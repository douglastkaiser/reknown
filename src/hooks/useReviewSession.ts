import { useMemo, useState } from 'react';
import type { Person, ReviewCard, Settings } from '../types';
import { buildReviewQueue, generateCardsForPeople } from '../lib/card-generator';
import { makeReviewCard } from '../lib/storage';
import { reviewSRS } from '../lib/srs';

export function useReviewSession(people: Person[], settings: Settings | null) {
  const [pool, setPool] = useState<ReviewCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const queue = useMemo(() => {
    if (!settings) return [];
    const generated = generateCardsForPeople(people, settings, settings.deckSize);
    return buildReviewQueue({
      existing: pool.length ? pool : generated,
      generatedNew: generated,
      queueCap: settings.queueCap,
      minQueueSize: settings.newCardsWhenQueueSmall,
    });
  }, [people, settings, pool]);

  const current = queue[index] ?? null;

  function start() {
    if (!settings) return;
    const newPool = generateCardsForPeople(people, settings, settings.deckSize);
    setPool(newPool.length ? newPool : people.map((p) => makeReviewCard(p, 'face_to_name')));
    setIndex(0);
    setRevealed(false);
  }

  function reveal() {
    setRevealed(true);
  }

  function grade(quality: number) {
    if (!current) return;
    setPool((existing) =>
      existing.map((card) => card.id === current.id ? { ...card, srs: reviewSRS(card.srs, quality), updatedAt: Date.now() } : card)
    );
    setIndex((v) => v + 1);
    setRevealed(false);
  }

  return { queue, current, index, revealed, done: index >= queue.length, start, reveal, grade };
}
