import type { FastifyInstance } from 'fastify';
import { EvidenceConfirmSchema, EvidenceCorrectSchema, EvidenceInputSchema, EvidenceUpdateSchema, type Evidence } from '@raylow/contracts';
import { canonicalKey, parseEvidenceLabel, parseJapaneseDate, buildDisplayLabel } from '@raylow/japanese-text';
import { withUserTx, type Tx } from '../db/pool.js';
import { ApiError, conflict, notFound, validationFailed, versionConflict } from '../errors.js';
import { requireActor } from '../plugins/auth.js';
import { ok } from '../lib/reply.js';
import { parseOrThrow } from '../lib/validate.js';
import { audit } from '../services/audit.js';

type Row = Record<string, unknown>;

function evOut(r: Row): Evidence {
  return {
    id: r.id as string, matterId: r.matter_id as string, symbolRaw: r.symbol_raw as string, numberRaw: r.number_raw as string, branchRaw: (r.branch_raw as string | null) ?? null, canonicalNumber: r.canonical_number as string, displayLabel: r.display_label as string, fileVersionId: (r.file_version_id as string | null) ?? null, fileId: (r.file_id as string | null) ?? null, fileName: (r.file_name as string | null) ?? null,
    titleRaw: r.title_raw as string, authorRaw: r.author_raw as string, dateRaw: r.date_raw as string, dateIso: (r.date_iso as string | null) ?? null, originalCopy: r.original_copy as 'copy', proofPurposeRaw: r.proof_purpose_raw as string, status: r.status as Evidence['status'], supersededBy: (r.superseded_by as string | null) ?? null, correctionReasonRaw: (r.correction_reason_raw as string | null) ?? null, updatedAt: r.updated_at as string, version: r.version as number,
  };
}
const EV_SELECT = `SELECT e.*, f.original_name_raw AS file_name, f.id AS file_id FROM public.evidence e LEFT JOIN public.file_versions fv ON fv.id = e.file_version_id LEFT JOIN public.files f ON f.id = fv.file_id`;

function canonicalOf(symbolRaw: string, numberRaw: string, branchRaw: string | null): { canonical: string; label: string } {
  const parsed = parseEvidenceLabel(buildDisplayLabel(symbolRaw, numberRaw, branchRaw));
  if (!parsed.canonical) throw validationFailed([{ field: 'numberRaw', code: 'unparsed', message: '証拠番号を解釈できません（例: 甲 / ３ / １）' }]);
  return { canonical: canonicalKey(parsed.canonical.symbol, parsed.canonical.number, parsed.canonical.branch), label: parsed.displayLabel };
}

async function loadEv(tx: Tx, id: string): Promise<Evidence> {
  const r = await tx.query<Row>(`${EV_SELECT} WHERE e.id = $1`, [id]);
  if (!r.rows[0]) throw notFound();
  return evOut(r.rows[0]);
}

