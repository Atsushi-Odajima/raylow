import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'apps/api/src/**/*.test.ts', 'apps/worker/src/**/*.test.ts'],
          exclude: ['**/*.db.test.ts', '**/*.templates.test.ts', '**/*.security.test.ts', '**/*.export.test.ts', '**/*.unicode.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'db',
          include: ['tests/db/**/*.db.test.ts'],
          environment: 'node',
          testTimeout: 120000,
          hookTimeout: 300000,
          fileParallelism: false,
          setupFiles: ['tests/helpers/env.ts'],
          globalSetup: ['tests/helpers/global-setup.ts'],
        },
      },
      {
        test: {
          name: 'unicode',
          include: ['tests/unicode/**/*.unicode.test.ts'],
          environment: 'node',
          testTimeout: 120000,
          hookTimeout: 300000,
          fileParallelism: false,
          setupFiles: ['tests/helpers/env.ts'],
          globalSetup: ['tests/helpers/global-setup.ts'],
        },
      },
      {
        test: {
          name: 'templates',
          include: ['tests/templates/**/*.templates.test.ts'],
          environment: 'node',
          testTimeout: 300000,
          hookTimeout: 300000,
          fileParallelism: false,
          setupFiles: ['tests/helpers/env.ts'],
        },
      },
      {
        test: {
          name: 'export',
          include: ['tests/export/**/*.export.test.ts'],
          environment: 'node',
          testTimeout: 120000,
          hookTimeout: 300000,
          fileParallelism: false,
          setupFiles: ['tests/helpers/env.ts'],
          globalSetup: ['tests/helpers/global-setup.ts'],
        },
      },
      {
        test: {
          name: 'security',
          include: ['tests/security/**/*.security.test.ts'],
          environment: 'node',
          testTimeout: 180000,
          hookTimeout: 300000,
          fileParallelism: false,
          setupFiles: ['tests/helpers/env.ts'],
          globalSetup: ['tests/helpers/global-setup.ts'],
        },
      },
    ],
  },
});
