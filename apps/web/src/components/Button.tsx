import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  variant?: Variant | undefined;
  small?: boolean | undefined;
  block?: boolean | undefined;
  icon?: IconName | undefined;
  /** 無効のときは必ず理由を表示する（title + 併記テキスト） */
  disabledReason?: string | undefined;
  busy?: boolean | undefined;
  children?: ReactNode;
}

function classes(variant: Variant | undefined, small: boolean | undefined, block: boolean | undefined, extra?: string): string {
  return ['btn', variant === 'primary' ? 'btn-primary' : variant === 'quiet' ? 'btn-quiet' : variant === 'danger' ? 'btn-danger' : '', small ? 'btn-small' : '', block ? 'btn-block' : '', extra ?? '']
    .filter(Boolean)
    .join(' ');
}

export function Button({ variant, small, block, icon, disabledReason, busy, children, className, type = 'button', ...rest }: ButtonProps) {
  const reasonId = useId();
  const disabled = !!disabledReason || !!busy;
  const btn = (
    <button
      {...rest}
      type={type}
      className={classes(variant, small, block, className)}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      aria-busy={busy || undefined}
      title={disabledReason ?? rest.title}
      aria-describedby={disabledReason && !busy ? reasonId : rest['aria-describedby']}
    >
      {busy ? <Icon name="spinner" label="処理中" size={small ? 16 : 20} /> : icon ? <Icon name={icon} size={small ? 16 : 20} /> : null}
      {children}
    </button>
  );
  if (disabledReason && !busy) {
    return (
      <span className="btn-with-reason">
        {btn}
        <span id={reasonId} className="btn-reason aux" role="note">
          {disabledReason}
        </span>
      </span>
    );
  }
  return btn;
}

export interface LinkButtonProps {
  to: string;
  variant?: Variant | undefined;
  small?: boolean | undefined;
  block?: boolean | undefined;
  icon?: IconName | undefined;
  children: ReactNode;
  className?: string | undefined;
  state?: unknown;
}

export function LinkButton({ to, variant, small, block, icon, children, className, state }: LinkButtonProps) {
  return (
    <Link to={to} className={classes(variant, small, block, className)} state={state}>
      {icon ? <Icon name={icon} size={small ? 16 : 20} /> : null}
      {children}
    </Link>
  );
}
