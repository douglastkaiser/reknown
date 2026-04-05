import { useEffect, useState } from 'react';
import type { ReviewCard } from '../../types';
import { Button } from '../common/Button';

export interface GuessSubmissionResult {
  quality: number;
  matched: boolean;
  feedback: string;
}

export function NameGuessCard({
  card,
  photoUrl,
  revealed,
  onToggleReveal,
  onSubmitGuess,
  onContinue,
}: {
  card: ReviewCard;
  photoUrl?: string;
  revealed: boolean;
  onToggleReveal: () => void;
  onSubmitGuess: (guess: string) => GuessSubmissionResult | null;
  onContinue: () => void;
}) {
  const [guess, setGuess] = useState('');
  const [result, setResult] = useState<GuessSubmissionResult | null>(null);

  useEffect(() => {
    setGuess('');
    setResult(null);
  }, [card.id]);

  function handleSubmit() {
    const evaluated = onSubmitGuess(guess);
    if (!evaluated) return;
    setResult(evaluated);
  }

  return (
    <section className="card space-y-3">
      <p className="text-sm text-muted">{card.type.replace(/_/g, ' ')}</p>
      <h3 className="text-lg font-semibold">{card.prompt}</h3>
      {photoUrl ? <img src={photoUrl} alt="Person to identify" className="max-h-64 rounded-xl" /> : <p className="text-sm text-muted">No photo available.</p>}

      <div className="space-y-2">
        <input
          className="w-full rounded-lg bg-bg px-3 py-2"
          placeholder="Type the person's name"
          value={guess}
          onChange={(event) => setGuess(event.target.value)}
          disabled={Boolean(result)}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSubmit} disabled={!guess.trim() || Boolean(result)}>Submit</Button>
          <Button onClick={onToggleReveal}>{revealed ? 'Hide answer' : 'Reveal answer'}</Button>
          {result ? <Button onClick={onContinue}>Continue</Button> : null}
        </div>
      </div>

      {revealed ? <p className="text-sm text-muted">Answer: {card.answer}</p> : null}
      {result ? <p className="text-sm">{result.feedback}</p> : null}
    </section>
  );
}
