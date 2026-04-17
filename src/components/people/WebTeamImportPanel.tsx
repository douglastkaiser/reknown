import { useState } from 'react';
import type { Category, Person } from '../../types';
import { createPerson, updatePerson } from '../../lib/storage';
import { importWebTeamPage } from '../../lib/web-team';
import type { WebTeamPersonRecord } from '../../lib/web-team';
import { Button } from '../common/Button';

function keyForRecord(record: Pick<WebTeamPersonRecord, 'name' | 'link'>): string {
  const normalizedName = record.name.trim().toLowerCase();
  const normalizedLink = (record.link ?? '').trim().toLowerCase();
  return normalizedLink ? `${normalizedName}::${normalizedLink}` : normalizedName;
}

function keyForPerson(person: Person): string {
  const normalizedName = person.name.trim().toLowerCase();
  const normalizedLinkedIn = (person.linkedinUrl ?? '').trim().toLowerCase();
  return normalizedLinkedIn ? `${normalizedName}::${normalizedLinkedIn}` : normalizedName;
}

export function WebTeamImportPanel({
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

  async function handleImport() {
    if (!provider || !url || importing) return;

    setImporting(true);
    setProgress({ done: 0, total: 0 });
    setResult(null);
    setError(null);

    try {
      const records = await importWebTeamPage({ provider, url });
      setProgress({ done: 0, total: records.length });

      const existingByKey = new Map<string, Person>();
      for (const person of people) {
        existingByKey.set(keyForPerson(person), person);
      }

      let added = 0;
      let updated = 0;

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const existing = existingByKey.get(keyForRecord(record));

        if (existing) {
          await updatePerson(existing.id, {
            headline: record.headline,
            company: record.company,
            photoUrl: record.photoUrl,
            linkedinUrl: record.link,
          });
          updated += 1;
        } else {
          await createPerson({
            categoryId: category.id,
            name: record.name,
            headline: record.headline,
            company: record.company,
            photoUrl: record.photoUrl,
            linkedinUrl: record.link,
          });
          added += 1;
        }

        setProgress({ done: i + 1, total: records.length });
      }

      setResult({ added, updated });
      await onImported();
    } catch (err) {
      console.error('[web-team] import failed', err);
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
          <h3 className="font-semibold">Web Team Import</h3>
          <p className="text-xs text-muted break-all">
            {provider ? provider.toUpperCase() : 'Unknown provider'} · {url ?? 'Missing URL'}
          </p>
        </div>

        <Button type="button" onClick={handleImport} disabled={importing || !provider || !url}>
          {importing ? 'Importing…' : 'Import Team'}
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
