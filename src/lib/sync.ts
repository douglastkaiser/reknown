import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { db as firestoreDb } from './firebase';
import type {
  Category,
  Person,
  ReviewEvent,
  SessionSummary,
  Settings,
} from '../types';
import {
  applyRemoteCategory,
  applyRemoteDelete,
  applyRemotePerson,
  applyRemoteReviewEvent,
  applyRemoteSessionSummary,
  applyRemoteSettings,
  getSettingsDirect,
  listCategoriesInScope,
  listPeopleInScope,
  listReviewEventsInScope,
  listSessionSummariesInScope,
  setReviewEventRemoteId,
} from './storage';
import { registerSyncHandlers, type SyncKind } from './sync-bus';

/**
 * Cloud-sync engine. IndexedDB remains the source of truth; this module
 * keeps a per-user Firestore subtree in lockstep with it.
 *
 *   users/{uid}/people/{personId}
 *   users/{uid}/categories/{categoryId}
 *   users/{uid}/settings/app
 *   users/{uid}/reviewEvents/{remoteId}
 *   users/{uid}/sessionSummaries/{sessionId}
 *
 * On `startSync` we do a single reconciliation pass (last-write-wins by
 * `updatedAt`), then subscribe via `onSnapshot` to pull subsequent changes.
 * `storage.ts` mutators call into the registered push handlers (see
 * `sync-bus.ts`) to propagate local writes outward.
 *
 * Known edge case (documented, not fixed in v1):
 *   If device A is offline holding a local copy of person X, device B deletes
 *   X, and A later comes online, A's reconciliation sees "local-only" and
 *   resurrects X. A tombstone store would fix this; left out for now.
 */

let currentUid: string | null = null;
let unsubs: Unsubscribe[] = [];
let active = false;
let starting: Promise<void> | null = null;

function userCol(uid: string, name: string) {
  return collection(firestoreDb, 'users', uid, name);
}

function userDoc(uid: string, colName: string, docId: string) {
  return doc(firestoreDb, 'users', uid, colName, docId);
}

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

function emitRemoteChanged(kind: SyncKind | 'settings'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('reknown:remote-changed', { detail: { kind } }));
  // Reuse the existing metrics-updated channel for review/session stats so
  // useStats recomputes without a second bespoke listener.
  if (kind === 'reviewEvents' || kind === 'sessionSummaries') {
    window.dispatchEvent(new CustomEvent('reknown:metrics-updated'));
  }
}

// --- Push handlers (called from storage.ts via sync-bus) --------------------

function pushPerson(person: Person): void {
  if (!currentUid) return;
  const payload = stripUndefined({ ...person, scope: undefined });
  void setDoc(userDoc(currentUid, 'people', person.id), payload).catch((err) => {
    console.warn('[sync] pushPerson failed', err);
  });
}

function pushCategory(category: Category): void {
  if (!currentUid) return;
  const payload = stripUndefined({ ...category, scope: undefined });
  void setDoc(userDoc(currentUid, 'categories', category.id), payload).catch((err) => {
    console.warn('[sync] pushCategory failed', err);
  });
}

function pushSettings(settings: Settings): void {
  if (!currentUid) return;
  const payload = stripUndefined({ ...settings });
  void setDoc(userDoc(currentUid, 'settings', 'app'), payload).catch((err) => {
    console.warn('[sync] pushSettings failed', err);
  });
}

function pushReviewEvent(event: ReviewEvent): void {
  if (!currentUid) return;
  const remoteId = event.remoteId;
  if (!remoteId) return; // recordReviewEvent always assigns one before pushing.
  // Firestore doc stores only sync-relevant fields; the local numeric `id`
  // is meaningless in the cloud and `scope` is implied by the parent path.
  const payload = stripUndefined({
    remoteId,
    cardId: event.cardId,
    cardType: event.cardType,
    outcome: event.outcome,
    score: event.score,
    timestamp: event.timestamp,
    mode: event.mode,
  });
  void setDoc(userDoc(currentUid, 'reviewEvents', remoteId), payload).catch((err) => {
    console.warn('[sync] pushReviewEvent failed', err);
  });
}

function pushSessionSummary(summary: SessionSummary): void {
  if (!currentUid) return;
  const payload = stripUndefined({ ...summary, scope: undefined });
  void setDoc(userDoc(currentUid, 'sessionSummaries', summary.id), payload).catch((err) => {
    console.warn('[sync] pushSessionSummary failed', err);
  });
}

function pushDelete(kind: SyncKind, id: string): void {
  if (!currentUid) return;
  void deleteDoc(userDoc(currentUid, kind, id)).catch((err) => {
    console.warn('[sync] pushDelete failed', kind, id, err);
  });
}

registerSyncHandlers({
  isActive: () => active,
  syncedUid: () => currentUid,
  pushPerson,
  pushCategory,
  pushSettings,
  pushReviewEvent,
  pushSessionSummary,
  pushDelete,
});

