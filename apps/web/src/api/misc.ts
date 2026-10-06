import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AuditEventSchema,
  ExportRequestSchema,
  ExportResponseSchema,
  ImportCommitResponseSchema,
  ImportPreviewRequestSchema,
  ImportPreviewResponseSchema,
  OrgSettingsSchema,
  OrgSettingsUpdateSchema,
  SearchQuerySchema,
  SearchResultSchema,
  type AuditEvent,
} from '@raylow/contracts';
import { apiRequest, apiRequestEnvelope, type QueryParams } from '../lib/apiClient';

const OrgSettingsWithVersionSchema = OrgSettingsSchema.extend({ version: z.number().int().optional() });
export type OrgSettings = z.infer<typeof OrgSettingsWithVersionSchema>;
export type OrgSettingsUpdate = z.input<typeof OrgSettingsUpdateSchema>;
export type ExportRequest = z.input<typeof ExportRequestSchema>;
export type ImportPreviewRequest = z.input<typeof ImportPreviewRequestSchema>;
export type ImportPreview = z.infer<typeof ImportPreviewResponseSchema>;
export type ImportCommitResponse = z.infer<typeof ImportCommitResponseSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SearchQuery = z.input<typeof SearchQuerySchema>;

export const miscKeys = {
  settings: ['settings'] as const,
  audit: (q: QueryParams) => ['audit', q] as const,
  search: (q: QueryParams) => ['search', q] as const,
};

export function useSettings() {
  return useQuery({ queryKey: miscKeys.settings, queryFn: () => apiRequest<OrgSettings>('/api/settings', { schema: OrgSettingsWithVersionSchema }) });
}
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrgSettingsUpdate) => apiRequest<OrgSettings>('/api/settings', { method: 'PUT', body: OrgSettingsUpdateSchema.parse(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: miscKeys.settings }),
  });
}

export function useAudit(q: { matterId?: string | undefined; action?: string | undefined }) {
  const params: QueryParams = { matterId: q.matterId, action: q.action, limit: 50 };
  return useInfiniteQuery({
    queryKey: miscKeys.audit(params),
    queryFn: async ({ pageParam }) => {
      const env = await apiRequestEnvelope<AuditEvent[]>('/api/audit', { query: { ...params, cursor: pageParam || undefined }, schema: z.array(AuditEventSchema) });
      return { items: env.data, nextCursor: env.meta.nextCursor ?? null };
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function requestExport(input: ExportRequest): Promise<{ jobId: string }> {
  return apiRequest<{ jobId: string }>('/api/exports', { method: 'POST', body: ExportRequestSchema.parse(input), schema: ExportResponseSchema });
}
export function exportDownloadUrl(jobId: string): string {
  return `/api/exports/${encodeURIComponent(jobId)}/download`;
}

export function importPreview(file: File, fields: ImportPreviewRequest): Promise<ImportPreview> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('fields', JSON.stringify(ImportPreviewRequestSchema.parse(fields)));
  return apiRequest<ImportPreview>('/api/imports/preview', { method: 'POST', rawBody: fd, schema: ImportPreviewResponseSchema });
}
export function importCommit(importToken: string): Promise<ImportCommitResponse> {
  return apiRequest<ImportCommitResponse>('/api/imports/commit', { method: 'POST', body: { importToken }, schema: ImportCommitResponseSchema });
}

export function useSearch(q: SearchQuery, enabled: boolean) {
  const params: QueryParams = { q: q.q, mode: q.mode ?? 'normalized', limit: q.limit ?? 20 };
  return useQuery({ queryKey: miscKeys.search(params), queryFn: () => apiRequest<SearchResult>('/api/search', { query: params, schema: SearchResultSchema }), enabled: enabled && q.q.length > 0 });
}
