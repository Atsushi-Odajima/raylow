import { useState } from 'react';
import type { MatterSummary } from '@raylow/contracts';
import { useMatters } from '../api/matters';
import { ACCEPTANCE_LABEL, MATTER_STATUS_LABEL } from '../lib/labels';
import { Button } from './Button';
import { Icon } from './Icon';
import { Input } from './Input';
import { LoadingState } from './States';
import { Alert } from './Alert';

export interface MatterPickerProps {
  selected: MatterSummary | null;
  onSelect: (m: MatterSummary | null) => void;
  disabled?: boolean | undefined;
  id?: string | undefined;
}

export function MatterPicker({ selected, onSelect, disabled, id }: MatterPickerProps) {
  const [q, setQ] = useState('');
  const list = useMatters({ q: q.trim() || undefined, limit: 30 }, !disabled);
  return (
    <div className="stack-s">
      {selected ? (
        <div className="row-between notice-box">
          <span>
            <Icon name="case" size={16} label="選択中" /> <b>{selected.titleRaw}</b>
            <span className="aux muted"> {selected.caseNumberRaw || ''} {selected.courtRaw || ''}</span>
          </span>
          <Button small variant="quiet" onClick={() => onSelect(null)} disabledReason={disabled ? '編集不可' : undefined}>
            選び直す
          </Button>
        </div>
      ) : (
        <>
          <Input id={id} value={q} onValueChange={setQ} placeholder="案件名・事件番号で検索" disabled={disabled} autoComplete="off" aria-label="案件を検索" />
          {list.isLoading ? <LoadingState label="案件を読み込んでいます…" /> : null}
          {list.isError ? <Alert kind="error">案件を読み込めませんでした。</Alert> : null}
          {list.isSuccess ? (
            <div className="candidate-list" role="listbox" aria-label="案件候補">
              {list.data.length === 0 ? <div className="muted aux">該当する案件がありません。下の「案件を登録」で最小項目だけ登録できます。</div> : null}
              {list.data.map((m) => (
                <button key={m.id} type="button" role="option" aria-selected={false} className="candidate" onClick={() => onSelect(m)} disabled={disabled}>
                  <span>
                    <b>{m.titleRaw}</b>
                  </span>
                  <span className="candidate__meta">
                    {m.caseNumberRaw || '事件番号なし'} ／ {m.courtRaw || '裁判所未設定'} ／ {MATTER_STATUS_LABEL[m.status] ?? m.status} ／ {ACCEPTANCE_LABEL[m.acceptanceStatus] ?? m.acceptanceStatus}
                    {m.matchReason === 'normalized' ? ' ／ 表記ゆれ一致' : ''}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
