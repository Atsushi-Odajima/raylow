/**
 * Service Worker 登録。
 * - updateViaCache:'none'
 * - 更新は「未保存なし」のときだけ適用（skipWaiting → reload）。編集中に強制 reload しない
 */
import { unsavedRegistry } from './unsaved';

let waitingWorker: ServiceWorker | null = null;
let reloading = false;

function tryApply(): void {
  if (!waitingWorker) return;
  if (unsavedRegistry.hasUnsaved()) return;
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}

export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) {
    // 開発時は旧 SW を外す（キャッシュ混乱防止）
    void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister()));
    return;
  }
  window.addEventListener('load', () => {
    // 初回インストール（controller 無し → clients.claim()）では reload しない。既存 controller の置換（更新）時だけ reload する
    let hadController = navigator.serviceWorker.controller != null;
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none', scope: '/' })
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          waitingWorker = reg.waiting;
          tryApply();
        }
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              waitingWorker = installing;
              tryApply();
            }
          });
        });
      })
      .catch(() => undefined);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      if (reloading) return;
      if (unsavedRegistry.hasUnsaved()) return;
      reloading = true;
      window.location.reload();
    });
    unsavedRegistry.subscribe((has) => {
      if (!has) tryApply();
    });
  });
}
