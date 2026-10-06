/**
 * 編集 lease: 開いたときに取得、30 秒ごとに heartbeat、離れるときに解放。
 * 他者保持中（409 lease_held）は保持者を表示し、理由付きの強制引継ぎフォームを出す。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { acquireLease, releaseLease, type EditLease } from '../api/drafts';
import { isApiError } from '../lib/apiClient';
import { sessionStore } from '../lib/session';

const HEARTBEAT_MS = 30_000;

export interface UseEditLeaseResult {
  lease: EditLease | null;
  /** 自分が保持している */
  mine: boolean;
  heldByOther: EditLease | null;
  error: unknown;
  takeover: (reason: string) => Promise<boolean>;
  acquiring: boolean;
}

export function useEditLease(draftId: string | undefined, enabled: boolean, currentLease: EditLease | null | undefined): UseEditLeaseResult {
  const [lease, setLease] = useState<EditLease | null>(null);
  const [heldByOther, setHeldByOther] = useState<EditLease | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [acquiring, setAcquiring] = useState(false);
  const timer = useRef<number | null>(null);
  const mineRef = useRef(false);

  const attempt = useCallback(
    async (reason?: string): Promise<boolean> => {
      if (!draftId) return false;
      setAcquiring(true);
      try {
        const l = await acquireLease(draftId, reason);
        setLease(l);
        setHeldByOther(null);
        setError(null);
        mineRef.current = l.mine !== false;
        return true;
      } catch (e) {
        if (isApiError(e) && e.status === 409 && e.code === 'lease_held') {
          const d = e.details as Partial<EditLease> | null;
          const fallback = currentLease && !currentLease.mine ? currentLease : null;
          setHeldByOther(
            d && typeof d.userName === 'string'
              ? { draftId, userId: String(d.userId ?? ''), userName: d.userName, expiresAt: String(d.expiresAt ?? ''), mine: false }
              : fallback ?? { draftId, userId: '', userName: '他の担当者', expiresAt: '', mine: false },
          );
          mineRef.current = false;
          return false;
        }
        setError(e);
        return false;
      } finally {
        setAcquiring(false);
      }
    },
    [draftId, currentLease],
  );

  useEffect(() => {
    if (!draftId || !enabled) return;
    void attempt();
    timer.current = window.setInterval(() => {
      if (mineRef.current && sessionStore.isAuthenticated()) void attempt();
    }, HEARTBEAT_MS);
    const id = draftId;
    return () => {
      if (timer.current) window.clearInterval(timer.current);
      if (mineRef.current) {
        // 離脱時に解放（失敗しても無視。期限切れで自然解放される）
        void releaseLease(id).catch(() => undefined);
        mineRef.current = false;
      }
    };
    // attempt は draftId に依存するので再取得は draftId 変更時のみ
  }, [draftId, enabled]);

  const takeover = useCallback((reason: string) => attempt(reason), [attempt]);

  return { lease, mine: !!lease && lease.mine !== false && !heldByOther, heldByOther, error, takeover, acquiring };
}
