/**
 * 差込データの構築（§5.1/§6）
 * 差込値は plain text。本文の段落/見出し/番号はアプリ AST で保持し、renderer で行・段落群へ変換する。
 * 任意式・JS 実行・raw XML 挿入は禁止。XML escape は docxtemplater が行うが、ここでは文字列化だけを担う。
 */
import { formatJpy } from '@raylow/japanese-text';
import { formatWareki } from '@raylow/japanese-text';
import { astToLines, astToPlainText, type DocumentAST } from './ast.js';
import type { FieldSpec, TemplateFieldSchema } from './fieldSpec.js';
import type { FieldValues } from './validate.js';
import { isSafeTagKey } from './tags.js';

export interface RenderContext {
  documentStatusLabel: string;
  templateVersionLabel: string;
  issueDateIso: string | null;
  attachments: Array<{ name: string; copies: string }>;
}

export type RenderData = Record<string, string | boolean | Array<Record<string, string | boolean>>>;

function formatScalar(f: FieldSpec | undefined, raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'boolean') return raw ? 'はい' : 'いいえ';
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'string') {
    if (f?.outputFormat === 'wareki') {
      const w = formatWareki(raw, { digits: 'fullwidth' });
      return w ?? raw;
    }
    if (f?.outputFormat === 'jpy_grouped') {
      const o = raw as string;
      return /^\d+$/.test(o) ? formatJpy(o) : o;
    }
    return raw;
  }
  if (typeof raw === 'object') {
    const o = raw as { raw?: unknown; decimal?: unknown; iso?: unknown; displayValue?: unknown };
    if (f?.type === 'money') {
      if (f.outputFormat === 'jpy_grouped' && typeof o.decimal === 'string') return formatJpy(o.decimal);
      if (typeof o.raw === 'string') return o.raw;
    }
    if (f?.type === 'date') {
      if (f.outputFormat === 'wareki' && typeof o.iso === 'string') return formatWareki(o.iso, { digits: 'fullwidth' }) ?? (o.raw as string) ?? '';
      if (f.outputFormat === 'iso_date' && typeof o.iso === 'string') return o.iso;
      if (typeof o.raw === 'string') return o.raw;
    }
    if (typeof o.displayValue === 'string') return o.displayValue;
    if (typeof o.raw === 'string') return o.raw;
  }
  return '';
}

/** docxtemplater に渡す data。キーは allowlist のみ。 */
export function buildRenderData(schema: TemplateFieldSchema, values: FieldValues, ast: DocumentAST, ctx: RenderContext): RenderData {
  const data: RenderData = Object.create(null) as RenderData;
  const specs = new Map(schema.fields.map((f) => [f.key, f] as const));
  for (const [key, v] of Object.entries(values)) {
    if (!isSafeTagKey(key)) continue;
    const f = specs.get(key);
    if (f?.type === 'array') {
      const rows = Array.isArray(v.rawValue) ? (v.rawValue as Array<Record<string, unknown>>) : [];
      data[key] = rows.map((row) => {
        const out: Record<string, string | boolean> = Object.create(null) as Record<string, string | boolean>;
        for (const it of f.itemFields ?? []) {
          const val = row[it.key];
          out[it.key] = typeof val === 'boolean' ? val : formatScalar(undefined, val);
        }
        return out;
      });
      data[`has_${key}`] = rows.length > 0;
      continue;
    }
    if (f?.type === 'boolean') {
      data[key] = v.rawValue === true;
      continue;
    }
    const display = typeof v.displayValue === 'string' && v.displayValue.length > 0 ? v.displayValue : formatScalar(f, v.rawValue);
    data[key] = display;
  }
  // 本文
  const lines = astToLines(ast);
  data[schema.bodyTag] = astToPlainText(ast);
  data.body_blocks = lines.map((l) => ({
    text: l.text,
    number_label: l.numberLabel,
    is_heading: l.kind === 'heading',
    is_numbered: l.kind === 'numbered',
    is_paragraph: l.kind === 'paragraph' || l.kind === 'evidence',
  }));
  // 添付
  data.attachments = ctx.attachments.map((a) => ({ name: a.name, copies: a.copies }));
  data.has_attachments = ctx.attachments.length > 0;
  // システム供給
  data.document_status_label = ctx.documentStatusLabel;
  data.template_version_label = ctx.templateVersionLabel;
  if (ctx.issueDateIso) {
    data.issue_date = data.issue_date && typeof data.issue_date === 'string' && data.issue_date.length > 0 ? data.issue_date : ctx.issueDateIso;
    data.issue_date_wareki = formatWareki(ctx.issueDateIso, { digits: 'fullwidth' }) ?? ctx.issueDateIso;
  }
  return data;
}
