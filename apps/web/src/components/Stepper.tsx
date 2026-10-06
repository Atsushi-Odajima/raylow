import type { ReactNode } from 'react';
import { Icon } from './Icon';

export interface Step<K extends string> {
  key: K;
  label: ReactNode;
  done?: boolean | undefined;
  disabledReason?: string | undefined;
}
export interface StepperProps<K extends string> {
  steps: Step<K>[];
  current: K;
  onSelect?: ((k: K) => void) | undefined;
  label: string;
}

export function Stepper<K extends string>({ steps, current, onSelect, label }: StepperProps<K>) {
  return (
    <ol className="stepper" aria-label={label}>
      {steps.map((s, i) => {
        const isCurrent = s.key === current;
        const cls = ['stepper__item', s.done ? 'stepper__item--done' : ''].join(' ').trim();
        const inner = (
          <>
            <span className="stepper__num num" aria-hidden="true">
              {s.done ? <Icon name="check" size={16} /> : i + 1}
            </span>
            <span>{s.label}</span>
            {s.done ? <span className="sr-only">（完了）</span> : null}
          </>
        );
        return (
          <li key={s.key}>
            {onSelect && !s.disabledReason ? (
              <button type="button" className={cls} aria-current={isCurrent ? 'step' : undefined} onClick={() => onSelect(s.key)}>
                {inner}
              </button>
            ) : (
              <span className={cls} aria-current={isCurrent ? 'step' : undefined} aria-disabled={s.disabledReason ? true : undefined} title={s.disabledReason}>
                {inner}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
