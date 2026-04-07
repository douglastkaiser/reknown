import { useEffect } from 'react';
import type { Person } from '../../types';
import { Button } from '../common/Button';

export function CardBack({
  person,
  correct,
  onContinue,
}: {
  person: Person;
  correct: boolean;
  onContinue: () => void;
}) {
  const photoUrl = person.photoDataUrl || person.photoUrl;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') onContinue();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onContinue]);

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border-2 px-4 py-3 text-center text-sm font-semibold ${correct ? 'border-green-500/40 bg-green-500/10 text-green-400' : 'border-red-500/40 bg-red-500/10 text-red-400'}`}>
        {correct ? 'Correct!' : 'Incorrect'}
      </div>

      <div className="flex flex-col items-center gap-3">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={person.name}
            className="h-32 w-32 rounded-full object-cover md:h-40 md:w-40"
            style={{ objectPosition: 'center 25%' }}
          />
        ) : null}
        <h3 className="text-xl font-bold text-text">{person.name}</h3>
      </div>

      {(person.headline || person.company || person.notes || (person.tags && person.tags.length > 0)) ? (
        <div className="space-y-2 rounded-xl border border-border bg-surface/60 p-4">
          {person.headline ? (
            <p className="text-sm text-muted"><span className="font-medium text-text/80">Title:</span> {person.headline}</p>
          ) : null}
          {person.company ? (
            <p className="text-sm text-muted"><span className="font-medium text-text/80">Company:</span> {person.company}</p>
          ) : null}
          {person.notes ? (
            <p className="text-sm text-muted"><span className="font-medium text-text/80">Notes:</span> {person.notes}</p>
          ) : null}
          {person.tags && person.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {person.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">{tag}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {person.linkedinUrl ? (
        <a href={person.linkedinUrl} target="_blank" rel="noopener noreferrer" className="block text-center text-xs text-accent hover:underline">
          View LinkedIn Profile
        </a>
      ) : null}

      <Button onClick={onContinue} className="w-full py-3">
        Continue
      </Button>
    </div>
  );
}
