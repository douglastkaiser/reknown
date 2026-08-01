import { useEffect, useState } from 'react';
import type { Category, Person } from '../../types';
import { getHistoricalCollection } from '../../lib/historical-collections';
import { importHistoricalFigures, type HistoricalImportResult } from '../../lib/historical-import';
import { wikidataHistoricalFigureProvider } from '../../lib/wikidata';
import { Button } from '../common/Button';

function failureMessage(result: HistoricalImportResult): string | null {
  if (!result.failures.length) return null;
  const failed = result.failures.reduce((sum, failure) => sum + failure.entityIds.length, 0);
  return `${failed} figure${failed === 1 ? '' : 's'} could not be refreshed. Retry to fetch the missing metadata.`;
}

export function HistoricalFiguresPanel({
  category,
  people,
  onImported,
  initialError,
}: {
  category: Category;
  people: Person[];
  onImported: () => Promise<void> | void;
  initialError?: string | null;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<HistoricalImportResult | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const collection = category.historicalCollectionId
    ? getHistoricalCollection(category.historicalCollectionId)
    : undefined;

  useEffect(() => {
    if (initialError) setError(initialError);
  }, [initialError]);

  async function refresh() {
    if (!collection || refreshing) return;
    setRefreshing(true);
    setError(null);
    setResult(null);
    try {
      const next = await importHistoricalFigures(
        category.id,
        collection.wikidataEntityIds,
        people,
        wikidataHistoricalFigureProvider,
        (done, total) => setProgress({ done, total }),
      );
      setResult(next);
      setError(failureMessage(next));
      await onImported();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Historical figure refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  const percent = progress.total ? Math.round(progress.done / progress.total * 100) : 0;
  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{category.historicalCollectionName ?? collection?.name ?? category.name}</h3>
          <p className="text-xs text-muted">{collection?.description ?? 'Curated historical collection'}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {(category.historicalCollectionTags ?? collection?.tags ?? []).map((tag) => (
              <span key={tag} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">{tag}</span>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">{people.length} imported · biographical metadata from Wikidata</p>
        </div>
        <Button type="button" onClick={() => void refresh()} disabled={refreshing || !collection}>
          {refreshing ? 'Refreshing…' : error ? 'Retry Refresh' : 'Refresh Collection'}
        </Button>
      </div>
      {refreshing && progress.total > 0 ? (
        <div className="space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-accent transition-all" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-muted">{progress.done} / {progress.total} figures</p>
        </div>
      ) : null}
      {result ? <p className="text-xs text-muted">Added {result.added}; updated {result.updated}.</p> : null}
      {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
      {!collection ? <p role="alert" className="text-xs text-red-400">This collection is no longer in the local catalog. Existing people remain available.</p> : null}
    </div>
  );
}
