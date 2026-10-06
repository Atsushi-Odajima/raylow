import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  ContactInputSchema,
  ContactSchema,
  ContactSearchQuerySchema,
  ContactUpdateSchema,
  LawyerInputSchema,
  LawyerSchema,
  LawyerUpdateSchema,
  MemberInviteSchema,
  MemberSchema,
  OfficeProfileInputSchema,
  OfficeProfileSchema,
  OfficeProfileUpdateSchema,
  type Contact,
  type Lawyer,
  type Member,
  type OfficeProfile,
} from '@raylow/contracts';
import { apiRequest, apiRequestEnvelope, type QueryParams } from '../lib/apiClient';

export const masterKeys = {
  offices: ['offices'] as const,
  lawyers: ['lawyers'] as const,
  members: ['members'] as const,
  contacts: (q: QueryParams) => ['contacts', q] as const,
  contact: (id: string) => ['contacts', 'detail', id] as const,
};

export type OfficeProfileInput = z.input<typeof OfficeProfileInputSchema>;
export type LawyerInput = z.input<typeof LawyerInputSchema>;
export type ContactInput = z.input<typeof ContactInputSchema>;
export type ContactSearchQuery = z.input<typeof ContactSearchQuerySchema>;
export type MemberInvite = z.input<typeof MemberInviteSchema>;

export function useOffices() {
  return useQuery({ queryKey: masterKeys.offices, queryFn: () => apiRequest<OfficeProfile[]>('/api/offices', { schema: z.array(OfficeProfileSchema) }) });
}
export function useSaveOffice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string | null; input: OfficeProfileInput; expectedVersion: number | null }) =>
      v.id && v.expectedVersion != null
        ? apiRequest<OfficeProfile>(`/api/offices/${v.id}`, { method: 'PUT', body: OfficeProfileUpdateSchema.parse({ ...v.input, expectedVersion: v.expectedVersion }), schema: OfficeProfileSchema })
        : apiRequest<OfficeProfile>('/api/offices', { method: 'POST', body: OfficeProfileInputSchema.parse(v.input), schema: OfficeProfileSchema }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: masterKeys.offices }),
  });
}

export function useLawyers() {
  return useQuery({ queryKey: masterKeys.lawyers, queryFn: () => apiRequest<Lawyer[]>('/api/lawyers', { schema: z.array(LawyerSchema) }) });
}
export function useCreateLawyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LawyerInput) => apiRequest<Lawyer>('/api/lawyers', { method: 'POST', body: LawyerInputSchema.parse(input), schema: LawyerSchema }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: masterKeys.lawyers }),
  });
}
export function useUpdateLawyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; patch: Partial<LawyerInput>; expectedVersion: number }) =>
      apiRequest<Lawyer>(`/api/lawyers/${v.id}`, { method: 'PUT', body: LawyerUpdateSchema.parse({ ...v.patch, expectedVersion: v.expectedVersion }), schema: LawyerSchema }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: masterKeys.lawyers }),
  });
}

export function useMembers(enabled = true) {
  return useQuery({ queryKey: masterKeys.members, queryFn: () => apiRequest<Member[]>('/api/members', { schema: z.array(MemberSchema) }), enabled });
}
export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MemberInvite) => apiRequest<Member & { initialPassword?: string }>('/api/members', { method: 'POST', body: MemberInviteSchema.parse(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: masterKeys.members }),
  });
}
export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; role?: string; status?: string; expectedVersion: number }) =>
      apiRequest<Member>(`/api/members/${v.userId}`, { method: 'PUT', body: { ...(v.role ? { role: v.role } : {}), ...(v.status ? { status: v.status } : {}), expectedVersion: v.expectedVersion }, schema: MemberSchema }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: masterKeys.members }),
  });
}

export function useContactSearch(query: ContactSearchQuery, enabled = true) {
  const q: QueryParams = { q: query.q, type: query.type, mode: query.mode, limit: query.limit, cursor: query.cursor };
  return useQuery({
    queryKey: masterKeys.contacts(q),
    queryFn: async () => (await apiRequestEnvelope<Contact[]>('/api/contacts', { query: q, schema: z.array(ContactSchema) })).data,
    enabled,
  });
}
export function useContact(id: string | null) {
  return useQuery({ queryKey: masterKeys.contact(id ?? ''), queryFn: () => apiRequest<Contact>(`/api/contacts/${id}`, { schema: ContactSchema }), enabled: !!id });
}
export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ContactInput) => apiRequest<Contact>('/api/contacts', { method: 'POST', body: ContactInputSchema.parse(input), schema: ContactSchema }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}
export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; patch: Partial<ContactInput>; expectedVersion: number }) =>
      apiRequest<Contact>(`/api/contacts/${v.id}`, { method: 'PUT', body: ContactUpdateSchema.parse({ ...v.patch, expectedVersion: v.expectedVersion }), schema: ContactSchema }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}
export function useAddAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; aliasRaw: string }) => apiRequest<Contact>(`/api/contacts/${v.id}/aliases`, { method: 'POST', body: { aliasRaw: v.aliasRaw }, schema: ContactSchema }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}
