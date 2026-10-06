import { useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { sessionStore, useSession } from '../lib/session';
import { LoginForm } from '../components/LoginForm';
import { BrandBlock } from '../layout/AppShell';

/** MFA 画面では過去の文書を表示しない（この画面は AppShell の外） */
export function LoginPage() {
  const state = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const from = (location.state as { from?: string } | null)?.from ?? '/create';

  useEffect(() => {
    // 画面表示時に旧 cache を破棄
    qc.clear();
    if (state.status === 'unknown') void sessionStore.refresh();
  }, [qc, state.status]);

  if (state.status === 'ready' && state.info?.authenticated && state.info.mfaVerified && !state.expired) {
    return <Navigate to={from.startsWith('/') ? from : '/create'} replace />;
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <BrandBlock />
        <h1 className="h-ja" style={{ fontSize: 22 }}>
          ログイン
        </h1>
        <LoginForm
          onSuccess={async (s) => {
            sessionStore.setInfo(s);
            sessionStore.clearExpired();
            await sessionStore.refresh();
            navigate(from.startsWith('/') ? from : '/create', { replace: true });
          }}
        />
        <p className="aux muted">所内ユーザーは認証アプリ（TOTP）による二要素認証が必須です。共有端末では利用後に必ずログアウトしてください。</p>
      </div>
    </div>
  );
}
