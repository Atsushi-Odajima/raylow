import { describe, expect, it } from 'vitest';
import { graphemeLength, snapToGraphemeBoundary, truncateGraphemes } from './grapheme.js';

describe('grapheme', () => {
  it('counts IVS, surrogate pairs, combining marks and ZWJ sequences as single graphemes', () => {
    expect(graphemeLength('葛\u{E0100}')).toBe(1); // IVS
    expect(graphemeLength('𠮷')).toBe(1); // surrogate pair
    expect(graphemeLength('が')).toBe(1); // combining voiced mark
    expect(graphemeLength('👨‍👩‍👧')).toBe(1); // ZWJ
    expect(graphemeLength('佐藤一郎')).toBe(4);
  });
  it('truncates without splitting graphemes', () => {
    expect(truncateGraphemes('𠮷野家', 1)).toBe('𠮷');
    expect(truncateGraphemes('葛\u{E0100}城', 1)).toBe('葛\u{E0100}');
  });
  it('snaps UTF-16 offsets to grapheme boundaries', () => {
    const s = '𠮷野';
    expect(snapToGraphemeBoundary(s, 1)).toBe(0);
    expect(snapToGraphemeBoundary(s, 1, 'forward')).toBe(2);
  });
});
