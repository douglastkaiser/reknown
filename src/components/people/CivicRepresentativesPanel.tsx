import { useMemo, useState } from 'react';
import type { Category, Person } from '../../types';
import { civicToPersonRecords, fetchRepresentatives } from '../../lib/civic';
import { createPerson, updateCategory, updatePerson } from '../../lib/storage';
import { Button } from '../common/Button';

const API_KEY_STORAGE_KEY = 'reknown:civic_api_key';

export function CivicRepresentativesPanel({
  category,
  people,
  onImported,
}: {
  category: Category;
  people: Person[];
  onImported: () => Promise<void> | void;
}) {
  const [addressOrZip, setAddressOrZip] = useState(category.civicAddressOrZip ?? '');
  const [apiKey, setApiKey] = useState<string>(
    () => window.localStorage.getItem(API_KEY_STORAGE_KEY) ?? '',
  );
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ added: number; updated: number; photos: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const existingBySourceId = useMemo(() => {
    const map = new Map<string, Person>();
    for (const person of people) {
      if (person.civicSourceId) {
        map.set(person.civicSourceId, person);
      }
    }
    return map;
  }, [people]);

  async function handleImport() {
    const query = addressOrZip.trim();
    if (!query || importing) return;

    setImporting(true);
    setResult(null);
    setError(null);

    try {
      const reps = await fetchRepresentatives(query, apiKey);
      const records = civicToPersonRecords(reps);

      let added = 0;
      let updated = 0;
      let photos = 0;

      for (const record of records) {
        if (record.photoUrl) photos += 1;
        const sourceId = record.civicSourceId;
        const existing = sourceId ? existingBySourceId.get(sourceId) : undefined;

        if (existing) {
          await updatePerson(existing.id, {
            name: record.name,
            headline: record.headline,
            photoUrl: record.photoUrl,
            civicOffice: record.civicOffice,
            civicDivisionId: record.civicDivisionId,
          });
          updated += 1;
        } else {
          await createPerson({ ...record, categoryId: category.id });
          added += 1;
        }
      }

      await updateCategory(category.id, {
        civicAddressOrZip: query,
      });

      window.localStorage.setItem(API_KEY_STORAGE_KEY, apiKey.trim());

      setResult({ added, updated, photos });
      await onImported();
    } catch (err) {
      console.error('[civic] import failed', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch representatives');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div className="space-y-1">
        <h3 className="font-semibold">Local Representatives</h3>
        <p className="text-xs text-muted">
          Enter a US address or ZIP code to import representatives from Google Civic Information.
        </p>
      </div>

      <input
        className="w-full rounded-lg bg-bg px-3 py-2 text-sm"
        placeholder="Address or ZIP code (e.g. 10001)"
        value={addressOrZip}
        onChange={(event) => setAddressOrZip(event.target.value)}
      />

      <input
        className="w-full rounded-lg bg-bg px-3 py-2 text-sm"
        placeholder="Google Civic API key (optional if already configured in browser)"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted">
          Tip: create a key for the Civic Information API in Google Cloud if you see a 403.
        </p>
        <Button type="button" onClick={handleImport} disabled={importing || !addressOrZip.trim()}>
          {importing ? 'Importing…' : 'Import Representatives'}
        </Button>
      </div>

      {result ? (
        <p className="text-xs text-muted">
          Added {result.added}, updated {result.updated}. {result.photos} with photos.
        </p>
      ) : null}

      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
