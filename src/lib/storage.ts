import { openDB, type DBSchema } from 'idb';
import type {
  AccuracyMetric,
  AppStats,
  Category,
  Person,
  ReviewCard,
  ReviewEvent,
  ReviewMetrics,
  SessionSummary,
  Settings,
} from '../types';
import {
  getSyncHandlers,
  isApplyingRemote,
  isSyncActive,
  withApplyingRemote,
} from './sync-bus';

const DB_NAME = 'reknown-db';
const DB_VERSION = 5;

function canPush(): boolean {
  if (!isSyncActive() || isApplyingRemote()) return false;
  const handlers = getSyncHandlers();
  if (!handlers) return false;
  const uid = handlers.syncedUid();
  return uid != null && activeScope === `u:${uid}`;
}

let activeScope: string | null = null;

export function setActiveScope(scope: string | null) {
  activeScope = scope;
}

export function getActiveScope(): string | null {
  return activeScope;
}

function requireScope(): string {
  if (!activeScope) throw new Error('No active data scope set');
  return activeScope;
}

function inScope<T extends { scope?: string }>(rows: T[]): T[] {
  return rows.filter((r) => r.scope === activeScope);
}
const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  deckSize: 20,
  newCardsWhenQueueSmall: 8,
  queueCap: 30,
  maturityThreshold: 21,
  facerOptionCount: 8,
  cardTypeWeights: {
    name_to_face: 4,
    face_to_name: 4,
  },
  installPromptDismissedAt: null,
  updatedAt: Date.now(),
};

interface ReknownDB extends DBSchema {
  people: {
    key: string;
    value: Person;
    indexes: { 'by-updatedAt': number; 'by-name': string; 'by-categoryId': string };
  };
  categories: {
    key: string;
    value: Category;
    indexes: { 'by-name': string };
  };
  stats: {
    key: string;
    value: AppStats;
  };
  settings: {
    key: string;
    value: Settings;
  };
  reviewEvents: {
    key: number;
    value: ReviewEvent;
    indexes: {
      'by-timestamp': number;
      'by-cardType': string;
      'by-mode': string;
      'by-remoteId': string;
    };
  };
  sessionSummaries: {
    key: string;
    value: SessionSummary;
    indexes: { 'by-timestamp': number };
  };
}

const dbPromise = openDB<ReknownDB>(DB_NAME, DB_VERSION, {
  upgrade(db, oldVersion, _newVersion, tx) {
    if (oldVersion < 1) {
      const people = db.createObjectStore('people', { keyPath: 'id' });
      people.createIndex('by-updatedAt', 'updatedAt');
      people.createIndex('by-name', 'name');

      db.createObjectStore('stats', { keyPath: 'id' });
      db.createObjectStore('settings', { keyPath: 'id' });
    }

    if (oldVersion < 2) {
      const events = db.createObjectStore('reviewEvents', { keyPath: 'id', autoIncrement: true });
      events.createIndex('by-timestamp', 'timestamp');
      events.createIndex('by-cardType', 'cardType');
      events.createIndex('by-mode', 'mode');

      const summaries = db.createObjectStore('sessionSummaries', { keyPath: 'id' });
      summaries.createIndex('by-timestamp', 'timestamp');
    }

    if (oldVersion < 3) {
      // Per-user data scoping was introduced. Legacy rows have no scope and
      // could leak across users on this device, so clear them on upgrade.
      // Use the version-change transaction provided by idb; opening a new
      // transaction here would conflict with the upgrade tx and abort requests.
      void tx.objectStore('people').clear();
      void tx.objectStore('stats').clear();
      void tx.objectStore('reviewEvents').clear();
      void tx.objectStore('sessionSummaries').clear();
    }

    if (oldVersion < 4) {
      // Categories were introduced and Person now requires a categoryId.
      // Existing rows would be orphaned so clear the people store; users
      // will re-import into named categories.
      const categories = db.createObjectStore('categories', { keyPath: 'id' });
      categories.createIndex('by-name', 'name');

      const peopleStore = tx.objectStore('people');
      if (!peopleStore.indexNames.contains('by-categoryId')) {
        peopleStore.createIndex('by-categoryId', 'categoryId');
      }
      void peopleStore.clear();
    }

    if (oldVersion < 5) {
      // Cloud sync needs a stable string id to correlate IDB review events
      // with Firestore docs, alongside the existing numeric autoIncrement key.
      const eventsStore = tx.objectStore('reviewEvents');
      if (!eventsStore.indexNames.contains('by-remoteId')) {
        eventsStore.createIndex('by-remoteId', 'remoteId');
      }
    }
  },
});

