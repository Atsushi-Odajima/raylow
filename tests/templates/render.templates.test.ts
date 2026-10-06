/**
 * 20 書式の技術検証（AC04/AC05/AC09）: inspector OK、架空サンプルで DOCX 生成、未置換タグなし、PDF 変換、フォント埋込、文字列往復。
 * DB 不要。worker のモジュールを直接使う。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import PizZip from 'pizzip';
import { TEST_ROOT } from '../helpers/env.js';

const demoRoot = path.join(TEST_ROOT, 'templates', 'demo');
const kinds = fs.readdirSync(demoRoot).filter((d) => /^T\d{2}_/.test(d)).sort();
const outDir = path.join(TEST_ROOT, '.data', 'test-output', 'templates');

import type * as RenderMod from '../../apps/worker/src/render/docx.js';
import type * as PdfMod from '../../apps/worker/src/render/pdf.js';
import type * as SchemaMod from '@raylow/template-schema';
let render: typeof RenderMod;
let pdf: typeof PdfMod;
let ts: typeof SchemaMod;

function inspect(file: string): { ok: boolean; issues: Array<{ severity: string; code: string; location?: string }>; tags: Array<{ key: string; valid: boolean; kind: string; location: string }>; stats: Record<string, unknown> } {
  const out = execFileSync('python3', ['-I', path.join(TEST_ROOT, 'workers', 'documents', 'inspect_docx.py'), file], { encoding: 'utf8' });
  return JSON.parse(out);
}
function pdfFonts(file: string, expect?: string): { fonts: Array<{ name: string; embedded: boolean }>; unembeddedFonts: string[]; pages: number; missingTexts: string[]; hasText: boolean } {
  const args = ['-I', path.join(TEST_ROOT, 'workers', 'documents', 'pdf_fonts.py'), file];
  if (expect) args.push('--expect-text', expect);
  return JSON.parse(execFileSync('python3', args, { encoding: 'utf8' }));
}
function docxText(bytes: Buffer): string {
  const zip = new PizZip(bytes);
  return ['word/document.xml', 'word/header1.xml', 'word/footer1.xml'].map((n) => zip.file(n)?.asText() ?? '').join('\n').replace(/<[^>]+>/g, '');
}

beforeAll(async () => {
  render = await import('../../apps/worker/src/render/docx.js');
  pdf = await import('../../apps/worker/src/render/pdf.js');
  ts = await import('@raylow/template-schema');
  fs.mkdirSync(outDir, { recursive: true });
});

describe('20 書式: 検査・スキーマ・DOCX/PDF', () => {
  it('20 種類すべてが存在する', () => {
    expect(kinds).toHaveLength(20);
  });
  for (const kind of kinds) {
    describe(kind, () => {
      const dir = path.join(demoRoot, kind);
      it('inspector が error なしで通り、スキーマとタグが整合する', () => {
        const rep = inspect(path.join(dir, 'template.docx'));
        expect(rep.ok, JSON.stringify(rep.issues.filter((i) => i.severity === 'error'))).toBe(true);
        expect(Number(rep.stats.splitRunParagraphs ?? 0)).toBeGreaterThan(0); // run 分割タグを含む
        const parsed = ts.parseTemplateFieldSchema(JSON.parse(fs.readFileSync(path.join(dir, 'schema.json'), 'utf8')));
        expect(parsed.schema, JSON.stringify(parsed.issues)).not.toBeNull();
        const issues = ts.validateTemplateSchema(parsed.schema!, rep.tags.map((t) => ({ ...t, raw: `{${t.key}}` })) as never);
        expect(issues.filter((i) => i.severity === 'error'), JSON.stringify(issues)).toHaveLength(0);
        const prov = JSON.parse(fs.readFileSync(path.join(dir, 'provenance.json'), 'utf8')) as { sampleOnly: boolean; supervised: boolean };
        expect(prov.sampleOnly).toBe(true);
        expect(prov.supervised).toBe(false);
      });
      it('架空サンプルで DOCX を生成し未置換タグが無く、PDF でフォントが埋込され文字列が往復する', async () => {
        const parsed = ts.parseTemplateFieldSchema(JSON.parse(fs.readFileSync(path.join(dir, 'schema.json'), 'utf8')));
        const sample = JSON.parse(fs.readFileSync(path.join(dir, 'sample_values.json'), 'utf8')) as { values: Record<string, { rawValue: unknown }>; attachments?: Array<{ name: string; copies: string }>; renderContext?: Record<string, string> };
        const ast = JSON.parse(fs.readFileSync(path.join(dir, 'ast_sample.json'), 'utf8'));
        const data = ts.buildRenderData(parsed.schema!, sample.values as never, ast, { documentStatusLabel: 'サンプル・要確認', templateVersionLabel: '書式版 r1（サンプル）', issueDateIso: '2026-10-06', attachments: sample.attachments ?? [] });
        for (const [k, v] of Object.entries(sample.renderContext ?? {})) if (!(k in data) && ts.isSafeTagKey(k) && typeof v === 'string') data[k] = v;
        const tpl = fs.readFileSync(path.join(dir, 'template.docx'));
        const r = render.renderDocx(tpl, data, { statusLabel: 'サンプル・要確認', stripMetadata: true });
        expect(render.scanLeftoverTags(r.bytes)).toEqual([]);
        const text = docxText(r.bytes);
        expect(text).toContain('サンプル・要確認');
        // 全角数字・異体字・長い氏名が保持される
        const allRaw = JSON.stringify(sample.values);
        if (allRaw.includes('髙')) expect(text).toContain('髙');
        fs.writeFileSync(path.join(outDir, `${kind}.docx`), r.bytes);
        const c = await pdf.convertToPdf(r.bytes);
        const pdfPath = path.join(outDir, `${kind}.pdf`);
        fs.writeFileSync(pdfPath, c.pdf);
        const expectFile = path.join(outDir, `${kind}.expect.txt`);
        const expectTexts = Object.values(sample.values).map((v) => v.rawValue).filter((v): v is string => typeof v === 'string' && v.length >= 3 && v.length <= 20 && !v.includes('\n')).slice(0, 3);
        fs.writeFileSync(expectFile, expectTexts.join('\n'));
        const f = pdfFonts(pdfPath, expectFile);
        expect(f.pages).toBeGreaterThan(0);
        expect(f.hasText).toBe(true);
        expect(f.unembeddedFonts, JSON.stringify(f.fonts)).toEqual([]);
        expect(f.fonts.every((x) => /Noto(Serif|Sans)JP/.test(x.name)), JSON.stringify(f.fonts)).toBe(true);
        expect(f.missingTexts, 'PDF text extraction round trip').toEqual([]);
      });
    });
  }
});

describe('fixture: run 分割タグ・長い氏名・表の行ループ', () => {
  it('split_run_tags.docx が検査を通り正しく差し込まれる', async () => {
    const file = path.join(TEST_ROOT, 'tests', 'fixtures', 'docx', 'split_run_tags.docx');
    const rep = inspect(file);
    expect(rep.ok, JSON.stringify(rep.issues)).toBe(true);
    expect(rep.tags.map((t) => t.key)).toContain('office_name');
    const data = { office_name: '青葉法律事務所', recipient_name: '一般社団法人全国中小企業取引適正化推進協議会関東甲信越支部事務局', recipient_honorific: '御中', subject: '件名', matter_title: '案件', client_name: '依頼者', opponent_name: '相手方', issue_date_wareki: '令和８年１０月６日', lawyer_name: '青葉 花子', attachments: [{ name: '甲第１号証の１', copies: '１通' }, { name: '甲第２号証', copies: '２通' }], has_attachments: true, body_text: '本文', body_blocks: [], document_status_label: '' } as Record<string, string | boolean | Array<Record<string, string>>>;
    const tpl = fs.readFileSync(file);
    const iMod = render.renderDocx(tpl, data as never, { statusLabel: '', stripMetadata: false });
    const text = docxText(iMod.bytes);
    expect(text).toContain('青葉法律事務所');
    expect(text).toContain('一般社団法人全国中小企業取引適正化推進協議会関東甲信越支部事務局');
    expect(text).toContain('甲第１号証の１');
    expect(text).toContain('甲第２号証');
    expect(render.scanLeftoverTags(iMod.bytes)).toEqual([]);
  });
  it('未置換タグ（data 欠落）は render を失敗させる', () => {
    const file = path.join(TEST_ROOT, 'tests', 'fixtures', 'docx', 'split_run_tags.docx');
    expect(() => render.renderDocx(fs.readFileSync(file), { office_name: 'x' } as never, { statusLabel: '', stripMetadata: false })).toThrow(/未置換タグ/);
  });
  it('禁止 fixture は inspector が位置付きで拒否する', () => {
    const dir = path.join(TEST_ROOT, 'tests', 'fixtures', 'docx', 'forbidden');
    const expectations: Record<string, string> = { 'with_textbox.docx': 'textbox', 'with_comments.docx': 'comments', 'with_footnotes.docx': 'footnotes', 'with_tracked_changes.docx': 'tracked_changes', 'with_multiple_sections.docx': 'multiple_sections', 'with_external_rel.docx': 'external_relationship', 'with_ole.docx': 'ole_object', 'with_unsupported_field.docx': 'unsupported_field', 'with_vmerge_in_loop.docx': 'vmerge_in_loop', 'with_paragraph_spanning_tag.docx': 'paragraph_spanning_tag', 'with_unbalanced_loop.docx': 'unbalanced_loop', 'with_dot_tag.docx': 'dot_path_not_allowed', 'with_dangerous_key.docx': 'dangerous_key', 'with_expression_tag.docx': 'expression_not_allowed', 'macro_enabled.docm': 'macro_enabled' };
    for (const [file, code] of Object.entries(expectations)) {
      const rep = inspect(path.join(dir, file));
      expect(rep.ok, file).toBe(false);
      const hit = rep.issues.find((i) => i.code === code && i.severity === 'error');
      expect(hit, `${file}: ${JSON.stringify(rep.issues.map((i) => i.code))}`).toBeTruthy();
      expect(hit!.location, file).toBeTruthy();
    }
    expect(inspect(path.join(dir, 'clean_minimal.docx')).ok).toBe(true);
    expect(inspect(path.join(TEST_ROOT, 'tests', 'fixtures', 'docx', 'zip_bomb.docx')).issues.some((i) => i.code === 'compression_ratio')).toBe(true);
    expect(inspect(path.join(TEST_ROOT, 'tests', 'fixtures', 'docx', 'fake_mime.docx')).issues.some((i) => i.code === 'not_zip')).toBe(true);
  });
});