// --- Reconciliation ---------------------------------------------------------

interface Timestamped {
  updatedAt?: number;
}

function newer<T extends Timestamped>(a: T, b: T): boolean {
  return (a.updatedAt ?? 0) > (b.updatedAt ?? 0);
}

async function reconcilePeople(uid: string, scope: string): Promise<void> {
  const snap = await getDocs(userCol(uid, 'people'));
  const remoteById = new Map<string, Person>();
  snap.forEach((d) => remoteById.set(d.id, d.data() as Person));

  const local = await listPeopleInScope(scope);
  const localById = new Map(local.map((p) => [p.id, p]));

  const ids = new Set([...remoteById.keys(), ...localById.keys()]);
  for (const id of ids) {
    const r = remoteById.get(id);
    const l = localById.get(id);
    if (r && !l) {
      await applyRemotePerson({ ...r, scope });
    } else if (l && !r) {
      pushPerson(l);
    } else if (l && r) {
      if (newer(l, r)) pushPerson(l);
      else if (newer(r, l)) await applyRemotePerson({ ...r, scope });
    }
  }
}

async function reconcileCategories(uid: string, scope: string): Promise<void> {
  const snap = await getDocs(userCol(uid, 'categories'));
  const remoteById = new Map<string, Category>();
  snap.forEach((d) => remoteById.set(d.id, d.data() as Category));

  const local = await listCategoriesInScope(scope);
  const localById = new Map(local.map((c) => [c.id, c]));

  const ids = new Set([...remoteById.keys(), ...localById.keys()]);
  for (const id of ids) {
    const r = remoteById.get(id);
    const l = localById.get(id);
    if (r && !l) {
      await applyRemoteCategory({ ...r, scope });
    } else if (l && !r) {
      pushCategory(l);
    } else if (l && r) {
      if (newer(l, r)) pushCategory(l);
      else if (newer(r, l)) await applyRemoteCategory({ ...r, scope });
    }
  }
}

async function reconcileSettings(uid: string): Promise<void> {
  const snap = await getDocs(userCol(uid, 'settings'));
  let remote: Settings | undefined;
  snap.forEach((d) => {
    if (d.id === 'app') remote = d.data() as Settings;
  });
  const local = await getSettingsDirect();
  if (remote && !local) {
    await applyRemoteSettings(remote);
  } else if (local && !remote) {
    pushSettings(local);
  } else if (local && remote) {
    if ((local.updatedAt ?? 0) > (remote.updatedAt ?? 0)) pushSettings(local);
    else if ((remote.updatedAt ?? 0) > (local.updatedAt ?? 0)) await applyRemoteSettings(remote);
  }
}

async function reconcileReviewEvents(uid: string, scope: string): Promise<void> {
  // Review events are append-only (no updates), so reconciliation is a
  // union: push any local event missing a remoteId, pull any remote id not
  // yet present locally. Dedup is by remoteId.
  const snap = await getDocs(userCol(uid, 'reviewEvents'));
  const remoteIds = new Set<string>();
  const remoteRows: Array<{ id: string; data: DocumentData }> = [];
  snap.forEach((d) => {
    remoteIds.add(d.id);
    remoteRows.push({ id: d.id, data: d.data() });
  });

  const local = await listReviewEventsInScope(scope);
  const localByRemoteId = new Map<string, ReviewEvent>();
  for (const ev of local) {
    if (ev.remoteId) localByRemoteId.set(ev.remoteId, ev);
  }

  // Remote → local
  for (const { id, data } of remoteRows) {
    if (localByRemoteId.has(id)) continue;
    await applyRemoteReviewEvent({
      ...(data as Omit<ReviewEvent, 'id'>),
      remoteId: id,
      scope,
    });
  }

  // Local → remote (including rows that predate sync and have no remoteId yet)
  for (const ev of local) {
    let remoteId = ev.remoteId;
    if (!remoteId) {
      remoteId = crypto.randomUUID();
      await setReviewEventRemoteId(ev.id, remoteId);
    }
    if (!remoteIds.has(remoteId)) {
      pushReviewEvent({ ...ev, remoteId });
    }
  }
}

async function reconcileSessionSummaries(uid: string, scope: string): Promise<void> {
  const snap = await getDocs(userCol(uid, 'sessionSummaries'));
  const remoteById = new Map<string, SessionSummary>();
  snap.forEach((d) => remoteById.set(d.id, d.data() as SessionSummary));

  const local = await listSessionSummariesInScope(scope);
  const localById = new Map(local.map((s) => [s.id, s]));

  const ids = new Set([...remoteById.keys(), ...localById.keys()]);
  for (const id of ids) {
    const r = remoteById.get(id);
    const l = localById.get(id);
    if (r && !l) {
      await applyRemoteSessionSummary({ ...r, scope });
    } else if (l && !r) {
      pushSessionSummary(l);
    }
    // Session summaries are immutable — no update branch.
  }
}

