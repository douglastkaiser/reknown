import type { Person, Settings } from '../../types';
import { useReviewSession } from '../../hooks/useReviewSession';
import { Button } from '../common/Button';
import { GradeControls } from './GradeControls';
import { FacePickCard } from './FacePickCard';
import { NameGuessCard } from './NameGuessCard';
import { RevealCard } from './RevealCard';
import { ReviewSummary } from './ReviewSummary';

export function ReviewSessionFlow({ people, settings }: { people: Person[]; settings: Settings | null }) {
  const session = useReviewSession(people, settings);

  if (!session.queue.length || session.done) {
    return (
      <div className="space-y-3">
        <Button onClick={session.start}>Start session</Button>
        {session.done && session.queue.length ? <ReviewSummary reviewed={session.index} total={session.queue.length} /> : null}
      </div>
    );
  }

  if (!session.current) return null;

  if (session.current.type === 'face_to_name') {
    const person = people.find((candidate) => candidate.id === session.current?.personId);
    if (session.current.options?.length) {
      return (
        <FacePickCard
          card={session.current}
          photoUrl={person?.photoDataUrl || person?.photoUrl}
          revealed={session.revealed}
          onToggleReveal={session.toggleReveal}
          onSubmitChoice={session.submitChoice}
          onContinue={session.continueAfterGuess}
        />
      );
    }

    return (
      <NameGuessCard
        card={session.current}
        photoUrl={person?.photoDataUrl || person?.photoUrl}
        revealed={session.revealed}
        onToggleReveal={session.toggleReveal}
        onSubmitGuess={session.submitGuess}
        onContinue={session.continueAfterGuess}
      />
    );
  }

  return (
    <section className="space-y-3">
      <RevealCard card={session.current} revealed={session.revealed} onReveal={session.reveal} />
      {session.revealed ? <GradeControls onGrade={session.grade} /> : null}
    </section>
  );
}
