/**
 * CSV 移行（§12 / AC21）
 * - UTF-8 BOM 有無 / CP932 を選択（auto 検出）。encoding 失敗は置換せずエラー（strict decode）。
 * - RFC4180（引用符内カンマ/改行）。
 * - formula injection: 先頭が = + - @ TAB CR の値はエラー（取込側で拒否。出力側は別途エスケープ）。
 * - 同一 external_id 異内容は競合。未登録外部 ID 参照も停止。1 行のエラーで batch 全体を止める。
 */
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';
import type { Tx } from '../db/pool.js';

export type ImportKind = 'contacts' | 'matters' | 'matter_parties';
export type ImportRow = Record<string, string>;

export const IMPORT_COLUMNS: Record<ImportKind, { required: string[]; all: string[] }> = {
  contacts: { required: ['external_id', 'type', 'name_raw'], all: ['external_id', 'type', 'name_raw', 'kana', 'organization_name_raw', 'address_raw', 'postcode_raw', 'phone_raw', 'email_raw'] },
  matters: { required: ['external_id', 'title_raw'], all: ['external_id', 'title_raw', 'case_number_raw', 'court_raw', 'status', 'scope_raw'] },
  matter_parties: { required: ['matter_external_id', 'contact_external_id', 'role'], all: ['matter_external_id', 'contact_external_id', 'role'] },
};

export function decodeCsvStrict(buf: Buffer, encoding: 'utf8' | 'utf8_bom' | 'cp932' | 'auto'): { ok: true; text: string; encoding: string } | { ok: false; error: string; encoding: string } {
  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const tryUtf8 = (): string | null => {
    try {
      const dec = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
      return dec.decode(hasBom ? buf.subarray(3) : buf);
    } catch {
      return null;
    }
  };
  const tryCp932 = (): string | null => {
    // iconv-lite は不正バイトを U+FFFD に置換する。置換が 1 文字でもあれば strict 失敗とする（「?」置換を禁止）。
    // NEC/IBM 拡張には同じ文字に複数の符号位置があり byte 往復は可逆でないため、往復比較は行わない。
    const decoded = iconv.decode(buf, 'cp932');
    if (decoded.includes('\uFFFD')) return null;
    return decoded;
  };
  if (encoding === 'utf8' || encoding === 'utf8_bom') {
    const t = tryUtf8();
    return t === null ? { ok: false, error: 'UTF-8 として復号できないバイト列があります（置換はしません）', encoding: 'utf-8' } : { ok: true, text: t, encoding: hasBom ? 'utf-8-bom' : 'utf-8' };
  }
  if (encoding === 'cp932') {
    const t = tryCp932();
    return t === null ? { ok: false, error: 'CP932 として復号できないバイト列があります（置換はしません）', encoding: 'cp932' } : { ok: true, text: t, encoding: 'cp932' };
  }
  const u = tryUtf8();
  if (u !== null) return { ok: true, text: u, encoding: hasBom ? 'utf-8-bom' : 'utf-8' };
  const c = tryCp932();
  if (c !== null) return { ok: true, text: c, encoding: 'cp932' };
  return { ok: false, error: 'UTF-8 でも CP932 でも復号できません。エンコーディングを確認してください', encoding: 'unknown' };
}

export function parseCsvRows(text: string): { ok: true; rows: ImportRow[] } | { ok: false; error: string; row: number } {
  try {
    const rows = parse(text, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: false, trim: false, record_delimiter: ['\r\n', '\n', '\r'] }) as ImportRow[];
    return { ok: true, rows };
  } catch (e) {
    const err = e as { message?: string; lines?: number };
    return { ok: false, error: err.message ?? 'CSV の解析に失敗しました', row: err.lines ?? 0 };
  }
}

const FORMULA_RE = /^[=+\-@\t\r]/;

export interface RowError { row: number; column: string | null; code: string; message: string }

