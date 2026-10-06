/**
 * 最小の polyfill。pdfjs-dist 5.7 は Map.prototype.getOrInsertComputed（ES2026 upsert）を使うため、
 * 未対応ブラウザ（Chromium 141 以前、Safari の一部）で PDF プレビューが落ちないよう補う。
 * 機能検出して無い場合だけ定義する（既存実装は上書きしない）。
 */
type MapLike<K, V> = { get(key: K): V | undefined; has(key: K): boolean; set(key: K, value: V): unknown };

function define<K, V>(proto: MapLike<K, V>): void {
  const p = proto as MapLike<K, V> & { getOrInsert?: (k: K, v: V) => V; getOrInsertComputed?: (k: K, f: (k: K) => V) => V };
  if (typeof p.getOrInsert !== 'function') {
    Object.defineProperty(p, 'getOrInsert', {
      value: function (this: MapLike<K, V>, key: K, value: V): V {
        if (this.has(key)) return this.get(key) as V;
        this.set(key, value);
        return value;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  if (typeof p.getOrInsertComputed !== 'function') {
    Object.defineProperty(p, 'getOrInsertComputed', {
      value: function (this: MapLike<K, V>, key: K, factory: (k: K) => V): V {
        if (this.has(key)) return this.get(key) as V;
        const v = factory(key);
        this.set(key, v);
        return v;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
}

define(Map.prototype as unknown as MapLike<unknown, unknown>);
define(WeakMap.prototype as unknown as MapLike<object, unknown>);
