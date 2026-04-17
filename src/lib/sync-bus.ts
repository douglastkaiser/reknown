import type {
  Category,
  EntityTombstone,
  Person,
  ReviewEvent,
  SessionSummary,
  Settings,
} from '../types';

/**
 * Tiny shim that lets `storage.ts` notify the cloud-sync layer without
 * importing `firebase/firestore` directly. `sync.ts` registers its push
 * handlers at startup; storage-layer mutators call into them after every
 * successful IndexedDB write.
 *
 * The `applyingRemote` flag short-circuits the push path while `sync.ts` is
 * writing IDB rows from an `onSnapshot` callback — without it every remote
 * change would bounce straight back out as a local-origin push.
 */

export type SyncKind = 'people' | 'categories' | 'reviewEvents' | 'sessionSummaries';

export interface SyncHandlers {
  isActive: () => boolean;
  syncedUid: () => string | null;
  pushPerson: (person: Person) => void;
  pushCategory: (category: Category) => void;
  pushSettings: (settings: Settings) => void;
  pushReviewEvent: (event: ReviewEvent) => void;
  pushSessionSummary: (summary: SessionSummary) => void;
  pushDelete: (kind: SyncKind, id: string) => void;
  pushTombstone: (tombstone: EntityTombstone) => void;
}

let handlers: SyncHandlers | null = null;
let applyingRemote = false;

export function registerSyncHandlers(next: SyncHandlers | null): void {
  handlers = next;
}

export function getSyncHandlers(): SyncHandlers | null {
  return handlers;
}

export function isSyncActive(): boolean {
  return handlers?.isActive() ?? false;
}

export function getSyncedUid(): string | null {
  return handlers?.syncedUid() ?? null;
}

export function setApplyingRemote(value: boolean): void {
  applyingRemote = value;
}

export function isApplyingRemote(): boolean {
  return applyingRemote;
}

/**
 * Run a function with the applying-remote flag set so storage mutators
 * triggered inside don't echo back out to Firestore.
 */
export async function withApplyingRemote<T>(fn: () => Promise<T>): Promise<T> {
  const previous = applyingRemote;
  applyingRemote = true;
  try {
    return await fn();
  } finally {
    applyingRemote = previous;
  }
}
