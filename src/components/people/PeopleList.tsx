import { useEffect, useMemo, useState } from 'react';
import type { Person } from '../../types';
import { PersonCard } from './PersonCard';
import { getPerPersonMetrics, type PersonMetric } from '../../lib/storage';

type SortMode =
  | 'missing_photo_first'
  | 'alphabetical'
  | 'total_misses_asc'
  | 'total_misses_desc'
  | 'total_correct_asc'
  | 'total_correct_desc';

function hasPhoto(person: Person) {
  return Boolean(person.photoDataUrl || person.photoUrl);
}

function getTotalMisses(metric?: PersonMetric) {
  if (!metric) return 0;
  return metric.faceToNameIncorrect + metric.nameToFaceIncorrect;
}

function getTotalCorrect(metric?: PersonMetric) {
  if (!metric) return 0;
  return metric.faceToNameCorrect + metric.nameToFaceCorrect;
}

export function PeopleList({
  people,
  onDelete,
  onUpdate,
}: {
  people: Person[];
  onDelete: (id: string) => void;
  onUpdate?: (id: string, updates: Partial<Person>) => Promise<void> | void;
}) {
  const [metrics, setMetrics] = useState<Record<string, PersonMetric>>({});
  const [sortMode, setSortMode] = useState<SortMode>('missing_photo_first');

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void getPerPersonMetrics().then((m) => {
        if (!cancelled) setMetrics(m);
      });
    };
    load();
    window.addEventListener('reknown:metrics-updated', load);
    return () => {
      cancelled = true;
      window.removeEventListener('reknown:metrics-updated', load);
    };
  }, []);

  const sortedPeople = useMemo(() => {
    if (sortMode === 'alphabetical') {
      return [...people].sort((a, b) => a.name.localeCompare(b.name));
    }

    if (sortMode === 'total_misses_asc' || sortMode === 'total_misses_desc') {
      const direction = sortMode === 'total_misses_asc' ? 1 : -1;
      return [...people].sort((a, b) => {
        const delta = getTotalMisses(metrics[a.id]) - getTotalMisses(metrics[b.id]);
        if (delta !== 0) return delta * direction;
        return a.name.localeCompare(b.name);
      });
    }

    if (sortMode === 'total_correct_asc' || sortMode === 'total_correct_desc') {
      const direction = sortMode === 'total_correct_asc' ? 1 : -1;
      return [...people].sort((a, b) => {
        const delta = getTotalCorrect(metrics[a.id]) - getTotalCorrect(metrics[b.id]);
        if (delta !== 0) return delta * direction;
        return a.name.localeCompare(b.name);
      });
    }

    return [...people].sort((a, b) => {
      const aHasPhoto = hasPhoto(a);
      const bHasPhoto = hasPhoto(b);
      if (aHasPhoto !== bHasPhoto) return aHasPhoto ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [metrics, people, sortMode]);

  if (!people.length) return <div className="card text-sm text-muted">No people yet.</div>;
  const missingPhotos = people.filter((p) => !hasPhoto(p)).length;
  return (
    <div className="space-y-3">
      {missingPhotos > 0 ? (
        <div className="card text-xs text-muted">
          {missingPhotos} {missingPhotos === 1 ? 'person is' : 'people are'} missing a photo. Use the
          "Find photo" link below to fix.
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <label htmlFor="people-sort" className="text-xs font-medium text-muted">Sort</label>
        <select
          id="people-sort"
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value as SortMode)}
          className="rounded-lg border border-border bg-bg px-2 py-1 text-xs text-text"
        >
          <option value="missing_photo_first">No-photo first</option>
          <option value="alphabetical">Alphabetical</option>
          <option value="total_misses_asc">Total misses (low to high)</option>
          <option value="total_misses_desc">Total misses (high to low)</option>
          <option value="total_correct_asc">Total correct (low to high)</option>
          <option value="total_correct_desc">Total correct (high to low)</option>
        </select>
      </div>

      {sortedPeople.map((person) => (
        <PersonCard key={person.id} person={person} onDelete={onDelete} onUpdate={onUpdate} metric={metrics[person.id]} />
      ))}
    </div>
  );
}
