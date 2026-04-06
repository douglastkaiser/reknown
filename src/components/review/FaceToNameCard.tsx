import { useEffect, useState } from 'react';
import type { Person, ReviewCard } from '../../types';
import type { GuessResult } from '../../hooks/useReviewSession';
import { Button } from '../common/Button';
import { CardBack } from './CardBack';

export function FaceToNameCard({
  card,
  person,
  onSubmitGuess,
  onContinue,
}: {
  card: ReviewCard;
  person: Person;
  onSubmitGuess: (guess: string) => GuessResult | null;
  onContinue: () => void;
}) {
  const [guess, setGuess] = useState('');
  const [result, setResult] = useState<GuessResult | null>(null);
  const photoUrl = person.photoDataUrl || person.photoUrl;

  useEffect(() => {
    setGuess('');
    setResult(null);
  }, [card.id]);

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!guess.trim() || result) return;
    setResult(onSubmitGuess(guess));
  }

  if (result) {
    return (
      <section className="card space-y-4">
        <CardBack person={person} correct={result.matched} onContinue={onContinue} />
      </section>
    );
  }

  return (
    <section className="card space-y-4">
      <p className="text-center text-xs font-medium uppercase tracking-wider text-muted">Who is this person?</p>

      {photoUrl ? (
        <div className="flex justify-center">
          <img src={photoUrl} alt="Person to identify" className="h-48 w-48 rounded-2xl object-cover shadow-lg" />
        </div>
      ) : (
        <p className="text-center text-sm text-muted">No photo available.</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          className="w-full rounded-xl border border-border bg-bg px-4 py-3 text-center text-text placeholder:text-muted/50 focus:border-accent focus:outline-none"
          placeholder="Type their name..."
          value={guess}
          onChange={(e) => setGuess(e.target.value)}
          autoFocus
        />
        <Button type="submit" disabled={!guess.trim()} className="w-full py-3">
          Submit
        </Button>
      </form>
    </section>
  );
}
