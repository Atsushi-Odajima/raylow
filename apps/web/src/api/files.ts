import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { FileSchema, UploadFinalizeResponseSchema, UploadInitResponseSchema, UploadInitSchema, type FileInfo } from '@raylow/contracts';
import { ApiError, apiRequest } from '../lib/apiClient';
import { sessionStore } from '../lib/session';

export type UploadInit = z.input<typeof UploadInitSchema>;
export type UploadInitResponse = z.infer<typeof UploadInitResponseSchema>;
export type UploadFinalizeResponse = z.infer<typeof UploadFinalizeResponseSchema>;

export const fileKeys = { detail: (id: string) => ['files', id] as const };

async function sha256Hex(file: File): Promise<string | undefined> {
  if (!('crypto' in globalThis) || !crypto.subtle || file.size > 64 * 1024 * 1024) return undefined;
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

export interface UploadProgress {
  stage: 'init' | 'upload' | 'finalize' | 'done';
  loaded: number;
  total: number;
}

/**
 * 原資料アップロード: init → PUT content → finalize（quarantine → scan job）。
 * 進捗は XMLHttpRequest の upload.progress を使う（実測値のみ。残り秒数は出さない）。
 */
export async function uploadFile(
  file: File,
  init: { scope: 'matter' | 'template' | 'receipt'; matterId?: string | null | undefined; confidential?: boolean | undefined },
  onProgress?: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<UploadFinalizeResponse> {
  onProgress?.({ stage: 'init', loaded: 0, total: file.size });
  const sha = await sha256Hex(file);
  const initBody: UploadInit = {
    scope: init.scope,
    matterId: init.matterId ?? null,
    originalName: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    confidential: init.confidential ?? true,
    ...(sha ? { sha256: sha } : {}),
  };
  const initRes = await apiRequest<UploadInitResponse>('/api/uploads/init', { method: 'POST', body: UploadInitSchema.parse(initBody), schema: UploadInitResponseSchema, ...(signal ? { signal } : {}) });
  if (file.size > initRes.maxBytes) {
    throw new ApiError({ status: 413, code: 'payload_too_large', message: `ファイルが上限（${Math.floor(initRes.maxBytes / 1024 / 1024)}MB）を超えています` });
  }
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/uploads/${encodeURIComponent(initRes.uploadId)}/content`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    const csrf = sessionStore.getCsrfToken();
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.upload.onprogress = (e) => onProgress?.({ stage: 'upload', loaded: e.loaded, total: e.lengthComputable ? e.total : file.size });
    xhr.onerror = () => reject(new ApiError({ status: 0, code: 'network_error', message: 'upload failed' }));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let code: ApiError['code'] = 'unknown';
        let message = `HTTP ${xhr.status}`;
        try {
          const j = JSON.parse(xhr.responseText) as { error?: { code?: ApiError['code']; message?: string } };
          if (j.error?.code) code = j.error.code;
          if (j.error?.message) message = j.error.message;
        } catch {
          /* ignore */
        }
        if (xhr.status === 401) sessionStore.notifyUnauthorized('unauthorized');
        reject(new ApiError({ status: xhr.status, code, message }));
      }
    };
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
  onProgress?.({ stage: 'finalize', loaded: file.size, total: file.size });
  const fin = await apiRequest<UploadFinalizeResponse>(`/api/uploads/${encodeURIComponent(initRes.uploadId)}/finalize`, { method: 'POST', schema: UploadFinalizeResponseSchema });
  onProgress?.({ stage: 'done', loaded: file.size, total: file.size });
  return fin;
}

export function useFile(id: string | null | undefined, opts: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: fileKeys.detail(id ?? ''),
    queryFn: () => apiRequest<FileInfo>(`/api/files/${id}`, { schema: FileSchema }),
    enabled: !!id,
    ...(opts.refetchInterval !== undefined ? { refetchInterval: opts.refetchInterval } : {}),
  });
}

export function latestFileVersionId(f: FileInfo): string | null {
  const sorted = [...f.versions].sort((a, b) => b.revision - a.revision);
  return sorted[0]?.id ?? null;
}
