import { describe, expect, it, vi } from 'vitest';
import { normalizeWikidataEntity, uniqueQids, WikidataHistoricalFigureProvider } from './wikidata';

describe('Wikidata hydration', () => {
  it('deduplicates and validates stable QIDs', () => {
    expect(uniqueQids([' Q42 ', 'Q1', 'Q42', 'Ada', 'Q0'])).toEqual(['Q42', 'Q1']);
  });
  it('normalizes entities when optional fields are missing', () => {
    expect(normalizeWikidataEntity('Q42', { labels: { en: { value: 'Douglas Adams' } } })).toEqual({
      name: 'Douglas Adams', wikidataEntityId: 'Q42', headline: undefined, photoUrl: undefined,
    });
    expect(normalizeWikidataEntity('Q1', { descriptions: { en: { value: 'missing label' } } })).toBeNull();
  });
  it('returns successful batches alongside partial batch failures', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ entities: { Q1: { labels: { en: { value: 'One' } }, claims: {} } } }) })
      .mockResolvedValueOnce({ ok: false, status: 429 });
    const result = await new WikidataHistoricalFigureProvider(fetcher as unknown as typeof fetch, 1).hydrate(['Q1', 'Q2']);
    expect(result.people.map((person) => person.wikidataEntityId)).toEqual(['Q1']);
    expect(result.failures).toEqual([{ entityIds: ['Q2'], message: 'Wikidata request failed (429)' }]);
  });
});
