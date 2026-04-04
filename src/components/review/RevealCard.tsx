import type { ReviewCard } from '../../types';
import { Button } from '../common/Button';

export function RevealCard({ card, revealed, onReveal }: { card: ReviewCard; revealed: boolean; onReveal: () => void }) {
  return (
    <section className="card space-y-3">
      <p className="text-sm text-muted">{card.type.replace(/_/g, ' ')}</p>
      <h3 className="text-lg font-semibold">{card.prompt}</h3>
      {revealed ? (
        card.answer.startsWith('data:image') || card.answer.startsWith('http')
          ? <img src={card.answer} alt="answer" className="max-h-52 rounded-xl" />
          : <p>{card.answer}</p>
      ) : <Button onClick={onReveal}>Reveal</Button>}
    </section>
  );
}
