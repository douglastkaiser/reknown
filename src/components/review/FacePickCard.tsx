import { useEffect, useState } from 'react';
import type { ReviewCard } from '../../types';
import { Button } from '../common/Button';
import type { GuessSubmissionResult } from './NameGuessCard';

export function FacePickCard({
  card,
  photoUrl,
  revealed,
  onToggleReveal,
  onSubmitChoice,
  onContinue,
}: {
  card: ReviewCard;
  photoUrl?: string;
  revealed: boolean;
  onToggleReveal: () => void;
  onSubmitChoice: (optionIndex: number) => GuessSubmissionResult | null;
  onContinue: () => void;
}) {
  const [result, setResult] = useState<GuessSubmissionResult | null>(null);

  useEffect(() => {
    setResult(null);
  }, [card.id]);

  return (
    <section className="card space-y-3">
      <p className="text-sm text-muted">face pick</p>
      <h3 className="text-lg font-semibold">Who is this person?</h3>
      {photoUrl ? <img src={photoUrl} alt="Person to identify" className="max-h-64 rounded-xl" /> : <p className="text-sm text-muted">No photo available.</p>}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(card.options ?? []).map((option, index) => (
          <Button
            key={`${card.id}:${option}`}
            onClick={() => setResult(onSubmitChoice(index))}
            disabled={Boolean(result)}
          >
            {option}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onToggleReveal}>{revealed ? 'Hide answer' : 'Reveal answer'}</Button>
        {result ? <Button onClick={onContinue}>Continue</Button> : null}
      </div>

      {revealed ? <p className="text-sm text-muted">Answer: {card.answer}</p> : null}
      {result ? <p className="text-sm">{result.feedback}</p> : null}
    </section>
  );
}
