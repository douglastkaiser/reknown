import type { Person } from '../types';

/**
 * Whether a LinkedIn-backed person is missing any data populated by the normal
 * enrichment pass. An empty `companies` array is intentional: it records that
 * the latest enrichment ran but found no additional employers.
 */
export function needsProfileEnrichment(
  person: Pick<Person, 'photoDataUrl' | 'photoUrl' | 'companies'>,
): boolean {
  const missingPhoto = !person.photoDataUrl && !person.photoUrl;
  const missingCompanies = !Array.isArray(person.companies);
  return missingPhoto || missingCompanies;
}