// --- Live subscription ------------------------------------------------------

function subscribePeople(uid: string, scope: string): Unsubscribe {
  return onSnapshot(userCol(uid, 'people'), (snap) => {
    if (snap.metadata.hasPendingWrites) return; // local echo
    void (async () => {
      let touched = false;
      for (const change of snap.docChanges()) {
        if (change.type === 'removed') {
          await applyRemoteDelete('people', change.doc.id);
          touched = true;
        } else {
          await applyRemotePerson({ ...(change.doc.data() as Person), scope });
          touched = true;
        }
      }
      if (touched) emitRemoteChanged('people');
    })();
  });
}

function subscribeCategories(uid: string, scope: string): Unsubscribe {
  return onSnapshot(userCol(uid, 'categories'), (snap) => {
    if (snap.metadata.hasPendingWrites) return;
    void (async () => {
      let touched = false;
      for (const change of snap.docChanges()) {
        if (change.type === 'removed') {
          await applyRemoteDelete('categories', change.doc.id);
          touched = true;
        } else {
          await applyRemoteCategory({ ...(change.doc.data() as Category), scope });
          touched = true;
        }
      }
      if (touched) emitRemoteChanged('categories');
    })();
  });
}

function subscribeSettings(uid: string): Unsubscribe {
  return onSnapshot(userDoc(uid, 'settings', 'app'), (doc) => {
    if (doc.metadata.hasPendingWrites) return;
    if (!doc.exists()) return;
    void (async () => {
      await applyRemoteSettings(doc.data() as Settings);
      emitRemoteChanged('settings');
    })();
  });
}

function subscribeReviewEvents(uid: string, scope: string): Unsubscribe {
  return onSnapshot(userCol(uid, 'reviewEvents'), (snap) => {
    if (snap.metadata.hasPendingWrites) return;
    void (async () => {
      let touched = false;
      for (const change of snap.docChanges()) {
        if (change.type === 'removed') {
          await applyRemoteDelete('reviewEvents', change.doc.id);
          touched = true;
        } else {
          await applyRemoteReviewEvent({
            ...(change.doc.data() as Omit<ReviewEvent, 'id'>),
            remoteId: change.doc.id,
            scope,
          });
          touched = true;
        }
      }
      if (touched) emitRemoteChanged('reviewEvents');
    })();
  });
}

function subscribeSessionSummaries(uid: string, scope: string): Unsubscribe {
  return onSnapshot(userCol(uid, 'sessionSummaries'), (snap) => {
    if (snap.metadata.hasPendingWrites) return;
    void (async () => {
      let touched = false;
      for (const change of snap.docChanges()) {
        if (change.type === 'removed') {
          await applyRemoteDelete('sessionSummaries', change.doc.id);
          touched = true;
        } else {
          await applyRemoteSessionSummary({ ...(change.doc.data() as SessionSummary), scope });
          touched = true;
        }
      }
      if (touched) emitRemoteChanged('sessionSummaries');
    })();
  });
}

// --- Public lifecycle -------------------------------------------------------

export function isSyncActive(): boolean {
  return active;
}

export function getSyncedUid(): string | null {
  return currentUid;
}

export async function startSync(uid: string): Promise<void> {
  if (active && currentUid === uid) return;
  if (starting) return starting;
  if (active && currentUid !== uid) stopSync();

  const scope = `u:${uid}`;
  currentUid = uid;

  starting = (async () => {
    try {
      // Push+pull reconciliation before we start listening, so the first
      // snapshot delivers a consistent baseline rather than a flurry of
      // echo-vs-remote races.
      active = true; // enable push path for events generated during reconcile
      await Promise.all([
        reconcilePeople(uid, scope),
        reconcileCategories(uid, scope),
        reconcileSettings(uid),
        reconcileReviewEvents(uid, scope),
        reconcileSessionSummaries(uid, scope),
      ]);

      unsubs = [
        subscribePeople(uid, scope),
        subscribeCategories(uid, scope),
        subscribeSettings(uid),
        subscribeReviewEvents(uid, scope),
        subscribeSessionSummaries(uid, scope),
      ];

      // Nudge any mounted hooks so they pick up reconciled data without
      // waiting for the first onSnapshot callback.
      emitRemoteChanged('people');
      emitRemoteChanged('categories');
      emitRemoteChanged('reviewEvents');
    } finally {
      starting = null;
    }
  })();

  return starting;
}

export function stopSync(): void {
  for (const u of unsubs) {
    try {
      u();
    } catch (err) {
      console.warn('[sync] unsubscribe failed', err);
    }
  }
  unsubs = [];
  active = false;
  currentUid = null;
}
