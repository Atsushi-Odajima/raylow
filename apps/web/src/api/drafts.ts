import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  ApplyCandidatesSchema,
  DispatchRecordSchema,
  DraftCreateSchema,
  DraftDetailSchema,
  DraftLeaseRequestSchema,
  DraftOutputSchema,
  DraftRevisionInputSchema,
  DraftRevisionSchema,
  DraftSchema,
  EditLeaseSchema,
  PreflightReportSchema,
  RefreshCandidatesResponseSchema,
  RenderRequestSchema,
  RenderResponseSchema,
  ReviewRequestCreateSchema,
  ReviewSchema,
  type Draft,
  type DraftDetail,
  type PreflightReport,
  type Review,
} from '@raylow/contracts';
import { apiRequest, apiRequestEnvelope, type QueryParams } from '../lib/apiClient';

export const draftKeys = {
  detail: (id: string) => ['drafts', 'detail', id] as const,
  preflight: (id: string) => ['drafts', id, 'preflight'] as const,
  documents: (q: QueryParams) => ['documents', q] as const,
  output: (id: string) => ['documents', id, 'output'] as const,
};

export type DraftCreateInput = z.input<typeof DraftCreateSchema>;
export type DraftRevisionInput = z.input<typeof DraftRevisionInputSchema>;
export type EditLease = z.infer<typeof EditLeaseSchema>;
export type RefreshCandidates = z.infer<typeof RefreshCandidatesResponseSchema>;
export type RenderResponse = z.infer<typeof RenderResponseSchema>;

const DocumentOutputSchema = z.object({
  draft: DraftSchema,
  approvedRevision: DraftRevisionSchema.nullable(),
  outputs: z.array(DraftOutputSchema),
  draftOutputs: z.array(DraftOutputSchema),
  dispatches: z.array(DispatchRecordSchema),
});
export type DocumentOutput = z.infer<typeof DocumentOutputSchema>;

export function useDraft(id: string | null | undefined, opts: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: draftKeys.detail(id ?? ''),
    queryFn: () => apiRequest<DraftDetail>(`/api/drafts/${id}`, { schema: DraftDetailSchema }),
    enabled: !!id,
    ...(opts.refetchInterval !== undefined ? { refetchInterval: opts.refetchInterval } : {}),
  });
}
export function fetchDraft(id: string): Promise<DraftDetail> {
  return apiRequest<DraftDetail>(`/api/drafts/${id}`, { schema: DraftDetailSchema });
}
export function createDraft(input: DraftCreateInput): Promise<DraftDetail> {
  return apiRequest<DraftDetail>('/api/drafts', { method: 'POST', body: DraftCreateSchema.parse(input), schema: DraftDetailSchema });
}
export function saveRevision(id: string, input: DraftRevisionInput): Promise<DraftDetail> {
  return apiRequest<DraftDetail>(`/api/drafts/${id}/revisions`, { method: 'PUT', body: DraftRevisionInputSchema.parse(input), schema: DraftDetailSchema });
}
export function acquireLease(id: string, takeoverReason?: string): Promise<EditLease> {
  return apiRequest<EditLease>(`/api/drafts/${id}/lease`, { method: 'POST', body: DraftLeaseRequestSchema.parse(takeoverReason ? { takeoverReason } : {}), schema: EditLeaseSchema });
}
export function releaseLease(id: string): Promise<void> {
  return apiRequest<{ released: boolean }>(`/api/drafts/${id}/lease`, { method: 'DELETE' }).then(() => undefined);
}
export function refreshCandidates(id: string): Promise<RefreshCandidates> {
  return apiRequest<RefreshCandidates>(`/api/drafts/${id}/refresh-candidates`, { method: 'POST', schema: RefreshCandidatesResponseSchema });
}
export function applyCandidates(id: string, expectedVersion: number, fieldKeys: string[]): Promise<DraftDetail> {
  return apiRequest<DraftDetail>(`/api/drafts/${id}/apply-candidates`, { method: 'POST', body: ApplyCandidatesSchema.parse({ expectedVersion, fieldKeys }), schema: DraftDetailSchema });
}
export function renderDraft(id: string, mode: 'draft' | 'final'): Promise<RenderResponse> {
  return apiRequest<RenderResponse>(`/api/drafts/${id}/render`, { method: 'POST', body: RenderRequestSchema.parse({ mode }), schema: RenderResponseSchema });
}
export function fetchPreflight(id: string): Promise<PreflightReport> {
  return apiRequest<PreflightReport>(`/api/drafts/${id}/preflight`, { schema: PreflightReportSchema });
}
export function usePreflight(id: string | null | undefined) {
  return useQuery({ queryKey: draftKeys.preflight(id ?? ''), queryFn: () => fetchPreflight(id ?? ''), enabled: !!id, staleTime: 0 });
}
export function requestReview(id: string, reviewerId: string, note?: string): Promise<Review> {
  return apiRequest<Review>(`/api/drafts/${id}/request-review`, { method: 'POST', body: ReviewRequestCreateSchema.parse({ reviewerId, ...(note ? { note } : {}) }), schema: ReviewSchema });
}
export function uploadExternalEdit(id: string, file: File): Promise<DraftDetail> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  return apiRequest<DraftDetail>(`/api/drafts/${id}/external-edit`, { method: 'POST', rawBody: fd, schema: DraftDetailSchema });
}
export function archiveDraft(id: string, expectedVersion: number): Promise<DraftDetail> {
  return apiRequest<DraftDetail>(`/api/drafts/${id}/archive`, { method: 'POST', body: { expectedVersion }, schema: DraftDetailSchema });
}

export function useRenderDraft() {
  return useMutation({ mutationFn: (v: { id: string; mode: 'draft' | 'final' }) => renderDraft(v.id, v.mode) });
}

export interface DocumentsQuery {
  matterId?: string | undefined;
  kind?: string | undefined;
  status?: string | undefined;
  q?: string | undefined;
  mine?: boolean | undefined;
}
export function useDocuments(q: DocumentsQuery) {
  const params: QueryParams = { matterId: q.matterId, kind: q.kind, status: q.status, q: q.q, mine: q.mine ? true : undefined, limit: 50 };
  return useInfiniteQuery({
    queryKey: draftKeys.documents(params),
    queryFn: async ({ pageParam }) => {
      const env = await apiRequestEnvelope<Draft[]>('/api/documents', { query: { ...params, cursor: pageParam || undefined }, schema: z.array(DraftSchema) });
      return { items: env.data, nextCursor: env.meta.nextCursor ?? null };
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
export function fetchDocumentOutput(id: string): Promise<DocumentOutput> {
  return apiRequest<DocumentOutput>(`/api/documents/${id}/output`, { schema: DocumentOutputSchema });
}
export function useDocumentOutput(id: string | null | undefined, opts: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: draftKeys.output(id ?? ''),
    queryFn: () => apiRequest<DocumentOutput>(`/api/documents/${id}/output`, { schema: DocumentOutputSchema }),
    enabled: !!id,
    ...(opts.refetchInterval !== undefined ? { refetchInterval: opts.refetchInterval } : {}),
  });
}
export function useInvalidateDraft() {
  const qc = useQueryClient();
  return (id: string) => {
    void qc.invalidateQueries({ queryKey: draftKeys.detail(id) });
    void qc.invalidateQueries({ queryKey: draftKeys.output(id) });
    void qc.invalidateQueries({ queryKey: ['documents'] });
  };
}