function id() {
  return crypto.randomUUID();
}

export async function listPeople(): Promise<Person[]> {
  const db = await dbPromise;
  const all = await db.getAllFromIndex('people', 'by-name');
  return inScope(all);
}

export async function listPeopleByCategory(categoryId: string): Promise<Person[]> {
  const all = await listPeople();
  return all.filter((p) => p.categoryId === categoryId);
}

export async function listCategories(): Promise<Category[]> {
  const db = await dbPromise;
  const all = await db.getAllFromIndex('categories', 'by-name');
  return inScope(all);
}

export async function getCategory(categoryId: string): Promise<Category | undefined> {
  const db = await dbPromise;
  const row = await db.get('categories', categoryId);
  if (!row || row.scope !== activeScope) return undefined;
  return row;
}

export async function createCategory(
  input: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Category> {
  const scope = requireScope();
  const now = Date.now();
  const category: Category = { ...input, id: id(), createdAt: now, updatedAt: now, scope };
  const db = await dbPromise;
  await db.put('categories', category);
  if (canPush()) getSyncHandlers()?.pushCategory(category);
  return category;
}

export async function updateCategory(
  categoryId: string,
  updates: Partial<Omit<Category, 'id' | 'createdAt'>>,
): Promise<Category | null> {
  const db = await dbPromise;
  const current = await db.get('categories', categoryId);
  if (!current || current.scope !== activeScope) return null;
  const next: Category = { ...current, ...updates, updatedAt: Date.now(), scope: current.scope };
  await db.put('categories', next);
  if (canPush()) getSyncHandlers()?.pushCategory(next);
  return next;
}

export async function deleteCategory(categoryId: string): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(['categories', 'people'], 'readwrite');
  const categoryStore = tx.objectStore('categories');
  const peopleStore = tx.objectStore('people');
  const current = await categoryStore.get(categoryId);
  if (!current || current.scope !== activeScope) {
    await tx.done;
    return;
  }
  await categoryStore.delete(categoryId);
  const cascadedPersonIds: string[] = [];
  const allPeople = await peopleStore.getAll();
  for (const person of allPeople) {
    if (person.scope === activeScope && person.categoryId === categoryId) {
      await peopleStore.delete(person.id);
      cascadedPersonIds.push(person.id);
    }
  }
  await tx.done;
  if (canPush()) {
    const handlers = getSyncHandlers();
    handlers?.pushDelete('categories', categoryId);
    for (const personId of cascadedPersonIds) {
      handlers?.pushDelete('people', personId);
    }
  }
}

export async function getPerson(personId: string): Promise<Person | undefined> {
  const db = await dbPromise;
  const row = await db.get('people', personId);
  if (!row || row.scope !== activeScope) return undefined;
  return row;
}

export async function createPerson(input: Omit<Person, 'id' | 'createdAt' | 'updatedAt'>): Promise<Person> {
  const scope = requireScope();
  const now = Date.now();
  const person: Person = { ...input, id: id(), createdAt: now, updatedAt: now, scope };
  const db = await dbPromise;
  await db.put('people', person);
  if (canPush()) getSyncHandlers()?.pushPerson(person);
  return person;
}

export async function updatePerson(personId: string, updates: Partial<Omit<Person, 'id' | 'createdAt'>>): Promise<Person | null> {
  const db = await dbPromise;
  const current = await db.get('people', personId);
  if (!current || current.scope !== activeScope) return null;
  const next: Person = { ...current, ...updates, updatedAt: Date.now(), scope: current.scope };
  await db.put('people', next);
  if (canPush()) getSyncHandlers()?.pushPerson(next);
  return next;
}

