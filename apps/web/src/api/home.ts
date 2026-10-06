import { useQuery } from '@tanstack/react-query';
import { CreateHomeSchema, type CreateHome } from '@raylow/contracts';
import { apiRequest } from '../lib/apiClient';

export const homeKeys = { create: ['home', 'create'] as const };

export function useCreateHome() {
  return useQuery({
    queryKey: homeKeys.create,
    queryFn: () => apiRequest<CreateHome>('/api/home/create', { schema: CreateHomeSchema }),
  });
}
