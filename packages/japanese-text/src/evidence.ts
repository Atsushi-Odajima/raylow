/**
 * 証拠番号（§19 U06）
 * 「甲第３号証の１」を 3.1 の浮動小数にしない。raw を保持し canonical を別値として持つ。
 */
import { foldFullwidthDigits } from './era.js';

export interface EvidenceNumber {
  symbolRaw: string;
  numberRaw: string;
  branchRaw: string | null;
  /** canonical: 全角数字を ASCII にした別値 */
  canonical: { symbol: string; number: number; branch: number[] } | null;
  displayLabel: string;
  warnings: string[];
}

const SYMBOL_ORDER = ['甲', '乙', '丙', '丁', '戊'];

export function parseEvidenceLabel(raw: string): EvidenceNumber {
  const warnings: string[] = [];
  const s = raw.replace(/[\s\u3000]+/g, '');
  const m = /^([甲乙丙丁戊]|[^\d０-９第号証の]+)第?([\d０-９]+)号?証?((?:の[\d０-９]+)*)$/.exec(s);
  if (!m) {
    warnings.push('unparsed');
    return { symbolRaw: '', numberRaw: raw, branchRaw: null, canonical: null, displayLabel: raw, warnings };
  }
  const symbolRaw = m[1]!;
  const numberRaw = m[2]!;
  const branchRawFull = m[3] ?? '';
  const branchRaw = branchRawFull.length > 0 ? branchRawFull.slice(1) : null; // 先頭の「の」を除く
  const number = Number(foldFullwidthDigits(numberRaw));
  const branch = branchRaw ? branchRaw.split('の').map((b) => Number(foldFullwidthDigits(b))) : [];
  if (/^0/.test(foldFullwidthDigits(numberRaw)) && number !== 0) warnings.push('leading_zero');
  return {
    symbolRaw,
    numberRaw,
    branchRaw,
    canonical: { symbol: symbolRaw, number, branch },
    displayLabel: buildDisplayLabel(symbolRaw, numberRaw, branchRaw),
    warnings,
  };
}

export function buildDisplayLabel(symbolRaw: string, numberRaw: string, branchRaw: string | null): string {
  const base = `${symbolRaw}第${numberRaw}号証`;
  return branchRaw ? `${base}の${branchRaw}` : base;
}

export function canonicalKey(symbol: string, number: number, branch: number[]): string {
  return `${symbol}:${number}${branch.length ? ':' + branch.join('.') : ''}`;
}

/** 並替: 符号順→整数番号→枝番順 */
export function compareEvidence(a: EvidenceNumber, b: EvidenceNumber): number {
  const ca = a.canonical;
  const cb = b.canonical;
  if (!ca && !cb) return a.displayLabel.localeCompare(b.displayLabel, 'ja');
  if (!ca) return 1;
  if (!cb) return -1;
  const sa = SYMBOL_ORDER.indexOf(ca.symbol);
  const sb = SYMBOL_ORDER.indexOf(cb.symbol);
  if (sa !== sb) {
    if (sa < 0) return 1;
    if (sb < 0) return -1;
    return sa - sb;
  }
  if (ca.symbol !== cb.symbol) return ca.symbol.localeCompare(cb.symbol, 'ja');
  if (ca.number !== cb.number) return ca.number - cb.number;
  const n = Math.max(ca.branch.length, cb.branch.length);
  for (let i = 0; i < n; i++) {
    const x = ca.branch[i];
    const y = cb.branch[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x !== y) return x - y;
  }
  return 0;
}
