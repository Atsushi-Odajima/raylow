/**
 * 検索キー ver1（§19 U02）
 *
 * 原文を保存し直す正規化ではなく、検索専用キーを別に生成する。
 * 規則（固定・version 1）:
 *  1. 全角 A-Z / a-z / 0-9 だけを ASCII へ（U+FF21-FF3A, U+FF41-FF5A, U+FF10-FF19）
 *  2. ASCII 大文字を小文字へ
 *  3. 全角丸括弧 （） を ASCII 括弧 () へ
 *  4. U+3000（全角空白）を U+0020 へ
 *  5. 半角カナ（U+FF61-FF9F）の連続区間だけ NFKC で全角カナへ。
 *     直後の半角濁点/半濁点（U+FF9E/U+FF9F）は同じ区間として処理する。
 *  6. 連続空白を 1 つにまとめ、全体を trim（検索キーのみ）。
 * 上記以外は変更しない（①≠1、Ⅰ≠I、㈱≠(株)、髙≠高、﨑≠崎、各種ダッシュ、～≠〜、¥≠\ を保持）。
 * 全文 NFKC は禁止。
 */

export const SEARCH_KEY_VERSION = 1 as const;

export interface KeyMapEntry {
  /** 原文の UTF-16 半開区間 */
  srcStart: number;
  srcEnd: number;
  /** 検索キーの UTF-16 半開区間（空区間なら削除された文字） */
  keyStart: number;
  keyEnd: number;
}

export interface SearchKeyResult {
  version: typeof SEARCH_KEY_VERSION;
  key: string;
  map: KeyMapEntry[];
}

function isHalfwidthKana(cp: number): boolean {
  return cp >= 0xff61 && cp <= 0xff9f;
}
function isHalfwidthVoicedMark(cp: number): boolean {
  return cp === 0xff9e || cp === 0xff9f;
}
function isAsciiWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

function mapCodePoint(cp: number): string {
  // 1. 全角英数字
  if ((cp >= 0xff21 && cp <= 0xff3a) || (cp >= 0xff41 && cp <= 0xff5a) || (cp >= 0xff10 && cp <= 0xff19)) {
    cp = cp - 0xfee0;
  }
  // 2. ASCII 大文字 → 小文字
  if (cp >= 0x41 && cp <= 0x5a) {
    cp = cp + 0x20;
  }
  // 3. 全角丸括弧
  if (cp === 0xff08) return '(';
  if (cp === 0xff09) return ')';
  // 4. 全角空白
  if (cp === 0x3000) return ' ';
  return String.fromCodePoint(cp);
}

export function buildSearchKey(text: string): SearchKeyResult {
  const map: KeyMapEntry[] = [];
  let key = '';
  let i = 0;
  let lastWasSpace = true; // 先頭空白を落とすため true から開始
  let pendingTrailingSpaceIndex = -1;

  const pushSegment = (srcStart: number, srcEnd: number, out: string): void => {
    // 空白のまとめ・trim は検索キーだけで許される
    if (out.length === 1 && isAsciiWhitespace(out)) {
      if (lastWasSpace) {
        map.push({ srcStart, srcEnd, keyStart: key.length, keyEnd: key.length });
        return;
      }
      lastWasSpace = true;
      pendingTrailingSpaceIndex = map.length;
      map.push({ srcStart, srcEnd, keyStart: key.length, keyEnd: key.length + 1 });
      key += ' ';
      return;
    }
    lastWasSpace = false;
    pendingTrailingSpaceIndex = -1;
    map.push({ srcStart, srcEnd, keyStart: key.length, keyEnd: key.length + out.length });
    key += out;
  };

  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const cpLen = cp > 0xffff ? 2 : 1;
    if (isHalfwidthKana(cp) && !isHalfwidthVoicedMark(cp)) {
      // 5. 半角カナ + 直後の濁点/半濁点を 1 セグメントとして NFKC
      let j = i + cpLen;
      while (j < text.length) {
        const next = text.codePointAt(j)!;
        if (isHalfwidthVoicedMark(next)) j += 1;
        else break;
      }
      const seg = text.slice(i, j);
      pushSegment(i, j, seg.normalize('NFKC'));
      i = j;
      continue;
    }
    if (isHalfwidthVoicedMark(cp)) {
      // 単独の半角濁点
      pushSegment(i, i + 1, text.slice(i, i + 1).normalize('NFKC'));
      i += 1;
      continue;
    }
    pushSegment(i, i + cpLen, mapCodePoint(cp));
    i += cpLen;
  }

  // 末尾 trim
  if (pendingTrailingSpaceIndex >= 0 && key.endsWith(' ')) {
    key = key.slice(0, -1);
    const e = map[pendingTrailingSpaceIndex]!;
    e.keyEnd = e.keyStart;
  }
  return { version: SEARCH_KEY_VERSION, key, map };
}

/**
 * 検索キー上の一致範囲 [keyStart, keyEnd) を原文の UTF-16 範囲へ写す。
 * 多対一の対応（半角カナ+濁点→1文字など）は元の区間を広く取る。
 */
export function mapKeyRangeToSource(result: SearchKeyResult, keyStart: number, keyEnd: number): { start: number; end: number } | null {
  let start = -1;
  let end = -1;
  for (const e of result.map) {
    if (e.keyEnd <= e.keyStart) continue; // 削除文字
    const overlaps = e.keyStart < keyEnd && e.keyEnd > keyStart;
    if (!overlaps) continue;
    if (start < 0 || e.srcStart < start) start = e.srcStart;
    if (e.srcEnd > end) end = e.srcEnd;
  }
  if (start < 0) return null;
  return { start, end };
}

export interface SearchMatch {
  /** 原文での一致区間 */
  start: number;
  end: number;
  /** 一致理由 */
  reason: 'exact' | 'normalized';
  /** 原文の一致部分 */
  quote: string;
}

/**
 * 「表記ゆれを含む」検索。query も同じ規則でキー化して照合する。
 */
export function searchNormalized(text: string, query: string): SearchMatch[] {
  const t = buildSearchKey(text);
  const q = buildSearchKey(query).key;
  const out: SearchMatch[] = [];
  if (q.length === 0) return out;
  let from = 0;
  for (;;) {
    const idx = t.key.indexOf(q, from);
    if (idx < 0) break;
    const r = mapKeyRangeToSource(t, idx, idx + q.length);
    if (r) {
      const quote = text.slice(r.start, r.end);
      out.push({ start: r.start, end: r.end, reason: quote === query ? 'exact' : 'normalized', quote });
    }
    from = idx + Math.max(1, q.length);
  }
  return out;
}

/** 「原文一致」検索 */
export function searchExact(text: string, query: string): SearchMatch[] {
  const out: SearchMatch[] = [];
  if (query.length === 0) return out;
  let from = 0;
  for (;;) {
    const idx = text.indexOf(query, from);
    if (idx < 0) break;
    out.push({ start: idx, end: idx + query.length, reason: 'exact', quote: query });
    from = idx + query.length;
  }
  return out;
}