export async function validateImportRows(tx: Tx, orgId: string, kind: ImportKind, rows: ImportRow[]): Promise<RowError[]> {
  const errors: RowError[] = [];
  const cols = IMPORT_COLUMNS[kind];
  if (rows.length === 0) return [{ row: 0, column: null, code: 'empty', message: 'データ行がありません' }];
  const header = Object.keys(rows[0]!);
  for (const c of cols.required) if (!header.includes(c)) errors.push({ row: 1, column: c, code: 'missing_column', message: `列 ${c} がありません` });
  for (const c of header) if (!cols.all.includes(c)) errors.push({ row: 1, column: c, code: 'unknown_column', message: `未知の列 ${c}` });
  if (errors.length) return errors;
  const seen = new Map<string, string>();
  rows.forEach((r, idx) => {
    const line = idx + 2;
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'string' && v.length > 0 && FORMULA_RE.test(v)) errors.push({ row: line, column: k, code: 'formula_injection', message: `先頭が「${v[0] === '\t' ? 'TAB' : v[0]}」の値は取り込めません（数式注入対策）。原文は JSON/TXT で保存してください` });
      // eslint-disable-next-line no-control-regex
      if (typeof v === 'string' && /\u0000/.test(v)) errors.push({ row: line, column: k, code: 'nul_char', message: 'NUL 文字を含みます' });
    }
    for (const c of cols.required) if (!r[c]) errors.push({ row: line, column: c, code: 'required', message: `${c} が空です` });
    if (kind === 'contacts' && r.type && !['person', 'organization', 'lawyer'].includes(r.type)) errors.push({ row: line, column: 'type', code: 'invalid_enum', message: 'type は person/organization/lawyer' });
    if (kind === 'matters' && r.status && !['active', 'archived', 'closed'].includes(r.status)) errors.push({ row: line, column: 'status', code: 'invalid_enum', message: 'status は active/archived/closed' });
    if (kind === 'matter_parties' && r.role && !['client', 'opponent', 'co_party', 'third_party'].includes(r.role)) errors.push({ row: line, column: 'role', code: 'invalid_enum', message: 'role は client/opponent/co_party/third_party' });
    const idCol = kind === 'matter_parties' ? null : 'external_id';
    if (idCol && r[idCol]) {
      const sig = JSON.stringify(r);
      const prev = seen.get(r[idCol]!);
      if (prev && prev !== sig) errors.push({ row: line, column: idCol, code: 'external_id_conflict', message: `external_id ${r[idCol]} が異なる内容で重複しています` });
      seen.set(r[idCol]!, sig);
    }
  });
  if (kind === 'matter_parties') {
    const mids = [...new Set(rows.map((r) => r.matter_external_id!).filter(Boolean))];
    const cids = [...new Set(rows.map((r) => r.contact_external_id!).filter(Boolean))];
    const m = await tx.query<{ external_id: string }>('SELECT external_id FROM public.matters WHERE org_id = $1 AND external_id = ANY($2::text[])', [orgId, mids]);
    const c = await tx.query<{ external_id: string }>('SELECT external_id FROM public.contacts WHERE org_id = $1 AND external_id = ANY($2::text[])', [orgId, cids]);
    const mset = new Set(m.rows.map((x) => x.external_id));
    const cset = new Set(c.rows.map((x) => x.external_id));
    rows.forEach((r, idx) => {
      if (r.matter_external_id && !mset.has(r.matter_external_id)) errors.push({ row: idx + 2, column: 'matter_external_id', code: 'unknown_reference', message: `案件 ${r.matter_external_id} が未登録です（人を名前だけで結合しません）` });
      if (r.contact_external_id && !cset.has(r.contact_external_id)) errors.push({ row: idx + 2, column: 'contact_external_id', code: 'unknown_reference', message: `連絡先 ${r.contact_external_id} が未登録です` });
    });
  }
  return errors;
}

/** CSV 出力時の式注入対策: 先頭が = + - @ の値は先頭に ' を付けず、タブ/改行を保持したまま二重引用符で囲む。原文完全保存は JSON/TXT。 */
export function csvSafeCell(v: string): string {
  if (/^[=+\-@\t\r]/.test(v)) return `'${v}`;
  return v;
}
