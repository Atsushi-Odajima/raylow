/**
 * BlobStore: 原本 bytes は immutable。storage key は UUID。長寿命の公開 URL は作らない。
 * local: BLOB_LOCAL_DIR/<key[0..2]>/<key>。supabase: private bucket（service role 経由、BFF 内部のみ）。
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { config } from '../config.js';

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

export const blobStore: BlobStore = config.blobStore === 'supabase' ? new SupabaseBlobStore(config.supabase.url, config.supabase.serviceRoleKey, config.supabase.bucket) : new LocalFsBlobStore(config.blobLocalDir);
