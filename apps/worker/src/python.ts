import { spawn } from 'node:child_process';
import path from 'node:path';
import { config } from './config.js';

export class ToolError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false) {
    super(message);
  }
}

/** python3 -I で隔離実行（スクリプトディレクトリからの import を防ぐ） */
export function runPython(script: string, args: string[], timeoutMs = 120_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.python, ['-I', path.join(config.documentWorkerDir, script), ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', PYTHONIOENCODING: 'utf-8' } });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new ToolError('timeout', `${script} が ${timeoutMs}ms で完了しませんでした`, true));
    }, timeoutMs);
    proc.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    proc.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    proc.on('error', (e) => { clearTimeout(timer); reject(new ToolError('tool_unavailable', `python 起動失敗: ${e.message}`, true)); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) return reject(new ToolError('tool_failed', `${script} exit ${code}: ${err.slice(0, 500)}`));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new ToolError('tool_failed', `${script} の出力を解析できません: ${out.slice(0, 200)} ${err.slice(0, 200)}`));
      }
    });
  });
}
