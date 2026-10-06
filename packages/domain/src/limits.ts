/** 一括生成の上限（§6）: 1案件・最大20書式×50宛先、合計100成果物。超過は422。 */
export const BATCH_MAX_TEMPLATES = 20;
export const BATCH_MAX_RECIPIENTS = 50;
export const BATCH_MAX_ITEMS = 100;

/** ファイル制限（§20.3） */
export const FILE_LIMITS = {
  sourceMaxBytes: 100 * 1024 * 1024,
  pdfMaxPages: 500,
  jobMaxPages: 2000,
  templateDocxMaxBytes: 20 * 1024 * 1024,
  docxMaxUncompressedBytes: 200 * 1024 * 1024,
  docxMaxEntries: 2000,
  docxMaxCompressionRatio: 100,
  imageMaxPixels: 40_000_000,
  parserTimeoutMs: 120_000,
  renderTimeoutMs: 300_000,
} as const;

export const ALLOWED_SOURCE_MIME = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg', 'text/plain', 'text/csv'] as const;

/** job（§9） */
export const JOB_LEASE_SECONDS = 120;
export const JOB_HEARTBEAT_SECONDS = 30;
export const JOB_MAX_ATTEMPTS = 3;
export const JOB_RETRY_DELAYS_SECONDS = [30, 120] as const;

/** 編集 lease（§9） */
export const EDIT_LEASE_SECONDS = 90;
export const EDIT_LEASE_HEARTBEAT_SECONDS = 30;

/** セッション（§20.2） */
export const SESSION_IDLE_MINUTES = 30;
export const SESSION_ABSOLUTE_HOURS = 12;
export const MFA_RECENT_MINUTES = 15;
