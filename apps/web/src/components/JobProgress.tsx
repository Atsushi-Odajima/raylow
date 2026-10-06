import type { Job } from '@raylow/contracts';
import { Link } from 'react-router';
import { readProgress } from '../api/jobs';
import { JOB_STATE_LABEL, JOB_TYPE_LABEL, label } from '../lib/labels';
import { Button } from './Button';
import { Icon } from './Icon';

export interface JobProgressProps {
  job: Job | undefined;
  /** job 取得前の表示 */
  pendingLabel?: string | undefined;
  onCancel?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  compact?: boolean | undefined;
}

/** 「3/8 書類を作成中」形式。残り秒数は捏造しない。中止・再試行・失敗理由・job 画面へのリンク */
export function JobProgress({ job, pendingLabel = '開始しています…', onCancel, onRetry, compact }: JobProgressProps) {
  if (!job) {
    return (
      <div className="job-progress" role="status" aria-live="polite">
        <div className="row">
          <Icon name="spinner" size={20} label="処理中" />
          <span>{pendingLabel}</span>
        </div>
        <div className="job-progress__bar job-progress__bar--indeterminate" aria-hidden="true">
          <span />
        </div>
      </div>
    );
  }
  const p = readProgress(job.progress);
  const active = job.state === 'queued' || job.state === 'running';
  const pct = p.current != null && p.total ? Math.min(100, Math.round((p.current / p.total) * 100)) : null;
  const typeLabel = label(JOB_TYPE_LABEL, job.type);
  return (
    <div className="job-progress" role={job.state === 'failed' ? 'alert' : 'status'} aria-live="polite">
      <div className="row-between">
        <div className="row">
          <Icon name={job.state === 'succeeded' ? 'check' : job.state === 'failed' ? 'alert' : active ? 'spinner' : 'info'} size={20} label={label(JOB_STATE_LABEL, job.state)} />
          <span>
            {p.current != null && p.total != null ? (
              <span className="job-progress__count">
                {p.current}/{p.total} {p.unit}
              </span>
            ) : null}{' '}
            {typeLabel}
            {active ? '中' : `：${label(JOB_STATE_LABEL, job.state)}`}
            {p.message ? <span className="muted">（{p.message}）</span> : null}
          </span>
        </div>
        <div className="row">
          {active && onCancel ? (
            <Button small onClick={onCancel} disabledReason={job.cancelRequested ? '中止を要求済みです（処理中の子は安全な地点で停止）' : undefined}>
              中止
            </Button>
          ) : null}
          {job.state === 'failed' && onRetry && job.retryable ? (
            <Button small onClick={onRetry} icon="refresh">
              再試行
            </Button>
          ) : null}
          {!compact ? (
            <Link to={`/jobs/${job.id}`} className="aux">
              ジョブ詳細
            </Link>
          ) : null}
        </div>
      </div>
      {active ? (
        <div className={['job-progress__bar', pct == null ? 'job-progress__bar--indeterminate' : ''].join(' ').trim()} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-valuetext={pct == null ? '進行中（残り時間は不明）' : `${pct}%`}>
          <span style={pct != null ? { width: `${pct}%` } : undefined} />
        </div>
      ) : null}
      {job.state === 'failed' ? (
        <div className="stack-s">
          <div>
            <b>失敗理由:</b> {job.errorMessage ?? job.errorCode ?? '不明'}
            {job.errorCode ? <span className="muted mono"> ({job.errorCode})</span> : null}
          </div>
          <div className="aux muted">
            試行 {job.attempt}/{job.maxAttempts}
            {job.retryable ? '。再試行できます' : '。自動再試行はされません。修正してから再度実行してください'}
          </div>
          {job.fixLink ? (
            <Link to={job.fixLink} className="btn btn-small">
              修正へ
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