export async function deletePerson(personId: string): Promise<void> {
  const db = await dbPromise;
  const current = await db.get('people', personId);
  if (!current || current.scope !== activeScope) return;
  await db.delete('people', personId);
  if (canPush()) getSyncHandlers()?.pushDelete('people', personId);
}

export async function clearScope(scope: string): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(
    ['people', 'categories', 'stats', 'reviewEvents', 'sessionSummaries'],
    'readwrite',
  );
  for (const storeName of ['people', 'categories', 'stats', 'reviewEvents', 'sessionSummaries'] as const) {
    const store = tx.objectStore(storeName);
    const rows = await store.getAll();
    for (const row of rows as Array<{ scope?: string; id: string | number }>) {
      if (row.scope === scope) {
        await store.delete(row.id as never);
      }
    }
  }
  await tx.done;
}

export async function getSettings(): Promise<Settings> {
  const db = await dbPromise;
  const existing = await db.get('settings', 'app');
  if (existing) {
    const merged: Settings = {
      ...DEFAULT_SETTINGS,
      ...existing,
      id: 'app',
      cardTypeWeights: {
        ...DEFAULT_SETTINGS.cardTypeWeights,
        ...existing.cardTypeWeights,
      },
    };

    if (JSON.stringify(merged) !== JSON.stringify(existing)) {
      const now = Date.now();
      const next = { ...merged, updatedAt: now };
      await db.put('settings', next);
      return next;
    }
    return merged;
  }
  await db.put('settings', DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export async function updateSettings(updates: Partial<Omit<Settings, 'id' | 'updatedAt'>>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = { ...current, ...updates, id: 'app', updatedAt: Date.now() };
  const db = await dbPromise;
  await db.put('settings', next);
  if (canPush()) getSyncHandlers()?.pushSettings(next);
  return next;
}

function statsKey(): string {
  return `app:${requireScope()}`;
}

export async function getStats(): Promise<AppStats> {
  const db = await dbPromise;
  const key = statsKey();
  const existing = await db.get('stats', key);
  if (existing) return existing;
  const initial: AppStats = {
    id: key,
    scope: activeScope ?? undefined,
    totalCards: 0,
    dueCards: 0,
    matureCards: 0,
    averageEaseFactor: 2.5,
    totalReviews: 0,
    updatedAt: Date.now(),
  };
  await db.put('stats', initial);
  return initial;
}

export async function updateStats(updates: Partial<Omit<AppStats, 'id' | 'updatedAt'>>): Promise<AppStats> {
  const current = await getStats();
  const next = { ...current, ...updates, id: statsKey(), updatedAt: Date.now() };
  const db = await dbPromise;
  await db.put('stats', next);
  return next;
}

export async function exportJson(): Promise<string> {
  const db = await dbPromise;
  const [people, categories, stats, settings, reviewEvents, sessionSummaries] = await Promise.all([
    db.getAll('people'),
    db.getAll('categories'),
    db.get('stats', 'app'),
    db.get('settings', 'app'),
    db.getAllFromIndex('reviewEvents', 'by-timestamp'),
    db.getAllFromIndex('sessionSummaries', 'by-timestamp'),
  ]);
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    people,
    categories,
    stats,
    settings,
    reviewEvents,
    sessionSummaries,
  }, null, 2);
}

export async function seedPeople(
  records: Array<Omit<Person, 'id' | 'categoryId' | 'createdAt' | 'updatedAt'>>,
  categoryId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Person[]> {
  const created: Person[] = [];
  for (let i = 0; i < records.length; i++) {
    created.push(await createPerson({ ...records[i], categoryId }));
    onProgress?.(i + 1, records.length);
  }
  return created;
}

export function makeReviewCard(person: Person, type: ReviewCard['type']): ReviewCard {
  const now = Date.now();
  const prompt = type === 'face_to_name' ? 'Name this person.' : `Who is ${person.name}?`;
  const answer = type === 'face_to_name' ? person.name : (person.photoDataUrl || person.photoUrl || 'No photo yet');
  return {
    id: `${person.id}:${type}`,
    personId: person.id,
    type,
    prompt,
    answer,
    srs: { interval: 0, repetitions: 0, easeFactor: 2.5, dueAt: now, lastReviewedAt: null },
    createdAt: now,
    updatedAt: now,
  };
}

function emitMetricsUpdatedEvent() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('reknown:metrics-updated'));
  }
}

