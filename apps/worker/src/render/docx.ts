/**
 * DOCX レンダリング（§5.1）: Docxtemplater OSS core + PizZip。
 * - タグは allowlist キーのみ。dot 探索・任意式・eval・raw XML 挿入は不可（parser を固定）。
 * - 文字列は docxtemplater が XML escape。改行は linebreaks: true で w:br へ。
 * - 未置換タグは render 前に検出して失敗させる（nullGetter で黙って空にしない）。
 * - 草案表記: {document_status_label} が無い書式には本文先頭へ段落を挿入する。
 * - 正式版: docProps のメタデータを除去した派生物を出力する。
 */
import Docxtemplater, { type DXT } from 'docxtemplater';
import PizZip from 'pizzip';
import InspectModuleImport from 'docxtemplater/js/inspect-module.js';

interface InspectModuleInstance {
  getAllTags(): Record<string, unknown>;
  getTags(file?: string): Record<string, unknown>;
}
// CJS の module.exports = class を ESM default import で受ける（NodeNext の型解決差を吸収）
const InspectModule = InspectModuleImport as unknown as new () => InspectModuleInstance & { set?: unknown };
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { isSafeTagKey, type RenderData } from '@raylow/template-schema';

export interface RenderResult {
  bytes: Buffer;
  tagsInTemplate: string[];
  unreplacedTags: string[];
  insertedStatusParagraph: boolean;
}

