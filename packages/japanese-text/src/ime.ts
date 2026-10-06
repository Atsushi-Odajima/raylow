/**
 * IME 変換中の判定（§19 U03）。ブラウザ・サーバー両方から利用できる純関数。
 */
export interface ComposingLike {
  isComposing?: boolean;
  keyCode?: number;
  key?: string;
}

/** compositionstart〜compositionend の間、または keyCode 229 は変換中とみなす */
export function isComposingEvent(e: ComposingLike): boolean {
  return e.isComposing === true || e.keyCode === 229 || e.key === 'Process';
}

/** Enter による submit を許すか（変換中は禁止） */
export function shouldSubmitOnEnter(e: ComposingLike & { shiftKey?: boolean }): boolean {
  if (isComposingEvent(e)) return false;
  if (e.key !== 'Enter') return false;
  return e.shiftKey !== true;
}

export const AUTOSAVE_DEBOUNCE_MS = 700;
