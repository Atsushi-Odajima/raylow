/**
 * 連絡先の検索・選択。候補には所属・住所を併記し、同姓同名があれば必ず明示選択させる（自動選択しない）。
 */
import { useMemo, useState } from 'react';
import type { ContactType } from '@raylow/contracts';
import { useContactSearch } from '../api/masters';
import { CONTACT_TYPE_LABEL } from '../lib/labels';
import { formatDate } from '../lib/format';
import { Alert } from './Alert';
import { Button } from './Button';
import { Icon } from './Icon';
import { Input } from './Input';
import { LoadingState } from './States';

/** 候補表示に必要な最小項目（Contact も MatterParty.contact も満たす） */
export interface ContactLite {
  id: string;
  nameRaw: string;
  organizationNameRaw: string;
  addressRaw: string;
  type?: ContactType | undefined;
  checkedAt?: string | null | undefined;
  matchReason?: 'exact' | 'normalized' | 'alias' | undefined;
  /** 案件上の役割などの注記 */
  note?: string | undefined;
}

export interface ContactPickerProps {
  id?: string | undefined;
  describedBy?: string | undefined;
  selectedId: string | null;
  selectedLabel?: string | undefined;
  onSelect: (c: ContactLite) => void;
  onClear?: (() => void) | undefined;
  type?: ContactType | undefined;
  disabled?: boolean | undefined;
  /** 候補の先頭に置く（案件の当事者・代理人など） */
  suggestions?: ContactLite[] | undefined;
}

export function ContactPicker({ id, describedBy, selectedId, selectedLabel, onSelect, onClear, type, disabled, suggestions }: ContactPickerProps) {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'normalized' | 'exact'>('normalized');
  const enabled = q.trim().length > 0;
  const search = useContactSearch({ q: q.trim(), type, mode, limit: 20 }, enabled);
  const results = search.data ?? [];
  const sameName = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of results) m.set(c.nameRaw, (m.get(c.nameRaw) ?? 0) + 1);
    return [...m.entries()].filter(([, n]) => n > 1).map(([name]) => name);
  }, [results]);

  return (
    <div className="stack-s">
      {selectedId ? (
        <div className="row-between notice-box">
          <span>
            <Icon name="recipient" size={16} label="選択中" /> 選択中: <b>{selectedLabel ?? selectedId}</b>
          </span>
          {onClear ? (
            <Button small variant="quiet" onClick={onClear} disabledReason={disabled ? '編集不可' : undefined}>
              選び直す
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="row">
        <div style={{ flex: '1 1 240px' }}>
          <Input id={id} aria-describedby={describedBy} value={q} onValueChange={setQ} placeholder="氏名・所属で検索（表記ゆれを含む）" disabled={disabled} autoComplete="off" aria-label="連絡先を検索" />
        </div>
        <label className="check" style={{ minHeight: 'auto', padding: 0 }}>
          <input type="checkbox" checked={mode === 'exact'} onChange={(e) => setMode(e.currentTarget.checked ? 'exact' : 'normalized')} disabled={disabled} />
          <span className="check__text aux">原文一致のみ</span>
        </label>
      </div>
      {suggestions && suggestions.length > 0 && !enabled ? (
        <div className="candidate-list" role="listbox" aria-label="案件に登録済みの候補">
          {suggestions.map((c) => (
            <CandidateButton key={c.id} c={c} selected={c.id === selectedId} onSelect={onSelect} disabled={disabled} note={c.note ?? '案件に登録済み'} />
          ))}
        </div>
      ) : null}
      {enabled && search.isLoading ? <LoadingState label="検索中…" /> : null}
      {enabled && search.isError ? <Alert kind="error">検索に失敗しました。</Alert> : null}
      {enabled && search.isSuccess ? (
        <>
          {sameName.length > 0 ? (
            <Alert kind="warning" title="同姓同名の候補があります">
              「{sameName.join('」「')}」は複数登録されています。所属・住所を確認して該当する連絡先を明示的に選択してください（自動では選択しません）。
            </Alert>
          ) : null}
          {results.length === 0 ? <div className="muted aux">該当する連絡先がありません。/contacts で登録してください。</div> : null}
          <div className="candidate-list" role="listbox" aria-label="検索結果">
            {results.map((c) => (
              <CandidateButton key={c.id} c={c} selected={c.id === selectedId} onSelect={onSelect} disabled={disabled} note={c.matchReason === 'normalized' ? '表記ゆれ一致' : c.matchReason === 'alias' ? '別名一致' : '原文一致'} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function CandidateButton({ c, selected, onSelect, disabled, note }: { c: ContactLite; selected: boolean; onSelect: (c: ContactLite) => void; disabled: boolean | undefined; note: string }) {
  return (
    <button type="button" role="option" aria-selected={selected} aria-pressed={selected} className="candidate" onClick={() => onSelect(c)} disabled={disabled}>
      <span>
        <b>{c.nameRaw}</b> {c.type ? <span className="aux muted">（{CONTACT_TYPE_LABEL[c.type] ?? c.type}）</span> : null}
      </span>
      <span className="candidate__meta">
        所属: {c.organizationNameRaw || '—'} ／ 住所: {c.addressRaw || '—'} ／ 確認日: {formatDate(c.checkedAt)} ／ {note}
      </span>
    </button>
  );
}
