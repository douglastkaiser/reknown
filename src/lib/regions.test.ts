import { describe, expect, it } from 'vitest';
import type { Person } from '../types';
import { collectRegionOptions, guessRegionFromLocation, inferPersonRegion, normalizeRegion, personHasRegion } from './regions';
import { personHasCompany } from './companies';

const person = (id: string, values: Partial<Person>): Person => ({ id, name: id, categoryId: 'c', createdAt: 0, updatedAt: 0, ...values });

describe('regions', () => {
  it('normalizes supported labels and maps known SoCal places', () => {
    expect(normalizeRegion(' southern california ')).toBe('SoCal');
    for (const place of ['Los Angeles', 'Long Beach, CA', 'Hawthorne', 'Irvine', 'Orange County']) {
      expect(guessRegionFromLocation(place)).toBe('SoCal');
    }
  });

  it('prefers a manual location over company headquarters inference', () => {
    expect(inferPersonRegion({ company: 'Vast', location: 'Boston, MA' })).toBeUndefined();
    expect(inferPersonRegion({ company: 'Vast', location: 'Irvine', region: 'socal' })).toBe('SoCal');
  });

  it('leaves uncertain locations unset', () => {
    expect(guessRegionFromLocation('California')).toBeUndefined();
    expect(guessRegionFromLocation('LA')).toBeUndefined();
  });

  it('uses intended Vast and SpaceX headquarters fallbacks without history inference', () => {
    expect(inferPersonRegion({ company: 'Vast' })).toBe('SoCal');
    expect(inferPersonRegion({ company: 'SpaceX' })).toBe('SoCal');
    expect(inferPersonRegion({ company: 'Other', region: 'SoCal' })).toBe('SoCal');
  });

  it('separates current-region results from company-history results', () => {
    const people = [
      person('current-vast', { company: 'Vast' }),
      person('current-spacex', { company: 'SpaceX' }),
      person('former-vast', { company: 'Boston Co', companies: ['Vast'], location: 'Boston, MA' }),
      person('unrelated-socal', { company: 'Other', location: 'Irvine' }),
    ];
    expect(people.filter((p) => personHasRegion(p, 'socal')).map((p) => p.id)).toEqual(['current-vast', 'current-spacex', 'unrelated-socal']);
    expect(people.filter((p) => personHasCompany(p, 'vast')).map((p) => p.id)).toEqual(['current-vast', 'former-vast']);
    expect(collectRegionOptions(people)).toEqual([{ name: 'SoCal', count: 3 }]);
  });
});
