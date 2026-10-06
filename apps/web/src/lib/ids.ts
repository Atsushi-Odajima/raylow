/** UUID / block ID 生成（crypto.randomUUID）。block ID は ^[A-Za-z0-9_-]+$ 64 文字以内 */
export function newUuid(): string {
  const c = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // fallback（暗号学的強度は不要な UI 用途）
  const bytes = new Uint8Array(16);
  if (c) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newBlockId(): string {
  return `b_${newUuid().replace(/-/g, '').slice(0, 20)}`;
}
