import { openDB, type DBSchema } from 'idb';
import type { AppStats, Person, ReviewCard, Settings } from '../types';

const DB_NAME = 'reknown-db';
const DB_VERSION = 1;
const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  deckSize: 20,
  newCardsWhenQueueSmall: 8,
  queueCap: 30,
  maturityThreshold: 21,
  facerOptionCount: 4,
  facerHardOptionCount: 8,
  hardModeEnabled: false,
  cardTypeWeights: {
    name_to_face: 4,
    face_to_name: 4,
    headline: 2,
    company: 2,
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
}

const dbPromise = openDB<ReknownDB>(DB_NAME, DB_VERSION, {
  upgrade(db) {
    const people = db.createObjectStore('people', { keyPath: 'id' });
    people.createIndex('by-updatedAt', 'updatedAt');
    people.createIndex('by-name', 'name');

    db.createObjectStore('stats', { keyPath: 'id' });
    db.createObjectStore('settings', { keyPath: 'id' });
  },
});

function id() {
  return crypto.randomUUID();
}

export async function listPeople(): Promise<Person[]> {
  const db = await dbPromise;
  return db.getAllFromIndex('people', 'by-name');
}

export async function getPerson(personId: string): Promise<Person | undefined> {
  const db = await dbPromise;
  return db.get('people', personId);
}

export async function createPerson(input: Omit<Person, 'id' | 'createdAt' | 'updatedAt'>): Promise<Person> {
  const now = Date.now();
  const person: Person = { ...input, id: id(), createdAt: now, updatedAt: now };
  const db = await dbPromise;
  await db.put('people', person);
  return person;
}

export async function updatePerson(personId: string, updates: Partial<Omit<Person, 'id' | 'createdAt'>>): Promise<Person | null> {
  const db = await dbPromise;
  const current = await db.get('people', personId);
  if (!current) return null;
  const next: Person = { ...current, ...updates, updatedAt: Date.now() };
  await db.put('people', next);
  return next;
}

export async function deletePerson(personId: string): Promise<void> {
  const db = await dbPromise;
  await db.delete('people', personId);
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

export async function getStats(): Promise<AppStats> {
  const db = await dbPromise;
  const existing = await db.get('stats', 'app');
  if (existing) return existing;
  const initial: AppStats = {
    id: 'app',
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
  const next = { ...current, ...updates, id: 'app' as const, updatedAt: Date.now() };
  const db = await dbPromise;
  await db.put('stats', next);
  return next;
}

export async function exportJson(): Promise<string> {
  const db = await dbPromise;
  const [people, stats, settings] = await Promise.all([
    db.getAll('people'),
    db.get('stats', 'app'),
    db.get('settings', 'app'),
  ]);
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    people,
    stats,
    settings,
  }, null, 2);
}

export async function seedPeople(records: Array<Omit<Person, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Person[]> {
  const created: Person[] = [];
  for (const record of records) {
    created.push(await createPerson(record));
  }
  return created;
}

export function makeReviewCard(person: Person, type: ReviewCard['type']): ReviewCard {
  const now = Date.now();
  const promptByType: Record<ReviewCard['type'], string> = {
    name_to_face: `Who is ${person.name}?`,
    face_to_name: 'Name this person.',
    headline: `What is ${person.name}'s headline?`,
    company: `Where does ${person.name} work?`,
  };
  const answerByType: Record<ReviewCard['type'], string> = {
    name_to_face: person.photoDataUrl || person.photoUrl || 'No photo yet',
    face_to_name: person.name,
    headline: person.headline || 'No headline available',
    company: person.company || 'No company available',
  };
  return {
    id: `${person.id}:${type}`,
    personId: person.id,
    type,
    prompt: promptByType[type],
    answer: answerByType[type],
    srs: { interval: 0, repetitions: 0, easeFactor: 2.5, dueAt: now, lastReviewedAt: null },
    createdAt: now,
    updatedAt: now,
  };
}
