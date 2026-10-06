/**
 * サーバー生成 PDF のプレビュー（PDF.js で canvas に描画）。DOCX をクライアントで描画しない。
 * 取得は credentials:'include' の fetch（no-store）。古いプレビューは呼び出し側がラベル表示。
 */
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { fetchBlob } from '../lib/download';
import { isApiError } from '../lib/apiClient';
import { Alert } from './Alert';
import { Icon } from './Icon';

/** PDF.js はプレビュー表示時にだけ読み込む（初期バンドルを小さくする） */
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  return pdfjs;
}

export interface PdfPreviewProps {
  /** null のときは「プレビュー未生成」 */
  src: string | null;
  /** 再描画トリガ（出力 id や hash） */
  version?: string | undefined;
  staleNotice?: string | null | undefined;
  emptyLabel?: string | undefined;
  maxPages?: number | undefined;
}

export function PdfPreview({ src, version, staleNotice, emptyLabel = 'プレビューはまだ生成されていません。「プレビューを更新」で生成します。', maxPages = 30 }: PdfPreviewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<{ kind: 'idle' | 'loading' | 'ready' | 'error'; message?: string; pages?: number }>({ kind: 'idle' });

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    container.replaceChildren();
    if (!src) {
      setStatus({ kind: 'idle' });
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    setStatus({ kind: 'loading' });
    (async () => {
      try {
        const [pdfjs, { blob }] = await Promise.all([loadPdfjs(), fetchBlob(src, ac.signal)]);
        const data = new Uint8Array(await blob.arrayBuffer());
        // PDF.js 5 は eval を使わない。PDF 内 JavaScript・外部動作は実行しない（canvas 描画のみ）
        doc = await pdfjs.getDocument({ data, disableAutoFetch: true }).promise;
        if (cancelled) return;
        const pageCount = Math.min(doc.numPages, maxPages);
        const width = Math.max(280, container.clientWidth - 32);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 1; i <= pageCount; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const viewport = page.getViewport({ scale: scale * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
          canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `${i} ページ目`);
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          if (cancelled) return;
          container.appendChild(canvas);
        }
        setStatus({ kind: 'ready', pages: doc.numPages });
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        const message = isApiError(err) ? err.userMessage() : 'PDF を表示できませんでした。';
        setStatus({ kind: 'error', message });
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
      void doc?.destroy();
    };
  }, [src, version, maxPages]);

  return (
    <div className="pdf-preview" aria-busy={status.kind === 'loading'}>
      {staleNotice ? (
        <div className="pdf-preview__stale">
          <Alert kind="warning" title="プレビューは最新ではありません">
            {staleNotice}
          </Alert>
        </div>
      ) : null}
      {!src ? (
        <div className="pdf-preview__status muted" role="status">
          {emptyLabel}
        </div>
      ) : null}
      {status.kind === 'loading' ? (
        <div className="pdf-preview__status row" role="status" aria-live="polite">
          <Icon name="spinner" size={20} label="読み込み中" />
          <span>PDF を読み込んでいます…</span>
        </div>
      ) : null}
      {status.kind === 'error' ? (
        <div className="pdf-preview__status">
          <Alert kind="error" title="プレビューを表示できません" live>
            {status.message}
          </Alert>
        </div>
      ) : null}
      {status.kind === 'ready' && status.pages != null ? (
        <div className="pdf-preview__status aux muted num" role="status">
          全 {status.pages} ページ{status.pages > maxPages ? `（先頭 ${maxPages} ページまで表示）` : ''}
        </div>
      ) : null}
      <div ref={host} style={{ display: 'contents' }} />
    </div>
  );
}
