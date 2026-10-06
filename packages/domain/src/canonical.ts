/**
 * canonical JSON serialization（§8）
 * 草案 snapshot の hash は原文を含む canonical JSON から計算する。検索キーや表示正規化を hash 元にしない。
 * 規則: オブジェクトキーを code unit 順にソート、undefined は省略、文字列は JSON.stringify（Unicode は変更しない）、
 * 数値は JSON 表現、配列は順序維持。
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(v: unknown): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string':
      return JSON.stringify(v);
    case 'number':
      if (!Number.isFinite(v)) throw new Error('non-finite number not allowed in canonical JSON');
      return JSON.stringify(v);
    case 'boolean':
      return v ? 'true' : 'false';
    case 'undefined':
      throw new Error('undefined not allowed at top level');
    case 'bigint':
      return JSON.stringify(v.toString());
    case 'object': {
      if (Array.isArray(v)) {
        return '[' + v.map((x) => (x === undefined ? 'null' : serialize(x))).join(',') + ']';
      }
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + serialize(o[k])).join(',') + '}';
    }
    default:
      throw new Error(`unsupported type ${typeof v}`);
  }
}

/** SHA-256 hex（WebCrypto。Node 22 / ブラウザ共通） */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashCanonical(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}
