import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { DispatchRecordInputSchema, DispatchRecordSchema, DispatchVerifySchema, PacketCreateSchema, PacketSchema, PacketUpdateSchema, type DispatchRecord, type Packet } from '@raylow/contracts';
import { apiRequest } from '../lib/apiClient';

export const packetKeys = {
  detail: (id: string) => ['packets', id] as const,
  dispatch: (id: string) => ['dispatch-records', id] as const,
};
export type PacketCreateInput = z.input<typeof PacketCreateSchema>;
export type PacketUpdateInput = z.input<typeof PacketUpdateSchema>;
export type DispatchRecordInput = z.input<typeof DispatchRecordInputSchema>;

export function createPacket(input: PacketCreateInput): Promise<Packet> {
  return apiRequest<Packet>('/api/packets', { method: 'POST', body: PacketCreateSchema.parse(input), schema: PacketSchema });
}
export function usePacket(id: string | null | undefined, refetchInterval: number | false = false) {
  return useQuery({ queryKey: packetKeys.detail(id ?? ''), queryFn: () => apiRequest<Packet>(`/api/packets/${id}`, { schema: PacketSchema }), enabled: !!id, refetchInterval });
}
export function useUpdatePacket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: PacketUpdateInput }) => apiRequest<Packet>(`/api/packets/${v.id}`, { method: 'PUT', body: PacketUpdateSchema.parse(v.input), schema: PacketSchema }),
    onSuccess: (p) => qc.setQueryData(packetKeys.detail(p.id), p),
  });
}
export function useCheckPacket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<Packet>(`/api/packets/${id}/check`, { method: 'POST', schema: PacketSchema }),
    onSuccess: (p) => qc.setQueryData(packetKeys.detail(p.id), p),
  });
}
export function useRenderPacket() {
  return useMutation({ mutationFn: (id: string) => apiRequest<{ jobId: string }>(`/api/packets/${id}/render`, { method: 'POST' }) });
}

export function createDispatchRecord(input: DispatchRecordInput): Promise<DispatchRecord> {
  return apiRequest<DispatchRecord>('/api/dispatch-records', { method: 'POST', body: DispatchRecordInputSchema.parse(input), schema: DispatchRecordSchema });
}
export function useDispatchRecord(id: string | null | undefined) {
  return useQuery({ queryKey: packetKeys.dispatch(id ?? ''), queryFn: () => apiRequest<DispatchRecord>(`/api/dispatch-records/${id}`, { schema: DispatchRecordSchema }), enabled: !!id });
}
export function useVerifyDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; expectedVersion: number }) =>
      apiRequest<DispatchRecord>(`/api/dispatch-records/${v.id}/verify`, { method: 'POST', body: DispatchVerifySchema.parse({ expectedVersion: v.expectedVersion }), schema: DispatchRecordSchema }),
    onSuccess: (d) => {
      qc.setQueryData(packetKeys.dispatch(d.id), d);
      void qc.invalidateQueries({ queryKey: ['matters', d.matterId, 'dispatches'] });
    },
  });
}