export class RenderError extends Error {
  constructor(public readonly code: string, message: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function collectTags(doc: Docxtemplater, iModule: InspectModuleInstance): string[] {
  void doc;
  const tags = iModule.getAllTags() as Record<string, unknown>;
  const keys = new Set<string>();
  const walk = (o: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(o)) {
      keys.add(k);
      if (v && typeof v === 'object') walk(v as Record<string, unknown>);
    }
  };
  walk(tags);
  return [...keys];
}

function dataHas(data: RenderData, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

/** 配列 item 内のキーも含めて、テンプレートの全タグが data で供給されるか */
function findUnreplaced(iModule: InspectModuleInstance, data: RenderData): string[] {
  const tags = iModule.getAllTags() as Record<string, unknown>;
  const missing: string[] = [];
  const check = (o: Record<string, unknown>, scope: Record<string, unknown>[], prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      const present = scope.some((s) => Object.prototype.hasOwnProperty.call(s, k));
      if (!present) missing.push(prefix + k);
      if (v && typeof v === 'object' && Object.keys(v as object).length > 0) {
        // ループ内: data[k] が配列ならその要素をスコープに追加
        const arr = scope.map((s) => s[k]).find((x) => Array.isArray(x)) as Array<Record<string, unknown>> | undefined;
        const inner = arr && arr.length > 0 ? [...arr, ...scope] : scope;
        check(v as Record<string, unknown>, inner, `${prefix}${k}.`);
      }
    }
  };
  check(tags, [data as unknown as Record<string, unknown>], '');
  return missing;
}

export function renderDocx(templateBytes: Buffer, data: RenderData, opts: { statusLabel: string; stripMetadata: boolean }): RenderResult {
  // キーの安全性を再検査
  for (const k of Object.keys(data)) if (!isSafeTagKey(k) && !k.startsWith('has_')) throw new RenderError('unsafe_key', `許可されないキー ${k}`);
  let zip: PizZip;
  try {
    zip = new PizZip(templateBytes);
  } catch (e) {
    throw new RenderError('bad_docx', `DOCX を開けません: ${(e as Error).message}`);
  }
  const iModule = new InspectModule();
  let doc: Docxtemplater;
  try {
    doc = new Docxtemplater(zip, {
      modules: [iModule as unknown as DXT.Module],
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{', end: '}' },
      parser: (tag: string) => {
        const key = tag.trim();
        if (!isSafeTagKey(key) && !key.startsWith('has_')) throw new RenderError('tag_not_allowed', `許可されないタグ {${tag}}`);
        return {
          get: (scope: unknown) => {
            const s = scope as Record<string, unknown> | null;
            if (!s || typeof s !== 'object') return undefined;
            return Object.prototype.hasOwnProperty.call(s, key) ? s[key] : undefined;
          },
        };
      },
      nullGetter: (part: { value: string }) => {
        throw new RenderError('unreplaced_tag', `未置換タグ {${part.value}}`, { tag: part.value });
      },
    });
  } catch (e) {
    if (e instanceof RenderError) throw e;
    const err = e as { properties?: { errors?: Array<{ properties?: { explanation?: string; id?: string; xtag?: string } }> }; message?: string };
    const first = err.properties?.errors?.[0]?.properties;
    throw new RenderError('template_compile_error', first?.explanation ?? err.message ?? 'テンプレートを解釈できません', { id: first?.id, tag: first?.xtag });
  }
  const tagsInTemplate = collectTags(doc, iModule);
  const unreplaced = findUnreplaced(iModule, data);
  if (unreplaced.length) throw new RenderError('unreplaced_tag', `未置換タグ: ${unreplaced.join(', ')}`, { unreplacedTags: unreplaced });
  try {
    doc.render(data as unknown as Record<string, unknown>);
  } catch (e) {
    if (e instanceof RenderError) throw e;
    const err = e as { properties?: { errors?: Array<{ properties?: { explanation?: string } }> }; message?: string };
    throw new RenderError('render_failed', err.properties?.errors?.[0]?.properties?.explanation ?? err.message ?? 'render failed');
  }
  const outZip = doc.getZip() as PizZip;
  let insertedStatusParagraph = false;
  if (opts.statusLabel && !tagsInTemplate.includes('document_status_label')) {
    const xml = outZip.file('word/document.xml')?.asText();
    if (xml) {
      const dom = new DOMParser().parseFromString(xml, 'application/xml');
      const body = dom.getElementsByTagNameNS(W_NS, 'body')[0];
      if (body) {
        const p = dom.createElementNS(W_NS, 'w:p');
        const r = dom.createElementNS(W_NS, 'w:r');
        const rPr = dom.createElementNS(W_NS, 'w:rPr');
        const b = dom.createElementNS(W_NS, 'w:b');
        rPr.appendChild(b);
        r.appendChild(rPr);
        const t = dom.createElementNS(W_NS, 'w:t');
        t.setAttribute('xml:space', 'preserve');
        t.appendChild(dom.createTextNode(opts.statusLabel));
        r.appendChild(t);
        p.appendChild(r);
        body.insertBefore(p, body.firstChild);
        outZip.file('word/document.xml', new XMLSerializer().serializeToString(dom));
        insertedStatusParagraph = true;
      }
    }
  }
  if (opts.stripMetadata) {
    const core = outZip.file('docProps/core.xml')?.asText();
    if (core) {
      const dom = new DOMParser().parseFromString(core, 'application/xml');
      for (const ln of ['creator', 'lastModifiedBy', 'title', 'subject', 'description', 'keywords', 'category', 'contentStatus']) {
        const els = dom.getElementsByTagName('dc:' + ln).length ? dom.getElementsByTagName('dc:' + ln) : dom.getElementsByTagName('cp:' + ln);
        for (let i = 0; i < els.length; i++) {
          const el = els.item(i);
          if (el) while (el.firstChild) el.removeChild(el.firstChild);
        }
      }
      outZip.file('docProps/core.xml', new XMLSerializer().serializeToString(dom));
    }
    if (outZip.file('docProps/custom.xml')) outZip.remove('docProps/custom.xml');
    const ct = outZip.file('[Content_Types].xml')?.asText();
    if (ct && ct.includes('docProps/custom.xml')) outZip.file('[Content_Types].xml', ct.replace(/<Override[^>]*PartName="\/docProps\/custom\.xml"[^>]*\/>/, ''));
    const rels = outZip.file('_rels/.rels')?.asText();
    if (rels && rels.includes('docProps/custom.xml')) outZip.file('_rels/.rels', rels.replace(/<Relationship[^>]*Target="docProps\/custom\.xml"[^>]*\/>/, ''));
  }
  const bytes = outZip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
  return { bytes, tagsInTemplate, unreplacedTags: [], insertedStatusParagraph };
}

/** 生成後の DOCX 本文テキストから `{key}` 風の残存を探す（二重検査） */
export function scanLeftoverTags(bytes: Buffer): string[] {
  const zip = new PizZip(bytes);
  const out = new Set<string>();
  for (const name of Object.keys(zip.files)) {
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(name)) continue;
    const xml = zip.file(name)!.asText();
    const text = xml.replace(/<[^>]+>/g, '');
    for (const m of text.matchAll(/\{[#/^]?[a-z][a-z0-9_]*\}/g)) out.add(m[0]);
  }
  return [...out];
}
