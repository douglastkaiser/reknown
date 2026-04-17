import { useEffect, useRef } from 'react';
import type { Person, Settings } from '../../types';
import { useReviewSession } from '../../hooks/useReviewSession';
import { Button } from '../common/Button';
import { FaceToNameCard } from './FaceToNameCard';
import { NameToFaceCard } from './NameToFaceCard';
import { ReviewSummary } from './ReviewSummary';

export function ReviewSessionFlow({ people, settings }: { people: Person[]; settings: Settings | null }) {
  const session = useReviewSession(people, settings);
  const hasAutoStarted = useRef(false);
  const hasAvailablePeople = people.length > 0;

  useEffect(() => {
    if (hasAutoStarted.current || !settings || !hasAvailablePeople) return;
    if (session.queue.length === 0 && !session.done) {
      session.start();
      hasAutoStarted.current = true;
    }
  }, [hasAvailablePeople, session, settings]);

  if (!session.queue.length || session.done) {
    return (
      <div className="flex flex-col items-center justify-center space-y-4 py-12">
        {session.done && session.queue.length ? (
          <>
            <ReviewSummary reviewed={session.index} total={session.queue.length} />
            <Button onClick={session.start} className="px-6 py-3">Start New Session</Button>
          </>
        ) : (
          <div className="text-center space-y-3">
            <p className="text-muted">
              {hasAvailablePeople ? 'Ready to review!' : 'Add some people to get started.'}
            </p>
            {hasAvailablePeople ? (
              <Button onClick={session.start} className="px-6 py-3">Start Session</Button>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  if (!session.current) return null;

  const person = people.find((p) => p.id === session.current?.personId);
  if (!person) return null;

  const progress = `${session.index + 1} / ${session.queue.length}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{progress}</span>
        <div className="h-1 flex-1 mx-3 rounded-full bg-border">
          <div
            className="h-1 rounded-full bg-accent transition-all"
            style={{ width: `${((session.index + 1) / session.queue.length) * 100}%` }}
          />
        </div>
      </div>

      {session.current.type === 'face_to_name' ? (
        <FaceToNameCard
          card={session.current}
          person={person}
          onSubmitGuess={session.submitGuess}
          onDontKnow={session.submitDontKnow}
          onContinue={session.continueAfterGuess}
        />
      ) : (
        <NameToFaceCard
          card={session.current}
          person={person}
          onSubmitChoice={session.submitFaceChoice}
          onDontKnow={session.submitDontKnow}
          onContinue={session.continueAfterGuess}
        />
      )}
    </div>
  );
}
