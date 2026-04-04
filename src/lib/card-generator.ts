import type { Person, ReviewCard, Settings } from '../types';
import { makeReviewCard } from './storage';

function weightedPick<T extends string>(weights: Record<T, number>, excludes: Set<T>): T {
  const allowed = (Object.keys(weights) as T[]).filter((key) => !excludes.has(key));
  const total = allowed.reduce((acc, key) => acc + Math.max(0, weights[key]), 0);
  const target = Math.random() * Math.max(total, 1);
  let running = 0;
  for (const key of allowed) {
    running += Math.max(0, weights[key]);
    if (running >= target) return key;
  }
  return allowed[0];
}

export function generateCardsForPeople(people: Person[], settings: Settings, count = settings.deckSize): ReviewCard[] {
  const cards: ReviewCard[] = [];
  const types = Object.keys(settings.cardTypeWeights) as ReviewCard['type'][];

  for (const person of people) {
    const maturityMultiplier = person.updatedAt < Date.now() - settings.maturityThreshold * 24 * 60 * 60 * 1000 ? 0.85 : 1.15;
    const weights = Object.fromEntries(
      types.map((type) => [type, settings.cardTypeWeights[type] * maturityMultiplier])
    ) as Settings['cardTypeWeights'];

    const excludes = new Set<ReviewCard['type']>();
    if (!person.photoDataUrl && !person.photoUrl) {
      excludes.add('face_to_name');
      excludes.add('name_to_face');
    }
    if (!person.headline) excludes.add('headline');
    if (!person.company) excludes.add('company');

    const type = weightedPick(weights, excludes);
    cards.push(makeReviewCard(person, type));
  }

  return cards.slice(0, count);
}

export function buildReviewQueue(params: {
  existing: ReviewCard[];
  generatedNew: ReviewCard[];
  now?: number;
  queueCap: number;
  minQueueSize: number;
}): ReviewCard[] {
  const { existing, generatedNew, queueCap, minQueueSize, now = Date.now() } = params;
  const due = existing.filter((card) => card.srs.dueAt <= now);
  const overdueSorted = [...due].sort((a, b) => a.srs.dueAt - b.srs.dueAt);
  const queue = overdueSorted.length < minQueueSize
    ? [...overdueSorted, ...generatedNew.slice(0, minQueueSize - overdueSorted.length)]
    : overdueSorted;

  for (let i = queue.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }

  return queue.slice(0, queueCap);
}
