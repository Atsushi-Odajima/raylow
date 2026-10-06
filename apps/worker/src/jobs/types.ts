import type { Tx } from '../db.js';

export interface JobRow {
  id: string;
  org_id: string;
  matter_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  attempt: number;
  max_attempts: number;
  cancel_requested: boolean;
  created_by: string | null;
}

export interface JobContext {
  job: JobRow;
  /** heartbeat + 進捗更新。cancel_requested なら false を返す（安全な checkpoint で停止） */
  progress(p: Record<string, unknown>): Promise<boolean>;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export type JobHandler = (ctx: JobContext, tx: Tx) => Promise<Record<string, unknown>>;

export class JobFailure extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean, public readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}
