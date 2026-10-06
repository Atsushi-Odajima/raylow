import { describe, expect, it } from 'vitest';
import { compareEvidence, parseEvidenceLabel } from './evidence.js';

describe('evidence numbers', () => {
  it('parses 甲第３号証の１ keeping raw and canonical separately', () => {
    const e = parseEvidenceLabel('甲第３号証の１');
    expect(e.symbolRaw).toBe('甲');
    expect(e.numberRaw).toBe('３');
    expect(e.branchRaw).toBe('１');
    expect(e.canonical).toEqual({ symbol: '甲', number: 3, branch: [1] });
    expect(e.displayLabel).toBe('甲第３号証の１');
  });
  it('does not turn branch numbers into floats: 甲3の10 sorts after 甲3の2', () => {
    const a = parseEvidenceLabel('甲第3号証の2');
    const b = parseEvidenceLabel('甲第3号証の10');
    expect(compareEvidence(a, b)).toBeLessThan(0);
  });
  it('orders by symbol then number then branch', () => {
    const list = ['乙第1号証', '甲第10号証', '甲第2号証', '甲第2号証の1'].map(parseEvidenceLabel).sort(compareEvidence).map((x) => x.displayLabel);
    expect(list).toEqual(['甲第2号証', '甲第2号証の1', '甲第10号証', '乙第1号証']);
  });
  it('flags leading zero', () => {
    expect(parseEvidenceLabel('甲第０１号証').warnings).toContain('leading_zero');
  });
});
