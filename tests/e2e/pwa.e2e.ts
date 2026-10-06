import { expect, test } from '@playwright/test';

test('manifest と service worker が配信され、API は cache されない', async ({ page, request }) => {
  const m = await request.get('/manifest.webmanifest');
  expect(m.ok()).toBeTruthy();
  const json = (await m.json()) as { name: string; start_url: string; display: string; theme_color: string; background_color: string; icons: Array<{ sizes: string; purpose?: string }> };
  expect(json.name).toBe('RayLaw');
  expect(json.start_url).toBe('/create');
  expect(json.display).toBe('standalone');
  expect(json.theme_color.toUpperCase()).toBe('#59385F');
  expect(json.background_color.toUpperCase()).toBe('#F3F0F5');
  expect(json.icons.some((i) => i.sizes === '192x192')).toBeTruthy();
  expect(json.icons.some((i) => i.sizes === '512x512' && i.purpose?.includes('maskable'))).toBeTruthy();
  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBeTruthy();
  const swText = await sw.text();
  expect(swText).toContain('/api/');
  await page.goto('/login');
  const html = await page.content();
  expect(html).toContain('apple-touch-icon');
  expect(html).toContain('viewport-fit=cover');
  const api = await request.get('/api/health');
  expect(api.headers()['cache-control']).toContain('no-store');
});
