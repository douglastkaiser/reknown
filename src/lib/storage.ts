import { openDB, type DBSchema } from 'idb';
import type {
  AccuracyMetric,
  AppStats,
  Person,
  ReviewCard,
  ReviewEvent,
  ReviewMetrics,
  SessionSummary,
  Settings,
} from '../types';

const DB_NAME = 'reknown-db';
const DB_VERSION = 3;

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
  facerOptionCount: 4,
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
    indexes: { 'by-updatedAt': number; 'by-name': string };
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
    indexes: { 'by-timestamp': number; 'by-cardType': string; 'by-mode': string };
  };
  sessionSummaries: {
    key: string;
    value: SessionSummary;
    indexes: { 'by-timestamp': number };
  };
}

const dbPromise = openDB<ReknownDB>(DB_NAME, DB_VERSION, {
  upgrade(db, oldVersion) {
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
      const tx = db.transaction(['people', 'stats', 'reviewEvents', 'sessionSummaries'], 'readwrite');
      void tx.objectStore('people').clear();
      void tx.objectStore('stats').clear();
      void tx.objectStore('reviewEvents').clear();
      void tx.objectStore('sessionSummaries').clear();
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
  return person;
}

export async function updatePerson(personId: string, updates: Partial<Omit<Person, 'id' | 'createdAt'>>): Promise<Person | null> {
  const db = await dbPromise;
  const current = await db.get('people', personId);
  if (!current || current.scope !== activeScope) return null;
  const next: Person = { ...current, ...updates, updatedAt: Date.now(), scope: current.scope };
  await db.put('people', next);
  return next;
}

export async function deletePerson(personId: string): Promise<void> {
  const db = await dbPromise;
  const current = await db.get('people', personId);
  if (!current || current.scope !== activeScope) return;
  await db.delete('people', personId);
}

export async function clearScope(scope: string): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(['people', 'stats', 'reviewEvents', 'sessionSummaries'], 'readwrite');
  for (const storeName of ['people', 'stats', 'reviewEvents', 'sessionSummaries'] as const) {
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
  const [people, stats, settings, reviewEvents, sessionSummaries] = await Promise.all([
    db.getAll('people'),
    db.get('stats', 'app'),
    db.get('settings', 'app'),
    db.getAllFromIndex('reviewEvents', 'by-timestamp'),
    db.getAllFromIndex('sessionSummaries', 'by-timestamp'),
  ]);
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    people,
    stats,
    settings,
    reviewEvents,
    sessionSummaries,
  }, null, 2);
}

export async function seedPeople(
  records: Array<Omit<Person, 'id' | 'createdAt' | 'updatedAt'>>,
  onProgress?: (done: number, total: number) => void,
): Promise<Person[]> {
  const created: Person[] = [];
  for (let i = 0; i < records.length; i++) {
    created.push(await createPerson(records[i]));
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
  await db.add('reviewEvents', { ...event, scope } as ReviewEvent);
  emitMetricsUpdatedEvent();
}

export async function recordSessionSummary(
  summary: Omit<SessionSummary, 'id'>
): Promise<SessionSummary> {
  const scope = requireScope();
  const db = await dbPromise;
  const fullSummary: SessionSummary = { ...summary, id: id(), scope };
  await db.add('sessionSummaries', fullSummary);
  emitMetricsUpdatedEvent();
  return fullSummary;
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
