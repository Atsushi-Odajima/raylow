/**
 * 制御入力。IME 変換中（compositionstart〜end / keyCode 229 / key=Process）は Enter で submit しない。
 * 入力値はそのまま onValueChange へ渡す（正規化しない）。inputMode numeric は本文・事件番号・人名へ使わない。
 */
import { forwardRef, useCallback, type InputHTMLAttributes, type KeyboardEvent, type CompositionEvent } from 'react';
import { isComposingEvent, shouldSubmitOnEnter } from '@raylow/japanese-text';
import { imeState } from '../lib/ime';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string;
  onValueChange: (value: string, composing: boolean) => void;
  /** 変換確定後の Enter（submit 相当）。変換中は呼ばれない */
  onEnter?: (() => void) | undefined;
  invalid?: boolean | undefined;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ value, onValueChange, onEnter, invalid, onKeyDown, onCompositionStart, onCompositionEnd, className, ...rest }, ref) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        if (!shouldSubmitOnEnter({ key: e.key, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode, shiftKey: e.shiftKey })) {
          e.preventDefault();
          return;
        }
        if (onEnter) {
          e.preventDefault();
          onEnter();
          return;
        }
      }
      onKeyDown?.(e);
    },
    [onEnter, onKeyDown],
  );
  const handleCompStart = useCallback(
    (e: CompositionEvent<HTMLInputElement>) => {
      imeState.begin();
      onCompositionStart?.(e);
    },
    [onCompositionStart],
  );
  const handleCompEnd = useCallback(
    (e: CompositionEvent<HTMLInputElement>) => {
      imeState.end();
      onCompositionEnd?.(e);
      // 一部ブラウザは compositionend 後に change が来ないため、確定値を通知する
      onValueChange(e.currentTarget.value, false);
    },
    [onCompositionEnd, onValueChange],
  );
  return (
    <input
      ref={ref}
      {...rest}
      className={['input', className ?? ''].join(' ').trim()}
      value={value}
      aria-invalid={invalid || undefined}
      onChange={(e) => onValueChange(e.currentTarget.value, isComposingEvent({ isComposing: (e.nativeEvent as InputEvent).isComposing }) || imeState.isComposing())}
      onKeyDown={handleKeyDown}
      onCompositionStart={handleCompStart}
      onCompositionEnd={handleCompEnd}
    />
  );
});
