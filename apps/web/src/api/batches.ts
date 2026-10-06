import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { BatchCreateSchema, BatchItemSchema, BatchSchema, type Batch } from '@raylow/contracts';
import { apiRequest } from '../lib/apiClient';

export const batchKeys = { detail: (id: string) => ['batches', id] as const };
export type BatchCreateInput = z.input<typeof BatchCreateSchema>;
export type BatchItem = z.infer<typeof BatchItemSchema>;

export function createBatch(input: BatchCreateInput): Promise<Batch> {
  return apiRequest<Batch>('/api/batches', { method: 'POST', body: BatchCreateSchema.parse(input), schema: BatchSchema });
}
export function isBatchActive(b: Batch | undefined | null): boolean {
  return !!b && (b.status === 'queued' || b.status === 'running');
}
/** 進行中は 2 秒間隔で追う */
export function useBatch(id: string | null | undefined) {
  return useQuery({
    queryKey: batchKeys.detail(id ?? ''),
    queryFn: () => apiRequest<Batch>(`/api/batches/${id}`, { schema: BatchSchema }),
    enabled: !!id,
    refetchInterval: (q) => (isBatchActive(q.state.data) ? 2000 : false),
  });
}
export function useCancelBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<Batch>(`/api/batches/${id}/cancel`, { method: 'POST', schema: BatchSchema }),
    onSuccess: (b) => qc.setQueryData(batchKeys.detail(b.id), b),
  });
}
export function useRetryBatchItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { itemId: string; batchId: string }) => apiRequest<BatchItem>(`/api/batch-items/${v.itemId}/retry`, { method: 'POST', schema: BatchItemSchema }),
    onSuccess: (_i, v) => void qc.invalidateQueries({ queryKey: batchKeys.detail(v.batchId) }),
  });
}
