import type { Person } from '../types';
import { createPerson, updatePerson } from './storage';
import type { HistoricalFigureProvider, HistoricalHydrationFailure } from './wikidata';

export interface HistoricalImportResult {
  added: number;
  updated: number;
  failures: HistoricalHydrationFailure[];
}

export async function importHistoricalFigures(
  categoryId: string,
  entityIds: string[],
  existingPeople: Person[],
  provider: HistoricalFigureProvider,
  onProgress?: (done: number, total: number) => void,
  persistence = { createPerson, updatePerson },
): Promise<HistoricalImportResult> {
  const hydration = await provider.hydrate(entityIds);
  const byQid = new Map(existingPeople.flatMap((person) =>
    person.wikidataEntityId ? [[person.wikidataEntityId, person] as const] : []));
  let added = 0;
  let updated = 0;
  onProgress?.(0, hydration.people.length);
  for (let index = 0; index < hydration.people.length; index++) {
    const record = hydration.people[index];
    const existing = byQid.get(record.wikidataEntityId!);
    if (existing) {
      // Only fields owned by Wikidata are refreshed. Notes, nicknames, tags,
      // photo focus, and other user-authored data remain untouched.
      await persistence.updatePerson(existing.id, {
        headline: record.headline,
        photoUrl: record.photoUrl,
      });
      updated++;
    } else {
      await persistence.createPerson({ ...record, categoryId });
      added++;
    }
    onProgress?.(index + 1, hydration.people.length);
  }
  return { added, updated, failures: hydration.failures };
}