function summarizeAccuracy(events: Pick<ReviewEvent, 'outcome'>[]): AccuracyMetric {
  const total = events.length;
  const accepted = events.filter((event) => event.outcome === 'accepted').length;
  const accuracy = total ? (accepted / total) * 100 : 0;
  return { total, accepted, accuracy };
}

export async function recordReviewEvent(
  event: Omit<ReviewEvent, 'id'>
): Promise<void> {
  const scope = requireScope();
  const db = await dbPromise;
  // Assign a stable string id up front so the Firestore doc id and the
  // local numeric autoIncrement key can correlate. `remoteId` may already be
  // set when this path is invoked from a remote-applied merge; preserve it.
  const remoteId = event.remoteId ?? id();
  const withIds: Omit<ReviewEvent, 'id'> = { ...event, remoteId, scope };
  const numericId = await db.add('reviewEvents', withIds as ReviewEvent);
  const stored: ReviewEvent = { ...withIds, id: numericId } as ReviewEvent;
  if (canPush()) getSyncHandlers()?.pushReviewEvent(stored);
  emitMetricsUpdatedEvent();
}

export async function recordSessionSummary(
  summary: Omit<SessionSummary, 'id'>
): Promise<SessionSummary> {
  const scope = requireScope();
  const db = await dbPromise;
  const fullSummary: SessionSummary = { ...summary, id: id(), scope };
  await db.add('sessionSummaries', fullSummary);
  if (canPush()) getSyncHandlers()?.pushSessionSummary(fullSummary);
  emitMetricsUpdatedEvent();
  return fullSummary;
}

export interface PersonMetric {
  faceToNameCorrect: number;
  faceToNameIncorrect: number;
  nameToFaceCorrect: number;
  nameToFaceIncorrect: number;
}

export async function getPerPersonMetrics(): Promise<Record<string, PersonMetric>> {
  const db = await dbPromise;
  const events = inScope(await db.getAllFromIndex('reviewEvents', 'by-timestamp'));
  const result: Record<string, PersonMetric> = {};
  for (const event of events) {
    const personId = event.cardId.split(':')[0];
    if (!personId) continue;
    const row = result[personId] ?? {
      faceToNameCorrect: 0,
      faceToNameIncorrect: 0,
      nameToFaceCorrect: 0,
      nameToFaceIncorrect: 0,
    };
    const accepted = event.outcome === 'accepted';
    if (event.cardType === 'face_to_name') {
      if (accepted) row.faceToNameCorrect += 1; else row.faceToNameIncorrect += 1;
    } else {
      if (accepted) row.nameToFaceCorrect += 1; else row.nameToFaceIncorrect += 1;
    }
    result[personId] = row;
  }
  return result;
}

export async function getReviewMetrics(now: number = Date.now()): Promise<ReviewMetrics> {
  const db = await dbPromise;
  const events = inScope(await db.getAllFromIndex('reviewEvents', 'by-timestamp'));
  const sevenDayCutoff = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDayCutoff = now - 30 * 24 * 60 * 60 * 1000;

  return {
    overall: summarizeAccuracy(events),
    faceToName: summarizeAccuracy(events.filter((event) => event.cardType === 'face_to_name')),
    nameToFace: summarizeAccuracy(events.filter((event) => event.cardType === 'name_to_face')),
    trend7d: summarizeAccuracy(events.filter((event) => event.timestamp >= sevenDayCutoff)),
    trend30d: summarizeAccuracy(events.filter((event) => event.timestamp >= thirtyDayCutoff)),
  };
}

// -----------------------------------------------------------------------------
// Sync helpers — called only by src/lib/sync.ts
// -----------------------------------------------------------------------------

/**
 * Scope-aware reads used for reconciliation. These intentionally do not call
 * `requireScope()` because the caller drives scope explicitly.
 */
export async function listPeopleInScope(scope: string): Promise<Person[]> {
  const db = await dbPromise;
  return (await db.getAll('people')).filter((p) => p.scope === scope);
}

export async function listCategoriesInScope(scope: string): Promise<Category[]> {
  const db = await dbPromise;
  return (await db.getAll('categories')).filter((c) => c.scope === scope);
}

