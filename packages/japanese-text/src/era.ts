/**
 * 和暦（§19 U06）
 * 明治/大正/昭和/平成/令和の西暦対応を version 付き表で定義する。元年=1。
 * 元号境界日を照合し、不整合は警告する（値は捨てず要確認にする）。
 */

export const ERA_TABLE_VERSION = 1 as const;

export interface EraDef {
  name: string;
  /** 元年の西暦 */
  firstYear: number;
  /** 開始日（グレゴリオ暦、ISO） */
  start: string;
  /** 終了日（含む）。現行元号は null */
  end: string | null;
  /** 旧暦期間を含む（明治1〜5年は太陰太陽暦。単純換算は要確認） */
  lunarUntil?: string;
}

export const ERAS: readonly EraDef[] = [
  { name: '明治', firstYear: 1868, start: '1868-10-23', end: '1912-07-29', lunarUntil: '1872-12-31' },
  { name: '大正', firstYear: 1912, start: '1912-07-30', end: '1926-12-24' },
  { name: '昭和', firstYear: 1926, start: '1926-12-25', end: '1989-01-07' },
  { name: '平成', firstYear: 1989, start: '1989-01-08', end: '2019-04-30' },
  { name: '令和', firstYear: 2019, start: '2019-05-01', end: null },
];

export type DatePrecision = 'day' | 'month' | 'year' | 'unknown';

export interface ParsedJapaneseDate {
  raw: string;
  /** ISO 8601 日付（day 精度のときのみ YYYY-MM-DD、month は YYYY-MM、year は YYYY） */
  iso: string | null;
  precision: DatePrecision;
  approximate: boolean;
  era: { name: string; eraYearRaw: string; eraYear: number } | null;
  warnings: string[];
  /** 不整合などで人の確認が必要 */
  needsConfirmation: boolean;
}

const FW_DIGITS = '０１２３４５６７８９';

/** 全角数字→ASCII（和暦解析専用。原文は保持する） */
export function foldFullwidthDigits(s: string): string {
  let out = '';
  for (const ch of s) {
    const i = FW_DIGITS.indexOf(ch);
    out += i >= 0 ? String(i) : ch;
  }
  return out;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parseJapaneseDate(raw: string): ParsedJapaneseDate {
  const warnings: string[] = [];
  const base: ParsedJapaneseDate = { raw, iso: null, precision: 'unknown', approximate: false, era: null, warnings, needsConfirmation: false };
  if (raw == null) return base;
  let s = foldFullwidthDigits(raw).replace(/[\s　]+/g, '');
  const approximate = /頃|ころ|ごろ|約/.test(s);
  if (approximate) s = s.replace(/頃|ころ|ごろ|約/g, '');

  // 和暦
  const eraNames = ERAS.map((e) => e.name).join('|');
  const eraRe = new RegExp(`^(${eraNames})(元|\\d{1,2})年(?:(\\d{1,2})月(?:(\\d{1,2})日)?)?$`);
  const m = eraRe.exec(s);
  if (m) {
    const era = ERAS.find((e) => e.name === m[1])!;
    const eraYearRaw = m[2]!;
    const eraYear = eraYearRaw === '元' ? 1 : Number(eraYearRaw);
    if (eraYear === 0) {
      warnings.push('era_year_zero');
      return { ...base, approximate, era: { name: era.name, eraYearRaw, eraYear }, needsConfirmation: true };
    }
    const year = era.firstYear + eraYear - 1;
    const month = m[3] ? Number(m[3]) : null;
    const day = m[4] ? Number(m[4]) : null;
    const result: ParsedJapaneseDate = {
      ...base,
      approximate,
      era: { name: era.name, eraYearRaw, eraYear },
    };
    if (era.lunarUntil && `${year}-01-01` <= era.lunarUntil) {
      warnings.push('lunar_calendar_period');
      result.needsConfirmation = true;
    }
    if (month != null && day != null) {
      if (!isValidYmd(year, month, day)) {
        warnings.push('invalid_calendar_date');
        return { ...result, precision: 'unknown', needsConfirmation: true };
      }
      const iso = `${year}-${pad2(month)}-${pad2(day)}`;
      if (iso < era.start || (era.end != null && iso > era.end)) {
        warnings.push('era_boundary_mismatch');
        result.needsConfirmation = true;
      }
      return { ...result, iso, precision: 'day' };
    }
    if (month != null) {
      if (month < 1 || month > 12) {
        warnings.push('invalid_calendar_date');
        return { ...result, precision: 'unknown', needsConfirmation: true };
      }
      const iso = `${year}-${pad2(month)}`;
      const eraStartMonth = era.start.slice(0, 7);
      const eraEndMonth = era.end?.slice(0, 7) ?? null;
      if (iso < eraStartMonth || (eraEndMonth != null && iso > eraEndMonth)) {
        warnings.push('era_boundary_mismatch');
        result.needsConfirmation = true;
      }
      return { ...result, iso, precision: 'month' };
    }
    const eraStartYear = era.start.slice(0, 4);
    const eraEndYear = era.end?.slice(0, 4) ?? null;
    if (String(year) < eraStartYear || (eraEndYear != null && String(year) > eraEndYear)) {
      warnings.push('era_boundary_mismatch');
      result.needsConfirmation = true;
    }
    return { ...result, iso: String(year), precision: 'year' };
  }

  // 西暦
  const w = /^(\d{4})(?:[年/\-.](\d{1,2})(?:[月/\-.](\d{1,2})日?)?月?)?$/.exec(s);
  if (w) {
    const year = Number(w[1]);
    const month = w[2] ? Number(w[2]) : null;
    const day = w[3] ? Number(w[3]) : null;
    if (month != null && day != null) {
      if (!isValidYmd(year, month, day)) {
        warnings.push('invalid_calendar_date');
        return { ...base, approximate, needsConfirmation: true };
      }
      return { ...base, approximate, iso: `${year}-${pad2(month)}-${pad2(day)}`, precision: 'day' };
    }
    if (month != null) {
      if (month < 1 || month > 12) {
        warnings.push('invalid_calendar_date');
        return { ...base, approximate, needsConfirmation: true };
      }
      return { ...base, approximate, iso: `${year}-${pad2(month)}`, precision: 'month' };
    }
    return { ...base, approximate, iso: String(year), precision: 'year' };
  }
  warnings.push('unparsed');
  return { ...base, approximate, needsConfirmation: true };
}

/** ISO 日付 → 和暦表示（出力用。元年は「元年」と表記） */
export function formatWareki(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const era = [...ERAS].reverse().find((e) => iso >= e.start && (e.end == null || iso <= e.end));
  if (!era) return null;
  const y = Number(m[1]) - era.firstYear + 1;
  const yStr = y === 1 ? '元' : String(y);
  return `${era.name}${yStr}年${Number(m[2])}月${Number(m[3])}日`;
}
