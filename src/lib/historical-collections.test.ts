import { describe, expect, it } from 'vitest';
import { searchHistoricalCollections } from './historical-collections';

describe('historical collection catalog', () => {
  it('searches names, descriptions, and normalized tags', () => {
    expect(searchHistoricalCollections('stoic').map((item) => item.id)).toContain('major-stoics');
    expect(searchHistoricalCollections('enduring novels').map((item) => item.id)).toContain('major-american-novelists');
    expect(searchHistoricalCollections('region:france').map((item) => item.id)).toEqual(['napoleons-marshals']);
  });
  it('applies tag filters using AND semantics', () => {
    expect(searchHistoricalCollections('', ['domain:literature', 'region:united-states']).map((item) => item.id))
      .toEqual(['major-american-novelists', 'harlem-renaissance']);
    expect(searchHistoricalCollections('', ['domain:science', 'movement:feminism'])).toEqual([]);
  });
});
