import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { sessionStore, useSession } from '../lib/session';
import { LoadingState } from '../components/States';

/** 認証・MFA 済みでなければ /login。確認中（初回・bfcache 復帰）は画面を隠す */
export function RequireAuth() {
  const state = useSession();
  const location = useLocation();
  useEffect(() => {
    if (state.status === 'unknown') void sessionStore.refresh();
  }, [state.status]);

  if (state.status === 'unknown' || (state.status === 'checking' && !state.info)) {
    return (
      <div className="container" style={{ paddingTop: 'var(--space-8)' }}>
        <LoadingState label="権限を確認しています…" />
      </div>
    );
  }
  if (state.status === 'checking') {
    // bfcache 復帰・再ログイン後など: 再検証が終わるまで旧画面を不透明に覆って隠す。
    // Outlet は unmount しない（未保存の入力をメモリ上に保持するため）
    return (
      <>
        <div aria-hidden="true" style={{ visibility: 'hidden' }}>
          <Outlet />
        </div>
        <div className="auth-cover" role="status" aria-live="polite">
          <LoadingState label="権限を再確認しています…" />
        </div>
      </>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="container" style={{ paddingTop: 'var(--space-8)' }}>
        <div className="state-box" role="alert">
          <div>サーバーに接続できません。接続を確認して再読み込みしてください。</div>
          <button type="button" className="btn" onClick={() => void sessionStore.refresh()}>
            再試行
          </button>
        </div>
      </div>
    );
  }
  const info = state.info;
  if (!info || !info.authenticated || !info.mfaVerified) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}
