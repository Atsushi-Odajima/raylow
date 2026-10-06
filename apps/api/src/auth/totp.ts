import * as OTPAuth from 'otpauth';

export function newTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function totpUri(secret: string, email: string, issuer = 'RayLaw'): string {
  const totp = new OTPAuth.TOTP({ issuer, label: email, algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
  return totp.toString();
}

/** 検証。使用済み counter の再利用を防ぐため counter を返す。 */
export function verifyTotp(secret: string, code: string, lastUsedCounter: number | null): { ok: boolean; counter: number | null } {
  const totp = new OTPAuth.TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) return { ok: false, counter: null };
  const counter = Math.floor(Date.now() / 1000 / 30) + delta;
  if (lastUsedCounter !== null && counter <= lastUsedCounter) return { ok: false, counter: null };
  return { ok: true, counter };
}

export function generateTotpCode(secret: string): string {
  return new OTPAuth.TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate();
}
