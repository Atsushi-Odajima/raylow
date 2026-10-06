import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UploadInitSchema, type FileInfo } from '@raylow/contracts';
import { FILE_LIMITS } from '@raylow/domain';
import { randomUUID } from 'node:crypto';
import { withUserTx, type Tx } from '../db/pool.js';
import { ApiError, conflict, notFound, payloadTooLarge, unsupportedMedia, validationFailed } from '../errors.js';
import { requireActor } from '../plugins/auth.js';
import { ok } from '../lib/reply.js';
import { parseOrThrow } from '../lib/validate.js';
import { audit } from '../services/audit.js';
import { blobStore } from '../services/blobs.js';
import { MIME_BY_MAGIC, detectMagic, storeUploadedFile } from '../services/files.js';

type Row = Record<string, unknown>;

/** メモリ内の進行中 upload（60 秒有効、対象キー固定）。複数 API プロセスでは sticky か共有ストアが必要（HANDOFF 記載）。 */
interface PendingUpload { id: string; actorUserId: string; orgId: string; matterId: string | null; scope: 'matter' | 'template' | 'receipt'; originalName: string; mime: string; size: number; sha256: string | undefined; confidential: boolean; chunks: Buffer[]; received: number; expiresAt: number }
const pending = new Map<string, PendingUpload>();
setInterval(() => { const now = Date.now(); for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k); }, 15_000).unref();

const ALLOWED_MIME = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg', 'text/plain', 'text/csv']);

export function fileOut(r: Row, versions: Row[] = []): FileInfo {
  return {
    id: r.id as string, orgId: r.org_id as string, matterId: (r.matter_id as string | null) ?? null, scope: r.scope as FileInfo['scope'], originalNameRaw: r.original_name_raw as string, mime: r.mime as string, size: Number(r.size), sha256: r.sha256 as string, scanStatus: r.scan_status as FileInfo['scanStatus'], scanReport: (r.scan_report as Record<string, unknown> | null) ?? null, confidential: r.confidential as boolean,
    versions: versions.map((v) => ({ id: v.id as string, revision: v.revision as number, kind: v.kind as string, sha256: v.sha256 as string, size: Number(v.size), encodingName: (v.encoding_name as string | null) ?? null, createdAt: v.created_at as string })),
    createdAt: r.created_at as string, version: r.version as number,
  };
}

