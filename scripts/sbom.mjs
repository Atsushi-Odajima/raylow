// SBOM（CycloneDX 風 JSON）とライセンス一覧を docs/sbom/ へ生成する（npm パッケージ + Python + システム依存の手書き分）。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './db-lib.mjs';

const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const components = [];
for (const [key, pkg] of Object.entries(lock.packages)) {
  if (!key || key === '') continue;
  if (key.startsWith('apps/') || key.startsWith('packages/')) continue;
  const name = key.replace(/^.*node_modules\//, '');
  let license = pkg.license ?? null;
  if (!license) {
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(ROOT, key, 'package.json'), 'utf8'));
      license = typeof pj.license === 'string' ? pj.license : pj.license?.type ?? (Array.isArray(pj.licenses) ? pj.licenses.map((l) => l.type).join(' OR ') : null);
    } catch {
      license = null;
    }
  }
  components.push({ type: 'library', name, version: pkg.version, purl: `pkg:npm/${name}@${pkg.version}`, licenses: license ? [{ license: { id: license } }] : [], scope: pkg.dev ? 'optional' : 'required' });
}
const python = [
  { name: 'lxml', version: '6.1.3', license: 'BSD-3-Clause' },
  { name: 'pypdf', version: '6.17.0', license: 'BSD-3-Clause' },
  { name: 'pillow', version: '12.3.0', license: 'MIT-CMU' },
  { name: 'python-docx', version: '1.2.0', license: 'MIT' },
  { name: 'fonttools', version: '4.60.1', license: 'MIT' },
].map((p) => ({ type: 'library', name: p.name, version: p.version, purl: `pkg:pypi/${p.name}@${p.version}`, licenses: [{ license: { id: p.license } }], scope: 'required' }));
const system = [
  { name: 'LibreOffice', version: '24.2.7.2 (dev container) / Debian bookworm apt (Docker)', license: 'MPL-2.0' },
  { name: 'PostgreSQL', version: '16.15', license: 'PostgreSQL' },
  { name: 'ClamAV', version: '1.4.3 (docker image)', license: 'GPL-2.0' },
  { name: 'Caddy', version: '2.10.2', license: 'Apache-2.0' },
  { name: 'Noto Sans JP / Noto Serif JP', version: 'bundled (assets/fonts)', license: 'OFL-1.1' },
  { name: 'Bricolage Grotesque', version: 'bundled (assets/fonts)', license: 'OFL-1.1' },
].map((p) => ({ type: 'application', name: p.name, version: p.version, licenses: [{ license: { id: p.license } }], scope: 'required' }));
const bom = { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1, metadata: { timestamp: new Date().toISOString(), component: { type: 'application', name: 'raylow', version: '0.1.0' } }, components: [...components, ...python, ...system] };
fs.mkdirSync(path.join(ROOT, 'docs', 'sbom'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'sbom', 'sbom.cdx.json'), JSON.stringify(bom, null, 2));
const byLicense = {};
for (const c of bom.components) {
  const l = c.licenses[0]?.license.id ?? 'UNKNOWN';
  (byLicense[l] ??= []).push(`${c.name}@${c.version}`);
}
const md = ['# ライセンス一覧（自動生成: npm run sbom）', '', `生成: ${bom.metadata.timestamp}`, '', ...Object.entries(byLicense).sort().map(([l, v]) => `## ${l} (${v.length})\n\n${v.sort().map((x) => `- ${x}`).join('\n')}\n`)].join('\n');
fs.writeFileSync(path.join(ROOT, 'docs', 'sbom', 'LICENSES.md'), md);
console.log(`sbom: ${bom.components.length} components; licenses: ${Object.keys(byLicense).join(', ')}`);
