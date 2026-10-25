import { describe, expect, it } from 'vitest';
import { BusinessStatus } from './opportunities.js';
import { checkMove, Contract, OPERATOR_TARGETS, StatusChangeRequest } from './status.js';

const ALL = BusinessStatus.options;

describe('checkMove (TR-14, S-08 D-1)', () => {
  it('never allows staying put or returning to NEW', () => {
    for (const status of ALL) {
      expect(checkMove(status, status).allowed).toBe(false);
      expect(checkMove(status, 'NEW').allowed).toBe(false);
    }
    expect(OPERATOR_TARGETS).not.toContain('NEW');
  });

  it('records the stages a forward move passes over', () => {
    expect(checkMove('SAVED', 'CONTACTED')).toEqual({
      allowed: true,
      kind: 'forward',
      skipped: ['OFFER_DRAFTED'],
      noteRequired: false,
    });
    expect(checkMove('NEW', 'SAVED')).toMatchObject({ kind: 'forward', skipped: ['QUALIFIED'] });
    expect(checkMove('QUALIFIED', 'SAVED')).toMatchObject({ kind: 'forward', skipped: [] });
    expect(checkMove('NEW', 'MEETING')).toMatchObject({
      skipped: ['QUALIFIED', 'SAVED', 'OFFER_DRAFTED', 'CONTACTED', 'REPLIED'],
    });
  });

  it('needs a note for every move back', () => {
    expect(checkMove('CONTACTED', 'SAVED')).toEqual({
      allowed: true,
      kind: 'back',
      skipped: [],
      noteRequired: true,
    });
    expect(checkMove('MEETING', 'REPLIED')).toMatchObject({ kind: 'back', noteRequired: true });
    expect(checkMove('WON', 'CONTACTED')).toMatchObject({ kind: 'back', noteRequired: true });
    expect(checkMove('LOST', 'MEETING')).toMatchObject({ kind: 'back', noteRequired: true });
  });

  it('reopens REJECTED and EXPIRED rows only with a note, leaving NEEDS_VERIFICATION is forward', () => {
    for (const closed of ['REJECTED', 'EXPIRED'] as const) {
      expect(checkMove(closed, 'SAVED')).toMatchObject({ kind: 'back', noteRequired: true });
      expect(checkMove(closed, 'CONTACTED')).toMatchObject({ kind: 'back', noteRequired: true });
      expect(checkMove(closed, 'WON').allowed).toBe(false);
    }
    expect(checkMove('NEEDS_VERIFICATION', 'SAVED')).toMatchObject({
      kind: 'forward',
      skipped: ['QUALIFIED'],
      noteRequired: false,
    });
    expect(checkMove('NEEDS_VERIFICATION', 'CONTACTED')).toMatchObject({
      kind: 'forward',
      skipped: ['QUALIFIED', 'SAVED', 'OFFER_DRAFTED'],
    });
    expect(checkMove('NEEDS_VERIFICATION', 'WON').allowed).toBe(false);
  });

  it('R1: from NEEDS_VERIFICATION no stage after CONTACTED is reachable, so WON needs a recorded contact', () => {
    for (const to of ['REPLIED', 'MEETING', 'WON', 'LOST'] as const) {
      expect(checkMove('NEEDS_VERIFICATION', to).allowed).toBe(false);
    }
    // two-step path: WON -> NEEDS_VERIFICATION -> MEETING is no longer a note-free back move
    expect(checkMove('WON', 'NEEDS_VERIFICATION').allowed).toBe(true);
  });

  it('R6: a reopened REJECTED/EXPIRED row cannot jump past CONTACTED, so WON needs a recorded contact', () => {
    for (const closed of ['REJECTED', 'EXPIRED'] as const) {
      for (const to of ['REPLIED', 'MEETING', 'WON', 'LOST'] as const) {
        expect(checkMove(closed, to).allowed).toBe(false);
      }
    }
  });

  it('allows REJECTED, EXPIRED and NEEDS_VERIFICATION from every other status', () => {
    for (const target of ['REJECTED', 'EXPIRED', 'NEEDS_VERIFICATION'] as const) {
      for (const from of ALL.filter((status) => status !== target)) {
        expect(checkMove(from, target)).toEqual({
          allowed: true,
          kind: 'aside',
          skipped: [],
          noteRequired: false,
        });
      }
    }
  });

  it('allows WON and LOST only after contact, or as a correction of each other', () => {
    for (const target of ['WON', 'LOST'] as const) {
      for (const from of ['CONTACTED', 'REPLIED', 'MEETING'] as const) {
        expect(checkMove(from, target)).toMatchObject({ kind: 'forward', noteRequired: false });
      }
      for (const from of [
        'NEW',
        'QUALIFIED',
        'SAVED',
        'OFFER_DRAFTED',
        'REJECTED',
        'EXPIRED',
        'NEEDS_VERIFICATION',
      ] as const) {
        expect(checkMove(from, target).allowed).toBe(false);
      }
    }
    expect(checkMove('WON', 'LOST')).toMatchObject({ kind: 'back', noteRequired: true });
    expect(checkMove('LOST', 'WON')).toMatchObject({ kind: 'back', noteRequired: true });
  });
});

describe('StatusChangeRequest', () => {
  it('requires a note for the reason OTHER', () => {
    expect(StatusChangeRequest.safeParse({ status: 'REJECTED', reason: 'OTHER' }).success).toBe(
      false,
    );
    expect(
      StatusChangeRequest.safeParse({ status: 'REJECTED', reason: 'OTHER', note: 'x' }).success,
    ).toBe(true);
  });

  it('refuses NEW and unknown fields, accepts every operator target', () => {
    expect(StatusChangeRequest.safeParse({ status: 'NEW' }).success).toBe(false);
    expect(StatusChangeRequest.safeParse({ status: 'SAVED', reason: 'OTHER' }).success).toBe(false);
    for (const status of OPERATOR_TARGETS.filter((s) => s !== 'REJECTED')) {
      expect(StatusChangeRequest.safeParse({ status }).success).toBe(true);
    }
  });

  it('checks the contract: value > 0, a currency, end not before start', () => {
    const ok = { valueMinor: 150_000, currency: 'PLN' };
    expect(StatusChangeRequest.safeParse({ status: 'WON', contract: ok }).success).toBe(true);
    expect(StatusChangeRequest.safeParse({ status: 'WON' }).success).toBe(true);
    expect(Contract.safeParse({ ...ok, valueMinor: 0 }).success).toBe(false);
    expect(Contract.safeParse({ ...ok, valueMinor: 1.5 }).success).toBe(false);
    expect(Contract.safeParse({ valueMinor: 100 }).success).toBe(false);
    expect(Contract.safeParse({ ...ok, currency: 'GBP' }).success).toBe(false);
    expect(
      Contract.safeParse({ ...ok, expectedStartOn: '2026-11-10', expectedEndOn: '2026-11-09' })
        .success,
    ).toBe(false);
    expect(
      Contract.safeParse({ ...ok, expectedStartOn: '2026-11-10', expectedEndOn: '2026-11-10' })
        .success,
    ).toBe(true);
    expect(Contract.safeParse({ ...ok, expectedStartOn: '2026-02-30' }).success).toBe(false);
  });
});
