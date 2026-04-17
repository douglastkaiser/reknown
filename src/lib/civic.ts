import type { Person } from '../types';

const CIVIC_API_BASE = 'https://www.googleapis.com/civicinfo/v2/representatives';

interface CivicOfficial {
  name: string;
  party?: string;
  photoUrl?: string;
}

interface CivicOffice {
  name: string;
  divisionId?: string;
  officialIndices?: number[];
}

interface CivicRepresentativesResponse {
  offices?: CivicOffice[];
  officials?: CivicOfficial[];
}

export interface CivicRepresentativeRecord {
  sourceId: string;
  name: string;
  office: string;
  divisionId?: string;
  party?: string;
  photoUrl?: string;
}

export async function fetchRepresentatives(
  addressOrZip: string,
  apiKey?: string,
): Promise<CivicRepresentativeRecord[]> {
  const query = addressOrZip.trim();
  if (!query) return [];

  const params = new URLSearchParams({ address: query });
  if (apiKey?.trim()) {
    params.set('key', apiKey.trim());
  }

  const res = await fetch(`${CIVIC_API_BASE}?${params.toString()}`);
  if (!res.ok) {
    const message = await res.text();
    throw new Error(
      `Google Civic API error: ${res.status} ${res.statusText}${message ? ` — ${message}` : ''}`,
    );
  }

  const data = (await res.json()) as CivicRepresentativesResponse;
  const offices = data.offices ?? [];
  const officials = data.officials ?? [];

  const rows: CivicRepresentativeRecord[] = [];

  for (const office of offices) {
    const indices = office.officialIndices ?? [];
    for (const index of indices) {
      const official = officials[index];
      if (!official) continue;
      rows.push({
        sourceId: `${office.name}::${official.name}`,
        name: official.name,
        office: office.name,
        divisionId: office.divisionId,
        party: official.party,
        photoUrl: official.photoUrl,
      });
    }
  }

  return rows;
}

export function civicToPersonRecords(
  reps: CivicRepresentativeRecord[],
): Array<Omit<Person, 'id' | 'categoryId' | 'createdAt' | 'updatedAt'>> {
  return reps.map((rep) => ({
    name: rep.name,
    headline: rep.party ? `${rep.office} · ${rep.party}` : rep.office,
    company: 'Public Office',
    photoUrl: rep.photoUrl,
    civicSourceId: rep.sourceId,
    civicOffice: rep.office,
    civicDivisionId: rep.divisionId,
  }));
}
