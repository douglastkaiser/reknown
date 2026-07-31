import type { Person } from '../types';

/** Stable, user-facing region vocabulary. Add new labels here deliberately. */
export const SUPPORTED_REGIONS = ['SoCal'] as const;
export type SupportedRegion = (typeof SUPPORTED_REGIONS)[number];

const SOCAL_PLACES = [
  /\blos angeles\b/i,
  /\blong beach\b/i,
  /\bhawthorne\b/i,
  /\birvine\b/i,
  /\borange county\b/i,
];

export function normalizeRegion(value: unknown): SupportedRegion | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  return key === 'socal' || key === 'southerncalifornia' ? 'SoCal' : undefined;
}

/** Deliberately avoids broad guesses such as "California" or "LA". */
export function guessRegionFromLocation(location: unknown): SupportedRegion | undefined {
  if (typeof location !== 'string' || !location.trim()) return undefined;
  return SOCAL_PLACES.some((place) => place.test(location)) ? 'SoCal' : undefined;
}

/** Headquarters fallback only; an explicit region/location always wins. */
export function inferPersonRegion(
  person: Pick<Person, 'region' | 'location' | 'company'>,
): SupportedRegion | undefined {
  const explicit = normalizeRegion(person.region);
  if (explicit) return explicit;
  if (person.location?.trim()) return guessRegionFromLocation(person.location);
  const company = person.company?.trim().toLowerCase();
  return company === 'vast' || company === 'spacex' ? 'SoCal' : undefined;
}

export function personHasRegion(
  person: Pick<Person, 'region' | 'location' | 'company'>,
  region: string,
): boolean {
  const target = normalizeRegion(region);
  return Boolean(target && inferPersonRegion(person)?.toLowerCase() === target.toLowerCase());
}

export interface RegionOption { name: SupportedRegion; count: number }

export function collectRegionOptions(people: Person[]): RegionOption[] {
  return SUPPORTED_REGIONS.map((name) => ({
    name,
    count: people.filter((person) => personHasRegion(person, name)).length,
  })).filter((option) => option.count > 0);
}
