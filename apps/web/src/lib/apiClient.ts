/**
 * API クライアント（同一 origin /api）。
 * - credentials:'include'、GET 以外は X-CSRF-Token（GET /api/auth/session の csrfToken）
 * - 応答 envelope {data, meta} を解き、error={code,message,fieldErrors,requestId,currentVersion} を ApiError にする
 * - 401 は sessionStore へ通知（再ログイン → 権限再確認）。403/404 は存在を秘匿した汎用文言にする
 */
import type { z } from 'zod';
import { ApiErrorSchema, type ErrorCode, type FieldError } from '@raylow/contracts';
import { sessionStore } from './session';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'network_error' | 'contract_mismatch' | 'unknown';
  readonly fieldErrors: FieldError[];
  readonly requestId: string | null;
  readonly currentVersion: number | null;
  readonly details: Record<string, unknown> | null;

  constructor(init: {
    status: number;
    code: ApiError['code'];
    message: string;
    fieldErrors?: FieldError[] | undefined;
    requestId?: string | null | undefined;
    currentVersion?: number | null | undefined;
    details?: Record<string, unknown> | null | undefined;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.fieldErrors = init.fieldErrors ?? [];
    this.requestId = init.requestId ?? null;
    this.currentVersion = init.currentVersion ?? null;
    this.details = init.details ?? null;
  }

  /** 存在秘匿: 403/404 は同じ文言 */
  get isNotFoundOrForbidden(): boolean {
    return this.status === 403 || this.status === 404;
  }
  get isConflict(): boolean {
    return this.status === 409;
  }
  get isValidation(): boolean {
    return this.status === 422;
  }
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** 画面向けの説明（原因 / 直す場所）。入力は呼び出し側で保持する */
  userMessage(): string {
    if (this.isNotFoundOrForbidden) return '見つからないか権限がありません。';
    if (this.status === 401) return this.code === 'mfa_required' ? '重要操作のため認証コードの再確認が必要です。' : 'セッションが切れました。再ログインしてください。';
    if (this.status === 409) {
      if (this.code === 'hash_stale') return '対象の版が更新されています。再読込してください。';
      if (this.code === 'lease_held') return '他の担当者が編集中です。';
      return '他の更新と競合しました。版を確認してください。';
    }
    if (this.status === 422) return this.message || '入力内容に不備があります。項目を確認してください。';
    if (this.status === 413) return 'ファイルが大きすぎます。';
    if (this.status === 415) return '対応していない形式です。';
    if (this.status === 429) return '操作が多すぎます。しばらく待ってから再試行してください。';
    if (this.code === 'network_error') return 'サーバーに接続できません。接続を確認して再試行してください（入力は保持されています）。';
    if (this.code === 'job_failed') return '処理に失敗しました。ジョブ画面で原因を確認してください。';
    return this.message || 'エラーが発生しました。';
  }
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  /** multipart など、JSON 以外の body をそのまま送る */
  rawBody?: BodyInit | undefined;
  query?: QueryParams | undefined;
  schema?: z.ZodType<T, z.ZodTypeDef, unknown> | undefined;
  signal?: AbortSignal | undefined;
  headers?: Record<string, string> | undefined;
  /** 401 を sessionStore に通知しない（ログイン画面など） */
  silentUnauthorized?: boolean | undefined;
}

export interface Envelope<T> {
  data: T;
  meta: { requestId: string; nextCursor?: string | null; total?: number };
}

export function buildQuery(query: QueryParams | undefined): string {
  if (!query) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function parseErrorResponse(res: Response): Promise<ApiError> {
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  const parsed = ApiErrorSchema.safeParse(payload);
  if (parsed.success) {
    const e = parsed.data.error;
    return new ApiError({
      status: res.status,
      code: e.code,
      message: e.message,
      fieldErrors: e.fieldErrors,
      requestId: e.requestId,
      currentVersion: e.currentVersion ?? null,
      details: e.details ?? null,
    });
  }
  const fallbackCode: ApiError['code'] =
    res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : res.status === 404 ? 'not_found' : res.status === 409 ? 'conflict' : res.status === 422 ? 'validation_failed' : 'unknown';
  return new ApiError({ status: res.status, code: fallbackCode, message: `HTTP ${res.status}`, requestId: res.headers.get('x-request-id') });
}

/** envelope 付きで取得（nextCursor が必要な一覧用） */
export async function apiRequestEnvelope<T>(path: string, opts: RequestOptions<T> = {}): Promise<Envelope<T>> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
  let body: BodyInit | undefined = opts.rawBody;
  if (opts.body !== undefined && body === undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (method !== 'GET') {
    const csrf = sessionStore.getCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  let res: Response;
  try {
    res = await fetch(`${path}${buildQuery(opts.query)}`, {
      method,
      headers,
      credentials: 'include',
      cache: 'no-store',
      ...(body !== undefined ? { body } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError({ status: 0, code: 'network_error', message: 'network error' });
  }
  if (!res.ok) {
    const apiErr = await parseErrorResponse(res);
    if (apiErr.status === 401 && !opts.silentUnauthorized) {
      sessionStore.notifyUnauthorized(apiErr.code === 'mfa_required' ? 'mfa_required' : 'unauthorized');
    }
    throw apiErr;
  }
  if (res.status === 204) {
    return { data: undefined as T, meta: { requestId: res.headers.get('x-request-id') ?? '' } };
  }
  const json = (await res.json()) as unknown;
  const env = json as Partial<Envelope<unknown>>;
  const data = env && typeof env === 'object' && 'data' in env ? env.data : json;
  const meta = env && typeof env === 'object' && env.meta ? env.meta : { requestId: res.headers.get('x-request-id') ?? '' };
  if (opts.schema) {
    const r = opts.schema.safeParse(data);
    if (!r.success) {
      // 契約との差異は開発時に警告する（API 実装と並行作業のため fail-closed にはしない）
      if (import.meta.env.DEV) {
        console.warn(`[contracts] ${method} ${path} の応答が契約と一致しません`, r.error.issues.slice(0, 5));
      }
      return { data: data as T, meta };
    }
    return { data: r.data, meta };
  }
  return { data: data as T, meta };
}

export async function apiRequest<T>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const env = await apiRequestEnvelope<T>(path, opts);
  return env.data;
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** 422 の fieldErrors を {field: message} へ */
export function fieldErrorMap(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isApiError(e)) return out;
  for (const fe of e.fieldErrors) {
    if (!(fe.field in out)) out[fe.field] = fe.message;
  }
  return out;
}
