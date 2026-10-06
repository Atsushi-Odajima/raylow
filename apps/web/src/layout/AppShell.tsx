import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useLogout } from '../api/auth';
import { useSession } from '../lib/session';
import { unsavedRegistry } from '../lib/unsaved';
import { LogoHorizontal, LogoMark } from '../components/Logo';
import { Icon, type IconName } from '../components/Icon';
import { SessionDialogs } from '../components/SessionDialogs';
import { ROLE_LABEL } from '../lib/labels';

const PRIMARY_NAV: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/create', label: '作成', icon: 'create' },
  { to: '/documents', label: '書類', icon: 'document' },
  { to: '/matters', label: '案件', icon: 'case' },
  { to: '/templates', label: '書式', icon: 'template' },
];

export function AppShell() {
  const state = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const user = state.info?.user;
  const role = state.info?.role;

  const onLogout = async () => {
    if (unsavedRegistry.hasUnsaved() && !window.confirm('未保存の入力があります。ログアウトすると失われます。続行しますか？')) return;
    await logout.mutateAsync();
    navigate('/login', { replace: true });
  };

  return (
    <>
      <header className="app-header">
        <div className="container app-header__inner">
          <Link to="/create" className="app-header__brand" aria-label="RayLaw 作成画面へ">
            <LogoHorizontal height={28} />
          </Link>
          <nav className="app-nav app-nav--header" aria-label="主要メニュー">
            {PRIMARY_NAV.map((n) => (
              <NavLink key={n.to} to={n.to}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="app-header__tools">
            <NavLink to="/reviews" title="確認待ち">
              <Icon name="review" size={20} label="確認待ち" />
              <span className="label-text">確認待ち</span>
            </NavLink>
            <NavLink to="/settings" title="設定">
              <Icon name="settings" size={20} label="設定" />
              <span className="label-text">設定</span>
            </NavLink>
            {user ? (
              <span className="app-header__user">
                {user.displayName}
                {role ? `（${ROLE_LABEL[role]}）` : ''}
              </span>
            ) : null}
            <button type="button" onClick={() => void onLogout()} title="ログアウト">
              <Icon name="logout" size={20} label="ログアウト" />
              <span className="label-text">ログアウト</span>
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="app-main">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="主要メニュー（モバイル）">
        <ul>
          {PRIMARY_NAV.map((n) => (
            <li key={n.to}>
              <NavLink to={n.to}>
                <Icon name={n.icon} size={20} />
                <span>{n.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <SessionDialogs />
    </>
  );
}

export function BrandBlock() {
  return (
    <div className="auth-brand">
      <LogoMark size={40} />
      <div>
        <div className="brand-wordmark" style={{ fontSize: 30 }}>
          RayLaw
        </div>
        <div className="auth-brand__desc">法律事務所の書類作成・訴訟準備</div>
      </div>
    </div>
  );
}
