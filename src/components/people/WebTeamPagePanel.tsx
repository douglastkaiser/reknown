import { useMemo, useState } from 'react';
import type { Category, Person } from '../../types';
import { importWebTeamPage } from '../../lib/web-team';
import { createPerson, updatePerson } from '../../lib/storage';
import { Button } from '../common/Button';

function normalizeText(value?: string): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeCompany(value?: string): string {
  const normalized = normalizeText(value);
  return normalized.replace(/[,\.]/g, '');
}

function canonicalizeProfileUrl(value?: string): string {
  if (!value) return '';
  try {
    const url = new URL(value.trim());
    url.hash = '';
    url.search = '';
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    return `${url.protocol}//${host}${path}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

function fallbackKey(name?: string, company?: string): string {
  return `${normalizeText(name)}::${normalizeCompany(company)}`;
}

function profileKeyForPerson(person: Person): string {
  return canonicalizeProfileUrl(person.linkedinUrl);
}

export function WebTeamPagePanel({
  category,
  people,
  onImported,
}: {
  category: Category;
  people: Person[];
  onImported: () => Promise<void> | void;
}) {
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ added: number; updated: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const provider = category.webTeamProvider;
  const url = category.webTeamUrl;

  const existingByProfileUrl = useMemo(() => {
    const map = new Map<string, Person>();
    for (const person of people) {
      const key = profileKeyForPerson(person);
      if (key) map.set(key, person);
    }
    return map;
  }, [people]);

  const existingByFallback = useMemo(() => {
    const map = new Map<string, Person>();
    for (const person of people) {
      const key = fallbackKey(person.name, person.company);
      if (key !== '::') map.set(key, person);
    }
    return map;
  }, [people]);

  async function handleRefresh() {
    if (!provider || !url || importing) return;

    setImporting(true);
    setProgress({ done: 0, total: 0 });
    setResult(null);
    setError(null);

    try {
      const records = await importWebTeamPage({ provider, url });
      setProgress({ done: 0, total: records.length });

      const seenProfileUrl = new Map(existingByProfileUrl);
      const seenFallback = new Map(existingByFallback);
      let added = 0;
      let updated = 0;

      for (let i = 0; i < records.length; i += 1) {
        const record = records[i];
        const canonicalProfileUrl = canonicalizeProfileUrl(record.link);
        const fallback = fallbackKey(record.name, record.company);

        const existing = canonicalProfileUrl
          ? seenProfileUrl.get(canonicalProfileUrl)
          : seenFallback.get(fallback);

        if (existing) {
          await updatePerson(existing.id, {
            name: record.name,
            headline: record.headline,
            company: record.company,
            photoUrl: record.photoUrl,
            linkedinUrl: record.link,
          });
          updated += 1;
        } else {
          const created = await createPerson({
            categoryId: category.id,
            name: record.name,
            headline: record.headline,
            company: record.company,
            photoUrl: record.photoUrl,
            linkedinUrl: record.link,
          });
          added += 1;
          if (canonicalProfileUrl) {
            seenProfileUrl.set(canonicalProfileUrl, created);
          }
          seenFallback.set(fallback, created);
        }

        setProgress({ done: i + 1, total: records.length });
      }

      setResult({ added, updated });
      await onImported();
    } catch (err) {
      console.error('[web-team-page] refresh failed', err);
      setError(err instanceof Error ? err.message : 'Failed to import team page');
    } finally {
      setImporting(false);
    }
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Web Team Page</h3>
          <p className="text-xs text-muted break-all">
            {provider ? provider.toUpperCase() : 'Unknown provider'} · {url ?? 'Missing URL'}
          </p>
        </div>

        <Button type="button" onClick={handleRefresh} disabled={importing || !provider || !url}>
          {importing ? 'Refreshing…' : 'Refresh team page'}
        </Button>
      </div>

      {importing && progress.total > 0 ? (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted">
            {progress.done} / {progress.total} people
          </p>
        </div>
      ) : null}

      {result ? (
        <p className="text-xs text-muted">
          {result.added > 0
            ? `Added ${result.added} new ${result.added === 1 ? 'person' : 'people'}`
            : 'No new people'}
          {result.updated > 0 ? `, updated ${result.updated}` : ''}.
        </p>
      ) : null}

      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
