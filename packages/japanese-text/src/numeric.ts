/**
 * 電話・金額・日付など raw と parsed を分離する欄のための解析候補（§19 U03, §5.3）。
 * 原入力は保持し、parse 候補だけを別に返す。金額欄以外へ波及させない。
 */
import { foldFullwidthDigits } from './era.js';

export interface MoneyValue {
  raw: string;
  /** JPY 整数の decimal string。解析できなければ null */
  decimal: string | null;
  currency: 'JPY';
  warnings: string[];
}

export function parseMoneyJpy(raw: string): MoneyValue {
  const warnings: string[] = [];
  let s = foldFullwidthDigits(raw);
  s = s.replace(/[\s　]/g, '');
  s = s.replace(/^[¥￥\\]/, '').replace(/円$/, '');
  s = s.replace(/[,，]/g, '');
  if (/^\d+$/.test(s)) {
    // 先頭0は金額としては除去するが raw は保持
    const normalized = s.replace(/^0+(?=\d)/, '');
    return { raw, decimal: normalized, currency: 'JPY', warnings };
  }
  if (/万|億/.test(s)) warnings.push('kanji_numeral_unit_not_parsed');
  else warnings.push('unparsed');
  return { raw, decimal: null, currency: 'JPY', warnings };
}

/** 全角数字 "１２３" → 候補 123。数値欄の parse 候補にだけ使う */
export function parseIntegerCandidate(raw: string): number | null {
  const s = foldFullwidthDigits(raw).replace(/[\s　,，]/g, '');
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** 3桁区切り（出力用）。全角は作らない。 */
export function formatJpy(decimal: string): string {
  if (!/^\d+$/.test(decimal)) return decimal;
  return decimal.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
