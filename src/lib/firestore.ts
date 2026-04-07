import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  addDoc,
  query,
  orderBy,
} from 'firebase/firestore';
import { db } from './firebase';
import type {
  Person,
  ReviewEvent,
  SessionSummary,
  Settings,
  AppStats,
  ReviewMetrics,
  AccuracyMetric,
} from '../types';

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

function userCol(uid: string, col: string) {
  return collection(db, 'users', uid, col);
}

function userDoc(uid: string, col: string, docId: string) {
  return doc(db, 'users', uid, col, docId);
}

// --- People ---

export async function fsListPeople(uid: string): Promise<Person[]> {
  const snap = await getDocs(query(userCol(uid, 'people'), orderBy('name')));
  return snap.docs.map((d) => d.data() as Person);
}

export async function fsGetPerson(uid: string, personId: string): Promise<Person | undefined> {
  const snap = await getDoc(userDoc(uid, 'people', personId));
  return snap.exists() ? (snap.data() as Person) : undefined;
}

export async function fsCreatePerson(uid: string, input: Omit<Person, 'id' | 'createdAt' | 'updatedAt'>): Promise<Person> {
  const now = Date.now();
  const person: Person = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
  await setDoc(userDoc(uid, 'people', person.id), person);
  return person;
}

export async function fsDeletePerson(uid: string, personId: string): Promise<void> {
  await deleteDoc(userDoc(uid, 'people', personId));
}

export async function fsSeedPeople(uid: string, records: Array<Omit<Person, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Person[]> {
  const created: Person[] = [];
  for (const record of records) {
    created.push(await fsCreatePerson(uid, record));
  }
  return created;
}

// --- Settings ---

export async function fsGetSettings(uid: string): Promise<Settings> {
  const snap = await getDoc(userDoc(uid, 'settings', 'app'));
  if (snap.exists()) {
    return { ...DEFAULT_SETTINGS, ...(snap.data() as Settings), id: 'app' };
  }
  await setDoc(userDoc(uid, 'settings', 'app'), DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export async function fsUpdateSettings(uid: string, updates: Partial<Omit<Settings, 'id' | 'updatedAt'>>): Promise<Settings> {
  const current = await fsGetSettings(uid);
  const next: Settings = { ...current, ...updates, id: 'app', updatedAt: Date.now() };
  await setDoc(userDoc(uid, 'settings', 'app'), next);
  return next;
}

// --- Stats ---

export async function fsGetStats(uid: string): Promise<AppStats> {
  const snap = await getDoc(userDoc(uid, 'stats', 'app'));
  if (snap.exists()) return snap.data() as AppStats;
  const initial: AppStats = {
    id: 'app',
    totalCards: 0,
    dueCards: 0,
    matureCards: 0,
    averageEaseFactor: 2.5,
    totalReviews: 0,
    updatedAt: Date.now(),
  };
  await setDoc(userDoc(uid, 'stats', 'app'), initial);
  return initial;
}

export async function fsUpdateStats(uid: string, updates: Partial<Omit<AppStats, 'id' | 'updatedAt'>>): Promise<AppStats> {
  const current = await fsGetStats(uid);
  const next = { ...current, ...updates, id: 'app' as const, updatedAt: Date.now() };
  await setDoc(userDoc(uid, 'stats', 'app'), next);
  return next;
}

// --- Review Events ---

function summarizeAccuracy(events: Pick<ReviewEvent, 'outcome'>[]): AccuracyMetric {
  const total = events.length;
  const accepted = events.filter((e) => e.outcome === 'accepted').length;
  return { total, accepted, accuracy: total ? (accepted / total) * 100 : 0 };
}

export async function fsRecordReviewEvent(uid: string, event: Omit<ReviewEvent, 'id'>): Promise<void> {
  await addDoc(userCol(uid, 'reviewEvents'), event);
}

export async function fsRecordSessionSummary(uid: string, summary: Omit<SessionSummary, 'id'>): Promise<SessionSummary> {
  const full: SessionSummary = { ...summary, id: crypto.randomUUID() };
  await setDoc(userDoc(uid, 'sessions', full.id), full);
  return full;
}

export async function fsGetReviewMetrics(uid: string, now: number = Date.now()): Promise<ReviewMetrics> {
  const snap = await getDocs(query(userCol(uid, 'reviewEvents'), orderBy('timestamp')));
  const events = snap.docs.map((d) => d.data() as ReviewEvent);
  const sevenDayCutoff = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDayCutoff = now - 30 * 24 * 60 * 60 * 1000;

  return {
    overall: summarizeAccuracy(events),
    faceToName: summarizeAccuracy(events.filter((e) => e.cardType === 'face_to_name')),
    nameToFace: summarizeAccuracy(events.filter((e) => e.cardType === 'name_to_face')),
    trend7d: summarizeAccuracy(events.filter((e) => e.timestamp >= sevenDayCutoff)),
    trend30d: summarizeAccuracy(events.filter((e) => e.timestamp >= thirtyDayCutoff)),
  };
}
