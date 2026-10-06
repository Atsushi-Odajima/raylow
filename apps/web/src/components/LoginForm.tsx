/**
 * email+password → MFA コード（未登録なら enroll: otpauth URL と手入力用 secret を表示）。
 * ログイン画面と「セッション切れ」ダイアログの両方で使う。過去の文書は表示しない。
 */
import { useState } from 'react';
import type { SessionInfo } from '@raylow/contracts';
import { login, mfaEnroll, mfaEnrollConfirm, mfaVerify } from '../api/auth';
import { isApiError } from '../lib/apiClient';
import { Alert } from './Alert';
import { Button } from './Button';
import { Field } from './Field';
import { Input } from './Input';

type Stage = 'credentials' | 'mfa' | 'enroll';

export function LoginForm({ onSuccess, compact }: { onSuccess: (s: SessionInfo) => void; compact?: boolean | undefined }) {
  const [stage, setStage] = useState<Stage>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [enroll, setEnroll] = useState<{ otpauthUrl: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  const submitCredentials = async () => {
    setBusy(true);
    setError(null);
    setFieldErr({});
    try {
      const r = await login({ email, password });
      setPassword('');
      if (r.mfaEnrolled) setStage('mfa');
      else {
        const e = await mfaEnroll();
        setEnroll(e);
        setStage('enroll');
      }
    } catch (e) {
      if (isApiError(e)) {
        if (e.status === 401) setError('メールアドレスまたはパスワードが正しくありません。');
        else if (e.status === 429) setError('試行回数が多すぎます。しばらく待ってから再試行してください。');
        else if (e.isValidation) {
          const m: Record<string, string> = {};
          for (const fe of e.fieldErrors) m[fe.field] = fe.message;
          setFieldErr(m);
          setError('入力内容を確認してください。');
        } else setError(e.userMessage());
      } else setError('ログインに失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    if (!/^\d{6}$/.test(code)) {
      setFieldErr({ code: '6 桁の数字を入力してください（全角の場合は半角に直してください）' });
      return;
    }
    setBusy(true);
    setError(null);
    setFieldErr({});
    try {
      const s = stage === 'enroll' ? await mfaEnrollConfirm(code) : await mfaVerify(code);
      setCode('');
      onSuccess(s);
    } catch (e) {
      if (isApiError(e) && e.status === 401) setError('認証コードが正しくないか、期限が切れています。認証アプリの現在のコードを入力してください。');
      else if (isApiError(e) && e.status === 429) setError('試行回数が多すぎます。しばらく待ってから再試行してください。');
      else setError(isApiError(e) ? e.userMessage() : '認証に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  if (stage === 'credentials') {
    return (
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submitCredentials();
        }}
        noValidate
      >
        {error ? (
          <Alert kind="error" live>
            {error}
          </Alert>
        ) : null}
        <Field label="メールアドレス" required error={fieldErr.email}>
          {({ id, describedBy, invalid }) => <Input id={id} type="email" value={email} onValueChange={setEmail} aria-describedby={describedBy} invalid={invalid} autoComplete="username" inputMode="email" required />}
        </Field>
        <Field label="パスワード" required error={fieldErr.password}>
          {({ id, describedBy, invalid }) => <Input id={id} type="password" value={password} onValueChange={setPassword} aria-describedby={describedBy} invalid={invalid} autoComplete="current-password" required />}
        </Field>
        <Button type="submit" variant="primary" block={!compact} busy={busy}>
          次へ（認証コード）
        </Button>
      </form>
    );
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void submitCode();
      }}
      noValidate
    >
      {stage === 'enroll' && enroll ? (
        <Alert kind="info" title="認証アプリを登録してください（初回のみ）">
          <div className="stack-s">
            <div>認証アプリ（TOTP）に次の URL を登録するか、キーを手入力してください。登録後に表示される 6 桁のコードを入力します。</div>
            <div className="mono wrap-anywhere">{enroll.otpauthUrl}</div>
            <div>
              手入力用キー: <b className="mono">{enroll.secret}</b>
            </div>
            <div className="row">
              <Button small onClick={() => void navigator.clipboard?.writeText(enroll.otpauthUrl)}>
                URL をコピー
              </Button>
              <Button small onClick={() => void navigator.clipboard?.writeText(enroll.secret)}>
                キーをコピー
              </Button>
            </div>
          </div>
        </Alert>
      ) : null}
      {error ? (
        <Alert kind="error" live>
          {error}
        </Alert>
      ) : null}
      <Field label="認証コード（6 桁）" required error={fieldErr.code} hint="認証アプリに表示されている現在のコード">
        {({ id, describedBy, invalid }) => <Input id={id} value={code} onValueChange={setCode} aria-describedby={describedBy} invalid={invalid} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} autoFocus />}
      </Field>
      <div className="row-between">
        <Button variant="quiet" onClick={() => setStage('credentials')} disabledReason={busy ? '処理中' : undefined}>
          戻る
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
          {stage === 'enroll' ? '登録して続行' : 'ログイン'}
        </Button>
      </div>
    </form>
  );
}
