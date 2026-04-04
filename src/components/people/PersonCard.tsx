import type { Person } from '../../types';
import { Button } from '../common/Button';

export function PersonCard({ person, onDelete }: { person: Person; onDelete: (id: string) => void }) {
  return (
    <article className="card">
      <div className="flex items-start gap-3">
        {person.photoDataUrl || person.photoUrl ? (
          <img src={person.photoDataUrl || person.photoUrl} alt={person.name} className="h-14 w-14 rounded-full object-cover" />
        ) : (
          <div className="h-14 w-14 rounded-full bg-white/10" />
        )}
        <div className="flex-1">
          <h3 className="font-semibold">{person.name}</h3>
          <p className="text-sm text-muted">{person.headline || 'No headline'}</p>
          <p className="text-xs text-muted">{person.company || 'No company'}</p>
        </div>
        <Button className="bg-red-400/20" onClick={() => onDelete(person.id)}>Delete</Button>
      </div>
    </article>
  );
}
