import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AgentInputSchema,
  BarrierAddSchema,
  DispatchRecordSchema,
  DraftSchema,
  EvidenceSchema,
  MatterAcceptanceSchema,
  MatterDetailSchema,
  MatterInputSchema,
  MatterLegalHoldSchema,
  MatterStatusChangeSchema,
  MatterSummarySchema,
  MatterUpdateSchema,
  MemberAddSchema,
  PartyInputSchema,
  type DispatchRecord,
  type Draft,
  type MatterDetail,
  type MatterSummary,
} from '@raylow/contracts';
import { apiRequest, apiRequestEnvelope, type QueryParams } from '../lib/apiClient';

export const matterKeys = {
  list: (q: QueryParams) => ['matters', 'list', q] as const,
  detail: (id: string) => ['matters', 'detail', id] as const,
  evidence: (id: string) => ['matters', id, 'evidence'] as const,
  dispatches: (id: string) => ['matters', id, 'dispatches'] as const,
  documents: (id: string) => ['matters', id, 'documents'] as const,
};

export type MatterInput = z.input<typeof MatterInputSchema>;
export type PartyInput = z.input<typeof PartyInputSchema>;
export type AgentInput = z.input<typeof AgentInputSchema>;
/** 原本閲覧 GET /api/files/:id/content?version= には file id が必要。EvidenceSchema に fileId が無いため、API が返す場合に読む */
const EvidenceWithFileSchema = EvidenceSchema.extend({ fileId: z.string().uuid().nullable().optional() });
export type EvidenceWithFile = z.infer<typeof EvidenceWithFileSchema>;

export function useMatters(q: { q?: string | undefined; status?: string | undefined; limit?: number | undefined }, enabled = true) {
  const params: QueryParams = { q: q.q, status: q.status, limit: q.limit ?? 50 };
  return useQuery({
    queryKey: matterKeys.list(params),
    queryFn: async () => (await apiRequestEnvelope<MatterSummary[]>('/api/matters', { query: params, schema: z.array(MatterSummarySchema) })).data,
    enabled,
  });
}
export function useMatter(id: string | null | undefined) {
  return useQuery({ queryKey: matterKeys.detail(id ?? ''), queryFn: () => apiRequest<MatterDetail>(`/api/matters/${id}`, { schema: MatterDetailSchema }), enabled: !!id });
}
export function useMatterEvidence(id: string | null | undefined) {
  return useQuery({ queryKey: matterKeys.evidence(id ?? ''), queryFn: () => apiRequest<EvidenceWithFile[]>(`/api/matters/${id}/evidence`, { schema: z.array(EvidenceWithFileSchema) }), enabled: !!id });
}
export function useMatterDispatches(id: string | null | undefined) {
  return useQuery({ queryKey: matterKeys.dispatches(id ?? ''), queryFn: () => apiRequest<DispatchRecord[]>(`/api/matters/${id}/dispatches`, { schema: z.array(DispatchRecordSchema) }), enabled: !!id });
}
export function useMatterDocuments(id: string | null | undefined, extra: QueryParams = {}) {
  return useQuery({
    queryKey: [...matterKeys.documents(id ?? ''), extra] as const,
    queryFn: async () => (await apiRequestEnvelope<Draft[]>(`/api/matters/${id}/documents`, { query: { limit: 100, ...extra }, schema: z.array(DraftSchema) })).data,
    enabled: !!id,
  });
}

function useMatterMutation<V>(fn: (v: V) => Promise<MatterDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (d) => {
      qc.setQueryData(matterKeys.detail(d.id), d);
      void qc.invalidateQueries({ queryKey: ['matters', 'list'] });
    },
  });
}

export function useCreateMatter() {
  return useMatterMutation((input: MatterInput) => apiRequest<MatterDetail>('/api/matters', { method: 'POST', body: MatterInputSchema.parse(input), schema: MatterDetailSchema }));
}
export function useUpdateMatter() {
  return useMatterMutation((v: { id: string; patch: Partial<MatterInput>; expectedVersion: number }) =>
    apiRequest<MatterDetail>(`/api/matters/${v.id}`, { method: 'PUT', body: MatterUpdateSchema.parse({ ...v.patch, expectedVersion: v.expectedVersion }), schema: MatterDetailSchema }),
  );
}
export function useMatterAcceptance() {
  return useMatterMutation((v: { id: string; acceptanceStatus: 'unconfirmed' | 'confirmed' | 'declined'; expectedVersion: number }) =>
    apiRequest<MatterDetail>(`/api/matters/${v.id}/acceptance`, { method: 'POST', body: MatterAcceptanceSchema.parse(v), schema: MatterDetailSchema }),
  );
}
export function useMatterStatus() {
  return useMatterMutation((v: { id: string; status: 'active' | 'archived' | 'closed'; reasonRaw?: string; expectedVersion: number }) =>
    apiRequest<MatterDetail>(`/api/matters/${v.id}/status`, { method: 'POST', body: MatterStatusChangeSchema.parse(v), schema: MatterDetailSchema }),
  );
}
export function useMatterLegalHold() {
  return useMatterMutation((v: { id: string; legalHold: boolean; reasonRaw?: string; expectedVersion: number }) =>
    apiRequest<MatterDetail>(`/api/matters/${v.id}/legal-hold`, { method: 'POST', body: MatterLegalHoldSchema.parse(v), schema: MatterDetailSchema }),
  );
}
export function useAddParty() {
  return useMatterMutation((v: { id: string; input: PartyInput }) => apiRequest<MatterDetail>(`/api/matters/${v.id}/parties`, { method: 'POST', body: PartyInputSchema.parse(v.input), schema: MatterDetailSchema }));
}
export function useRemoveParty() {
  return useMatterMutation((v: { id: string; partyId: string }) => apiRequest<MatterDetail>(`/api/matters/${v.id}/parties/${v.partyId}`, { method: 'DELETE', schema: MatterDetailSchema }));
}
export function useAddAgent() {
  return useMatterMutation((v: { id: string; input: AgentInput }) => apiRequest<MatterDetail>(`/api/matters/${v.id}/agents`, { method: 'POST', body: AgentInputSchema.parse(v.input), schema: MatterDetailSchema }));
}
export function useRemoveAgent() {
  return useMatterMutation((v: { id: string; agentId: string }) => apiRequest<MatterDetail>(`/api/matters/${v.id}/agents/${v.agentId}`, { method: 'DELETE', schema: MatterDetailSchema }));
}
export function useAddMatterMember() {
  return useMatterMutation((v: { id: string; userId: string; canEdit: boolean }) =>
    apiRequest<MatterDetail>(`/api/matters/${v.id}/members`, { method: 'POST', body: MemberAddSchema.parse({ userId: v.userId, canEdit: v.canEdit }), schema: MatterDetailSchema }),
  );
}
export function useRemoveMatterMember() {
  return useMatterMutation((v: { id: string; userId: string }) => apiRequest<MatterDetail>(`/api/matters/${v.id}/members/${v.userId}`, { method: 'DELETE', schema: MatterDetailSchema }));
}
export function useAddBarrier() {
  return useMatterMutation((v: { id: string; userId: string; reason: string }) =>
    apiRequest<MatterDetail>(`/api/matters/${v.id}/barriers`, { method: 'POST', body: BarrierAddSchema.parse({ userId: v.userId, reason: v.reason }), schema: MatterDetailSchema }),
  );
}
