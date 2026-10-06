/**
 * セッション状態（メモリのみ。localStorage に機密を置かない）。
 * - GET /api/auth/session で確認。bfcache 復帰(pageshow persisted)時は再検証まで画面を隠す
 * - 401 を受けたら「再ログイン → 権限再確認」ダイアログへ通知する
 */
import { SessionInfoSchema, type SessionInfo } from '@raylow/contracts';

export type SessionStatus = 'unknown' | 'checking' | 'ready' | 'error';
export type UnauthorizedKind = 'unauthorized' | 'mfa_required';

export interface SessionState {
  status: SessionStatus;
  info: SessionInfo | null;
  /** 401 により再ログインが必要になった */
  expired: UnauthorizedKind | null;
  checkedAt: number | null;
}

type Listener = () => void;

const EMPTY: SessionInfo = {
  authenticated: false,
  mfaVerified: false,
  mfaEnrolled: false,
  user: null,
  org: null,
  role: null,
  lawyerId: null,
  csrfToken: null,
  mfaRecent: false,
  idleExpiresAt: null,
  absoluteExpiresAt: null,
};

class SessionStore {
  private state: SessionState = { status: 'unknown', info: null, expired: null, checkedAt: null };
  private listeners = new Set<Listener>();
  private inflight: Promise<SessionInfo> | null = null;

  getState(): SessionState {
    return this.state;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private set(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  getCsrfToken(): string | null {
    return this.state.info?.csrfToken ?? null;
  }

  isAuthenticated(): boolean {
    const i = this.state.info;
    return !!i && i.authenticated && i.mfaVerified;
  }

  /** GET /api/auth/session（未認証でも 200）。同時呼び出しは 1 本にまとめる */
  refresh(): Promise<SessionInfo> {
    if (this.inflight) return this.inflight;
    this.set({ status: this.state.status === 'ready' ? 'checking' : 'checking' });
    this.inflight = (async () => {
      try {
        const res = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`session ${res.status}`);
        const json = (await res.json()) as { data?: unknown };
        const parsed = SessionInfoSchema.safeParse(json.data ?? json);
        const info = parsed.success ? parsed.data : { ...EMPTY };
        const wasAuthed = this.isAuthenticated();
        this.set({ status: 'ready', info, checkedAt: Date.now(), expired: info.authenticated && info.mfaVerified ? null : this.state.expired });
        if (wasAuthed && !(info.authenticated && info.mfaVerified) && this.state.expired === null) {
          this.set({ expired: 'unauthorized' });
        }
        return info;
      } catch {
        this.set({ status: 'error', checkedAt: Date.now() });
        return this.state.info ?? { ...EMPTY };
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  /** API から 401 を受けた */
  notifyUnauthorized(kind: UnauthorizedKind): void {
    if (!this.state.info?.authenticated && kind === 'unauthorized') {
      // 未ログインのまま叩いた場合: 期限切れ扱いにせず status だけ更新
      this.set({ info: { ...EMPTY }, status: 'ready' });
      return;
    }
    this.set({ expired: kind });
  }

  /** 再ログイン成功後（権限再確認は refresh が行う） */
  clearExpired(): void {
    this.set({ expired: null });
  }

  /** ログアウト・ログイン画面表示時: メモリ上の情報を破棄 */
  reset(): void {
    this.set({ status: 'ready', info: { ...EMPTY }, expired: null, checkedAt: Date.now() });
  }

  setInfo(info: SessionInfo): void {
    this.set({ status: 'ready', info, checkedAt: Date.now() });
  }
}

export const sessionStore = new SessionStore();

/** bfcache 復帰時は権限再検証まで画面を隠す */
if (typeof window !== 'undefined') {
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) {
      void sessionStore.refresh();
    }
  });
}
