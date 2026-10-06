/**
 * 変換ツール（§19 U05）: 選択範囲 + 対象種別（英数だけ/数字だけ/カナだけ）を選び、
 * before/after と件数を返す。適用は呼び出し側が明示的に行う（全体ワンクリック整形は設けない）。
 */
export type ConvertKind = 'alnum_to_ascii' | 'digits_to_ascii' | 'halfwidth_kana_to_fullwidth';

export interface ConvertPreview {
  before: string;
  after: string;
  count: number;
}

export function previewConvert(text: string, kind: ConvertKind): ConvertPreview {
  let count = 0;
  let after = '';
  if (kind === 'halfwidth_kana_to_fullwidth') {
    let i = 0;
    while (i < text.length) {
      const cp = text.codePointAt(i)!;
      if (cp >= 0xff61 && cp <= 0xff9f) {
        let j = i + 1;
        while (j < text.length) {
          const c2 = text.codePointAt(j)!;
          if (c2 >= 0xff61 && c2 <= 0xff9f) j++;
          else break;
        }
        const seg = text.slice(i, j);
        const conv = seg.normalize('NFKC');
        if (conv !== seg) count += 1;
        after += conv;
        i = j;
      } else {
        const len = cp > 0xffff ? 2 : 1;
        after += text.slice(i, i + len);
        i += len;
      }
    }
    return { before: text, after, count };
  }
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const isDigit = cp >= 0xff10 && cp <= 0xff19;
    const isAlpha = (cp >= 0xff21 && cp <= 0xff3a) || (cp >= 0xff41 && cp <= 0xff5a);
    if (isDigit || (kind === 'alnum_to_ascii' && isAlpha)) {
      after += String.fromCodePoint(cp - 0xfee0);
      count += 1;
    } else {
      after += ch;
    }
  }
  return { before: text, after, count };
}
