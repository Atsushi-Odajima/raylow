/**
 * AC22/AC30 の導線: ログイン→MFA→/create→案件→書式→宛先→入力→本文→プレビュー→形式検査。
 * desktop と 390px（iPhone 相当のエミュレーション）で実行する。実機 iPhone は未検証。
 */
import { expect, test } from '@playwright/test';
import { login } from './helpers.js';

test.describe('受任通知の縦断導線', () => {
  test('ログインから草案 PDF プレビュー・形式検査まで', async ({ page, isMobile }, testInfo) => {
    // CSP 違反・未捕捉例外を集める（同一 origin 配信（WEB_DIST_DIR）時のセキュリティヘッダ検証を兼ねる）
    const violations: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy|Refused to/.test(m.text())) violations.push(m.text());
    });
    page.on('pageerror', (e) => violations.push(`pageerror: ${e.message}`));
    const started = Date.now();
    await login(page, 'lawyerA');
    await expect(page.getByRole('heading', { name: '書類を作る' })).toBeVisible();
    // S04 wizard
    await page.goto('/drafts/new');
    // PC は同一フォーム、mobile は段階式（「次へ」）
    const next = async () => { if (isMobile) await page.getByRole('button', { name: '次へ', exact: true }).click(); };
    await page.getByLabel('案件を検索').fill('売買');
    await page.getByRole('option', { name: /売買代金請求事件/ }).first().click();
    await next();
    const templates = page.getByRole('radiogroup', { name: '公開済みの書式' });
    await templates.locator('button, [role="radio"], label', { hasText: '受任通知' }).first().click();
    await next();
    await page.getByLabel('宛先種別').selectOption({ label: '相手方代理人' });
    await page.getByRole('option', { name: /佐藤 一郎/ }).first().click();
    await next();
    await page.getByRole('button', { name: '入力へ' }).click();
    await page.waitForURL(/\/drafts\/[0-9a-f-]+\/edit/, { timeout: 30_000 });
    // S05: 自動差込確認（自事務所/宛先）
    if (isMobile) await page.getByRole('tab', { name: '入力' }).click();
    await expect(page.getByLabel(/自事務所名/)).toHaveValue('青葉法律事務所');
    await expect(page.locator('input[value*="佐藤 一郎"]').first()).toBeVisible();
    await page.getByLabel(/件名/).first().fill('受任のご通知（E2E）');
    // PC も編集ペイン内は「入力/本文」タブ
    await page.getByRole('tab', { name: '本文' }).first().click();
    await page.getByRole('button', { name: '段落を追加' }).click();
    await page.getByLabel('1 番目の本文').fill('当職は依頼者から委任を受けました。（E2E 本文）');
    await expect(page.getByText(/保存済み/).first()).toBeVisible({ timeout: 20_000 });
    if (isMobile) await page.getByRole('tab', { name: 'プレビュー' }).click();
    await page.getByRole('button', { name: 'プレビューを更新' }).click();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 180_000 });
    // S06
    await page.getByRole('button', { name: '確認へ' }).first().click();
    await page.waitForURL(/\/check/);
    await expect(page.getByRole('heading', { name: '形式検査' })).toBeVisible();
    await expect(page.getByText(/法的審査/).first()).toBeVisible();
    const elapsed = Date.now() - started;
    testInfo.annotations.push({ type: 'AC30 login→preview→check ms', description: String(elapsed) });
    console.log(`AC30 ${testInfo.project.name}: login→preview→check = ${elapsed} ms`);
    expect(violations).toEqual([]);
  });
  test('ログアウト後に bfcache 復帰しても機密画面を表示しない', async ({ page }) => {
    await login(page, 'staff');
    await page.goto('/documents');
    await page.getByRole('button', { name: 'ログアウト' }).first().click();
    await page.waitForURL(/\/login/, { timeout: 20_000 });
    await page.goBack();
    await expect(page.getByLabel(/メールアドレス/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/受任通知（/)).toHaveCount(0);
  });
});
