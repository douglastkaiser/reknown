import { describe, expect, it } from 'vitest';
import type { Person } from '../types';
import {
  collectCompanyOptions,
  parseCompanies,
  partitionCompanyOptions,
  personCompanies,
  personHasCompany,
} from './companies';

function makePerson(overrides: Partial<Person>): Person {
  return {
    id: overrides.id ?? 'p',
    name: overrides.name ?? 'Test Person',
    categoryId: overrides.categoryId ?? 'c',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('personCompanies', () => {
  it('unions the primary company and the companies list, primary first', () => {
    const person = makePerson({ company: 'Acme', companies: ['Globex', 'Initech'] });
    expect(personCompanies(person)).toEqual(['Acme', 'Globex', 'Initech']);
  });

  it('dedupes case-insensitively while keeping the first-seen casing', () => {
    const person = makePerson({ company: 'Acme', companies: ['acme', 'Globex', 'GLOBEX'] });
    expect(personCompanies(person)).toEqual(['Acme', 'Globex']);
  });

  it('ignores blank and whitespace-only entries', () => {
    const person = makePerson({ company: '  ', companies: ['', '  Globex  '] });
    expect(personCompanies(person)).toEqual(['Globex']);
  });
});

describe('personHasCompany', () => {
  it('matches case-insensitively across the full company set', () => {
    const person = makePerson({ company: 'Acme', companies: ['Globex'] });
    expect(personHasCompany(person, 'globex')).toBe(true);
    expect(personHasCompany(person, 'ACME')).toBe(true);
    expect(personHasCompany(person, 'Initech')).toBe(false);
  });
});

describe('collectCompanyOptions', () => {
  it('counts each person once per company and surfaces overlap', () => {
    const people = [
      makePerson({ id: '1', company: 'Acme', companies: ['Globex'] }),
      makePerson({ id: '2', company: 'Acme' }),
      makePerson({ id: '3', company: 'Globex' }),
    ];
    const options = collectCompanyOptions(people);
    // Acme: persons 1,2 -> 2; Globex: persons 1,3 -> 2. Person 1 overlaps both.
    expect(options).toEqual([
      { name: 'Acme', count: 2 },
      { name: 'Globex', count: 2 },
    ]);
  });

  it('sorts by descending count then alphabetically', () => {
    const people = [
      makePerson({ id: '1', company: 'Big' }),
      makePerson({ id: '2', company: 'Big' }),
      makePerson({ id: '3', company: 'Zeta' }),
      makePerson({ id: '4', company: 'Alpha' }),
    ];
    expect(collectCompanyOptions(people).map((o) => o.name)).toEqual(['Big', 'Alpha', 'Zeta']);
  });
});

describe('partitionCompanyOptions', () => {
  it('splits shared (2+) companies from single-person ones, preserving order', () => {
    const options = [
      { name: 'Acme', count: 4 },
      { name: 'Globex', count: 2 },
      { name: 'Initech', count: 1 },
      { name: 'Umbrella', count: 1 },
    ];
    expect(partitionCompanyOptions(options)).toEqual({
      shared: [
        { name: 'Acme', count: 4 },
        { name: 'Globex', count: 2 },
      ],
      rare: [
        { name: 'Initech', count: 1 },
        { name: 'Umbrella', count: 1 },
      ],
    });
  });

  it('puts everything in the tail when no company is shared', () => {
    const options = [
      { name: 'Acme', count: 1 },
      { name: 'Globex', count: 1 },
    ];
    expect(partitionCompanyOptions(options)).toEqual({
      shared: [],
      rare: options,
    });
  });
});

describe('parseCompanies', () => {
  it('splits, trims, and dedupes comma-separated input', () => {
    expect(parseCompanies('Acme, Globex , acme,,Initech')).toEqual(['Acme', 'Globex', 'Initech']);
  });

  it('returns an empty array for blank input', () => {
    expect(parseCompanies('   ')).toEqual([]);
    expect(parseCompanies('')).toEqual([]);
  });
});
