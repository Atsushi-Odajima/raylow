import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type AlertKind = 'info' | 'success' | 'warning' | 'error';

const ICON: Record<AlertKind, IconName> = { info: 'info', success: 'check', warning: 'alert', error: 'alert' };
const LABEL: Record<AlertKind, string> = { info: '情報', success: '完了', warning: '注意', error: 'エラー' };

export interface AlertProps {
  kind: AlertKind;
  title?: ReactNode | undefined;
  children?: ReactNode;
  actions?: ReactNode | undefined;
  /** 動的に出る通知は role=alert / status */
  live?: boolean | undefined;
  className?: string | undefined;
}

/** 状態を色だけで示さない: アイコン＋種別テキスト＋本文 */
export function Alert({ kind, title, children, actions, live, className }: AlertProps) {
  return (
    <div className={['alert', `alert-${kind}`, className ?? ''].join(' ').trim()} role={live ? (kind === 'error' ? 'alert' : 'status') : undefined}>
      <span className="alert__icon">
        <Icon name={ICON[kind]} size={20} label={LABEL[kind]} />
      </span>
      <div className="alert__body stack-s">
        {title ? <div className="alert__title">{title}</div> : null}
        {children ? <div>{children}</div> : null}
        {actions ? <div className="row">{actions}</div> : null}
      </div>
    </div>
  );
}
