export type WebTeamProvider = 'vast';

/**
 * Normalized team-member shape consumed by importer UI and storage helpers.
 * Compatible with `seedPeople` / `createPerson` once `link` is mapped to
 * `linkedinUrl` (or another Person link field) by the caller.
 */
export interface WebTeamPersonRecord {
  name: string;
  headline?: string;
  company?: string;
  photoUrl?: string;
  link?: string;
}

export interface ImportWebTeamPageInput {
  provider?: WebTeamProvider | string;
  url: string;
}
