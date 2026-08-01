import { useMemo, useState } from 'react';
import {
  historicalCollectionTags,
  searchHistoricalCollections,
  type HistoricalCollection,
} from '../../lib/historical-collections';

export function HistoricalCollectionSelector({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect: (collection: HistoricalCollection) => void;
}) {
  const [query, setQuery] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const collections = useMemo(() => searchHistoricalCollections(query, tags), [query, tags]);

  function toggleTag(tag: string) {
    setTags((current) => current.includes(tag)
      ? current.filter((value) => value !== tag)
      : [...current, tag]);
  }

  return (
    <div className="space-y-3">
      <input
        type="search"
        aria-label="Search historical collections"
        className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm"
        placeholder="Search collections or tags"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto" aria-label="Collection tags">
        {historicalCollectionTags().map((tag) => (
          <button
            key={tag}
            type="button"
            aria-pressed={tags.includes(tag)}
            onClick={() => toggleTag(tag)}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${tags.includes(tag) ? 'border-accent bg-accent/20 text-text' : 'border-border text-muted'}`}
          >
            {tag}
          </button>
        ))}
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {collections.map((collection) => (
          <button
            key={collection.id}
            type="button"
            onClick={() => onSelect(collection)}
            className={`w-full rounded-lg border p-3 text-left ${selectedId === collection.id ? 'border-accent bg-accent/10' : 'border-border bg-white/[.03]'}`}
          >
            <span className="flex justify-between gap-2 text-sm font-medium text-text">
              {collection.name}
              <span className="whitespace-nowrap text-xs font-normal text-muted">
                {collection.wikidataEntityIds.length} members
              </span>
            </span>
            <span className="mt-1 block text-xs text-muted">{collection.description}</span>
            <span className="mt-1 block text-[11px] text-muted">{collection.tags.join(' · ')}</span>
          </button>
        ))}
        {collections.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted">
            No curated collection matches this search and these tags. Try removing a filter.
          </p>
        ) : null}
      </div>
    </div>
  );
}
