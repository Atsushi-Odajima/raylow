import type { ReactNode } from 'react';
import { isApiError } from '../lib/apiClient';
import { Alert } from './Alert';
import { Icon } from './Icon';

/** 読み込み中。残り秒数は出さない */
export function LoadingState({ label = '読み込み中…' }: { label?: string | undefined }) {
  return (
    <div className="state-box" role="status" aria-live="polite">
      <Icon name="spinner" size={24} label="読み込み中" />
      <span>{label}</span>
    </div>
  );
}

/** 空: 次の作成操作を示す */
export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode | undefined }) {
  return (
    <div className="state-box">
      <Icon name="document" size={24} />
      <div style={{ fontWeight: 500 }}>{title}</div>
      {children ? <div className="muted">{children}</div> : null}
      {action}
    </div>
  );
}

/** エラー: 原因・直す場所。403/404 は存在を秘匿した汎用文言 */
export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: (() => void) | undefined; title?: ReactNode | undefined }) {
  const message = isApiError(error) ? error.userMessage() : error instanceof Error ? error.message : 'エラーが発生しました。';
  const requestId = isApiError(error) ? error.requestId : null;
  return (
    <Alert
      kind="error"
      live
      title={title ?? '読み込めませんでした'}
      actions={
        onRetry ? (
          <button type="button" className="btn btn-small" onClick={onRetry}>
            <Icon name="refresh" size={16} />
            再試行
          </button>
        ) : undefined
      }
    >
      <div>{message}</div>
      {requestId ? <div className="aux muted mono">requestId: {requestId}</div> : null}
    </Alert>
  );
}
