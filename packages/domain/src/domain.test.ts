import { describe, expect, it } from 'vitest';
import { checkApproval } from './acl.js';
import { canonicalJson, hashCanonical } from './canonical.js';
import { canTransitionDraft, canTransitionTemplateVersion } from './states.js';

describe('canonical json', () => {
  it('sorts keys, preserves strings byte-for-byte, omits undefined', () => {
    expect(canonicalJson({ b: 1, a: 'ＡＢ　髙', c: undefined, d: [1, 'x', null] })).toBe('{"a":"ＡＢ　髙","b":1,"d":[1,"x",null]}');
  });
  it('hash differs for fullwidth vs ASCII (no normalization)', async () => {
    expect(await hashCanonical({ t: 'ＡＢＣ' })).not.toBe(await hashCanonical({ t: 'ABC' }));
    expect(await hashCanonical({ t: 'x', u: 'y' })).toBe(await hashCanonical({ u: 'y', t: 'x' }));
  });
});

describe('approval rules (AC14)', () => {
  const base = {
    actorUserId: 'u2',
    actorRole: 'lawyer' as const,
    actorIsMatterMember: true,
    actorIsBarrier: false,
    actorIsAssignedLawyer: true,
    lastEditorUserId: 'u1',
    targetHash: 'h',
    currentHash: 'h',
    draftStatus: 'ready_for_review',
  };
  it('allows a different assigned lawyer', () => {
    expect(checkApproval(base)).toEqual({ ok: true });
  });
  it('denies staff, admin-only, unassigned, self, stale hash', () => {
    expect(checkApproval({ ...base, actorRole: 'staff' })).toMatchObject({ ok: false, reason: 'staff_cannot_approve', httpStatus: 403 });
    expect(checkApproval({ ...base, actorRole: 'admin', actorIsAssignedLawyer: false })).toMatchObject({ ok: false, reason: 'admin_cannot_approve' });
    expect(checkApproval({ ...base, actorIsAssignedLawyer: false })).toMatchObject({ ok: false, reason: 'not_assigned_lawyer' });
    expect(checkApproval({ ...base, actorUserId: 'u1' })).toMatchObject({ ok: false, reason: 'self_approval' });
    expect(checkApproval({ ...base, currentHash: 'h2' })).toMatchObject({ ok: false, reason: 'hash_stale', httpStatus: 409 });
    expect(checkApproval({ ...base, actorIsBarrier: true })).toMatchObject({ ok: false, reason: 'barrier' });
  });
});

describe('state machines', () => {
  it('draft transitions', () => {
    expect(canTransitionDraft('draft', 'rendering')).toBe(true);
    expect(canTransitionDraft('approved', 'in_review')).toBe(false);
    expect(canTransitionDraft('archived', 'draft')).toBe(false);
  });
  it('published template versions are immutable', () => {
    expect(canTransitionTemplateVersion('published', 'draft')).toBe(false);
    expect(canTransitionTemplateVersion('published', 'retired')).toBe(true);
  });
});
