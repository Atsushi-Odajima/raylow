/**
 * 草案の差込 snapshot（§6 不変条件）
 * 選択時に事務所・案件・宛先・書式・文例の版を snapshot する。
 * 文書のフィールドは {rawValue, displayValue, sourceId, sourceVersion, manuallyOverridden} を保持する。
 */
import { hashCanonical } from '@raylow/domain';
import { findInvisible } from '@raylow/japanese-text';
import { type DocumentAST, type FieldValues, type TemplateFieldSchema, parseTemplateFieldSchema, validateFieldValues, isFieldVisible } from '@raylow/template-schema';
import type { DraftSnapshot, PreflightIssue, PreflightReport, RecipientSnapshot, RecipientType, RefreshCandidateSchema } from '@raylow/contracts';
import type { z } from 'zod';
import type { Tx } from '../db/pool.js';
import { notFound } from '../errors.js';

type Row = Record<string, unknown>;
export type RefreshCandidate = z.infer<typeof RefreshCandidateSchema>;

export interface SourceBundle {
  office: Row | null;
  matter: Row;
  lawyer: Row | null;
  recipient: Row | null;
  clientNames: string[];
  opponentNames: string[];
  honorificSettings: Record<string, string>;
}

export async function loadSources(tx: Tx, matterId: string, recipientContactId: string | null, lawyerId: string | null): Promise<SourceBundle> {
  const m = await tx.query<Row>('SELECT * FROM public.matters WHERE id = $1', [matterId]);
  const matter = m.rows[0];
  if (!matter) throw notFound();
  const office = await tx.query<Row>('SELECT * FROM public.office_profiles WHERE org_id = $1 AND is_current', [matter.org_id]);
  let lawyer: Row | null = null;
  const lid = lawyerId ?? (matter.lead_lawyer_id as string | null);
  if (lid) {
    const l = await tx.query<Row>('SELECT * FROM public.lawyers WHERE id = $1 AND org_id = $2', [lid, matter.org_id]);
    lawyer = l.rows[0] ?? null;
  }
  let recipient: Row | null = null;
  if (recipientContactId) {
    const r = await tx.query<Row>('SELECT * FROM public.contacts WHERE id = $1 AND org_id = $2', [recipientContactId, matter.org_id]);
    recipient = r.rows[0] ?? null;
    if (!recipient) throw notFound();
  }
  const parties = await tx.query<{ role: string; name_raw: string }>('SELECT p.role, c.name_raw FROM public.matter_parties p JOIN public.contacts c ON c.id = p.contact_id WHERE p.matter_id = $1 ORDER BY p.created_at', [matterId]);
  return {
    office: office.rows[0] ?? null,
    matter,
    lawyer,
    recipient,
    clientNames: parties.rows.filter((p) => p.role === 'client').map((p) => p.name_raw),
    opponentNames: parties.rows.filter((p) => p.role === 'opponent').map((p) => p.name_raw),
    honorificSettings: (office.rows[0]?.honorific_settings as Record<string, string>) ?? { person: '様', lawyer: '先生', organization: '御中', court: '御中' },
  };
}

export function honorificFor(recipientType: RecipientType, contactType: string | null, settings: Record<string, string>): string {
  if (recipientType === 'court') return settings.court ?? '御中';
  if (recipientType === 'none') return '';
  if (contactType === 'lawyer') return settings.lawyer ?? '先生';
  if (contactType === 'organization') return settings.organization ?? '御中';
  return settings.person ?? '様';
}

export function buildRecipientSnapshot(recipientType: RecipientType, recipient: Row | null, settings: Record<string, string>, confirmedDirectToOpponent?: boolean): RecipientSnapshot {
  const snap: RecipientSnapshot = {
    type: recipientType,
    contactId: recipient ? (recipient.id as string) : null,
    contactVersion: recipient ? (recipient.version as number) : null,
    nameRaw: recipient ? (recipient.name_raw as string) : '',
    organizationNameRaw: recipient ? (recipient.organization_name_raw as string) : '',
    addressRaw: recipient ? (recipient.address_raw as string) : '',
    postcodeRaw: recipient ? (recipient.postcode_raw as string) : '',
    honorific: honorificFor(recipientType, recipient ? (recipient.type as string) : null, settings),
  };
  if (confirmedDirectToOpponent !== undefined) snap.confirmedDirectToOpponent = confirmedDirectToOpponent;
  return snap;
}

