/**
 * タグ allowlist（§5.1）
 * タグは ASCII の allowlist キーのみ。dot による任意オブジェクト探索は不許可。
 * __proto__/constructor/prototype を含むキーを拒否する。
 */
export const TAG_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

export const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'this', 'eval']);

export function isSafeTagKey(key: string): boolean {
  if (!TAG_KEY_RE.test(key)) return false;
  if (DANGEROUS_KEYS.has(key)) return false;
  if (key.includes('.')) return false;
  return true;
}

export type TagKind = 'value' | 'loop_open' | 'loop_close' | 'inverted_open';

export interface ParsedTag {
  raw: string;
  kind: TagKind;
  key: string;
  valid: boolean;
  reason?: string;
}

/** `{...}` の中身を分類する。式・パイプ・ドット・空白を含むものは無効。 */
export function parseTagBody(body: string): ParsedTag {
  const raw = `{${body}}`;
  let kind: TagKind = 'value';
  let key = body;
  if (body.startsWith('#')) {
    kind = 'loop_open';
    key = body.slice(1);
  } else if (body.startsWith('/')) {
    kind = 'loop_close';
    key = body.slice(1);
  } else if (body.startsWith('^')) {
    kind = 'inverted_open';
    key = body.slice(1);
  }
  if (!isSafeTagKey(key)) {
    let reason = 'tag_key_not_allowed';
    if (key.includes('.')) reason = 'dot_path_not_allowed';
    else if (DANGEROUS_KEYS.has(key)) reason = 'dangerous_key';
    else if (/[|()+\-*/<>=!?:'"`\s]/.test(key)) reason = 'expression_not_allowed';
    // eslint-disable-next-line no-control-regex
    else if (/[^\x00-\x7f]/.test(key)) reason = 'non_ascii_key';
    return { raw, kind, key, valid: false, reason };
  }
  return { raw, kind, key, valid: true };
}

/**
 * 段落テキスト（run 連結済み）からタグを抽出する。
 * 未閉の `{` は段落跨ぎタグとして報告する。
 */
export interface TagScanResult {
  tags: ParsedTag[];
  unclosedBrace: boolean;
  strayClose: boolean;
}

export function scanParagraphTags(text: string): TagScanResult {
  const tags: ParsedTag[] = [];
  let unclosedBrace = false;
  let strayClose = false;
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    const closeBefore = text.indexOf('}', i);
    if (open < 0) {
      if (closeBefore >= 0) strayClose = true;
      break;
    }
    if (closeBefore >= 0 && closeBefore < open) strayClose = true;
    const close = text.indexOf('}', open + 1);
    if (close < 0) {
      unclosedBrace = true;
      break;
    }
    const inner = text.slice(open + 1, close);
    if (inner.includes('{')) {
      // `{{` などの入れ子は無効扱い
      tags.push({ raw: `{${inner}}`, kind: 'value', key: inner, valid: false, reason: 'nested_brace' });
    } else {
      tags.push(parseTagBody(inner));
    }
    i = close + 1;
  }
  return { tags, unclosedBrace, strayClose };
}

/** 全書式共通の既定キー（§4） */
export const COMMON_TAG_KEYS = [
  'matter_id',
  'matter_title',
  'template_version_label',
  'issue_date',
  'issue_date_wareki',
  'office_name',
  'office_address',
  'office_postcode',
  'office_phone',
  'office_fax',
  'office_email',
  'lawyer_name',
  'lawyer_title',
  'recipient_name',
  'recipient_honorific',
  'recipient_organization',
  'recipient_address',
  'client_name',
  'opponent_name',
  'subject',
  'body_text',
  'document_status_label',
] as const;

export type CommonTagKey = (typeof COMMON_TAG_KEYS)[number];
