export type WebTeamProvider = 'vast';
export type WebTeamDiscoverySource = 'yc_directory';

/**
 * Normalized team-member shape consumed by importer UI and storage helpers.
 * Compatible with `seedPeople` / `createPerson` once `link` is mapped to
 * `linkedinUrl` (or another Person link field) by the caller.
 */
export interface WebTeamPersonRecord {
  name: string;
  headline?: string;
  company?: string;
  location?: string;
  region?: string;
  photoUrl?: string;
  link?: string;
}

export interface ImportWebTeamPageInput {
  provider?: WebTeamProvider | string;
  url: string;
}

/**
 * Candidate discovered from external company directories (e.g. YC).
 * These URLs are untrusted until validated against a web-team provider.
 */
export interface DiscoveredWebTeamCandidate {
  source: WebTeamDiscoverySource;
  companyName: string;
  companyUrl: string;
  externalId?: string;
}

export interface PreparedWebTeamSectionInput {
  name: string;
  provider: WebTeamProvider;
  url: string;
  source: WebTeamDiscoverySource;
}

export interface RejectedWebTeamCandidate {
  candidate: DiscoveredWebTeamCandidate;
  reason: string;
}

export interface PrepareWebTeamSectionImportsResult {
  accepted: PreparedWebTeamSectionInput[];
  rejected: RejectedWebTeamCandidate[];
}
