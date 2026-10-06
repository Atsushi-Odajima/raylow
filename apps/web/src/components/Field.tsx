import { useId, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface FieldProps {
  label: ReactNode;
  required?: boolean | undefined;
  hint?: ReactNode | undefined;
  error?: string | undefined;
  warning?: string | undefined;
  /** label の右に置く補助（バッジ等） */
  adornment?: ReactNode | undefined;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string | undefined;
}

/** ラベル・補足・エラーを id で結び付けるラッパー（aria-describedby） */
export function Field({ label, required, hint, error, warning, adornment, children, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const warnId = `${id}-warn`;
  const describedBy = [hint ? hintId : null, error ? errId : null, warning ? warnId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={['field', className ?? ''].join(' ').trim()}>
      <label className="field__label" htmlFor={id}>
        <span>{label}</span>
        {required ? <span className="field__required">必須</span> : null}
        {adornment}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint ? (
        <div id={hintId} className="field__hint">
          {hint}
        </div>
      ) : null}
      {warning ? (
        <div id={warnId} className="field__warning" role="status">
          <Icon name="alert" size={16} label="注意" />
          <span>{warning}</span>
        </div>
      ) : null}
      {error ? (
        <div id={errId} className="field__error" role="alert">
          <Icon name="alert" size={16} label="エラー" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}
