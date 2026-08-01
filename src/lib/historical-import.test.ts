import { describe, expect, it, vi } from 'vitest';
vi.mock('./storage', () => ({ createPerson: vi.fn(), updatePerson: vi.fn() }));
import type { Person } from '../types';
import { importHistoricalFigures } from './historical-import';
import type { HistoricalFigureProvider } from './wikidata';

const existing: Person = {
  id: 'person-1', categoryId: 'category-1', name: 'User name', wikidataEntityId: 'Q1',
  headline: 'Old source text', photoUrl: 'old.jpg', notes: 'My note', nicknames: ['Ace'],
  tags: ['favorite'], photoFocus: { x: 0.2, y: 0.7, zoom: 2 }, createdAt: 1, updatedAt: 1,
};
const provider: HistoricalFigureProvider = { hydrate: async () => ({ people: [{
  name: 'Canonical Name', wikidataEntityId: 'Q1', headline: 'New source text', photoUrl: 'new.jpg',
}], failures: [] }) };

describe('historical refresh', () => {
  it('is idempotent by QID and preserves user-authored fields', async () => {
    const createPerson = vi.fn();
    const updatePerson = vi.fn();
    const result = await importHistoricalFigures('category-1', ['Q1'], [existing], provider, undefined, {
      createPerson: createPerson as never, updatePerson: updatePerson as never,
    });
    expect(result).toMatchObject({ added: 0, updated: 1 });
    expect(createPerson).not.toHaveBeenCalled();
    expect(updatePerson).toHaveBeenCalledWith('person-1', {
      headline: 'New source text', photoUrl: 'new.jpg',
    });
    for (const field of ['notes', 'nicknames', 'tags', 'photoFocus']) {
      expect(updatePerson.mock.calls[0][1]).not.toHaveProperty(field);
    }
  });
});
