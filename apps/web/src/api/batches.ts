import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { BatchCreateSchema, BatchItemSchema, BatchSchema, type Batch } from '@raylow/contracts';
import { apiRequest } from '../lib/apiClient';

export const batchKeys = { detail: (id: string) => ['batches', id] as const };
export type BatchCreateInput = z.input<typeof BatchCreateSchema>;
export type BatchItem = z.infer<typeof BatchItemSchema>;

export function createBatch(input: BatchCreateInput): Promise<Batch> {
  return apiRequest<Batch>('/api/batches', { method: 'POST', body: BatchCreateSchema.parse(input), schema: BatchSchema });
}
export function useBatch(id: string | null | undefined, refetchInterval: number | false) {
  return useQuery({ queryKey: batchKeys.detail(id ?? ''), queryFn: () => apiRequest<Batch>(`/api/batches/${id}`, { schema: BatchSchema }), enabled: !!id, refetchInterval });
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
