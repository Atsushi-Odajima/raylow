import { useRef, useState } from 'react';
import type { FileInfo } from '@raylow/contracts';
import { uploadFile, type UploadProgress } from '../api/files';
import { isApiError } from '../lib/apiClient';
import { formatBytes } from '../lib/format';
import { Alert } from './Alert';
import { Button } from './Button';
import { Icon } from './Icon';

export interface FileUploadProps {
  scope: 'matter' | 'template' | 'receipt';
  matterId?: string | null | undefined;
  accept?: string | undefined;
  maxBytes?: number | undefined;
  confidential?: boolean | undefined;
  onUploaded: (file: FileInfo, scanJobId: string | null) => void;
  label?: string | undefined;
  disabled?: boolean | undefined;
}

/** init → PUT → finalize。進捗は実測バイト数のみ表示。残り秒数は出さない */
export function FileUpload({ scope, matterId, accept, maxBytes, confidential, onUploaded, label = 'ファイルを選択', disabled }: FileUploadProps) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [ac, setAc] = useState<AbortController | null>(null);

  const onPick = async (f: File) => {
    setError(null);
    setName(f.name);
    if (maxBytes && f.size > maxBytes) {
      setError(`ファイルが上限（${formatBytes(maxBytes)}）を超えています。`);
      return;
    }
    const controller = new AbortController();
    setAc(controller);
    try {
      const r = await uploadFile(f, { scope, matterId, confidential }, setProgress, controller.signal);
      onUploaded(r.file, r.scanJobId);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setError('アップロードを中止しました。');
      else setError(isApiError(e) ? e.userMessage() : 'アップロードに失敗しました。');
    } finally {
      setProgress(null);
      setAc(null);
    }
  };

  return (
    <div className="file-drop">
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={disabled || !!progress}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) void onPick(f);
        }}
      />
      <div className="row">
        <Button icon="upload" onClick={() => input.current?.click()} disabledReason={disabled ? '操作できません' : progress ? 'アップロード中' : undefined}>
          {label}
        </Button>
        {name ? <span className="aux">{name}</span> : null}
        {accept ? <span className="aux muted">対応: {accept}</span> : null}
        {maxBytes ? <span className="aux muted">上限 {formatBytes(maxBytes)}</span> : null}
      </div>
      {progress ? (
        <div className="job-progress" role="status" aria-live="polite">
          <div className="row-between">
            <span>
              <Icon name="spinner" size={16} label="進行中" />{' '}
              {progress.stage === 'init' ? '準備中' : progress.stage === 'upload' ? `送信中 ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}` : progress.stage === 'finalize' ? '検査キューへ登録中' : '完了'}
            </span>
            {ac ? (
              <Button small onClick={() => ac.abort()}>
                中止
              </Button>
            ) : null}
          </div>
          <div className="job-progress__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.total ? Math.round((progress.loaded / progress.total) * 100) : undefined}>
            <span style={{ width: `${progress.total ? Math.round((progress.loaded / progress.total) * 100) : 10}%` }} />
          </div>
        </div>
      ) : null}
      {error ? (
        <Alert kind="error" live>
          {error}
        </Alert>
      ) : null}
      <div className="aux muted">アップロード後はウイルス検査・形式検査が完了するまで隔離され、取得できません。検査停止時は利用不可のままになります（fail closed）。</div>
    </div>
  );
}
