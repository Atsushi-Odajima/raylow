import type { Draft, DraftDetail, DraftOutput, DraftRevision, DraftSnapshot, PreflightReport, RecipientType } from '@raylow/contracts';
import { checkApproval } from '@raylow/domain';
import type { DocumentAST } from '@raylow/template-schema';
import type { Actor, Tx } from '../db/pool.js';
import { notFound } from '../errors.js';
import { computePreflight, templateSchemaOf } from './drafts.js';

type Row = Record<string, unknown>;

export function draftOut(r: Row): Draft {
  return {
    id: r.id as string, orgId: r.org_id as string, matterId: r.matter_id as string, matterTitleRaw: (r.matter_title_raw as string) ?? '', templateId: r.template_id as string, templateName: (r.template_name as string) ?? '', kind: r.kind as string, titleRaw: r.title_raw as string, status: r.status as Draft['status'],
    recipientType: r.recipient_type as RecipientType, recipientContactId: (r.recipient_contact_id as string | null) ?? null, currentRevisionId: (r.current_revision_id as string | null) ?? null, approvedRevisionId: (r.approved_revision_id as string | null) ?? null, batchId: (r.batch_id as string | null) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string, version: r.version as number,
  };
}

export function revisionOut(r: Row): DraftRevision {
  return {
    id: r.id as string, draftId: r.draft_id as string, revision: r.revision as number, templateVersionId: r.template_version_id as string, snapshot: r.snapshot_json as DraftSnapshot, ast: r.ast_json as DocumentAST, sourceRevisionId: (r.source_revision_id as string | null) ?? null, kind: r.kind as 'app' | 'external_edit',
    externalFileVersionId: (r.external_file_version_id as string | null) ?? null, hash: r.hash as string, createdAt: r.created_at as string, createdBy: (r.created_by as string | null) ?? null, createdByName: (r.created_by_name as string | null) ?? null,
  };
}

export function outputOut(r: Row): DraftOutput {
  return { id: r.id as string, revisionId: r.revision_id as string, format: r.format as 'docx' | 'pdf', mode: r.mode as 'draft' | 'final', fileId: r.file_id as string, sha256: r.sha256 as string, rendererVersion: r.renderer_version as string, fontManifest: (r.font_manifest as unknown[]) ?? [], status: r.status as DraftOutput['status'], createdAt: r.created_at as string };
}

export const DRAFT_SELECT = `SELECT d.*, m.title_raw AS matter_title_raw, t.name AS template_name FROM public.drafts d JOIN public.matters m ON m.id = d.matter_id JOIN public.templates t ON t.id = d.template_id`;
export const REVISION_SELECT = `SELECT r.*, u.display_name_raw AS created_by_name FROM public.draft_revisions r LEFT JOIN public.app_users u ON u.id = r.created_by`;

export async function loadDraftRow(tx: Tx, id: string): Promise<Row> {
  const r = await tx.query<Row>(`${DRAFT_SELECT} WHERE d.id = $1`, [id]);
  if (!r.rows[0]) throw notFound();
  return r.rows[0];
}

export async function loadRevision(tx: Tx, id: string): Promise<DraftRevision | null> {
  const r = await tx.query<Row>(`${REVISION_SELECT} WHERE r.id = $1`, [id]);
  return r.rows[0] ? revisionOut(r.rows[0]) : null;
}

export async function buildPreflight(tx: Tx, draft: Row, revision: DraftRevision | null): Promise<PreflightReport | null> {
  if (!revision) return null;
  const tv = await tx.query<Row>('SELECT * FROM public.template_versions WHERE id = $1', [revision.templateVersionId]);
  const tvRow = tv.rows[0];
  if (!tvRow) return null;
  const matter = await tx.query<Row>('SELECT * FROM public.matters WHERE id = $1', [draft.matter_id]);
  const agents = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM public.matter_agents a JOIN public.matter_parties p ON p.id = a.represented_party_id WHERE a.matter_id = $1 AND p.role = 'opponent' AND (a.valid_to IS NULL OR a.valid_to >= current_date)`, [draft.matter_id]);
  const ev = await tx.query<{ id: string; status: string }>('SELECT id, status FROM public.evidence WHERE matter_id = $1', [draft.matter_id]);
  const out = await tx.query<Row>(`SELECT preflight_report FROM public.draft_outputs WHERE revision_id = $1 AND format = 'pdf' AND status = 'ready' ORDER BY created_at DESC LIMIT 1`, [revision.id]);
  const report = computePreflight({
    schema: templateSchemaOf(tvRow),
    snapshot: revision.snapshot,
    ast: revision.ast,
    templateStatus: tvRow.status as string,
    sampleOnly: tvRow.sample_only as boolean,
    matter: matter.rows[0] ?? {},
    matterAgentsForOpponent: Number(agents.rows[0]?.n ?? 0),
    evidenceLabels: new Map(ev.rows.map((e) => [e.id, { status: e.status }])),
    renderReport: (out.rows[0]?.preflight_report as Record<string, unknown> | null) ?? null,
    recipientType: draft.recipient_type as RecipientType,
    draftId: draft.id as string,
  });
  // 書面番号衝突（T14）
  const schema = templateSchemaOf(tvRow);
  const briefNoField = schema.fields.find((f) => f.key === 'brief_number');
  if (briefNoField) {
    const v = revision.snapshot.fields.brief_number?.rawValue;
    if (typeof v === 'string' && v.length > 0) {
      const dup = await tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM public.drafts d2 JOIN public.draft_revisions r2 ON r2.id = d2.current_revision_id WHERE d2.matter_id = $1 AND d2.id <> $2 AND d2.kind = $3 AND d2.status NOT IN ('archived','superseded') AND r2.snapshot_json -> 'fields' -> 'brief_number' ->> 'rawValue' = $4`,
        [draft.matter_id, draft.id, draft.kind, v],
      );
      if (Number(dup.rows[0]!.n) > 0) {
        report.issues.push({ severity: 'error', category: 'other', code: 'brief_number_conflict', message: `準備書面番号「${v}」は同じ案件の別文書で使われています`, fieldKey: 'brief_number', kind: 'formal' });
        report.blocking = true;
      }
    }
  }
  return report;
}

