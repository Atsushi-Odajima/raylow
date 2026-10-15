/**
 * BlobStore: 原本 bytes は immutable。storage key は UUID。長寿命の公開 URL は作らない。
 * local: BLOB_LOCAL_DIR/<key[0..2]>/<key>。supabase: private bucket（service role 経由、BFF 内部のみ）。
 * postgres: private.blobs(bytea)。service_role でのみ到達。ファイルシステムが揮発する単一コンテナ配備向け。
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { config } from '../config.js';
import { withServiceTx } from '../db/pool.js';

export interface BlobStore {
  put(bytes: Buffer, key?: string): Promise<{ key: string; sha256: string; size: number }>;
  get(key: string): Promise<Buffer>;
  stream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
}

function keyPath(root: string, key: string): string {
  if (!/^[0-9a-f-]{36}$/.test(key)) throw new Error('invalid storage key');
  return path.join(root, key.slice(0, 2), key);
}

export class LocalFsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}
  async put(bytes: Buffer, key = randomUUID()): Promise<{ key: string; sha256: string; size: number }> {
    const p = keyPath(this.root, key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    try {
      await fs.writeFile(p, bytes, { flag: 'wx' }); // 既存は上書きしない（immutable）
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('blob already exists (immutable)');
      throw e;
    }
    return { key, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  }
  get(key: string): Promise<Buffer> {
    return fs.readFile(keyPath(this.root, key));
  }
  async stream(key: string): Promise<Readable> {
    const p = keyPath(this.root, key);
    await fs.access(p);
    return createReadStream(p);
  }
  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(keyPath(this.root, key));
      return true;
    } catch {
      return false;
    }
  }
}

/** Supabase Storage（REST）。開発コンテナでは未検証。 */
export class SupabaseBlobStore implements BlobStore {
  constructor(private readonly url: string, private readonly serviceKey: string, private readonly bucket: string) {}
  private objUrl(key: string): string {
    return `${this.url}/storage/v1/object/${this.bucket}/${key.slice(0, 2)}/${key}`;
  }
  async put(bytes: Buffer, key = randomUUID()): Promise<{ key: string; sha256: string; size: number }> {
    const res = await fetch(this.objUrl(key), { method: 'POST', headers: { authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, 'content-type': 'application/octet-stream', 'x-upsert': 'false' }, body: new Uint8Array(bytes) });
    if (!res.ok) throw new Error(`storage put failed: ${res.status}`);
    return { key, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  }
  async get(key: string): Promise<Buffer> {
    const res = await fetch(this.objUrl(key), { headers: { authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey } });
    if (!res.ok) throw new Error(`storage get failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  async stream(key: string): Promise<Readable> {
    const { Readable } = await import('node:stream');
    return Readable.from(await this.get(key));
  }
  async exists(key: string): Promise<boolean> {
    const res = await fetch(this.objUrl(key), { method: 'HEAD', headers: { authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey } });
    return res.ok;
  }
}

/** Postgres（private.blobs）。INSERT のみ（UPDATE/DELETE は権限・トリガーで拒否 = immutable）。 */
export class PgBlobStore implements BlobStore {
  async put(bytes: Buffer, key = randomUUID()): Promise<{ key: string; sha256: string; size: number }> {
    if (!/^[0-9a-f-]{36}$/.test(key)) throw new Error('invalid storage key');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    try {
      await withServiceTx((tx) => tx.query('INSERT INTO private.blobs (key, bytes, sha256, size) VALUES ($1, $2, $3, $4)', [key, bytes, sha256, bytes.length]));
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new Error('blob already exists (immutable)');
      throw e;
    }
    return { key, sha256, size: bytes.length };
  }
  async get(key: string): Promise<Buffer> {
    if (!/^[0-9a-f-]{36}$/.test(key)) throw new Error('invalid storage key');
    const r = await withServiceTx((tx) => tx.query<{ bytes: Buffer }>('SELECT bytes FROM private.blobs WHERE key = $1', [key]));
    const row = r.rows[0];
    if (!row) {
      const err = new Error(`blob not found: ${key}`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return row.bytes;
  }
  async stream(key: string): Promise<Readable> {
    return Readable.from(await this.get(key));
  }
  async exists(key: string): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/.test(key)) return false;
    const r = await withServiceTx((tx) => tx.query('SELECT 1 FROM private.blobs WHERE key = $1', [key]));
    return (r.rowCount ?? 0) > 0;
  }
}

export function createBlobStore(): BlobStore {
  if (config.blobStore === 'supabase') return new SupabaseBlobStore(config.supabase.url, config.supabase.serviceRoleKey, config.supabase.bucket);
  if (config.blobStore === 'postgres') return new PgBlobStore();
  return new LocalFsBlobStore(config.blobLocalDir);
}

export const blobStore: BlobStore = createBlobStore();
