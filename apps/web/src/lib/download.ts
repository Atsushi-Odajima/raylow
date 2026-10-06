/**
 * 出力ファイルの取得。毎回 BFF 経由で ACL 確認・no-store。
 * ダウンロード成功だけで送付/提出済みにはならない（画面側で明示する）。
 */
import { ApiError } from './apiClient';
import { sessionStore } from './session';

function filenameFromDisposition(h: string | null, fallback: string): string {
  if (!h) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(h);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* ignore */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(h);
  return plain?.[1] ?? fallback;
}

export async function fetchBlob(url: string, signal?: AbortSignal): Promise<{ blob: Blob; filename: string; contentType: string }> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include', cache: 'no-store', ...(signal ? { signal } : {}) });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError({ status: 0, code: 'network_error', message: 'network error' });
  }
  if (!res.ok) {
    let code: ApiError['code'] = res.status === 404 ? 'not_found' : res.status === 403 ? 'forbidden' : res.status === 409 ? 'conflict' : res.status === 401 ? 'unauthorized' : 'unknown';
    let message = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { code?: ApiError['code']; message?: string } };
      if (j.error?.code) code = j.error.code;
      if (j.error?.message) message = j.error.message;
    } catch {
      /* not json */
    }
    if (res.status === 401) sessionStore.notifyUnauthorized(code === 'mfa_required' ? 'mfa_required' : 'unauthorized');
    throw new ApiError({ status: res.status, code, message });
  }
  const blob = await res.blob();
  const filename = filenameFromDisposition(res.headers.get('Content-Disposition'), 'download');
  return { blob, filename, contentType: res.headers.get('Content-Type') ?? blob.type };
}

export async function downloadFile(url: string, fallbackName: string): Promise<string> {
  const { blob, filename } = await fetchBlob(url);
  const name = filename === 'download' ? fallbackName : filename;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Safari でも確実に revoke されるよう遅延
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  }
  return name;
}

/** 別タブで開く（原本閲覧）。blob URL は短時間で破棄 */
export async function openInNewTab(url: string): Promise<void> {
  const { blob } = await fetchBlob(url);
  const objectUrl = URL.createObjectURL(blob);
  const w = window.open(objectUrl, '_blank', 'noopener');
  if (!w) {
    // ポップアップ抑止時はダウンロードへ
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = 'file';
    a.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export function outputDownloadUrl(outputId: string, mode: 'draft' | 'final'): string {
  return `/api/outputs/${encodeURIComponent(outputId)}/download?mode=${mode}`;
}

export function fileContentUrl(fileId: string, versionId?: string | null): string {
  const q = versionId ? `?version=${encodeURIComponent(versionId)}` : '';
  return `/api/files/${encodeURIComponent(fileId)}/content${q}`;
}
