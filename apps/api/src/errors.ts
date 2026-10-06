import type { ErrorCode, FieldError } from '@raylow/contracts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fieldErrors: FieldError[];
  readonly currentVersion: number | undefined;
  readonly details: Record<string, unknown> | undefined;
  constructor(status: number, code: ErrorCode, message: string, opts: { fieldErrors?: FieldError[]; currentVersion?: number; details?: Record<string, unknown> } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = opts.fieldErrors ?? [];
    this.currentVersion = opts.currentVersion;
    this.details = opts.details;
  }
}

export const unauthorized = (msg = '認証が必要です') => new ApiError(401, 'unauthorized', msg);
export const mfaRequired = () => new ApiError(401, 'mfa_required', '多要素認証を完了してください');
export const forbidden = (msg = 'この操作の権限がありません') => new ApiError(403, 'forbidden', msg);
/** 存在秘匿: 他 org / barrier / 未割当は 404 */
export const notFound = (msg = '見つからないか、権限がありません') => new ApiError(404, 'not_found', msg);
export const conflict = (msg: string, code: ErrorCode = 'conflict', details?: Record<string, unknown>) => new ApiError(409, code, msg, details ? { details } : {});
export const versionConflict = (currentVersion: number) => new ApiError(409, 'version_conflict', '他の利用者が更新しました。再読込するか、別版として保存してください', { currentVersion });
export const validationFailed = (fieldErrors: FieldError[], msg = '入力内容を確認してください') => new ApiError(422, 'validation_failed', msg, { fieldErrors });
export const payloadTooLarge = (msg = 'ファイルが大きすぎます') => new ApiError(413, 'payload_too_large', msg);
export const unsupportedMedia = (msg = '対応していない形式です') => new ApiError(415, 'unsupported_media_type', msg);
export const rateLimited = () => new ApiError(429, 'rate_limited', '試行回数が多すぎます。しばらく待ってから再試行してください');
