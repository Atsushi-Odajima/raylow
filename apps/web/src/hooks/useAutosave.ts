/**
 * autosave: 変更から 700ms（AUTOSAVE_DEBOUNCE_MS）後に保存。IME 変換中は走らせず、確定後に再度 debounce。
 * 保存中に新しい変更が入った場合は完了後に再保存する。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTOSAVE_DEBOUNCE_MS } from '@raylow/japanese-text';
import { imeState } from '../lib/ime';
import { unsavedRegistry } from '../lib/unsaved';
import type { SaveState } from '../components/SaveStatus';

export interface UseAutosaveOptions {
  /** 未保存変更の有無（呼び出し側で管理） */
  dirty: boolean;
  /** 保存処理。成功で true。失敗は throw */
  save: () => Promise<void>;
  enabled: boolean;
  registryKey: string;
  /** 変更が入るたびに増える数（debounce の起点） */
  changeTick: number;
}

export interface UseAutosaveResult {
  state: SaveState;
  savedAt: Date | null;
  error: unknown;
  /** 直ちに保存（確認へ進む前など）。変換中は確定を待つ */
  flush: () => Promise<boolean>;
}

export function useAutosave({ dirty, save, enabled, registryKey, changeTick }: UseAutosaveOptions): UseAutosaveResult {
  const [state, setState] = useState<SaveState>('saved');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<unknown>(null);
  const saving = useRef(false);
  const pending = useRef(false);
  const timer = useRef<number | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    unsavedRegistry.set(registryKey, dirty);
    return () => unsavedRegistry.clear(registryKey);
  }, [dirty, registryKey]);

  const runSave = useCallback(async (): Promise<boolean> => {
    if (saving.current) {
      pending.current = true;
      return false;
    }
    if (imeState.isComposing()) {
      await imeState.whenSettled();
    }
    if (!dirtyRef.current) return true;
    saving.current = true;
    setState('saving');
    try {
      await saveRef.current();
      setSavedAt(new Date());
      setError(null);
      setState(dirtyRef.current && pending.current ? 'unsaved' : 'saved');
      return true;
    } catch (e) {
      setError(e);
      setState('error');
      return false;
    } finally {
      saving.current = false;
      if (pending.current) {
        pending.current = false;
        if (dirtyRef.current) {
          timer.current = window.setTimeout(() => void runSave(), AUTOSAVE_DEBOUNCE_MS);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (!dirty) return;
    setState((s) => (s === 'saving' ? s : 'unsaved'));
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (imeState.isComposing()) {
        // 変換確定後に改めて debounce
        void imeState.whenSettled().then(() => {
          timer.current = window.setTimeout(() => void runSave(), AUTOSAVE_DEBOUNCE_MS);
        });
        return;
      }
      void runSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [changeTick, dirty, enabled, runSave]);

  useEffect(() => {
    if (!dirty && state === 'unsaved') setState('saved');
  }, [dirty, state]);

  const flush = useCallback(async () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (!dirtyRef.current) return true;
    return runSave();
  }, [runSave]);

  return { state, savedAt, error, flush };
}