/** sourcePath → 値。氏名の一致だけで置換しない（ID で解決した row からのみ取り出す）。 */
export function resolveSourceValue(path: string, src: SourceBundle, recipient: RecipientSnapshot): { value: string; sourceId: string | null; sourceVersion: number | null } | null {
  const [kind, attr] = path.split('.', 2) as [string, string | undefined];
  if (!attr) return null;
  const pick = (row: Row | null, map: Record<string, string>, idKey: 'id', versionKey: string): { value: string; sourceId: string | null; sourceVersion: number | null } | null => {
    if (!row) return null;
    const col = map[attr];
    if (!col) return null;
    const v = row[col];
    return { value: v == null ? '' : String(v), sourceId: row[idKey] as string, sourceVersion: Number(row[versionKey]) };
  };
  switch (kind) {
    case 'office':
      return pick(src.office, { name: 'name_raw', address: 'address_raw', postcode: 'postcode_raw', phone: 'phone_raw', fax: 'fax_raw', email: 'email_raw' }, 'id', 'revision');
    case 'lawyer':
      return pick(src.lawyer, { name: 'name_raw', title: 'title_raw', registration_number: 'registration_number_raw' }, 'id', 'version');
    case 'matter': {
      if (attr === 'client_name') return { value: src.clientNames.join('、'), sourceId: src.matter.id as string, sourceVersion: Number(src.matter.version) };
      if (attr === 'opponent_name') return { value: src.opponentNames.join('、'), sourceId: src.matter.id as string, sourceVersion: Number(src.matter.version) };
      if (attr === 'acceptance_confirmed') return { value: src.matter.acceptance_status === 'confirmed' ? 'true' : 'false', sourceId: src.matter.id as string, sourceVersion: Number(src.matter.version) };
      return pick(src.matter, { title: 'title_raw', case_number: 'case_number_raw', court: 'court_raw', court_department: 'court_department_raw', scope: 'scope_raw' }, 'id', 'version');
    }
    case 'recipient': {
      const map: Record<string, string> = { name: recipient.nameRaw, organization: recipient.organizationNameRaw, address: recipient.addressRaw, postcode: recipient.postcodeRaw, honorific: recipient.honorific };
      const v = map[attr];
      if (v === undefined) return null;
      return { value: v, sourceId: recipient.contactId, sourceVersion: recipient.contactVersion };
    }
    default:
      return null;
  }
}

export function templateSchemaOf(row: Row): TemplateFieldSchema {
  const parsed = parseTemplateFieldSchema(row.field_schema);
  if (!parsed.schema) throw new Error('template schema invalid');
  return parsed.schema;
}

/** 初期差込 */
export function buildInitialFields(schema: TemplateFieldSchema, src: SourceBundle, recipient: RecipientSnapshot, today: string): FieldValues {
  const values: FieldValues = {};
  for (const f of schema.fields) {
    if (f.source !== 'input' && f.sourcePath) {
      const r = resolveSourceValue(f.sourcePath, src, recipient);
      // boolean 型の差込元（例: matter.acceptance_confirmed）は 'true'/'false' 文字列を boolean に戻す
      const raw: unknown = f.type === 'boolean' ? r?.value === 'true' : (r?.value ?? '');
      values[f.key] = { rawValue: raw, sourceId: r?.sourceId ?? null, sourceVersion: r?.sourceVersion ?? null, manuallyOverridden: false };
      continue;
    }
    let raw: unknown = '';
    if (f.type === 'boolean') raw = false;
    else if (f.type === 'array') raw = [];
    else if (f.defaultPolicy === 'today' && f.type === 'date') raw = today;
    else if (f.defaultPolicy === 'fixed' && f.defaultValue !== undefined && !f.legalJudgement) raw = f.defaultValue;
    values[f.key] = { rawValue: raw, sourceId: null, sourceVersion: null, manuallyOverridden: false };
  }
  return values;
}

/** 更新候補（元データ更新で既存草案を黙って変更しない。手入力上書きは保持） */
export function computeRefreshCandidates(schema: TemplateFieldSchema, current: FieldValues, src: SourceBundle, recipient: RecipientSnapshot): RefreshCandidate[] {
  const out: RefreshCandidate[] = [];
  for (const f of schema.fields) {
    if (f.source === 'input' || !f.sourcePath) continue;
    const r = resolveSourceValue(f.sourcePath, src, recipient);
    if (!r) continue;
    const cur = current[f.key];
    const curVal = cur ? (f.type === 'boolean' ? String(cur.rawValue === true) : String(cur.rawValue ?? '')) : '';
    if (curVal === r.value) continue;
    out.push({ fieldKey: f.key, label: f.label, currentValue: curVal, newValue: r.value, sourceKind: f.sourcePath.split('.')[0] as RefreshCandidate['sourceKind'], sourceId: r.sourceId, sourceVersion: r.sourceVersion, manuallyOverridden: cur?.manuallyOverridden === true });
  }
  return out;
}

