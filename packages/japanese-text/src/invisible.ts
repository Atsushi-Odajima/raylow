/**
 * 制御文字・bidi override・zero width の検出（§19 U04）。
 * 存在は警告表示し、保存拒否/削除を自動実行しない。
 */
export interface InvisibleFinding {
  index: number;
  codePoint: string;
  category: 'control' | 'bidi' | 'zero_width' | 'nul' | 'pua' | 'ivs' | 'variation_selector';
  description: string;
}

const BIDI = new Set([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f, 0x061c]);
const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

export function hex(cp: number): string {
  return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
}

export function findInvisible(text: string): InvisibleFinding[] {
  const out: InvisibleFinding[] = [];
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    if (cp === 0) out.push({ index: i, codePoint: hex(cp), category: 'nul', description: 'NUL（DB保持不可。原本bytes保存+テキスト化失敗を明示）' });
    else if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) out.push({ index: i, codePoint: hex(cp), category: 'control', description: '制御文字' });
    else if (cp >= 0x7f && cp <= 0x9f) out.push({ index: i, codePoint: hex(cp), category: 'control', description: 'C1 制御文字' });
    else if (BIDI.has(cp)) out.push({ index: i, codePoint: hex(cp), category: 'bidi', description: '双方向制御文字（bidi override）' });
    else if (ZERO_WIDTH.has(cp)) out.push({ index: i, codePoint: hex(cp), category: 'zero_width', description: 'ゼロ幅文字' });
    else if (cp >= 0xe000 && cp <= 0xf8ff) out.push({ index: i, codePoint: hex(cp), category: 'pua', description: '私用領域（外字の可能性。字体確認が必要）' });
    else if ((cp >= 0xf0000 && cp <= 0xffffd) || (cp >= 0x100000 && cp <= 0x10fffd)) out.push({ index: i, codePoint: hex(cp), category: 'pua', description: '補助私用領域' });
    else if (cp >= 0xe0100 && cp <= 0xe01ef) out.push({ index: i, codePoint: hex(cp), category: 'ivs', description: '異体字セレクタ（IVS）。字体収録の確認が必要' });
    else if (cp >= 0xfe00 && cp <= 0xfe0f) out.push({ index: i, codePoint: hex(cp), category: 'variation_selector', description: '異体字セレクタ（SVS）' });
    i += len;
  }
  return out;
}

/** 不可視文字表示モード用: 空白を中点等に見せるのは画面表示のみ（出力に混ぜない）。 */
export function describeCodePoints(text: string): Array<{ char: string; codePoint: string }> {
  const out: Array<{ char: string; codePoint: string }> = [];
  for (const ch of text) out.push({ char: ch, codePoint: hex(ch.codePointAt(0)!) });
  return out;
}
