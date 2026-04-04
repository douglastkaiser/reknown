import type { Person } from '../../types';
import { PersonCard } from './PersonCard';

export function PeopleList({ people, onDelete }: { people: Person[]; onDelete: (id: string) => void }) {
  if (!people.length) return <div className="card text-sm text-muted">No people yet.</div>;
  return <div className="space-y-3">{people.map((person) => <PersonCard key={person.id} person={person} onDelete={onDelete} />)}</div>;
}