export async function revisionHash(snapshot: DraftSnapshot, ast: DocumentAST, templateVersionId: string): Promise<string> {
  return hashCanonical({ snapshot, ast, templateVersionId });
}

export interface PreflightContext {
  schema: TemplateFieldSchema;
  snapshot: DraftSnapshot;
  ast: DocumentAST;
  templateStatus: string;
  sampleOnly: boolean;
  matter: Row;
  matterAgentsForOpponent: number;
  evidenceLabels: Map<string, { status: string }>;
  renderReport: Record<string, unknown> | null;
  recipientType: RecipientType;
  draftId: string;
}

/** Preflight（§7）: 形式検査。法的審査ではない。 */
export function computePreflight(ctx: PreflightContext): PreflightReport {
  const issues: PreflightIssue[] = [];
  const push = (i: Omit<PreflightIssue, 'kind'>) => issues.push({ ...i, kind: 'formal' });
  // (a) 必須
  for (const v of validateFieldValues(ctx.schema, ctx.snapshot.fields, ctx.snapshot.recipient.honorific || undefined)) {
    if (v.code === 'double_honorific') push({ severity: 'confirm', category: 'honorific', code: v.code, message: v.message, fieldKey: v.fieldKey });
    else push({ severity: v.severity === 'error' ? 'error' : 'warning', category: v.code === 'required_missing' ? 'required' : 'other', code: v.code, message: v.message, fieldKey: v.fieldKey });
  }
  // (b) 人物/事件番号の不一致
  const caseField = ctx.schema.fields.find((f) => f.sourcePath === 'matter.case_number');
  if (caseField) {
    const v = ctx.snapshot.fields[caseField.key];
    const cur = String(ctx.matter.case_number_raw ?? '');
    if (v && String(v.rawValue ?? '') !== cur && !v.manuallyOverridden) push({ severity: 'confirm', category: 'identity_mismatch', code: 'case_number_differs', message: `事件番号が案件情報（${cur || '未登録'}）と異なります。更新候補を確認してください`, fieldKey: caseField.key });
  }
  if (ctx.snapshot.recipient.type === 'opponent' && ctx.matterAgentsForOpponent > 0 && !ctx.snapshot.recipient.confirmedDirectToOpponent) {
    push({ severity: 'confirm', category: 'recipient_mixing', code: 'direct_to_represented_opponent', message: '相手方には代理人が登録されていますが、宛先が相手方本人になっています。可否はシステムが判定しません。確認してください' });
  }
  if (ctx.snapshot.recipient.type !== 'none' && !ctx.snapshot.recipient.nameRaw) push({ severity: 'error', category: 'required', code: 'recipient_missing', message: '宛先が選択されていません' });
  // (d) 未承認書式
  if (ctx.templateStatus !== 'published') push({ severity: 'error', category: 'template_unapproved', code: 'template_not_published', message: 'この書式版は公開されていません' });
  if (ctx.sampleOnly) push({ severity: 'warning', category: 'template_unapproved', code: 'template_sample_only', message: 'サンプル書式（要確認）です。正式出力には所内承認済みの書式版が必要です' });
  // (e) 証拠番号重複/参照切れ
  for (const b of ctx.ast.blocks) {
    if (b.type === 'evidenceRef') {
      const e = ctx.evidenceLabels.get(b.evidenceId);
      if (!e) push({ severity: 'error', category: 'evidence', code: 'evidence_ref_broken', message: `証拠参照 ${b.displayLabel} が台帳に見つかりません`, blockId: b.id });
      else if (e.status === 'superseded') push({ severity: 'error', category: 'evidence', code: 'evidence_superseded', message: `証拠 ${b.displayLabel} は訂正され別版になっています`, blockId: b.id });
    }
  }
  const evField = ctx.schema.fields.find((f) => f.type === 'array' && (f.key === 'evidence_rows' || f.key === 'submitted_evidence'));
  if (evField) {
    const rows = ctx.snapshot.fields[evField.key]?.rawValue;
    if (Array.isArray(rows)) {
      const seen = new Map<string, number>();
      rows.forEach((row, idx) => {
        const label = String((row as Record<string, unknown>).label ?? '');
        if (!label) return;
        if (seen.has(label)) push({ severity: 'error', category: 'evidence', code: 'evidence_label_duplicate', message: `証拠番号 ${label} が重複しています（${seen.get(label)! + 1} 行目と ${idx + 1} 行目）`, fieldKey: `${evField.key}[${idx}].label` });
        seen.set(label, idx);
      });
    }
  }
  // 書面番号衝突は routes 側で DB 検査し renderReport に入る
  // (c)(f)(g)(i) render worker の報告
  if (ctx.renderReport) {
    const rr = ctx.renderReport as { unreplacedTags?: string[]; missingFonts?: string[]; unembeddedFonts?: string[]; pages?: number; metadataFound?: string[]; warnings?: string[]; overflowCandidates?: string[] };
    for (const t of rr.unreplacedTags ?? []) push({ severity: 'error', category: 'unreplaced_tag', code: 'unreplaced_tag', message: `未置換タグ ${t} が残っています`, location: t });
    for (const f of rr.missingFonts ?? []) push({ severity: 'error', category: 'font', code: 'font_missing', message: `フォント ${f} が出力環境にありません（一般字体への置換で通過させません）` });
    for (const f of rr.unembeddedFonts ?? []) push({ severity: 'error', category: 'font', code: 'font_not_embedded', message: `フォント ${f} が PDF に埋め込まれていません` });
    for (const m of rr.metadataFound ?? []) push({ severity: 'warning', category: 'metadata', code: 'metadata_present', message: `内部メタデータ/コメント: ${m}（正式版では除去した派生物を出力します）` });
    for (const o of rr.overflowCandidates ?? []) push({ severity: 'confirm', category: 'layout', code: 'layout_overflow_candidate', message: `${o}：長い氏名等で段落が伸びている可能性があります。縮小や省略は自動で行いません。改行/余白の調整か新しい書式版で対応してください` });
    if (typeof rr.pages === 'number') push({ severity: 'warning', category: 'layout', code: 'page_count', message: `PDF ${rr.pages} 頁（添付・用紙を確認）` });
  } else {
    push({ severity: 'warning', category: 'layout', code: 'preview_not_rendered', message: '最新版の PDF がまだ生成されていません。プレビューを更新してください' });
  }
  // 字体未収録の可能性: PUA は正式出力を止める（適切な使用権のあるフォント追加または手動作成 PDF の取込へ）。IVS/SVS・制御文字は要確認。
  const scanText = (label: string, text: string, loc: { fieldKey?: string; blockId?: string }) => {
    for (const f of findInvisible(text)) {
      if (f.category === 'pua') push({ severity: 'error', category: 'font', code: 'pua_character', message: `${label} に私用領域文字 ${f.codePoint}（外字）があります。字体が未検証のため出力を止めます`, ...loc });
      else if (f.category === 'ivs' || f.category === 'variation_selector') push({ severity: 'confirm', category: 'font', code: 'variation_selector', message: `${label} に異体字セレクタ ${f.codePoint} があります。PDF の字形を確認してください`, ...loc });
      else if (f.category === 'bidi' || f.category === 'zero_width' || f.category === 'control' || f.category === 'nul') push({ severity: 'confirm', category: 'other', code: 'invisible_character', message: `${label} に ${f.description}（${f.codePoint}）があります。削除は自動で行いません`, ...loc });
    }
  };
  for (const f of ctx.schema.fields) {
    const v = ctx.snapshot.fields[f.key]?.rawValue;
    if (typeof v === 'string') scanText(f.label, v, { fieldKey: f.key });
    else if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { raw?: unknown }).raw === 'string') scanText(f.label, (v as { raw: string }).raw, { fieldKey: f.key });
  }
  for (const b of ctx.ast.blocks) if ('text' in b) scanText(`本文 ${b.id}`, b.text, { blockId: b.id });
  // 本文の未置換タグ風文字列（入力値に {..} が含まれる場合）
  for (const b of ctx.ast.blocks) {
    if ('text' in b && /\{[a-z_#/^][a-z0-9_]*\}/.test(b.text)) push({ severity: 'confirm', category: 'unreplaced_tag', code: 'tag_like_text_in_body', message: `本文にタグ風の文字列があります（${b.id}）。差込は行われません`, blockId: b.id });
  }
  // 非表示だが入力済みの項目は警告
  for (const f of ctx.schema.fields) {
    if (!isFieldVisible(f, ctx.snapshot.fields)) {
      const v = ctx.snapshot.fields[f.key];
      if (v && typeof v.rawValue === 'string' && v.rawValue.length > 0) push({ severity: 'warning', category: 'other', code: 'hidden_field_has_value', message: `${f.label} は非表示条件ですが値が入力されています（出力されません）`, fieldKey: f.key });
    }
  }
  const blocking = issues.some((i) => i.severity === 'error');
  return { issues, blocking, confirmationsRequired: issues.filter((i) => i.severity === 'confirm').map((i) => i.code), generatedAt: new Date().toISOString(), legalReviewNote: 'この検査は形式検査です。法的内容（受任、主張、期限、提出、文例の適用）の確認は担当弁護士が行います。システムは「法的問題なし」と判定しません。' };
}
