import { useMemo, useState } from 'react';
import type { Person, ReviewCard, Settings } from '../types';
import { buildReviewQueue, generateCardsForPeople } from '../lib/card-generator';
import { makeReviewCard } from '../lib/storage';
import { reviewSRS } from '../lib/srs';

export interface GuessEvaluation {
  quality: number;
  matched: boolean;
  feedback: string;
}

function normalize(value: string) {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function evaluateGuess(answer: string, guess: string): GuessEvaluation {
  const normalizedAnswer = normalize(answer);
  const normalizedGuess = normalize(guess);

  if (normalizedGuess === normalizedAnswer) {
    return { quality: 5, matched: true, feedback: 'Correct — great recall.' };
  }

  if (normalizedGuess && (normalizedAnswer.includes(normalizedGuess) || normalizedGuess.includes(normalizedAnswer))) {
    return { quality: 3, matched: false, feedback: `Close. Correct answer: ${answer}` };
  }

  return { quality: 1, matched: false, feedback: `Not quite. Correct answer: ${answer}` };
}

export function useReviewSession(people: Person[], settings: Settings | null) {
  const [pool, setPool] = useState<ReviewCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [guessEvaluation, setGuessEvaluation] = useState<GuessEvaluation | null>(null);

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
    setGuessEvaluation(null);
  }

  function reveal() {
    setRevealed(true);
  }

  function toggleReveal() {
    setRevealed((value) => !value);
  }

  function advanceWithQuality(quality: number) {
    if (!current) return;
    setPool((existing) =>
      existing.map((card) => card.id === current.id ? { ...card, srs: reviewSRS(card.srs, quality), updatedAt: Date.now() } : card)
    );
    setIndex((value) => value + 1);
    setRevealed(false);
    setGuessEvaluation(null);
  }

  function grade(quality: number) {
    advanceWithQuality(quality);
  }

  function submitGuess(guess: string): GuessEvaluation | null {
    if (!current || current.type !== 'face_to_name') return null;
    const evaluated = evaluateGuess(current.answer, guess);
    setGuessEvaluation(evaluated);
    return evaluated;
  }

  function continueAfterGuess() {
    if (!guessEvaluation) return;
    advanceWithQuality(guessEvaluation.quality);
  }

  return {
    queue,
    current,
    index,
    revealed,
    done: index >= queue.length,
    guessEvaluation,
    start,
    reveal,
    toggleReveal,
    grade,
    submitGuess,
    continueAfterGuess,
  };
}
