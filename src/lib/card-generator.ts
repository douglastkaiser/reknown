import type { Person, ReviewCard, Settings } from '../types';
import { makeReviewCard } from './storage';
import { selectDistractors } from './face-distractors';

function hasPhoto(person: Person): boolean {
  return Boolean(person.photoDataUrl || person.photoUrl);
}

function getPhotoUrl(person: Person): string {
  return person.photoDataUrl || person.photoUrl || '';
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function generateCardsForPeople(people: Person[], settings: Settings, count = settings.deckSize): ReviewCard[] {
  const cards: ReviewCard[] = [];
  const peopleWithPhotos = people.filter(hasPhoto);

  for (const person of people) {
    if (!hasPhoto(person)) continue;

    const canDoNameToFace = peopleWithPhotos.length >= 3;
    const faceWeight = settings.cardTypeWeights.face_to_name;
    const nameWeight = canDoNameToFace ? settings.cardTypeWeights.name_to_face : 0;
    const total = faceWeight + nameWeight;
    const type = Math.random() * total < faceWeight ? 'face_to_name' : 'name_to_face';
    cards.push(makeReviewCard(person, type));
  }

  return shuffle(cards).slice(0, count);
}

export function withFaceOptions(cards: ReviewCard[], people: Person[], settings: Settings): ReviewCard[] {
  const optionCount = settings.facerOptionCount;
  if (optionCount < 2) return cards;

  return cards.map((card) => {
    if (card.type !== 'name_to_face') return card;

    const correctPerson = people.find((p) => p.id === card.personId);
    if (!correctPerson) return card;

    const distractorPeople = selectDistractors(card.personId, people, Math.max(0, optionCount - 1), 'similar-first');
    const correctUrl = getPhotoUrl(correctPerson);
    const allOptions = [
      { url: correctUrl, personId: correctPerson.id },
      ...distractorPeople.map((p) => ({ url: getPhotoUrl(p), personId: p.id })),
    ];
    const shuffled = shuffle(allOptions);
    const correctIndex = shuffled.findIndex((opt) => opt.personId === correctPerson.id);

    return {
      ...card,
      options: shuffled.map((opt) => opt.url),
      correctOptionIndex: correctIndex,
    };
  });
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

  return shuffle(queue).slice(0, queueCap);
}
