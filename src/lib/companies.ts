import type { Person } from '../types';

/**
 * Helpers for grouping people by the companies in their background.
 *
 * The company sub-tabs let you focus on the people you share a former employer
 * with. Because someone can share more than one company with you, a person can
 * belong to several tabs at once — the filtering here is membership-based, not
 * a single-bucket assignment, so overlap surfaces the person in each matching
 * tab rather than forcing a single home.
 */

function cleanCompany(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * Every distinct company associated with a person: the primary `company` plus
 * any extra `companies`. Deduped case-insensitively while preserving the
 * first-seen casing, and returned in a stable order (primary company first).
 */
export function personCompanies(person: Pick<Person, 'company' | 'companies'>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    const value = cleanCompany(raw);
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
  };
  push(person.company);
  if (Array.isArray(person.companies)) {
    for (const entry of person.companies) push(entry);
  }
  return out;
}

/** Case-insensitive membership test against a person's company set. */
export function personHasCompany(
  person: Pick<Person, 'company' | 'companies'>,
  company: string,
): boolean {
  const target = company.trim().toLowerCase();
  if (!target) return false;
  return personCompanies(person).some((c) => c.toLowerCase() === target);
}

export interface CompanyOption {
  /** Display name using the first-seen casing across the group. */
  name: string;
  /** How many people are associated with this company. */
  count: number;
}

/**
 * The set of company sub-tabs to offer for a group of people: one option per
 * distinct company, with the number of people in each. Sorted by descending
 * count, then alphabetically, so the biggest shared groups lead.
 */
export function collectCompanyOptions(people: Person[]): CompanyOption[] {
  const byKey = new Map<string, CompanyOption>();
  for (const person of people) {
    for (const company of personCompanies(person)) {
      const key = company.toLowerCase();
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        byKey.set(key, { name: company, count: 1 });
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Parse a comma-separated list of companies from a text input into a clean,
 * deduped array suitable for `Person.companies`.
 */
export function parseCompanies(input: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of String(input ?? '').split(',')) {
    const value = cleanCompany(part);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}
