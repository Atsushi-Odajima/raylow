// seed は API パッケージの TypeScript 実装を tsx で実行する
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './db-lib.mjs';

const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(ROOT, 'apps', 'api', 'src', 'seed', 'run.ts')], { stdio: 'inherit', env: process.env });
process.exit(r.status ?? 1);
