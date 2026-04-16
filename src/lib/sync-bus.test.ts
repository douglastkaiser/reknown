import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSyncedUid,
  getSyncHandlers,
  isApplyingRemote,
  isSyncActive,
  registerSyncHandlers,
  setApplyingRemote,
  withApplyingRemote,
  type SyncHandlers,
} from './sync-bus';

function makeHandlers(overrides: Partial<SyncHandlers> = {}): SyncHandlers {
  return {
    isActive: () => true,
    syncedUid: () => 'uid-123',
    pushPerson: vi.fn(),
    pushCategory: vi.fn(),
    pushSettings: vi.fn(),
    pushReviewEvent: vi.fn(),
    pushSessionSummary: vi.fn(),
    pushDelete: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  registerSyncHandlers(null);
  setApplyingRemote(false);
});

describe('sync-bus', () => {
  it('reports inactive with no handlers registered', () => {
    expect(isSyncActive()).toBe(false);
    expect(getSyncedUid()).toBeNull();
    expect(getSyncHandlers()).toBeNull();
  });

  it('surfaces handler isActive / syncedUid once registered', () => {
    const handlers = makeHandlers();
    registerSyncHandlers(handlers);
    expect(isSyncActive()).toBe(true);
    expect(getSyncedUid()).toBe('uid-123');
    expect(getSyncHandlers()).toBe(handlers);
  });

  it('flips active/inactive when handler state changes', () => {
    let active = false;
    registerSyncHandlers(makeHandlers({ isActive: () => active }));
    expect(isSyncActive()).toBe(false);
    active = true;
    expect(isSyncActive()).toBe(true);
  });

  it('withApplyingRemote flips the flag for the duration and restores it', async () => {
    expect(isApplyingRemote()).toBe(false);
    const during = await withApplyingRemote(async () => {
      return isApplyingRemote();
    });
    expect(during).toBe(true);
    expect(isApplyingRemote()).toBe(false);
  });

  it('withApplyingRemote restores the previous value when nested', async () => {
    setApplyingRemote(true);
    await withApplyingRemote(async () => {
      expect(isApplyingRemote()).toBe(true);
    });
    // Preserves the outer true rather than resetting to false.
    expect(isApplyingRemote()).toBe(true);
  });

  it('withApplyingRemote restores the flag when the body throws', async () => {
    await expect(
      withApplyingRemote(async () => {
        expect(isApplyingRemote()).toBe(true);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(isApplyingRemote()).toBe(false);
  });
});
