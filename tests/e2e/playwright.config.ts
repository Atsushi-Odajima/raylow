import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// 同梱 Chromium（PLAYWRIGHT_BROWSERS_PATH）と @playwright/test の版が異なる環境では executablePath を明示する
const preinstalled = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium';
const launchOptions = fs.existsSync(preinstalled) ? { executablePath: preinstalled } : {};

/**
 * E2E（ブラウザ）: 事前に `npm run dev`（API 3001 / web 5173）と seed 済み DB が必要。
 * 実機 iPhone の検証は含まない（HANDOFF 参照）。iPhone 相当の viewport（390×844）は Chromium のエミュレーションで実行する。
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.e2e\.ts/,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../../.data/playwright-report' }]],
  outputDir: '../../.data/test-results',
  use: {
    baseURL: process.env.RAYLOW_E2E_BASE ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, launchOptions } },
    { name: 'mobile-390', use: { ...devices['iPhone 13'], browserName: 'chromium', isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 }, launchOptions } },
  ],
});
