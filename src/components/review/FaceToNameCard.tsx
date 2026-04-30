import { useEffect, useState } from 'react';
import type { Person, ReviewCard } from '../../types';
import type { GuessResult } from '../../hooks/useReviewSession';
import { Button } from '../common/Button';
import { CardBack } from './CardBack';
import { FacePhoto } from '../common/FacePhoto';

export function FaceToNameCard({
  card,
  person,
  onSubmitGuess,
  onDontKnow,
  onContinue,
}: {
  card: ReviewCard;
  person: Person;
  onSubmitGuess: (guess: string) => GuessResult | null;
  onDontKnow: () => GuessResult | null;
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
          <FacePhoto
            src={photoUrl}
            alt="Person to identify"
            containerClassName="h-56 w-56 rounded-2xl shadow-lg md:h-72 md:w-72 lg:h-80 lg:w-80"
            focus={person.photoFocus}
          />
        </div>

        <form onSubmit={handleSubmit} className="flex-1 space-y-3 pb-24 md:max-w-sm md:pb-0">
          <input
            className="w-full rounded-xl border border-border bg-bg px-4 py-3 text-center text-text placeholder:text-muted/50 focus:border-accent focus:outline-none md:text-lg"
            placeholder="Type their name..."
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            autoFocus
          />
          <div className="hidden grid-cols-2 gap-2 md:grid">
            <Button type="submit" disabled={!guess.trim()} className="w-full py-3">
              Submit
            </Button>
            <Button type="button" onClick={() => setResult(onDontKnow())} className="w-full py-3">
              I don't know
            </Button>
          </div>
        </form>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        <div className="mx-auto grid w-full max-w-2xl grid-cols-2 gap-2">
          <Button type="button" onClick={handleSubmit} disabled={!guess.trim()} className="w-full py-3">
            Submit
          </Button>
          <Button type="button" onClick={() => setResult(onDontKnow())} className="w-full py-3">
            I don't know
          </Button>
        </div>
      </div>
    </section>
  );
}
