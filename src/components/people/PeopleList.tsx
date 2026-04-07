import { useEffect, useState } from 'react';
import type { Person } from '../../types';
import { PersonCard } from './PersonCard';
import { getPerPersonMetrics, type PersonMetric } from '../../lib/storage';

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

  if (!people.length) return <div className="card text-sm text-muted">No people yet.</div>;
  const missingPhotos = people.filter((p) => !p.photoDataUrl && !p.photoUrl).length;
  return (
    <div className="space-y-3">
      {missingPhotos > 0 ? (
        <div className="card text-xs text-muted">
          {missingPhotos} {missingPhotos === 1 ? 'person is' : 'people are'} missing a photo. Use the
          "Find photo" link below to fix.
        </div>
      ) : null}
      {people.map((person) => (
        <PersonCard key={person.id} person={person} onDelete={onDelete} onUpdate={onUpdate} metric={metrics[person.id]} />
      ))}
    </div>
  );
}
