/**
 * 日本語の文字境界（§19 U04）
 * JS の string.length / slice の UTF-16 単位で文字数や切り詰めを行わない。
 * Intl.Segmenter(granularity:'grapheme') を使う。ICU 版は process.versions.icu で記録し golden fixture で差を検知する。
 */

const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

export interface GraphemeSegment {
  segment: string;
  /** UTF-16 index */
  index: number;
}

export function graphemes(text: string): GraphemeSegment[] {
  const out: GraphemeSegment[] = [];
  for (const s of segmenter.segment(text)) {
    out.push({ segment: s.segment, index: s.index });
  }
  return out;
}

export function graphemeLength(text: string): number {
  let n = 0;
  for (const _ of segmenter.segment(text)) n += 1;
  return n;
}

/** 先頭 max グラフェムまで。IVS・サロゲートペア・結合濁点・ZWJ を分割しない。 */
export function truncateGraphemes(text: string, max: number): string {
  if (max <= 0) return '';
  let n = 0;
  let end = 0;
  for (const s of segmenter.segment(text)) {
    if (n >= max) break;
    end = s.index + s.segment.length;
    n += 1;
  }
  return text.slice(0, end);
}

/**
 * UTF-16 offset をグラフェム境界へ寄せる（直前の境界）。
 * 選択 offset は UTF-16 半開区間で保存するが、境界は必ずグラフェムに一致させる。
 */
export function snapToGraphemeBoundary(text: string, offset: number, direction: 'backward' | 'forward' = 'backward'): number {
  if (offset <= 0) return 0;
  if (offset >= text.length) return text.length;
  let prev = 0;
  for (const s of segmenter.segment(text)) {
    const start = s.index;
    const end = s.index + s.segment.length;
    if (offset === start) return offset;
    if (offset > start && offset < end) {
      return direction === 'backward' ? start : end;
    }
    prev = end;
  }
  return prev;
}

export function icuVersion(): string {
  const v = (globalThis as { process?: { versions?: { icu?: string } } }).process?.versions?.icu;
  return v ?? 'unknown';
}
