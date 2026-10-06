import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { JobSchema, type Job } from '@raylow/contracts';
import { apiRequest } from '../lib/apiClient';

export const jobKeys = { detail: (id: string) => ['jobs', id] as const };

export function fetchJob(id: string): Promise<Job> {
  return apiRequest<Job>(`/api/jobs/${id}`, { schema: JobSchema });
}

export function isJobActive(j: Job | undefined | null): boolean {
  return !!j && (j.state === 'queued' || j.state === 'running');
}

/** 1.5 秒間隔で状態を追う。完了/失敗で停止 */
export function useJob(id: string | null | undefined, intervalMs = 1500) {
  return useQuery({
    queryKey: jobKeys.detail(id ?? ''),
    queryFn: () => fetchJob(id ?? ''),
    enabled: !!id,
    refetchInterval: (q) => (isJobActive(q.state.data) ? intervalMs : false),
    staleTime: 0,
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<Job>(`/api/jobs/${id}/cancel`, { method: 'POST', schema: JobSchema }),
    onSuccess: (j) => qc.setQueryData(jobKeys.detail(j.id), j),
  });
}

/** progress JSON（{current,total,message} 等）から表示用の値を取り出す。推測で残り秒数を作らない */
export interface ProgressView {
  current: number | null;
  total: number | null;
  message: string | null;
  unit: string;
}
export function readProgress(p: Record<string, unknown> | null | undefined): ProgressView {
  if (!p) return { current: null, total: null, message: null, unit: '件' };
  const num = (k: string[]): number | null => {
    for (const key of k) {
      const v = p[key];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    return null;
  };
  const str = (k: string[]): string | null => {
    for (const key of k) {
      const v = p[key];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return null;
  };
  return {
    current: num(['current', 'done', 'completed', 'processed']),
    total: num(['total', 'count']),
    message: str(['message', 'stage', 'step']),
    unit: str(['unit']) ?? '件',
  };
}