export async function listReviewEventsInScope(scope: string): Promise<ReviewEvent[]> {
  const db = await dbPromise;
  return (await db.getAll('reviewEvents')).filter((e) => e.scope === scope);
}

export async function listSessionSummariesInScope(scope: string): Promise<SessionSummary[]> {
  const db = await dbPromise;
  return (await db.getAll('sessionSummaries')).filter((s) => s.scope === scope);
}

/**
 * Write a record arriving from Firestore into IndexedDB without echoing
 * back out as a push. `scope` is always assigned by the caller so remote
 * data lands in the correct per-user bucket.
 */
export async function applyRemotePerson(person: Person): Promise<void> {
  await withApplyingRemote(async () => {
    const db = await dbPromise;
    await db.put('people', person);
  });
}

export async function applyRemoteCategory(category: Category): Promise<void> {
  await withApplyingRemote(async () => {
    const db = await dbPromise;
    await db.put('categories', category);
  });
}

export async function applyRemoteSettings(settings: Settings): Promise<void> {
  await withApplyingRemote(async () => {
    const db = await dbPromise;
    await db.put('settings', settings);
  });
}

export async function applyRemoteSessionSummary(summary: SessionSummary): Promise<void> {
  await withApplyingRemote(async () => {
    const db = await dbPromise;
    await db.put('sessionSummaries', summary);
  });
}

/**
 * Insert or update a review event from Firestore. Correlation is by the
 * Firestore-assigned `remoteId`; if no local row has that id yet, add a new
 * one (IDB will mint a numeric key). Otherwise overwrite in place.
 */
export async function applyRemoteReviewEvent(event: Omit<ReviewEvent, 'id'>): Promise<void> {
  if (!event.remoteId) return;
  await withApplyingRemote(async () => {
    const db = await dbPromise;
    const existing = await db.getFromIndex('reviewEvents', 'by-remoteId', event.remoteId!);
    if (existing) {
      await db.put('reviewEvents', { ...event, id: existing.id } as ReviewEvent);
    } else {
      await db.add('reviewEvents', event as ReviewEvent);
    }
  });
}

export async function applyRemoteDelete(
  kind: 'people' | 'categories' | 'sessionSummaries' | 'reviewEvents',
  id: string,
): Promise<void> {
  await withApplyingRemote(async () => {
    const db = await dbPromise;
    if (kind === 'reviewEvents') {
      const existing = await db.getFromIndex('reviewEvents', 'by-remoteId', id);
      if (existing) await db.delete('reviewEvents', existing.id);
    } else {
      await db.delete(kind, id);
    }
  });
}

/**
 * Direct, scope-explicit getters used by reconciliation to read single
 * records without touching `activeScope`.
 */
export async function getSettingsDirect(): Promise<Settings | undefined> {
  const db = await dbPromise;
  return db.get('settings', 'app');
}

/**
 * Stamp a locally-created review event with a Firestore-assigned id so
 * subsequent pushes and snapshot echoes can correlate it. Does not trigger
 * a push.
 */
export async function setReviewEventRemoteId(numericId: number, remoteId: string): Promise<void> {
  await withApplyingRemote(async () => {
    const db = await dbPromise;
    const row = await db.get('reviewEvents', numericId);
    if (!row) return;
    await db.put('reviewEvents', { ...row, remoteId });
  });
}

/**
 * Rewrite every guest-scoped row to belong to the signed-in user. Used when
 * the user signed in while running as a guest: we keep their work instead of
 * discarding it. Ids stay stable so the ensuing reconciliation can dedupe
 * cleanly against any existing cloud copies.
 */
export async function migrateGuestScope(uid: string): Promise<void> {
  const targetScope = `u:${uid}`;
  const db = await dbPromise;
  const stores = ['people', 'categories', 'reviewEvents', 'sessionSummaries'] as const;
  for (const store of stores) {
    const tx = db.transaction(store, 'readwrite');
    const all = await tx.store.getAll();
    for (const row of all as Array<{ scope?: string; id: string | number }>) {
      if (row.scope === 'guest') {
        await tx.store.put({ ...row, scope: targetScope } as never);
      }
    }
    await tx.done;
  }
}
