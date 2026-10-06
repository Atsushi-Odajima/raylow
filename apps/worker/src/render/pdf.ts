import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { ensureFontConfig } from './fonts.js';
import { ToolError } from '../python.js';

let cachedVersion: string | null = null;
export function sofficeVersion(): string {
  if (cachedVersion) return cachedVersion;
  const r = spawnSync(config.soffice, ['--version'], { encoding: 'utf8', timeout: 30_000 });
  cachedVersion = (r.stdout || r.stderr || 'unknown').split('\n')[0]!.trim() || 'unknown';
  return cachedVersion;
}

/** LibreOffice headless で DOCX → PDF。job ごとの一時領域、固定フォント、timeout 300 秒。外部 URL は取得させない。 */
export async function convertToPdf(docxBytes: Buffer, timeoutMs = 300_000): Promise<{ pdf: Buffer; converterVersion: string; durationMs: number }> {
  const { fontconfigFile } = ensureFontConfig();
  const work = path.join(config.tmpDir, 'render', randomUUID());
  await fs.mkdir(work, { recursive: true });
  const inPath = path.join(work, 'input.docx');
  await fs.writeFile(inPath, docxBytes);
  const profile = path.join(work, 'profile');
  const started = Date.now();
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(config.soffice, [`-env:UserInstallation=file://${profile}`, '--headless', '--nologo', '--norestore', '--nodefault', '--nolockcheck', '--convert-to', 'pdf:writer_pdf_Export', '--outdir', work, inPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH ?? '', HOME: work, FONTCONFIG_FILE: fontconfigFile, LANG: 'ja_JP.UTF-8', SAL_USE_VCLPLUGIN: 'svp', no_proxy: '*', NO_PROXY: '*' },
      });
      let err = '';
      proc.stderr.on('data', (d: Buffer) => (err += d.toString()));
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new ToolError('timeout', `PDF 変換が ${timeoutMs}ms で完了しませんでした`, true));
      }, timeoutMs);
      proc.on('error', (e) => { clearTimeout(timer); reject(new ToolError('converter_unavailable', `soffice 起動失敗: ${e.message}`, true)); });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new ToolError('converter_failed', `soffice exit ${code}: ${err.slice(0, 500)}`, code === null));
      });
    });
    const pdfPath = path.join(work, 'input.pdf');
    const pdf = await fs.readFile(pdfPath).catch(() => null);
    if (!pdf || pdf.length < 100) throw new ToolError('converter_failed', 'PDF が生成されませんでした', true);
    return { pdf, converterVersion: sofficeVersion(), durationMs: Date.now() - started };
  } finally {
    // 一時ディレクトリは job 終了時に清掃
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}
