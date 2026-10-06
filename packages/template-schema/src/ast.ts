/**
 * DocumentAST（§6）={schemaVersion:1,blocks:[heading|paragraph|numberedParagraph|evidenceRef]}。
 * 各 block は stable ID を持つ。全角の文字列と番号文字列は維持する。
 */
import { z } from 'zod';

const blockId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const HeadingBlockSchema = z.object({ id: blockId, type: z.literal('heading'), level: z.number().int().min(1).max(3), text: z.string().max(2000) }).strict();
export const ParagraphBlockSchema = z.object({ id: blockId, type: z.literal('paragraph'), text: z.string().max(20000) }).strict();
export const NumberedParagraphBlockSchema = z
  .object({
    id: blockId,
    type: z.literal('numberedParagraph'),
    /** 「第１」「１」「（１）」など原文の番号文字列を維持する */
    numberLabel: z.string().max(50),
    text: z.string().max(20000),
    level: z.number().int().min(1).max(4).default(1),
  })
  .strict();
export const EvidenceRefBlockSchema = z
  .object({
    id: blockId,
    type: z.literal('evidenceRef'),
    evidenceId: z.string().uuid(),
    displayLabel: z.string().max(100),
    /** 引用参照は documentVersionId/page/rect/textVersionId で固定 */
    sourceRef: z
      .object({
        documentVersionId: z.string().uuid(),
        page: z.number().int().positive().optional(),
        rect: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
        textVersionId: z.string().uuid().optional(),
        quote: z.string().max(5000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const BlockSchema = z.discriminatedUnion('type', [HeadingBlockSchema, ParagraphBlockSchema, NumberedParagraphBlockSchema, EvidenceRefBlockSchema]);
export type Block = z.infer<typeof BlockSchema>;

export const DocumentASTSchema = z.object({ schemaVersion: z.literal(1), blocks: z.array(BlockSchema).max(2000) }).strict();
export type DocumentAST = z.infer<typeof DocumentASTSchema>;

export function emptyAST(): DocumentAST {
  return { schemaVersion: 1, blocks: [] };
}

/** AST → プレーン行配列（renderer 入力） */
export interface RenderLine {
  kind: 'heading' | 'paragraph' | 'numbered' | 'evidence';
  level: number;
  numberLabel: string;
  text: string;
}

export function astToLines(ast: DocumentAST): RenderLine[] {
  return ast.blocks.map((b): RenderLine => {
    switch (b.type) {
      case 'heading':
        return { kind: 'heading', level: b.level, numberLabel: '', text: b.text };
      case 'paragraph':
        return { kind: 'paragraph', level: 1, numberLabel: '', text: b.text };
      case 'numberedParagraph':
        return { kind: 'numbered', level: b.level, numberLabel: b.numberLabel, text: b.text };
      case 'evidenceRef':
        return { kind: 'evidence', level: 1, numberLabel: '', text: b.displayLabel };
    }
  });
}

/** AST → body_text（段落は改行、番号付きは「番号\u3000本文」。全角空白はアプリ既定ではなく書式側で決める） */
export function astToPlainText(ast: DocumentAST): string {
  return astToLines(ast)
    .map((l) => (l.kind === 'numbered' && l.numberLabel ? `${l.numberLabel}\u3000${l.text}` : l.text))
    .join('\n');
}

export function astBlockIds(ast: DocumentAST): string[] {
  return ast.blocks.map((b) => b.id);
}

export function validateUniqueBlockIds(ast: DocumentAST): string[] {
  const seen = new Set<string>();
  const dup: string[] = [];
  for (const b of ast.blocks) {
    if (seen.has(b.id)) dup.push(b.id);
    seen.add(b.id);
  }
  return dup;
}
