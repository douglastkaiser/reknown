export interface HistoricalCollection {
  id: string;
  name: string;
  description: string;
  tags: string[];
  wikidataEntityIds: string[];
}

/**
 * Membership is deliberately editorial: words such as "major" cannot be
 * represented by a reliable, bounded knowledge-graph query.
 */
export const HISTORICAL_COLLECTIONS: HistoricalCollection[] = [
  {
    id: 'napoleons-marshals', name: "Napoleon’s Marshals",
    description: 'Selected commanders who held the rank Marshal of the Empire under Napoleon.',
    tags: ['era:19th-century', 'domain:military', 'region:france'],
    wikidataEntityIds: ['Q4515', 'Q203042', 'Q312682', 'Q310294', 'Q314790', 'Q159739'],
  },
  {
    id: 'major-stoics', name: 'Major Figures of Stoicism',
    description: 'Influential ancient thinkers in the Stoic philosophical tradition.',
    tags: ['era:ancient', 'domain:philosophy', 'movement:stoicism'],
    wikidataEntityIds: ['Q9448', 'Q1423', 'Q1430', 'Q2001', 'Q177894'],
  },
  {
    id: 'major-feminists', name: 'Major Figures of Feminism',
    description: 'Writers and organizers influential in major feminist movements.',
    tags: ['era:19th-century', 'era:20th-century', 'domain:activism', 'movement:feminism'],
    wikidataEntityIds: ['Q101638', 'Q150629', 'Q188146', 'Q132662', 'Q171224'],
  },
  {
    id: 'major-american-novelists', name: 'Authors of Major American Novels',
    description: 'Authors of enduring novels in the American literary canon.',
    tags: ['era:19th-century', 'era:20th-century', 'domain:literature', 'region:united-states'],
    wikidataEntityIds: ['Q846', 'Q7245', 'Q35610', 'Q117012', 'Q36107', 'Q662596'],
  },
  {
    id: 'harlem-renaissance', name: 'Harlem Renaissance Writers',
    description: 'Selected writers associated with the Harlem Renaissance.',
    tags: ['era:20th-century', 'domain:literature', 'movement:harlem-renaissance', 'region:united-states'],
    wikidataEntityIds: ['Q189514', 'Q184139', 'Q310713', 'Q465365'],
  },
  {
    id: 'scientific-revolution', name: 'Scientific Revolution',
    description: 'Thinkers central to the development of early modern science.',
    tags: ['era:early-modern', 'domain:science', 'region:europe'],
    wikidataEntityIds: ['Q619', 'Q307', 'Q935', 'Q76705', 'Q7850'],
  },
  {
    id: 'us-civil-rights', name: 'U.S. Civil Rights Movement',
    description: 'Selected leaders and organizers of the modern U.S. civil rights movement.',
    tags: ['era:20th-century', 'domain:activism', 'movement:civil-rights', 'region:united-states'],
    wikidataEntityIds: ['Q8027', 'Q1001', 'Q7327', 'Q3105215', 'Q316487'],
  },
];

export function historicalCollectionTags(): string[] {
  return [...new Set(HISTORICAL_COLLECTIONS.flatMap((collection) => collection.tags))].sort();
}

export function searchHistoricalCollections(query = '', selectedTags: string[] = []): HistoricalCollection[] {
  const needle = query.trim().toLocaleLowerCase();
  return HISTORICAL_COLLECTIONS.filter((collection) => {
    const searchable = [collection.name, collection.description, ...collection.tags]
      .join(' ').toLocaleLowerCase();
    return (!needle || searchable.includes(needle))
      && selectedTags.every((tag) => collection.tags.includes(tag));
  });
}

export function getHistoricalCollection(id: string): HistoricalCollection | undefined {
  return HISTORICAL_COLLECTIONS.find((collection) => collection.id === id);
}