export async function loadDraftDetail(tx: Tx, actor: Actor, id: string): Promise<DraftDetail> {
  const draftRow = await loadDraftRow(tx, id);
  const current = draftRow.current_revision_id ? await loadRevision(tx, draftRow.current_revision_id as string) : null;
  const approved = draftRow.approved_revision_id ? await loadRevision(tx, draftRow.approved_revision_id as string) : null;
  const outs = await tx.query<Row>(`SELECT o.* FROM public.draft_outputs o JOIN public.draft_revisions r ON r.id = o.revision_id WHERE r.draft_id = $1 ORDER BY o.created_at DESC`, [id]);
  const lease = await tx.query<Row>(`SELECT l.*, u.display_name_raw FROM public.edit_leases l JOIN public.app_users u ON u.id = l.user_id WHERE l.draft_id = $1 AND l.expires_at > now()`, [id]);
  const tvId = current?.templateVersionId ?? null;
  const tv = tvId ? await tx.query<Row>('SELECT tv.*, t.name AS template_name FROM public.template_versions tv JOIN public.templates t ON t.id = tv.template_id WHERE tv.id = $1', [tvId]) : null;
  const tvRow = tv?.rows[0];
  if (!tvRow) throw notFound();
  const jobs = await tx.query<Row>(`SELECT id, type, state, progress_json FROM public.jobs WHERE payload ->> 'draftId' = $1 AND state IN ('queued','running') ORDER BY created_at`, [id]);
  const review = await tx.query<{ id: string }>(`SELECT rv.id FROM public.reviews rv JOIN public.draft_revisions r ON r.id = rv.revision_id WHERE r.draft_id = $1 AND rv.status = 'pending' ORDER BY rv.created_at DESC LIMIT 1`, [id]);
  const flags = await tx.query<{ can_edit: boolean; assigned: boolean }>('SELECT app.can_edit_matter($1) AS can_edit, app.is_assigned_lawyer($1) AS assigned', [draftRow.matter_id]);
  const preflight = await buildPreflight(tx, draftRow, current);
  const canApprove = current
    ? checkApproval({ actorUserId: actor.userId, actorRole: actor.role, actorIsMatterMember: flags.rows[0]!.can_edit || flags.rows[0]!.assigned, actorIsBarrier: false, actorIsAssignedLawyer: flags.rows[0]!.assigned, lastEditorUserId: current.createdBy ?? '', targetHash: current.hash, currentHash: current.hash, draftStatus: draftRow.status as string }).ok
    : false;
  return {
    draft: draftOut(draftRow),
    currentRevision: current,
    approvedRevision: approved,
    outputs: outs.rows.map(outputOut),
    lease: lease.rows[0] ? { draftId: id, userId: lease.rows[0].user_id as string, userName: lease.rows[0].display_name_raw as string, expiresAt: lease.rows[0].expires_at as string, mine: lease.rows[0].user_id === actor.userId } : null,
    preflight,
    templateVersion: { id: tvRow.id as string, revision: tvRow.revision as number, status: tvRow.status as string, sampleOnly: tvRow.sample_only as boolean, fieldSchema: tvRow.field_schema, templateName: tvRow.template_name as string },
    pendingJobs: jobs.rows.map((j) => ({ id: j.id as string, type: j.type as string, state: j.state as 'queued', progress: (j.progress_json as Record<string, unknown>) ?? {} })),
    openReviewId: review.rows[0]?.id ?? null,
    canEdit: flags.rows[0]!.can_edit && !['approved', 'superseded', 'archived'].includes(draftRow.status as string) ? true : flags.rows[0]!.can_edit && draftRow.status === 'approved',
    canApprove,
  };
}
