import { formatTime } from '../lib/format';
import { Icon } from './Icon';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

export function SaveStatus({ state, savedAt, errorMessage, live = true }: { state: SaveState; savedAt: Date | null; errorMessage?: string | null | undefined; live?: boolean | undefined }) {
  let text = '';
  let icon: 'check' | 'alert' | 'spinner' | 'info' = 'info';
  switch (state) {
    case 'saved':
      text = savedAt ? `保存済み ${formatTime(savedAt)}` : '保存済み';
      icon = 'check';
      break;
    case 'unsaved':
      text = '未保存';
      icon = 'alert';
      break;
    case 'saving':
      text = '保存中…';
      icon = 'spinner';
      break;
    case 'error':
      text = `保存に失敗しました${errorMessage ? `（${errorMessage}）` : ''}。入力は保持されています`;
      icon = 'alert';
      break;
  }
  return (
    <span className={`save-status save-status--${state}`} role={live ? 'status' : undefined} aria-live={live ? 'polite' : undefined} aria-atomic="true">
      <Icon name={icon} size={16} />
      <span>{text}</span>
    </span>
  );
}
