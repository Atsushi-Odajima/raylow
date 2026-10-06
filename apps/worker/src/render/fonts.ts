import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../config.js';

/** 同梱フォント（Noto Sans JP / Noto Serif JP / Bricolage）を LibreOffice に見せる fontconfig を生成する。外部 CDN へ通信しない。 */
export function ensureFontConfig(): { fontconfigFile: string; fontsDir: string } {
  const dir = path.join(config.tmpDir, 'fontconfig');
  fs.mkdirSync(dir, { recursive: true });
  const cache = path.join(dir, 'cache');
  fs.mkdirSync(cache, { recursive: true });
  const file = path.join(dir, 'fonts.conf');
  // 可変フォントは LibreOffice が Type3 で書き出すため、静的インスタンス（assets/fonts/static）だけを見せる
  const staticDir = fs.existsSync(path.join(config.fontsDir, 'static')) ? path.join(config.fontsDir, 'static') : config.fontsDir;
  const xml = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${staticDir}</dir>
  <dir>/usr/share/fonts</dir>
  <dir>/usr/local/share/fonts</dir>
  <cachedir>${cache}</cachedir>
  <!-- 字体不足を一般字への置換で通過させないため、alias は追加しない -->
</fontconfig>
`;
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== xml) fs.writeFileSync(file, xml);
  return { fontconfigFile: file, fontsDir: config.fontsDir };
}

export function bundledFontManifest(): Array<{ file: string; sha256: string; bytes: number }> {
  const dir = fs.existsSync(path.join(config.fontsDir, 'static')) ? path.join(config.fontsDir, 'static') : config.fontsDir;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(ttf|otf)$/i.test(f))
    .map((f) => {
      const b = fs.readFileSync(path.join(dir, f));
      return { file: f, sha256: createHash('sha256').update(b).digest('hex'), bytes: b.length };
    });
}
