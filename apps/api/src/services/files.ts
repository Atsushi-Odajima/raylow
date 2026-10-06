/**
 * ファイル保存: 原本 bytes immutable、storage key UUID、quarantine → scan 完了まで一般取得不可（§20.3）。
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Actor, Tx } from '../db/pool.js';
import { config } from '../config.js';
import { blobStore } from './blobs.js';
import { enqueueJob } from './jobs.js';

export interface StoreFileInput {
  bytes: Buffer;
  originalName: string;
  mime: string;
  scope: 'matter' | 'template' | 'output' | 'packet' | 'export' | 'receipt';
  matterId: string | null;
  confidential: boolean;
  /** worker が生成した出力など、scan 不要の内部生成物 */
  internal?: boolean;
}

export interface StoredFile {
  fileId: string;
  fileVersionId: string;
  sha256: string;
  storageKey: string;
  scanJobId: string | null;
}

export function detectMagic(bytes: Buffer): 'zip' | 'pdf' | 'png' | 'jpeg' | 'text' | 'unknown' {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) return 'zip';
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  // UTF-8/CP932 のテキストは NUL を含まないことだけ確認
  const head = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (!head.includes(0)) return 'text';
  return 'unknown';
}

export const MIME_BY_MAGIC: Record<string, string[]> = {
  zip: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  pdf: ['application/pdf'],
  png: ['image/png'],
  jpeg: ['image/jpeg'],
  text: ['text/plain', 'text/csv'],
};

export async function storeUploadedFile(tx: Tx, actor: Actor, input: StoreFileInput): Promise<StoredFile> {
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const key = randomUUID();
  await blobStore.put(input.bytes, key);
  const scanStatus = input.internal ? 'clean' : 'quarantine';
  const f = await tx.query<{ id: string }>(
    `INSERT INTO public.files (org_id, matter_id, scope, storage_key, original_name_raw, mime, size, sha256, scan_status, confidential, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [actor.orgId, input.matterId, input.scope, key, input.originalName, input.mime, input.bytes.length, sha256, scanStatus, input.confidential, actor.userId],
  );
  const fileId = f.rows[0]!.id;
  const fv = await tx.query<{ id: string }>(`INSERT INTO public.file_versions (org_id, file_id, revision, storage_key, sha256, size, kind, created_by) VALUES ($1, $2, 1, $3, $4, $5, 'original', $6) RETURNING id`, [actor.orgId, fileId, key, sha256, input.bytes.length, actor.userId]);
  let scanJobId: string | null = null;
  if (!input.internal) {
    const j = await enqueueJob(tx, actor, { type: 'scan_file', matterId: input.matterId, scopeKey: `file:${fileId}`, payload: { fileId, fileVersionId: fv.rows[0]!.id, mime: input.mime, originalName: input.originalName, devAllowUnscanned: config.devAllowUnscanned } });
    scanJobId = j.jobId;
  }
  return { fileId, fileVersionId: fv.rows[0]!.id, sha256, storageKey: key, scanJobId };
}
