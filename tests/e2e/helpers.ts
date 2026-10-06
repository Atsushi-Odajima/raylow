import fs from 'node:fs';
import path from 'node:path';
import * as OTPAuth from 'otpauth';
import type { Page } from '@playwright/test';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export interface Creds { users: Array<{ key: string; email: string; password: string; totpSecret: string }>; ids: { matters: Record<string, string>; contacts: Record<string, string> } }
export function creds(): Creds {
  const p = process.env.RAYLOW_SEED_CREDENTIALS ?? path.join(root, '.data', 'seed-credentials.json');
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Creds;
}
export function totp(secret: string): string {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate();
}
/** ログイン→MFA。同一 30 秒内の TOTP 再利用は拒否されるため、401 のときは次の時刻ステップを待って再試行する。 */
export async function login(page: Page, userKey: string): Promise<void> {
  const u = creds().users.find((x) => x.key === userKey)!;
  await page.goto('/login');
  await page.getByLabel(/メールアドレス/).fill(u.email);
  await page.getByLabel(/^パスワード/).fill(u.password);
  await page.getByRole('button', { name: '次へ（認証コード）' }).click();
  const code = page.getByLabel(/認証コード/);
  await code.waitFor({ timeout: 20_000 });
  for (let attempt = 0; attempt < 2; attempt++) {
    await code.fill(totp(u.totpSecret));
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    try {
      await page.waitForURL(/\/create/, { timeout: 15_000 });
      return;
    } catch {
      const wait = (30 - (Math.floor(Date.now() / 1000) % 30)) * 1000 + 500;
      await page.waitForTimeout(wait);
    }
  }
  await page.waitForURL(/\/create/, { timeout: 30_000 });
}
