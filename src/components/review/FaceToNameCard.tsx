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

  // Defensive: this card is only generated for people with photos, so if a
  // photo is somehow missing, render nothing rather than a broken prompt.
  if (!photoUrl) return null;

  return (
    <section className="card space-y-4 md:space-y-0 md:p-8">
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:gap-10">
        <div className="flex flex-1 flex-col items-center gap-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted">Who is this person?</p>
          <img
            src={photoUrl}
            alt="Person to identify"
            className="h-56 w-56 rounded-2xl object-cover shadow-lg md:h-72 md:w-72 lg:h-80 lg:w-80"
            style={{ objectPosition: 'center 25%' }}
          />
        </div>

        <form onSubmit={handleSubmit} className="flex-1 space-y-3 md:max-w-sm">
          <input
            className="w-full rounded-xl border border-border bg-bg px-4 py-3 text-center text-text placeholder:text-muted/50 focus:border-accent focus:outline-none md:text-lg"
            placeholder="Type their name..."
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            autoFocus
          />
          <Button type="submit" disabled={!guess.trim()} className="w-full py-3">
            Submit
          </Button>
        </form>
      </div>
    </section>
  );
}
