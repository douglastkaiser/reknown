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
 * How many people must share a company before its sub-tab is shown up front.
 * Anything below this is a single-person company — a long tail that buries the
 * shared employers the filter is really for, so those are collapsed by default.
 */
export const SHARED_COMPANY_MIN_COUNT = 2;

/**
 * Split already-sorted company options (see `collectCompanyOptions`) into the
 * companies worth leading with — shared by `SHARED_COMPANY_MIN_COUNT`+ people —
 * and the tail of single-person companies. Lets the sub-tabs show the shared
 * ones by default and tuck the rest behind a "show all" toggle.
 */
export function partitionCompanyOptions(options: CompanyOption[]): {
  shared: CompanyOption[];
  rare: CompanyOption[];
} {
  const shared: CompanyOption[] = [];
  const rare: CompanyOption[] = [];
  for (const opt of options) {
    (opt.count >= SHARED_COMPANY_MIN_COUNT ? shared : rare).push(opt);
  }
  return { shared, rare };
}

/**
 * Fold companies scraped from a LinkedIn profile into a person's existing
 * `companies` list. Purely additive: existing entries keep their order and are
 * never removed (manual edits win), scraped names are appended only when new.
 * The primary `company` is skipped because `personCompanies()` already implies
 * it — `companies` holds the extra history. Returns `null` when nothing new
 * would be added, so callers can skip a redundant write.
 */
export function mergeScrapedCompanies(
  existing: string[] | undefined,
  scraped: string[],
  primary?: string,
): string[] | null {
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (raw: unknown) => {
    const value = cleanCompany(raw);
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(value);
  };
  if (Array.isArray(existing)) {
    for (const entry of existing) add(entry);
  }
  const startLen = result.length;
  const primaryKey = cleanCompany(primary)?.toLowerCase() ?? null;
  for (const entry of scraped) {
    const value = cleanCompany(entry);
    if (!value) continue;
    const key = value.toLowerCase();
    if (key === primaryKey || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result.length > startLen ? result : null;
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
