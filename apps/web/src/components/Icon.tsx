/**
 * アイコン（assets/icons/*.svg を inline sprite 化 + 不足分を同一線幅 2px / 24 viewBox で追加）。
 * 20px 表示（補助 16px）。accessible name は label を渡す（無い場合は装飾扱い aria-hidden）。
 */
import type { ReactElement } from 'react';

export type IconName =
  | 'alert'
  | 'calendar'
  | 'case'
  | 'check'
  | 'close'
  | 'evidence'
  | 'export'
  | 'external'
  | 'lock'
  | 'portal'
  | 'quote'
  | 'search'
  | 'text-width'
  | 'timeline'
  | 'upload'
  | 'version'
  // 追加（機能アイコン）
  | 'document'
  | 'merge'
  | 'review'
  | 'output'
  | 'recipient'
  | 'template'
  | 'original'
  | 'history'
  | 'settings'
  | 'plus'
  | 'minus'
  | 'arrow-up'
  | 'arrow-down'
  | 'info'
  | 'spinner'
  | 'refresh'
  | 'user'
  | 'logout'
  | 'create';

const PATHS: Record<IconName, ReactElement> = {
  // assets/icons
  alert: <path d="M12 3 2 21h20ZM12 9v5m0 3v1" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 2v6m10-6v6M3 11h18" />
    </>
  ),
  case: <path d="M3 6h7l2 3h9v11H3Z" />,
  check: <path d="m4 12 5 5 11-11" />,
  close: <path d="m5 5 14 14M19 5 5 19" />,
  evidence: <path d="M6 2h9l4 4v16H6ZM14 2v5h5M9 12h7m-7 4h7" />,
  export: <path d="M12 3v14m-5-5 5 5 5-5M3 17v4h18v-4" />,
  external: <path d="M14 3h7v7m0-7L10 14m0-10H3v17h17v-7" />,
  lock: (
    <>
      <rect x="4" y="10" width="16" height="12" rx="2" />
      <path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v3" />
    </>
  ),
  portal: <path d="M3 3h12v18H3M11 12h10m-4-4 4 4-4 4" />,
  quote: <path d="M4 6h6v7H5v5H2v-5Zm11 0h6v7h-5v5h-3v-5Z" />,
  search: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="m15 15 6 6" />
    </>
  ),
  'text-width': <path d="M3 4h18M8 4v16m8-16v16M4 20h16" />,
  timeline: (
    <>
      <path d="M7 2v20m0-15h13M7 17h13" />
      <circle cx="7" cy="7" r="2" />
      <circle cx="7" cy="17" r="2" />
    </>
  ),
  upload: <path d="M12 17V3m-5 5 5-5 5 5M3 16v5h18v-5" />,
  version: <path d="M8 3h13v14H8ZM3 7v14h13" />,
  // 追加: 書類
  document: <path d="M5 3h10l4 4v14H5ZM15 3v4h4M8 11h8M8 15h8M8 19h5" />,
  // 差込
  merge: <path d="M4 6h7M4 12h7M4 18h7M14 12h6m-3-3 3 3-3 3M17 4v3M17 17v3" />,
  // 確認
  review: <path d="M6 3h12v18H6ZM9 7h6M9 11h6M9 16l2 2 4-4" />,
  // 出力
  output: <path d="M4 4h10l4 4v5M4 4v16h8M14 4v4h4M15 18h6m-3-3 3 3-3 3" />,
  // 宛先
  recipient: <path d="M3 6h18v12H3ZM3 7l9 6 9-6" />,
  // 書式
  template: <path d="M4 3h16v18H4ZM4 8h16M9 8v13M12 12h5M12 16h5" />,
  // 原本
  original: <path d="M6 3h9l4 4v14H6ZM15 3v4h4M9 12l2 2 4-4M12 17h.01" />,
  // 履歴
  history: <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M4.9 19.1 7 17m10-10 2.1-2.1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  'arrow-up': <path d="M12 19V5m-6 6 6-6 6 6" />,
  'arrow-down': <path d="M12 5v14m-6-6 6 6 6-6" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5m0-8v.5" />
    </>
  ),
  spinner: <path d="M12 3a9 9 0 1 0 9 9" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  logout: <path d="M10 4H4v16h6M14 8l5 4-5 4M19 12H9" />,
  create: <path d="M12 5v14M5 12h14M4 4h4M16 20h4" />,
};

export interface IconProps {
  name: IconName;
  /** accessible name。省略時は装飾（aria-hidden） */
  label?: string | undefined;
  size?: 20 | 16 | 24 | undefined;
  className?: string | undefined;
}

export function Icon({ name, label, size = 20, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={className}
      style={{ flex: '0 0 auto' }}
    >
      {label ? <title>{label}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
