import { describe, expect, it } from 'vitest';
import { decidePersonReconcileAction } from './sync-merge';

describe('sync tombstone reconciliation', () => {
  it('keeps delete when tombstone is newer than stale local row', () => {
    const action = decidePersonReconcileAction({
      local: { updatedAt: 100 },
      tombstone: { deletedAt: 200 },
    });
    expect(action).toBe('keep_deleted');
  });

  it('prevents resurrection when offline device comes online with stale local row', () => {
    const action = decidePersonReconcileAction({
      local: { updatedAt: 1_000 },
      remote: undefined,
      tombstone: { deletedAt: 2_000 },
    });
    expect(action).toBe('keep_deleted');
  });

  it('allows explicit recreate with same id only when newer than tombstone', () => {
    const action = decidePersonReconcileAction({
      local: { updatedAt: 3_000 },
      tombstone: { deletedAt: 2_000 },
    });
    expect(action).toBe('push_local');
  });
});