export async function loadFile(tx: Tx, id: string): Promise<FileInfo> {
  const r = await tx.query<Row>('SELECT * FROM public.files WHERE id = $1', [id]);
  if (!r.rows[0]) throw notFound();
  const v = await tx.query<Row>('SELECT * FROM public.file_versions WHERE file_id = $1 ORDER BY revision', [id]);
  return fileOut(r.rows[0], v.rows);
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/uploads/init', async (req, reply) => {
    const actor = requireActor(req);
    const body = parseOrThrow(UploadInitSchema, req.body);
    const limit = body.scope === 'template' ? FILE_LIMITS.templateDocxMaxBytes : FILE_LIMITS.sourceMaxBytes;
    if (body.size > limit) throw payloadTooLarge(`上限 ${Math.floor(limit / 1024 / 1024)}MB を超えています`);
    if (!ALLOWED_MIME.has(body.mime)) throw unsupportedMedia('PDF/DOCX/PNG/JPEG/TXT/CSV のみ登録できます');
    if (body.scope === 'template' && body.mime !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') throw unsupportedMedia('書式は DOCX のみ登録できます（DOCM/マクロは不可）');
    if (/\.(docm|dotm|xlsm|exe|js|vbs|html?|svg)$/i.test(body.originalName)) throw unsupportedMedia('この拡張子は登録できません');
    if (body.scope === 'matter' || body.scope === 'receipt') {
      if (!body.matterId) throw validationFailed([{ field: 'matterId', code: 'required', message: '案件を指定してください' }]);
      await withUserTx(actor, async (tx) => {
        const r = await tx.query<{ ok: boolean }>('SELECT app.can_edit_matter($1) AS ok', [body.matterId]);
        if (!r.rows[0]?.ok) throw notFound();
      });
    }
    const id = randomUUID();
    const expiresAt = Date.now() + 60_000;
    pending.set(id, { id, actorUserId: actor.userId, orgId: actor.orgId, matterId: body.matterId ?? null, scope: body.scope, originalName: body.originalName, mime: body.mime, size: body.size, sha256: body.sha256, confidential: body.confidential, chunks: [], received: 0, expiresAt });
    return ok(req, reply, { uploadId: id, fileId: id, maxBytes: limit, expiresAt: new Date(expiresAt).toISOString() }, {}, 201);
  });

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: FILE_LIMITS.sourceMaxBytes }, (_req, body, done) => done(null, body));

  app.put('/api/uploads/:id/content', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const up = pending.get(id);
    if (!up || up.actorUserId !== actor.userId || up.expiresAt < Date.now()) throw notFound('アップロードが見つからないか期限切れです（60 秒）');
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf)) throw unsupportedMedia('application/octet-stream で送信してください');
    if (up.received + buf.length > up.size) throw payloadTooLarge('宣言サイズを超えています');
    up.chunks.push(buf);
    up.received += buf.length;
    up.expiresAt = Date.now() + 60_000;
    return ok(req, reply, { received: up.received });
  });

  app.post('/api/uploads/:id/finalize', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const up = pending.get(id);
    if (!up || up.actorUserId !== actor.userId) throw notFound('アップロードが見つからないか期限切れです');
    pending.delete(id);
    if (up.received !== up.size) throw validationFailed([{ field: 'size', code: 'size_mismatch', message: `受信 ${up.received} bytes が宣言 ${up.size} bytes と一致しません` }]);
    const bytes = Buffer.concat(up.chunks);
    const magic = detectMagic(bytes);
    const allowed = MIME_BY_MAGIC[magic] ?? [];
    if (!allowed.includes(up.mime)) throw new ApiError(415, 'file_rejected', `ファイル内容（${magic}）と宣言形式（${up.mime}）が一致しません`);
    if (up.sha256) {
      const { createHash } = await import('node:crypto');
      if (createHash('sha256').update(bytes).digest('hex') !== up.sha256) throw validationFailed([{ field: 'sha256', code: 'mismatch', message: 'ハッシュが一致しません（転送エラー）' }]);
    }
    const data = await withUserTx(actor, async (tx) => {
      const stored = await storeUploadedFile(tx, actor, { bytes, originalName: up.originalName, mime: up.mime, scope: up.scope, matterId: up.matterId, confidential: up.confidential });
      await audit(tx, actor, { action: 'file.uploaded', targetType: 'file', targetId: stored.fileId, targetHash: stored.sha256, matterId: up.matterId, details: { scope: up.scope, size: bytes.length } });
      return { file: await loadFile(tx, stored.fileId), scanJobId: stored.scanJobId };
    });
    return ok(req, reply, data, {}, 201);
  });

  app.get('/api/files/:id', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    return ok(req, reply, await withUserTx(actor, (tx) => loadFile(tx, id)));
  });

  // 毎回 ACL / no-store。scan 未完了は 409。scanner 停止は fail closed。
  app.get('/api/files/:id/content', async (req, reply) => {
    const actor = requireActor(req);
    const { id } = req.params as { id: string };
    const q = parseOrThrow(z.object({ version: z.string().uuid().optional(), disposition: z.enum(['inline', 'attachment']).default('attachment') }), req.query);
    const { bytes, mime, name } = await withUserTx(actor, async (tx) => {
      const f = await tx.query<Row>('SELECT * FROM public.files WHERE id = $1', [id]);
      const file = f.rows[0];
      if (!file) throw notFound();
      if (file.scan_status !== 'clean') {
        if (file.scan_status === 'infected' || file.scan_status === 'rejected') throw new ApiError(409, 'file_rejected', `このファイルは検査で拒否されました（${file.scan_status}）`);
        if (file.scan_status === 'scan_failed') throw new ApiError(409, 'scanner_unavailable', 'ウイルス検査が完了していません（scanner 停止）。復旧後に再検査されます');
        throw new ApiError(409, 'file_quarantined', 'ウイルス検査が完了するまで取得できません');
      }
      let v: Row | undefined;
      if (q.version) {
        const r = await tx.query<Row>('SELECT * FROM public.file_versions WHERE id = $1 AND file_id = $2', [q.version, id]);
        v = r.rows[0];
      } else {
        const r = await tx.query<Row>(`SELECT * FROM public.file_versions WHERE file_id = $1 ORDER BY CASE kind WHEN 'safe_preview' THEN 0 ELSE 1 END, revision DESC LIMIT 1`, [id]);
        v = r.rows[0];
      }
      if (!v) throw notFound();
      // 原本 PDF は派生安全版（safe_preview）があればそれを優先し、原本直接取得は version 明示時のみ
      const bytes = await blobStore.get(v.storage_key as string);
      await audit(tx, actor, { action: 'file.downloaded', targetType: 'file', targetId: id, targetHash: v.sha256 as string, matterId: (file.matter_id as string | null) ?? null, details: { versionId: v.id, kind: v.kind } });
      const mime = v.kind === 'derived_pdf' || v.kind === 'safe_preview' || v.kind === 'submission_pdf' ? 'application/pdf' : v.kind === 'native_text' || v.kind === 'ocr_text' ? 'text/plain; charset=utf-8' : (file.mime as string);
      return { bytes, mime, name: file.original_name_raw as string };
    });
    reply.header('Content-Type', mime);
    reply.header('Content-Disposition', `${q.disposition}; filename*=UTF-8''${encodeURIComponent(name)}`);
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
    return reply.send(bytes);
  });
  void conflict;
}
