import { describe, expect, it } from 'vitest';
import { formatWareki, parseJapaneseDate } from './era.js';

describe('era', () => {
  it('maps 令和元年5月1日 to 2019-05-01', () => {
    const r = parseJapaneseDate('令和元年5月1日');
    expect(r.iso).toBe('2019-05-01');
    expect(r.precision).toBe('day');
    expect(r.needsConfirmation).toBe(false);
  });
  it('accepts fullwidth digits but keeps raw', () => {
    const r = parseJapaneseDate('令和６年１０月６日');
    expect(r.iso).toBe('2024-10-06');
    expect(r.raw).toBe('令和６年１０月６日');
  });
  it('warns on era boundary mismatch', () => {
    expect(parseJapaneseDate('令和元年4月30日').warnings).toContain('era_boundary_mismatch');
    expect(parseJapaneseDate('平成31年5月1日').warnings).toContain('era_boundary_mismatch');
    expect(parseJapaneseDate('平成31年4月30日').warnings).not.toContain('era_boundary_mismatch');
  });
  it('keeps approximate/year precision instead of rounding to a date', () => {
    const r = parseJapaneseDate('令和８年頃');
    expect(r.precision).toBe('year');
    expect(r.approximate).toBe(true);
    expect(r.iso).toBe('2026');
  });
  it('returns null (not 1970-01-01) when unknown', () => {
    const r = parseJapaneseDate('不明');
    expect(r.iso).toBeNull();
    expect(r.precision).toBe('unknown');
  });
  it('formats wareki with 元年', () => {
    expect(formatWareki('2019-05-01')).toBe('令和元年5月1日');
    expect(formatWareki('1989-01-07')).toBe('昭和64年1月7日');
    expect(formatWareki('1989-01-08')).toBe('平成元年1月8日');
  });
});
