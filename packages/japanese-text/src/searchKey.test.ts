import { describe, expect, it } from 'vitest';
import { buildSearchKey, mapKeyRangeToSource, searchExact, searchNormalized } from './searchKey.js';

describe('search key ver1', () => {
  it('folds fullwidth alnum and ASCII case only', () => {
    expect(buildSearchKey('ＡＢＣ１２３').key).toBe('abc123');
    expect(buildSearchKey('ABC123').key).toBe('abc123');
  });
  it('folds halfwidth kana runs with voiced marks', () => {
    expect(buildSearchKey('ｶﾞ').key).toBe('ガ');
    expect(buildSearchKey('ﾀﾅｶ ﾋﾞﾙ').key).toBe('タナカ ビル');
  });
  it('does NOT fold other compatibility characters (no full NFKC)', () => {
    expect(buildSearchKey('①').key).toBe('①');
    expect(buildSearchKey('Ⅰ').key).toBe('Ⅰ');
    expect(buildSearchKey('㈱').key).toBe('㈱');
    expect(buildSearchKey('髙橋').key).toBe('髙橋');
    expect(buildSearchKey('﨑').key).toBe('﨑');
    expect(buildSearchKey('－ー−―').key).toBe('－ー−―');
    expect(buildSearchKey('～〜').key).toBe('～〜');
    expect(buildSearchKey('¥\\').key).toBe('¥\\');
    // 結合濁点は合成しない（NFC も行わない）
    expect(buildSearchKey('が').key).toBe('が');
  });
  it('maps fullwidth parentheses and ideographic space', () => {
    expect(buildSearchKey('（株）').key).toBe('(株)');
    expect(buildSearchKey('佐藤　一郎').key).toBe('佐藤 一郎');
  });
  it('collapses whitespace and trims only in the key', () => {
    const r = buildSearchKey('  佐藤 　 一郎  ');
    expect(r.key).toBe('佐藤 一郎');
    expect(r.map.length).toBeGreaterThan(0);
  });
  it('maps key ranges back to source offsets (many-to-one widens)', () => {
    const src = 'ＡＢ ｶﾞ 髙';
    const r = buildSearchKey(src);
    expect(r.key).toBe('ab ガ 髙');
    const m = mapKeyRangeToSource(r, 3, 4); // 'ガ'
    expect(m).toEqual({ start: 3, end: 5 }); // ｶﾞ (2 code units)
    expect(src.slice(m!.start, m!.end)).toBe('ｶﾞ');
  });
  it('searchNormalized returns reason and original quote', () => {
    const hits = searchNormalized('東京都千代田区　ＡＢＣビル ３階', 'abcビル');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.quote).toBe('ＡＢＣビル');
    expect(hits[0]!.reason).toBe('normalized');
    expect(searchExact('ＡＢＣビル', 'ABC')).toHaveLength(0);
  });
  it('does not treat ① and 1 as equal', () => {
    expect(searchNormalized('第①回', '第1回')).toHaveLength(0);
  });
});
