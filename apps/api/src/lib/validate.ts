import type { z } from 'zod';
import { validationFailed } from '../errors.js';

export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  return thrower(r.error);
}

function thrower(error: z.ZodError): never {
  throw validationFailed(
    error.issues.map((i) => ({ field: i.path.join('.') || '(root)', code: i.code, message: i.message })),
  );
}

export function encodeCursor(obj: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}
export function decodeCursor<T extends Record<string, string | number>>(cursor: string | undefined): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
