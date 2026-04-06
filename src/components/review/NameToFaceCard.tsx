import { useEffect, useState } from 'react';
import type { Person, ReviewCard } from '../../types';
import type { GuessResult } from '../../hooks/useReviewSession';
import { CardBack } from './CardBack';

export function NameToFaceCard({
  card,
  person,
  onSubmitChoice,
  onContinue,
}: {
  card: ReviewCard;
  person: Person;
  onSubmitChoice: (optionIndex: number) => GuessResult | null;
  onContinue: () => void;
}) {
  const [result, setResult] = useState<GuessResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    setResult(null);
    setSelectedIndex(null);
  }, [card.id]);

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
    <section className="card space-y-4">
      <p className="text-center text-xs font-medium uppercase tracking-wider text-muted">Select the correct face</p>
      <h3 className="text-center text-2xl font-bold text-text">{person.name}</h3>

      <div className="grid grid-cols-2 gap-3">
        {(card.options ?? []).map((photoUrl, index) => (!photoUrl ? null :
          <button
            key={`${card.id}:${index}`}
            onClick={() => handleChoice(index)}
            className="overflow-hidden rounded-xl border-2 border-border transition hover:border-accent/50 focus:outline-none"
          >
            <img
              src={photoUrl}
              alt={`Option ${index + 1}`}
              className="aspect-square w-full object-cover"
            />
          </button>
        ))}
      </div>
    </section>
  );
}
