import type { ReactNode } from 'react';
import { Link } from 'react-router';

export interface Crumb {
  to?: string | undefined;
  label: ReactNode;
}
export interface PageHeaderProps {
  title: ReactNode;
  lead?: ReactNode | undefined;
  crumbs?: Crumb[] | undefined;
  actions?: ReactNode | undefined;
  /** 英語見出し（ロゴ書体）を使うか。通常は和文見出し */
  en?: boolean | undefined;
}

export function PageHeader({ title, lead, crumbs, actions, en }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        {crumbs && crumbs.length > 0 ? (
          <nav aria-label="現在地" className="breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i}>
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
                {i < crumbs.length - 1 ? <span aria-hidden="true"> / </span> : null}
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className={en ? 'h-en' : 'h-ja'}>{title}</h1>
        {lead ? <p className="page-header__lead">{lead}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}
