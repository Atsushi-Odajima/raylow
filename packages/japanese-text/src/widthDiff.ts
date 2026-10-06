/**
 * 「原文差分」と「表記差を畳む」閲覧モード（§19 U05）。
 * 承認 hash は原文 AST から作る。ここでの畳み込みは閲覧専用。
 */
import { buildSearchKey } from './searchKey.js';

export interface DiffSegment {
  type: 'equal' | 'insert' | 'delete';
  text: string;
}

/** 単純な LCS ベースの文字列差分（グラフェム単位ではなくコードポイント単位。閲覧用） */
export function diffCodePoints(a: string, b: string): DiffSegment[] {
  const A = Array.from(a);
  const B = Array.from(b);
  const n = A.length;
  const m = B.length;
  // 大きすぎる入力は行単位に落とす
  if (n * m > 4_000_000) return diffLines(a, b);
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  const push = (type: DiffSegment['type'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push('equal', A[i]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      push('delete', A[i]!);
      i++;
    } else {
      push('insert', B[j]!);
      j++;
    }
  }
  while (i < n) push('delete', A[i++]!);
  while (j < m) push('insert', B[j++]!);
  return out;
}

function diffLines(a: string, b: string): DiffSegment[] {
  const A = a.split('\n');
  const B = b.split('\n');
  const out: DiffSegment[] = [];
  const max = Math.max(A.length, B.length);
  for (let k = 0; k < max; k++) {
    const x = A[k];
    const y = B[k];
    if (x === y && x !== undefined) out.push({ type: 'equal', text: x + (k < max - 1 ? '\n' : '') });
    else {
      if (x !== undefined) out.push({ type: 'delete', text: x + '\n' });
      if (y !== undefined) out.push({ type: 'insert', text: y + '\n' });
    }
  }
  return out;
}

export interface WidthFoldedDiff {
  segments: DiffSegment[];
  /** 畳まれた表記差の件数（消さずに表示する） */
  widthOnlyChanges: number;
}

/** 表記差（全角/半角など検索キー規則で同一になる差）を畳んで表示する閲覧モード */
export function diffWidthFolded(a: string, b: string): WidthFoldedDiff {
  const raw = diffCodePoints(a, b);
  const segments: DiffSegment[] = [];
  let widthOnlyChanges = 0;
  for (let k = 0; k < raw.length; k++) {
    const cur = raw[k]!;
    const next = raw[k + 1];
    if (cur.type === 'delete' && next && next.type === 'insert' && buildSearchKey(cur.text).key === buildSearchKey(next.text).key && cur.text !== next.text) {
      widthOnlyChanges += 1;
      segments.push({ type: 'equal', text: next.text });
      k += 1;
      continue;
    }
    segments.push(cur);
  }
  return { segments, widthOnlyChanges };
}
