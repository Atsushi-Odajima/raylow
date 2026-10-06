/** 複数行入力（IME ガード付き）。Enter は改行。Ctrl/Cmd+Enter も変換中は無視 */
import { forwardRef, useCallback, type TextareaHTMLAttributes, type KeyboardEvent, type CompositionEvent } from 'react';
import { isComposingEvent } from '@raylow/japanese-text';
import { imeState } from '../lib/ime';

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> {
  value: string;
  onValueChange: (value: string, composing: boolean) => void;
  /** Ctrl/Cmd+Enter（変換中は呼ばれない） */
  onSubmitShortcut?: (() => void) | undefined;
  invalid?: boolean | undefined;
  short?: boolean | undefined;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { value, onValueChange, onSubmitShortcut, invalid, short, onKeyDown, onCompositionStart, onCompositionEnd, className, ...rest },
  ref,
) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (isComposingEvent({ isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode, key: e.key })) {
        // 変換中はショートカットを走らせない
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.preventDefault();
        return;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSubmitShortcut) {
        e.preventDefault();
        onSubmitShortcut();
        return;
      }
      onKeyDown?.(e);
    },
    [onSubmitShortcut, onKeyDown],
  );
  const handleCompStart = useCallback(
    (e: CompositionEvent<HTMLTextAreaElement>) => {
      imeState.begin();
      onCompositionStart?.(e);
    },
    [onCompositionStart],
  );
  const handleCompEnd = useCallback(
    (e: CompositionEvent<HTMLTextAreaElement>) => {
      imeState.end();
      onCompositionEnd?.(e);
      onValueChange(e.currentTarget.value, false);
    },
    [onCompositionEnd, onValueChange],
  );
  return (
    <textarea
      ref={ref}
      {...rest}
      className={['textarea', short ? 'textarea-short' : '', className ?? ''].join(' ').trim()}
      value={value}
      aria-invalid={invalid || undefined}
      onChange={(e) => onValueChange(e.currentTarget.value, isComposingEvent({ isComposing: (e.nativeEvent as InputEvent).isComposing }) || imeState.isComposing())}
      onKeyDown={handleKeyDown}
      onCompositionStart={handleCompStart}
      onCompositionEnd={handleCompEnd}
    />
  );
});
