import { useMemo, useState } from 'react';
import { diffCodePoints, diffWidthFolded } from '@raylow/japanese-text';
import { Checkbox } from './Checkbox';

/** 原文差分（全角/半角・空白・改行・異体字を全て変更として表示）。「表記差を畳む」は閲覧モードで件数を残す */
export function DiffView({ before, after, label }: { before: string; after: string; label: string }) {
  const [fold, setFold] = useState(false);
  const raw = useMemo(() => diffCodePoints(before, after), [before, after]);
  const folded = useMemo(() => diffWidthFolded(before, after), [before, after]);
  const segs = fold ? folded.segments : raw;
  const changes = raw.filter((s) => s.type !== 'equal').length;
  return (
    <div className="stack-s">
      <div className="row-between">
        <span className="aux muted num">
          変更箇所 {changes} 件{fold ? `（表記差 ${folded.widthOnlyChanges} 件を畳んで表示中）` : ''}
        </span>
        <Checkbox checked={fold} onCheckedChange={setFold} label="表記差を畳む（閲覧のみ）" />
      </div>
      <div className="diff" aria-label={label}>
        {changes === 0 ? <span className="muted">差分はありません</span> : null}
        {segs.map((s, i) => (s.type === 'equal' ? <span key={i}>{s.text}</span> : s.type === 'insert' ? <ins key={i}>{s.text}</ins> : <del key={i}>{s.text}</del>))}
      </div>
    </div>
  );
}