export async function evidenceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/matters/:id/evidence', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const rows = await withUserTx(actor, async (tx) => {
      const m = await tx.query('SELECT 1 FROM public.matters WHERE id = $1', [id]);
      if (!m.rowCount) throw notFound();
      return tx.query<Row>(`${EV_SELECT} WHERE e.matter_id = $1 ORDER BY e.created_at`, [id]).then((r) => r.rows);
    });
    const list = rows.map(evOut);
    // 並替: 符号順→整数番号→枝番順
    const parsed = new Map(list.map((e) => [e.id, parseEvidenceLabel(e.displayLabel)] as const));
    const { compareEvidence } = await import('@raylow/japanese-text');
    list.sort((a, b) => compareEvidence(parsed.get(a.id)!, parsed.get(b.id)!));
    return ok(req, reply, list);
  });

  app.post('/api/evidence', async (req, reply) => {
    const actor = requireActor(req);
    const body = parseOrThrow(EvidenceInputSchema, req.body);
    const ev = await withUserTx(actor, async (tx) => {
      const m = await tx.query<{ org_id: string }>('SELECT org_id FROM public.matters WHERE id = $1', [body.matterId]);
      if (!m.rows[0]) throw notFound();
      const { canonical, label } = canonicalOf(body.symbolRaw, body.numberRaw, body.branchRaw ?? null);
      const d = body.dateRaw ? parseJapaneseDate(body.dateRaw) : null;
      const r = await tx.query<{ id: string }>(
        `INSERT INTO public.evidence (org_id, matter_id, symbol_raw, number_raw, branch_raw, canonical_number, display_label, file_version_id, title_raw, author_raw, date_raw, date_iso, original_copy, proof_purpose_raw, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'draft', $15) RETURNING id`,
        [m.rows[0].org_id, body.matterId, body.symbolRaw, body.numberRaw, body.branchRaw ?? null, canonical, label, body.fileVersionId ?? null, body.titleRaw, body.authorRaw, body.dateRaw, d?.precision === 'day' ? d.iso : null, body.originalCopy, body.proofPurposeRaw, actor.userId],
      );
      await audit(tx, actor, { action: 'evidence.created', targetType: 'evidence', targetId: r.rows[0]!.id, matterId: body.matterId, details: { label } });
      return loadEv(tx, r.rows[0]!.id);
    });
    return ok(req, reply, ev, {}, 201);
  });

  app.put('/api/evidence/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(EvidenceUpdateSchema, req.body);
    const ev = await withUserTx(actor, async (tx) => {
      const cur = await tx.query<Row>('SELECT * FROM public.evidence WHERE id = $1 FOR UPDATE', [id]);
      const c = cur.rows[0];
      if (!c) throw notFound();
      if ((c.version as number) !== body.expectedVersion) throw versionConflict(c.version as number);
      if (c.status === 'submitted' || c.status === 'superseded') throw conflict('提出済み/訂正済みの証拠は変更できません。訂正は理由付きで別版を作成します');
      const symbolRaw = body.symbolRaw ?? (c.symbol_raw as string);
      const numberRaw = body.numberRaw ?? (c.number_raw as string);
      const branchRaw = body.branchRaw === undefined ? (c.branch_raw as string | null) : body.branchRaw;
      const { canonical, label } = canonicalOf(symbolRaw, numberRaw, branchRaw);
      const dateRaw = body.dateRaw ?? (c.date_raw as string);
      const d = dateRaw ? parseJapaneseDate(dateRaw) : null;
      try {
        await tx.query(
          `UPDATE public.evidence SET symbol_raw = $3, number_raw = $4, branch_raw = $5, canonical_number = $6, display_label = $7, file_version_id = $8, title_raw = $9, author_raw = $10, date_raw = $11, date_iso = $12, original_copy = $13, proof_purpose_raw = $14 WHERE id = $1 AND version = $2`,
          [id, body.expectedVersion, symbolRaw, numberRaw, branchRaw, canonical, label, body.fileVersionId === undefined ? c.file_version_id : body.fileVersionId, body.titleRaw ?? c.title_raw, body.authorRaw ?? c.author_raw, dateRaw, d?.precision === 'day' ? d.iso : null, body.originalCopy ?? c.original_copy, body.proofPurposeRaw ?? c.proof_purpose_raw],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ApiError(409, 'conflict', `証拠番号 ${label} は既に確定済みです。別の番号を選んでください`);
        throw e;
      }
      await audit(tx, actor, { action: 'evidence.updated', targetType: 'evidence', targetId: id, matterId: c.matter_id as string });
      return loadEv(tx, id);
    });
    return ok(req, reply, ev);
  });

  app.post('/api/evidence/:id/confirm', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(EvidenceConfirmSchema, req.body);
    const ev = await withUserTx(actor, async (tx) => {
      const cur = await tx.query<Row>('SELECT * FROM public.evidence WHERE id = $1 FOR UPDATE', [id]);
      const c = cur.rows[0];
      if (!c) throw notFound();
      if ((c.version as number) !== body.expectedVersion) throw versionConflict(c.version as number);
      if (c.status !== 'draft') throw conflict('確定できる状態ではありません');
      try {
        await tx.query(`UPDATE public.evidence SET status = 'confirmed' WHERE id = $1 AND version = $2`, [id, body.expectedVersion]);
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ApiError(409, 'conflict', `証拠番号 ${c.display_label as string} は同じ案件で既に確定しています。番号を再選択してください`);
        throw e;
      }
      await audit(tx, actor, { action: 'evidence.confirmed', targetType: 'evidence', targetId: id, matterId: c.matter_id as string, details: { label: c.display_label } });
      return loadEv(tx, id);
    });
    return ok(req, reply, ev);
  });

  // 提出済ラベルの改番は禁止。訂正は履歴付き別版。
  app.post('/api/evidence/:id/correct', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const body = parseOrThrow(EvidenceCorrectSchema, req.body);
    const ev = await withUserTx(actor, async (tx) => {
      const cur = await tx.query<Row>('SELECT * FROM public.evidence WHERE id = $1 FOR UPDATE', [id]);
      const c = cur.rows[0];
      if (!c) throw notFound();
      if ((c.version as number) !== body.expectedVersion) throw versionConflict(c.version as number);
      if (c.status === 'superseded') throw conflict('既に訂正済みです');
      const symbolRaw = body.symbolRaw ?? (c.symbol_raw as string);
      const numberRaw = body.numberRaw ?? (c.number_raw as string);
      const branchRaw = body.branchRaw === undefined ? (c.branch_raw as string | null) : body.branchRaw;
      const { canonical, label } = canonicalOf(symbolRaw, numberRaw, branchRaw);
      const n = await tx.query<{ id: string }>(
        `INSERT INTO public.evidence (org_id, matter_id, symbol_raw, number_raw, branch_raw, canonical_number, display_label, file_version_id, title_raw, author_raw, date_raw, date_iso, original_copy, proof_purpose_raw, status, correction_reason_raw, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'draft', $15, $16) RETURNING id`,
        [c.org_id, c.matter_id, symbolRaw, numberRaw, branchRaw, canonical, label, c.file_version_id, c.title_raw, c.author_raw, c.date_raw, c.date_iso, c.original_copy, c.proof_purpose_raw, body.reasonRaw, actor.userId],
      );
      await tx.query(`UPDATE public.evidence SET status = 'superseded', superseded_by = $3 WHERE id = $1 AND version = $2`, [id, body.expectedVersion, n.rows[0]!.id]);
      await audit(tx, actor, { action: 'evidence.corrected', targetType: 'evidence', targetId: id, matterId: c.matter_id as string, details: { newId: n.rows[0]!.id, reason: body.reasonRaw, oldLabel: c.display_label, newLabel: label } });
      return loadEv(tx, n.rows[0]!.id);
    });
    return ok(req, reply, ev, {}, 201);
  });
}
