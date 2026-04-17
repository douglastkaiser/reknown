import { useEffect, useState } from 'react';
import type { Person, ReviewCard } from '../../types';
import type { GuessResult } from '../../hooks/useReviewSession';
import { CardBack } from './CardBack';

export function NameToFaceCard({
  card,
  person,
  onSubmitChoice,
  onDontKnow,
  onContinue,
}: {
  card: ReviewCard;
  person: Person;
  onSubmitChoice: (optionIndex: number) => GuessResult | null;
  onDontKnow: () => GuessResult | null;
  onContinue: () => void;
}) {
  const [result, setResult] = useState<GuessResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    setResult(null);
    setSelectedIndex(null);
  }, [card.id]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (result) return;

      const key = event.key;
      const parsed = Number.parseInt(key, 10);
      if (Number.isNaN(parsed)) return;

      const index = parsed - 1;
      const options = card.options ?? [];
      if (index < 0 || index >= options.length) return;
      if (!options[index]) return;

      event.preventDefault();
      setSelectedIndex(index);
      setResult(onSubmitChoice(index));
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [card.options, onSubmitChoice, result]);

  function handleChoice(index: number) {
    if (result) return;
    setSelectedIndex(index);
    setResult(onSubmitChoice(index));
  }

  if (result) {
    return (
      <section className="card space-y-4">
        <CardBack person={person} correct={result.matched} onContinue={onContinue} />
      </section>
    );
  }

  return (
    <section className="card flex flex-col gap-6 md:p-8">
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6">
        <p className="text-center text-xs font-medium uppercase tracking-wider text-muted">Select the correct face</p>
        <h3 className="text-center text-3xl font-bold text-text md:text-4xl">{person.name}</h3>
      </div>

      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(4.25rem, 21vw), 1fr))',
        }}
      >
        {(card.options ?? []).map((photoUrl, index) => (!photoUrl ? null :
          <button
            key={`${card.id}:${index}`}
            onClick={() => handleChoice(index)}
            className="overflow-hidden rounded-lg border-2 border-border transition hover:border-accent/50 focus:outline-none"
          >
            <img
              src={photoUrl}
              alt={`Option ${index + 1}`}
              className="aspect-square w-full object-cover"
              style={{ objectPosition: 'center 25%' }}
            />
            <span className="block border-t border-border bg-surface px-1 py-1 text-center text-xs font-semibold text-muted">
              {index + 1}
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setResult(onDontKnow())}
        className="self-center rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-text transition hover:bg-accent/10"
      >
        I don't know
      </button>
    </section>
  );
}
