import type { EntityTombstone, Person } from '../types';

export type PersonReconcileDecision =
  | 'apply_remote'
  | 'push_local'
  | 'keep_deleted';

export function decidePersonReconcileAction(input: {
  local?: Pick<Person, 'updatedAt'>;
  remote?: Pick<Person, 'updatedAt'>;
  tombstone?: Pick<EntityTombstone, 'deletedAt'>;
}): PersonReconcileDecision {
  const localUpdatedAt = input.local?.updatedAt ?? 0;
  const remoteUpdatedAt = input.remote?.updatedAt ?? 0;
  const deletedAt = input.tombstone?.deletedAt ?? 0;

  if (deletedAt > 0) {
    if (localUpdatedAt > deletedAt || remoteUpdatedAt > deletedAt) {
      return localUpdatedAt >= remoteUpdatedAt ? 'push_local' : 'apply_remote';
    }
    return 'keep_deleted';
  }

  if (remoteUpdatedAt > 0 && localUpdatedAt === 0) return 'apply_remote';
  if (localUpdatedAt > 0 && remoteUpdatedAt === 0) return 'push_local';
  return localUpdatedAt >= remoteUpdatedAt ? 'push_local' : 'apply_remote';
}
