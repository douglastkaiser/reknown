import { describe, expect, it, vi } from 'vitest';
import type { Person, ReviewCard, Settings } from '../types';

vi.mock('./storage', () => ({
  makeReviewCard: (person: Person, type: ReviewCard['type']): ReviewCard => ({
    id: `${person.id}:${type}`,
    personId: person.id,
    type,
    prompt: '',
    answer: '',
    srs: { interval: 0, repetitions: 0, easeFactor: 2.5, dueAt: 0, lastReviewedAt: null },
    createdAt: 0,
    updatedAt: 0,
  }),
}));

import { buildReviewQueue, withFaceOptions } from './card-generator';

function person(index: number): Person {
  return {
    id: `person-${index}`,
    name: `Person ${index}`,
    categoryId: 'category',
    photoUrl: `photo-${index}.jpg`,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('withFaceOptions', () => {
  it('uses the corrected faceOptionCount setting', () => {
    const people = Array.from({ length: 10 }, (_, index) => person(index));
    const card: ReviewCard = {
      id: 'person-0:name_to_face',
      personId: 'person-0',
      type: 'name_to_face',
      prompt: '',
      answer: '',
      srs: { interval: 0, repetitions: 0, easeFactor: 2.5, dueAt: 0, lastReviewedAt: null },
      createdAt: 0,
      updatedAt: 0,
    };
    const settings = {
      faceOptionCount: 10,
    } as Settings;

    const [result] = withFaceOptions([card], people, settings);

    expect(result.options).toHaveLength(10);
    expect(result.options?.[result.correctOptionIndex!]).toBe('photo-0.jpg');
  });
});

function reviewCard(id: string, dueAt = 0): ReviewCard {
  return {
    id,
    personId: `person-${id}`,
    type: 'face_to_name',
    prompt: '',
    answer: '',
    srs: { interval: 0, repetitions: 0, easeFactor: 2.5, dueAt, lastReviewedAt: null },
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('buildReviewQueue', () => {
  it('does not duplicate cards when existing and generated cards overlap completely', () => {
    const existing = [reviewCard('card-1', 1), reviewCard('card-2', 2)];
    const generatedNew = [reviewCard('card-1'), reviewCard('card-2')];

    const result = buildReviewQueue({
      existing,
      generatedNew,
      now: 10,
      minQueueSize: 4,
      queueCap: 4,
    });

    expect(result).toHaveLength(2);
    expect(new Set(result.map((card) => card.id)).size).toBe(result.length);
  });

  it('skips overlapping cards and uses non-overlapping new cards to fill the queue', () => {
    const existing = [reviewCard('card-1', 2), reviewCard('card-2', 1)];
    const generatedNew = [
      reviewCard('card-1'),
      reviewCard('card-3'),
      reviewCard('card-2'),
      reviewCard('card-4'),
    ];

    const result = buildReviewQueue({
      existing,
      generatedNew,
      now: 10,
      minQueueSize: 4,
      queueCap: 4,
    });
    const resultIds = result.map((card) => card.id);

    expect(result).toHaveLength(4);
    expect(new Set(resultIds).size).toBe(result.length);
    expect(resultIds).toEqual(expect.arrayContaining(['card-3', 'card-4']));
  });
});
