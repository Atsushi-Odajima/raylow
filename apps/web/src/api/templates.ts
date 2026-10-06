import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  CourtProfileSchema,
  PhraseApproveSchema,
  PhraseInputSchema,
  PhraseSchema,
  PhraseVersionInputSchema,
  RendererProfileSchema,
  TemplateImportFieldsSchema,
  TemplateImportResponseSchema,
  TemplatePublishSchema,
  TemplateRetireSchema,
  TemplateSchemaUpdateSchema,
  TemplateSummarySchema,
  TemplateTestRequestSchema,
  TemplateVersionSchema,
  type Phrase,
  type TemplateSummary,
  type TemplateVersion,
} from '@raylow/contracts';
import { apiRequest, apiRequestEnvelope, type QueryParams } from '../lib/apiClient';

export const templateKeys = {
  list: (q: QueryParams) => ['templates', 'list', q] as const,
  detail: (id: string) => ['templates', 'detail', id] as const,
  version: (id: string) => ['template-versions', id] as const,
  phrases: (q: QueryParams) => ['phrases', q] as const,
  phrase: (id: string) => ['phrases', 'detail', id] as const,
  rendererProfiles: ['renderer-profiles'] as const,
  courtProfiles: ['court-profiles'] as const,
};

export type TemplateWithVersions = TemplateSummary & { versions: TemplateVersion[] };
export type TemplateImportFields = z.input<typeof TemplateImportFieldsSchema>;
export type TemplateImportResponse = z.infer<typeof TemplateImportResponseSchema>;
export type TemplateSchemaUpdate = z.input<typeof TemplateSchemaUpdateSchema>;
export type TemplatePublishInput = z.input<typeof TemplatePublishSchema>;
export type PhraseInput = z.input<typeof PhraseInputSchema>;
export type RendererProfile = z.infer<typeof RendererProfileSchema>;
export type CourtProfile = z.infer<typeof CourtProfileSchema>;

const TemplateWithVersionsSchema = TemplateSummarySchema.extend({ versions: z.array(TemplateVersionSchema) });

export function useTemplates(q: { kind?: string | undefined; status?: string | undefined; scope?: string | undefined; q?: string | undefined } = {}, enabled = true) {
  const params: QueryParams = { kind: q.kind, status: q.status, scope: q.scope, q: q.q, limit: 100 };
  return useQuery({
    queryKey: templateKeys.list(params),
    queryFn: async () => (await apiRequestEnvelope<TemplateSummary[]>('/api/templates', { query: params, schema: z.array(TemplateSummarySchema) })).data,
    enabled,
  });
}
export function useTemplate(id: string | null | undefined) {
  return useQuery({ queryKey: templateKeys.detail(id ?? ''), queryFn: () => apiRequest<TemplateWithVersions>(`/api/templates/${id}`, { schema: TemplateWithVersionsSchema }), enabled: !!id });
}
export function useTemplateVersion(id: string | null | undefined, opts: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: templateKeys.version(id ?? ''),
    queryFn: () => apiRequest<TemplateVersion>(`/api/template-versions/${id}`, { schema: TemplateVersionSchema }),
    enabled: !!id,
    ...(opts.refetchInterval !== undefined ? { refetchInterval: opts.refetchInterval } : {}),
  });
}

export function importTemplate(file: File, fields: TemplateImportFields): Promise<TemplateImportResponse> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('fields', JSON.stringify(TemplateImportFieldsSchema.parse(fields)));
  return apiRequest<TemplateImportResponse>('/api/templates/import', { method: 'POST', rawBody: fd, schema: TemplateImportResponseSchema });
}

export function useUpdateTemplateSchema() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { versionId: string; input: TemplateSchemaUpdate }) =>
      apiRequest<TemplateVersion>(`/api/template-versions/${v.versionId}/schema`, { method: 'PUT', body: TemplateSchemaUpdateSchema.parse(v.input), schema: TemplateVersionSchema }),
    onSuccess: (tv) => {
      qc.setQueryData(templateKeys.version(tv.id), tv);
      void qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}
export function useTestTemplateVersion() {
  return useMutation({
    mutationFn: (v: { versionId: string; sampleValues?: Record<string, unknown> }) =>
      apiRequest<{ jobId: string }>(`/api/template-versions/${v.versionId}/test`, { method: 'POST', body: TemplateTestRequestSchema.parse({ ...(v.sampleValues ? { sampleValues: v.sampleValues } : {}) }) }),
  });
}
export function usePublishTemplateVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { versionId: string; input: TemplatePublishInput }) =>
      apiRequest<TemplateVersion>(`/api/template-versions/${v.versionId}/publish`, { method: 'POST', body: TemplatePublishSchema.parse(v.input), schema: TemplateVersionSchema }),
    onSuccess: (tv) => {
      qc.setQueryData(templateKeys.version(tv.id), tv);
      void qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}
export function useRetireTemplateVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { versionId: string; expectedVersion: number; reasonRaw?: string }) =>
      apiRequest<TemplateVersion>(`/api/template-versions/${v.versionId}/retire`, { method: 'POST', body: TemplateRetireSchema.parse({ expectedVersion: v.expectedVersion, ...(v.reasonRaw ? { reasonRaw: v.reasonRaw } : {}) }), schema: TemplateVersionSchema }),
    onSuccess: (tv) => {
      qc.setQueryData(templateKeys.version(tv.id), tv);
      void qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export function usePhrases(q: { category?: string | undefined; templateKind?: string | undefined } = {}) {
  const params: QueryParams = { category: q.category, templateKind: q.templateKind };
  return useQuery({ queryKey: templateKeys.phrases(params), queryFn: async () => (await apiRequestEnvelope<Phrase[]>('/api/phrases', { query: params, schema: z.array(PhraseSchema) })).data });
}
export function usePhrase(id: string | null) {
  return useQuery({ queryKey: templateKeys.phrase(id ?? ''), queryFn: () => apiRequest<Phrase>(`/api/phrases/${id}`, { schema: PhraseSchema }), enabled: !!id });
}
export function useCreatePhrase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PhraseInput) => apiRequest<Phrase>('/api/phrases', { method: 'POST', body: PhraseInputSchema.parse(input), schema: PhraseSchema }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['phrases'] }),
  });
}
export function useAddPhraseVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; bodyRaw: string; requestApproval: boolean }) =>
      apiRequest<Phrase>(`/api/phrases/${v.id}/versions`, { method: 'POST', body: PhraseVersionInputSchema.parse({ bodyRaw: v.bodyRaw, requestApproval: v.requestApproval }), schema: PhraseSchema }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['phrases'] }),
  });
}
export function useApprovePhraseVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { versionId: string }) =>
      apiRequest<Phrase>(`/api/phrase-versions/${v.versionId}/approve`, { method: 'POST', body: PhraseApproveSchema.parse({ confirmations: { contentReviewed: true, residualTextReviewed: true } }), schema: PhraseSchema }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['phrases'] }),
  });
}

export function useRendererProfiles() {
  return useQuery({ queryKey: templateKeys.rendererProfiles, queryFn: () => apiRequest<RendererProfile[]>('/api/renderer-profiles', { schema: z.array(RendererProfileSchema) }), staleTime: 60_000 });
}
export function useCourtProfiles() {
  return useQuery({ queryKey: templateKeys.courtProfiles, queryFn: () => apiRequest<CourtProfile[]>('/api/court-profiles', { schema: z.array(CourtProfileSchema) }), staleTime: 60_000 });
}
