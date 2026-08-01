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

import { withFaceOptions } from './card-generator';

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
