import type { Person } from '../types';

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const QID_PATTERN = /^Q[1-9]\d*$/;
export const WIKIDATA_BATCH_SIZE = 40;

export type HistoricalPersonRecord = Omit<Person, 'id' | 'categoryId' | 'createdAt' | 'updatedAt'>;

export interface HistoricalHydrationFailure {
  entityIds: string[];
  message: string;
}

export interface HistoricalHydrationResult {
  people: HistoricalPersonRecord[];
  failures: HistoricalHydrationFailure[];
}

export interface HistoricalFigureProvider {
  hydrate(entityIds: string[]): Promise<HistoricalHydrationResult>;
}

type Claim = { mainsnak?: { datavalue?: { value?: unknown } } };
type Entity = {
  id?: string;
  missing?: string;
  labels?: Record<string, { value?: string }>;
  descriptions?: Record<string, { value?: string }>;
  claims?: Record<string, Claim[]>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function entityMap(value: unknown): Record<string, Entity> {
  if (!isObject(value) || !isObject(value.entities)) {
    throw new Error('Wikidata returned an unexpected response shape');
  }
  return value.entities as Record<string, Entity>;
}

export function uniqueQids(entityIds: string[]): string[] {
  return [...new Set(entityIds.map((id) => id.trim()).filter((id) => QID_PATTERN.test(id)))];
}

function claimString(entity: Entity, property: string): string | undefined {
  const value = entity.claims?.[property]?.[0]?.mainsnak?.datavalue?.value;
  return typeof value === 'string' ? value : undefined;
}

function occupationIds(entity: Entity): string[] {
  return (entity.claims?.P106 ?? []).flatMap((claim) => {
    const value = claim.mainsnak?.datavalue?.value;
    return isObject(value) && typeof value.id === 'string' && QID_PATTERN.test(value.id)
      ? [value.id]
      : [];
  });
}

function yearFromClaim(entity: Entity, property: string): string | undefined {
  const value = entity.claims?.[property]?.[0]?.mainsnak?.datavalue?.value;
  if (!isObject(value) || typeof value.time !== 'string') return undefined;
  const match = value.time.match(/^[+-](\d{1,})-/);
  if (!match) return undefined;
  const year = String(Number(match[1]));
  return value.time.startsWith('-') ? `${year} BCE` : year;
}

export function commonsImageUrl(filename: string): string {
  return `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(filename.replace(/ /g, '_'))}`;
}

export function normalizeWikidataEntity(
  qid: string,
  entity: Entity | undefined,
  occupationLabels: Record<string, string> = {},
): HistoricalPersonRecord | null {
  if (!entity || entity.missing !== undefined) return null;
  const name = entity.labels?.en?.value?.trim();
  if (!name) return null;
  const description = entity.descriptions?.en?.value?.trim();
  const occupations = occupationIds(entity).map((id) => occupationLabels[id]).filter(Boolean);
  const born = yearFromClaim(entity, 'P569');
  const died = yearFromClaim(entity, 'P570');
  const lifespan = born || died ? `${born ?? '?'}–${died ?? ''}` : '';
  const details = [description, occupations.slice(0, 2).join(', '), lifespan].filter(Boolean);
  const image = claimString(entity, 'P18');
  return {
    name,
    wikidataEntityId: qid,
    headline: details.length ? details.join(' · ') : undefined,
    photoUrl: image ? commonsImageUrl(image) : undefined,
  };
}

async function requestEntities(fetcher: typeof fetch, ids: string[]): Promise<Record<string, Entity>> {
  const params = new URLSearchParams({
    action: 'wbgetentities', format: 'json', origin: '*',
    ids: ids.join('|'), props: 'labels|descriptions|claims', languages: 'en',
  });
  const response = await fetcher(`${WIKIDATA_API}?${params.toString()}`, {
    headers: { 'Api-User-Agent': 'reknown-historical-figures/0.1 (metadata hydration)' },
  });
  if (!response.ok) throw new Error(`Wikidata request failed (${response.status})`);
  return entityMap(await response.json());
}

export class WikidataHistoricalFigureProvider implements HistoricalFigureProvider {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly batchSize = WIKIDATA_BATCH_SIZE,
  ) {}

  async hydrate(requestedIds: string[]): Promise<HistoricalHydrationResult> {
    const ids = uniqueQids(requestedIds);
    const people: HistoricalPersonRecord[] = [];
    const failures: HistoricalHydrationFailure[] = [];
    for (let start = 0; start < ids.length; start += this.batchSize) {
      const batch = ids.slice(start, start + this.batchSize);
      try {
        const entities = await requestEntities(this.fetcher, batch);
        const occupationQids = uniqueQids(batch.flatMap((qid) => occupationIds(entities[qid] ?? {})));
        let labels: Record<string, string> = {};
        for (let occupationStart = 0; occupationStart < occupationQids.length; occupationStart += this.batchSize) {
          const occupationBatch = occupationQids.slice(occupationStart, occupationStart + this.batchSize);
          const occupations = await requestEntities(this.fetcher, occupationBatch);
          for (const id of occupationBatch) {
            const label = occupations[id]?.labels?.en?.value;
            if (label) labels[id] = label;
          }
        }
        for (const qid of batch) {
          const person = normalizeWikidataEntity(qid, entities[qid], labels);
          if (person) people.push(person);
        }
      } catch (error) {
        failures.push({ entityIds: batch, message: error instanceof Error ? error.message : 'Unknown Wikidata error' });
      }
    }
    return { people, failures };
  }
}

export const wikidataHistoricalFigureProvider: HistoricalFigureProvider =
  new WikidataHistoricalFigureProvider();
