import { Link } from 'react-router';
import { BrandBlock } from '../layout/AppShell';
import { Alert } from '../components/Alert';

export function AuthExpiredPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <BrandBlock />
        <h1 className="h-ja" style={{ fontSize: 22 }}>
          セッションの有効期限が切れました
        </h1>
        <Alert kind="info">
          30 分間操作がない、または 12 時間が経過したため、安全のためにログアウトしました。未保存の入力は保持されません（機密データは端末に保存しない方針です）。再ログイン後、権限を再確認してから画面を表示します。
        </Alert>
        <Link to="/login" className="btn btn-primary">
          ログイン画面へ
        </Link>
      </div>
    </div>
  );
}
