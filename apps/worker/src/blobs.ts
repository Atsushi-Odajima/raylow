import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { withServiceTx } from './db.js';

export interface BlobStore {
  put(bytes: Buffer, key?: string): Promise<{ key: string; sha256: string; size: number }>;
  get(key: string): Promise<Buffer>;
}
function keyPath(root: string, key: string): string {
  if (!/^[0-9a-f-]{36}$/.test(key)) throw new Error('invalid storage key');
  return path.join(root, key.slice(0, 2), key);
}
class LocalFs implements BlobStore {
  constructor(private readonly root: string) {}
  async put(bytes: Buffer, key = randomUUID()) {
    const p = keyPath(this.root, key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, bytes, { flag: 'wx' });
    return { key, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  }
  get(key: string) {
    return fs.readFile(keyPath(this.root, key));
  }
}
class Supabase implements BlobStore {
  constructor(private readonly url: string, private readonly key: string, private readonly bucket: string) {}
  private u(k: string) { return `${this.url}/storage/v1/object/${this.bucket}/${k.slice(0, 2)}/${k}`; }
  async put(bytes: Buffer, key = randomUUID()) {
    const res = await fetch(this.u(key), { method: 'POST', headers: { authorization: `Bearer ${this.key}`, apikey: this.key, 'content-type': 'application/octet-stream', 'x-upsert': 'false' }, body: new Uint8Array(bytes) });
    if (!res.ok) throw new Error(`storage put failed: ${res.status}`);
    return { key, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  }
  async get(key: string) {
    const res = await fetch(this.u(key), { headers: { authorization: `Bearer ${this.key}`, apikey: this.key } });
    if (!res.ok) throw new Error(`storage get failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
/** private.blobs(bytea)。API 側 PgBlobStore と同じ表・同じ key 規則。INSERT のみ（immutable）。 */
class PgBlobs implements BlobStore {
  async put(bytes: Buffer, key = randomUUID()) {
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
  async get(key: string) {
    if (!/^[0-9a-f-]{36}$/.test(key)) throw new Error('invalid storage key');
    const r = await withServiceTx((tx) => tx.query<{ bytes: Buffer }>('SELECT bytes FROM private.blobs WHERE key = $1', [key]));
    const row = r.rows[0];
    if (!row) throw new Error(`blob not found: ${key}`);
    return row.bytes;
  }
}
export const blobStore: BlobStore = config.blobStore === 'supabase' ? new Supabase(config.supabase.url, config.supabase.serviceKey, config.supabase.bucket) : config.blobStore === 'postgres' ? new PgBlobs() : new LocalFs(config.blobLocalDir);
export function sha256Hex(b: Buffer): string {
  return createHash('sha256').update(b).digest('hex');
}
