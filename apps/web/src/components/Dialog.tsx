import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  onClose?: (() => void) | undefined;
  /** 閉じられない（再ログイン等） */
  modalOnly?: boolean | undefined;
  /** 背景を不透明にして旧画面を隠す（セッション切れ等） */
  cover?: boolean | undefined;
  wide?: boolean | undefined;
  children: ReactNode;
  actions?: ReactNode | undefined;
  describedBy?: string | undefined;
}

/** native <dialog> によるモーダル（フォーカス閉じ込み・Esc）。radius 8px・影は dialog のみ */
export function Dialog({ open, title, onClose, modalOnly, cover, wide, children, actions, describedBy }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      try {
        el.showModal();
      } catch {
        el.setAttribute('open', '');
      }
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      if (modalOnly) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      onClose?.();
    };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [modalOnly, onClose]);
  return (
    <dialog ref={ref} className={['dialog', wide ? 'dialog-wide' : '', cover ? 'dialog--cover' : ''].join(' ').trim()} aria-labelledby={titleId} aria-describedby={describedBy}>
      {open ? (
        <div className="dialog__inner">
          <div className="dialog__head">
            <h2 id={titleId}>{title}</h2>
            {!modalOnly && onClose ? (
              <Button variant="quiet" small onClick={onClose} aria-label="閉じる">
                <Icon name="close" size={20} />
              </Button>
            ) : null}
          </div>
          <div className="stack">{children}</div>
          {actions ? <div className="dialog__actions">{actions}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
