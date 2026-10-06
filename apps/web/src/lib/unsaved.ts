/**
 * 未保存状態の登録簿。
 * - beforeunload 警告
 * - Service Worker 更新は未保存が無いときだけ適用する
 */
type Listener = (hasUnsaved: boolean) => void;

const keys = new Set<string>();
const listeners = new Set<Listener>();

function emit(): void {
  const has = keys.size > 0;
  for (const l of listeners) l(has);
}

export const unsavedRegistry = {
  set(key: string, dirty: boolean): void {
    const before = keys.size > 0;
    if (dirty) keys.add(key);
    else keys.delete(key);
    const after = keys.size > 0;
    if (before !== after) emit();
  },
  clear(key: string): void {
    this.set(key, false);
  },
  hasUnsaved(): boolean {
    return keys.size > 0;
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (unsavedRegistry.hasUnsaved()) {
      e.preventDefault();
      // 一部ブラウザは returnValue を必要とする
      e.returnValue = '';
    }
  });
}
