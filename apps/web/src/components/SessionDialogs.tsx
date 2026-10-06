/**
 * 401 → 再ログインダイアログ（再ログイン後に権限を再確認し、未保存状態を説明）。
 * mfa_required → 認証コード再確認（step-up）ダイアログ。
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { stepUp } from '../api/auth';
import { isApiError } from '../lib/apiClient';
import { sessionStore, useSession } from '../lib/session';
import { unsavedRegistry } from '../lib/unsaved';
import { Alert } from './Alert';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Field } from './Field';
import { Input } from './Input';
import { LoginForm } from './LoginForm';

export function SessionDialogs() {
  const state = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hasUnsaved = unsavedRegistry.hasUnsaved();
  const prevUser = state.info?.user?.id ?? null;

  if (state.expired === 'unauthorized') {
    return (
      <Dialog open title="セッションが切れました" modalOnly cover describedBy="sess-desc">
        <div id="sess-desc" className="stack-s">
          <Alert kind="warning" title={hasUnsaved ? '未保存の入力があります' : '再ログインが必要です'}>
            {hasUnsaved
              ? 'この画面の未保存の内容はブラウザのメモリ上に保持されています。再ログイン後に保存をやり直してください。ページを閉じると失われます。'
              : '一定時間操作がなかったため、安全のためセッションを終了しました。再ログイン後、権限を再確認してから画面を表示します。'}
          </Alert>
        </div>
        <LoginForm
          compact
          onSuccess={async (s) => {
            sessionStore.setInfo(s);
            sessionStore.clearExpired();
            const info = await sessionStore.refresh();
            // 権限再確認: 別ユーザー/別組織なら画面を破棄して作成画面へ
            if (!info.user || info.user.id !== prevUser) {
              qc.clear();
              navigate('/create', { replace: true });
              return;
            }
            void qc.invalidateQueries();
          }}
        />
      </Dialog>
    );
  }

  if (state.expired === 'mfa_required') {
    const submit = async () => {
      if (!/^\d{6}$/.test(code)) {
        setErr('6 桁の数字を入力してください');
        return;
      }
      setBusy(true);
      setErr(null);
      try {
        const s = await stepUp(code);
        sessionStore.setInfo(s);
        sessionStore.clearExpired();
        setCode('');
      } catch (e) {
        setErr(isApiError(e) && e.status === 401 ? '認証コードが正しくありません。' : '確認に失敗しました。');
      } finally {
        setBusy(false);
      }
    };
    return (
      <Dialog
        open
        title="重要操作のため認証コードを再確認します"
        onClose={() => sessionStore.clearExpired()}
        actions={
          <>
            <Button variant="quiet" onClick={() => sessionStore.clearExpired()}>
              キャンセル
            </Button>
            <Button variant="primary" onClick={() => void submit()} busy={busy}>
              確認
            </Button>
          </>
        }
      >
        <p>承認・公開などの重要操作は、15 分以内に認証コードの確認が必要です。入力中の内容は保持されています。確認後に操作をやり直してください。</p>
        {err ? (
          <Alert kind="error" live>
            {err}
          </Alert>
        ) : null}
        <Field label="認証コード（6 桁）" required>
          {({ id }) => <Input id={id} value={code} onValueChange={setCode} inputMode="numeric" autoComplete="one-time-code" maxLength={6} onEnter={() => void submit()} autoFocus />}
        </Field>
      </Dialog>
    );
  }
  return null;
}
