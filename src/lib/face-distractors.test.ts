import { describe, expect, it, vi } from 'vitest';
import type { Person } from '../types';
import { selectDistractors } from './face-distractors';

const NOW = Date.UTC(2026, 0, 1);

function makePerson(overrides: Partial<Person> & Pick<Person, 'id' | 'name'>): Person {
  const { id, name, ...rest } = overrides;
  return {
    id,
    name,
    createdAt: NOW,
    updatedAt: NOW,
    ...rest,
  };
}

describe('selectDistractors', () => {
  it('returns only available photo-backed distractors when too few exist', () => {
    const people: Person[] = [
      makePerson({ id: 'target', name: 'Target', photoUrl: 'target.jpg' }),
      makePerson({ id: 'a', name: 'A', photoUrl: 'a.jpg' }),
      makePerson({ id: 'b', name: 'B' }),
    ];

    const result = selectDistractors('target', people, 3, 'similar-first');

    expect(result.map((person) => person.id)).toEqual(['a']);
  });

  it('falls back to random photo-backed distractors when metadata is missing', () => {
    const random = vi.spyOn(Math, 'random');
    random
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0);

    const people: Person[] = [
      makePerson({ id: 'target', name: 'Target', photoUrl: 'target.jpg' }),
      makePerson({ id: 'a', name: 'A', photoUrl: 'a.jpg' }),
      makePerson({ id: 'b', name: 'B', photoUrl: 'b.jpg' }),
      makePerson({ id: 'c', name: 'C', photoUrl: 'c.jpg' }),
    ];

    const result = selectDistractors('target', people, 2, 'similar-first');

    expect(result).toHaveLength(2);
    expect(result.every((person) => person.id !== 'target')).toBe(true);
    expect(new Set(result.map((person) => person.id)).size).toBe(2);

    random.mockRestore();
  });

  it('prioritizes nearest neighbors, then returns partial set when hard mode count is not satisfiable', () => {
    const people: Person[] = [
      makePerson({
        id: 'target',
        name: 'Target',
        photoUrl: 'target.jpg',
        similarity: {
          nearestNeighborIds: ['neighbor-a', 'neighbor-b', 'neighbor-c'],
          clusterIds: ['group-1'],
          normalizedDescriptors: ['smiling', 'glasses'],
        },
      }),
      makePerson({
        id: 'neighbor-a',
        name: 'Neighbor A',
        photoUrl: 'a.jpg',
        similarity: { clusterIds: ['group-1'] },
      }),
      makePerson({
        id: 'neighbor-b',
        name: 'Neighbor B',
        photoUrl: 'b.jpg',
        similarity: { clusterIds: ['group-1'] },
      }),
      makePerson({
        id: 'neighbor-c',
        name: 'Neighbor C',
      }),
    ];

    const result = selectDistractors('target', people, 5, 'similar-first');

    expect(result.map((person) => person.id)).toEqual(['neighbor-a', 'neighbor-b']);
  });
});
