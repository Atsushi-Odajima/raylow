import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ReviewCommentInputSchema, ReviewCommentSchema, ReviewDecisionSchema, ReviewDetailSchema, ReviewSchema, type Review, type ReviewDetail } from '@raylow/contracts';
import { apiRequest, apiRequestEnvelope, type QueryParams } from '../lib/apiClient';

export const reviewKeys = {
  list: (q: QueryParams) => ['reviews', 'list', q] as const,
  detail: (id: string) => ['reviews', 'detail', id] as const,
};

export type ReviewDecisionInput = z.input<typeof ReviewDecisionSchema>;
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

export function useReviews(q: { status?: string | undefined; mine?: boolean | undefined }) {
  const params: QueryParams = { status: q.status, mine: q.mine ? true : undefined, limit: 50 };
  return useInfiniteQuery({
    queryKey: reviewKeys.list(params),
    queryFn: async ({ pageParam }) => {
      const env = await apiRequestEnvelope<Review[]>('/api/reviews', { query: { ...params, cursor: pageParam || undefined }, schema: z.array(ReviewSchema) });
      return { items: env.data, nextCursor: env.meta.nextCursor ?? null };
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
export function useReview(id: string | null | undefined) {
  return useQuery({ queryKey: reviewKeys.detail(id ?? ''), queryFn: () => apiRequest<ReviewDetail>(`/api/reviews/${id}`, { schema: ReviewDetailSchema }), enabled: !!id });
}
export function useReviewDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: ReviewDecisionInput }) => apiRequest<ReviewDetail>(`/api/reviews/${v.id}/decision`, { method: 'POST', body: ReviewDecisionSchema.parse(v.input), schema: ReviewDetailSchema }),
    onSuccess: (d) => {
      qc.setQueryData(reviewKeys.detail(d.review.id), d);
      void qc.invalidateQueries({ queryKey: ['reviews', 'list'] });
      void qc.invalidateQueries({ queryKey: ['drafts'] });
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['home'] });
    },
  });
}
export function useAddReviewComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; bodyRaw: string; blockId?: string | null; fieldKey?: string | null }) =>
      apiRequest<ReviewComment>(`/api/reviews/${v.id}/comments`, { method: 'POST', body: ReviewCommentInputSchema.parse({ bodyRaw: v.bodyRaw, blockId: v.blockId ?? null, fieldKey: v.fieldKey ?? null }), schema: ReviewCommentSchema }),
    onSuccess: (_c, v) => void qc.invalidateQueries({ queryKey: reviewKeys.detail(v.id) }),
  });
}
export function useResolveReviewComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { commentId: string; reviewId: string }) => apiRequest<ReviewComment>(`/api/review-comments/${v.commentId}/resolve`, { method: 'POST', schema: ReviewCommentSchema }),
    onSuccess: (_c, v) => void qc.invalidateQueries({ queryKey: reviewKeys.detail(v.reviewId) }),
  });
}
