/**
 * IME 変換中の全体フラグ（§19 U03 / AC08）。
 * compositionstart〜compositionend の間は autosave・submit・ショートカットを走らせない。
 * Input/TextArea 部品が自動で begin/end を呼ぶ。
 */
let composingCount = 0;
const settledWaiters = new Set<() => void>();

export const imeState = {
  begin(): void {
    composingCount += 1;
  },
  end(): void {
    composingCount = Math.max(0, composingCount - 1);
    if (composingCount === 0) {
      const ws = [...settledWaiters];
      settledWaiters.clear();
      for (const w of ws) w();
    }
  },
  isComposing(): boolean {
    return composingCount > 0;
  },
  /** 変換が確定するまで待つ（既に確定済みなら即時） */
  whenSettled(): Promise<void> {
    if (composingCount === 0) return Promise.resolve();
    return new Promise((resolve) => settledWaiters.add(resolve));
  },
};
