import type { ReactNode } from 'react';
import { Alert } from './Alert';
import { Button } from './Button';
import { Dialog } from './Dialog';

export interface VersionConflictDialogProps {
  open: boolean;
  currentVersion: number | null;
  myVersion: number;
  /** 版の対比表示（呼び出し側が差分などを渡す） */
  compare?: ReactNode | undefined;
  onReload: () => void;
  onSaveAsNew?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  busy?: boolean | undefined;
}

/** 409: 版対比 → 「再読込」または「別版として保存」。本文を黙って上書きしない */
export function VersionConflictDialog({ open, currentVersion, myVersion, compare, onReload, onSaveAsNew, onClose, busy }: VersionConflictDialogProps) {
  return (
    <Dialog
      open={open}
      title="他の更新と競合しました"
      onClose={onClose}
      wide={!!compare}
      actions={
        <>
          <Button onClick={onReload} disabledReason={busy ? '処理中' : undefined}>
            再読込（自分の変更を破棄）
          </Button>
          {onSaveAsNew ? (
            <Button variant="primary" onClick={onSaveAsNew} busy={busy}>
              別版として保存
            </Button>
          ) : null}
        </>
      }
    >
      <Alert kind="warning" title="サーバー上の版が更新されています">
        あなたが編集を始めた版: <b className="num">{myVersion}</b> ／ 現在の版: <b className="num">{currentVersion ?? '不明'}</b>
        。他の担当者が保存した可能性があります。内容を見比べて、再読込するか、自分の内容を新しい版として保存してください。自動で上書きはしません。
      </Alert>
      {compare}
    </Dialog>
  );
}
