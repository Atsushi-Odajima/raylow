import { describe, expect, it } from 'vitest';
import { parseTagBody, scanParagraphTags } from './tags.js';

describe('tags', () => {
  it('accepts allowlisted keys and loops', () => {
    expect(parseTagBody('office_name').valid).toBe(true);
    expect(parseTagBody('#evidence_rows')).toMatchObject({ kind: 'loop_open', key: 'evidence_rows', valid: true });
    expect(parseTagBody('/evidence_rows').kind).toBe('loop_close');
  });
  it('rejects dot paths, expressions, dangerous keys and non-ASCII', () => {
    expect(parseTagBody('a.b').reason).toBe('dot_path_not_allowed');
    expect(parseTagBody('__proto__').reason).toBe('dangerous_key');
    expect(parseTagBody('constructor').reason).toBe('dangerous_key');
    expect(parseTagBody('x | upper').reason).toBe('expression_not_allowed');
    expect(parseTagBody('office_name()').reason).toBe('expression_not_allowed');
    expect(parseTagBody('氏名').reason).toBe('non_ascii_key');
    expect(parseTagBody('Office').valid).toBe(false);
  });
  it('scans paragraph text and detects unclosed braces', () => {
    const r = scanParagraphTags('拝啓 {recipient_name} 先生 {office_name');
    expect(r.tags.map((t) => t.key)).toEqual(['recipient_name']);
    expect(r.unclosedBrace).toBe(true);
  });
});
