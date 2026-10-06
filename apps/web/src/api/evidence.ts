import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { EvidenceConfirmSchema, EvidenceCorrectSchema, EvidenceInputSchema, EvidenceSchema, EvidenceUpdateSchema, type Evidence } from '@raylow/contracts';
import { apiRequest } from '../lib/apiClient';
import { matterKeys } from './matters';

export type EvidenceInput = z.input<typeof EvidenceInputSchema>;
export type EvidenceCorrectInput = z.input<typeof EvidenceCorrectSchema>;

function useEvidenceMutation<V>(fn: (v: V) => Promise<Evidence>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: (e) => void qc.invalidateQueries({ queryKey: matterKeys.evidence(e.matterId) }) });
}

export function useCreateEvidence() {
  return useEvidenceMutation((input: EvidenceInput) => apiRequest<Evidence>('/api/evidence', { method: 'POST', body: EvidenceInputSchema.parse(input), schema: EvidenceSchema }));
}
export function useUpdateEvidence() {
  return useEvidenceMutation((v: { id: string; patch: Partial<Omit<EvidenceInput, 'matterId'>>; expectedVersion: number }) =>
    apiRequest<Evidence>(`/api/evidence/${v.id}`, { method: 'PUT', body: EvidenceUpdateSchema.parse({ ...v.patch, expectedVersion: v.expectedVersion }), schema: EvidenceSchema }),
  );
}
export function useConfirmEvidence() {
  return useEvidenceMutation((v: { id: string; expectedVersion: number }) =>
    apiRequest<Evidence>(`/api/evidence/${v.id}/confirm`, { method: 'POST', body: EvidenceConfirmSchema.parse({ expectedVersion: v.expectedVersion }), schema: EvidenceSchema }),
  );
}
export function useCorrectEvidence() {
  return useEvidenceMutation((v: { id: string; input: EvidenceCorrectInput }) =>
    apiRequest<Evidence>(`/api/evidence/${v.id}/correct`, { method: 'POST', body: EvidenceCorrectSchema.parse(v.input), schema: EvidenceSchema }),
  );
}
