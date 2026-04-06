import { useMemo, useState } from 'react';
import type { Person, ReviewCard, ReviewMode, Settings } from '../types';
import { buildReviewQueue, generateCardsForPeople, withFaceOptions } from '../lib/card-generator';
import { makeReviewCard, recordReviewEvent, recordSessionSummary } from '../lib/storage';
import { reviewSRS } from '../lib/srs';
import { matchHumanNameGuess } from '../lib/name-match';

export interface GuessResult {
  quality: number;
  matched: boolean;
  feedback: string;
  mode: ReviewMode;
}

function normalize(value: string) {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function evaluateGuess(answer: string, guess: string): GuessResult {
  if (!normalize(guess)) {
    return { quality: 1, matched: false, feedback: `Incorrect. Correct answer: ${answer}`, mode: 'typed_guess' };
  }

  const match = matchHumanNameGuess(guess, answer);

  if (match.verdict === 'correct') {
    return { quality: 5, matched: true, feedback: 'Correct!', mode: 'typed_guess' };
  }

  if (match.verdict === 'almost') {
    return {
      quality: 4,
      matched: true,
      feedback: `Close enough — answer: ${answer}`,
      mode: 'typed_guess',
    };
  }

  return { quality: 1, matched: false, feedback: `Incorrect. Correct answer: ${answer}`, mode: 'typed_guess' };
}

export function useReviewSession(people: Person[], settings: Settings | null) {
  const [pool, setPool] = useState<ReviewCard[]>([]);
  const [index, setIndex] = useState(0);
  const [guessResult, setGuessResult] = useState<GuessResult | null>(null);
  const [correctInSession, setCorrectInSession] = useState(0);
  const [incorrectInSession, setIncorrectInSession] = useState(0);
  const [sessionSummarySaved, setSessionSummarySaved] = useState(false);

  const queue = useMemo(() => {
    if (!settings) return [];
    const generated = withFaceOptions(generateCardsForPeople(people, settings, settings.deckSize), people, settings);
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
    const newPool = withFaceOptions(generateCardsForPeople(people, settings, settings.deckSize), people, settings);
    const fallback = withFaceOptions(
      people.filter((p) => p.photoDataUrl || p.photoUrl).map((p) => makeReviewCard(p, 'face_to_name')),
      people,
      settings,
    );
    setPool(newPool.length ? newPool : fallback);
    setIndex(0);
    setGuessResult(null);
    setCorrectInSession(0);
    setIncorrectInSession(0);
    setSessionSummarySaved(false);
  }

  function advanceWithQuality(quality: number, mode: ReviewMode, outcome: 'accepted' | 'rejected') {
    if (!current) return;
    const timestamp = Date.now();

    setPool((existing) =>
      existing.map((card) => card.id === current.id ? { ...card, srs: reviewSRS(card.srs, quality), updatedAt: timestamp } : card)
    );

    void recordReviewEvent({
      cardId: current.id,
      cardType: current.type,
      outcome,
      score: quality,
      timestamp,
      mode,
    });

    const nextCorrect = correctInSession + (outcome === 'accepted' ? 1 : 0);
    const nextIncorrect = incorrectInSession + (outcome === 'rejected' ? 1 : 0);
    if (outcome === 'accepted') setCorrectInSession(nextCorrect);
    else setIncorrectInSession(nextIncorrect);

    const nextReviewed = index + 1;
    if (!sessionSummarySaved && nextReviewed >= queue.length) {
      const total = nextCorrect + nextIncorrect;
      void recordSessionSummary({
        correct: nextCorrect,
        incorrect: nextIncorrect,
        accuracy: total ? (nextCorrect / total) * 100 : 0,
        timestamp,
      });
      setSessionSummarySaved(true);
    }

    setIndex((v) => v + 1);
    setGuessResult(null);
  }

  function submitGuess(guess: string): GuessResult | null {
    if (!current || current.type !== 'face_to_name') return null;
    const result = evaluateGuess(current.answer, guess);
    setGuessResult(result);
    return result;
  }

  function submitFaceChoice(optionIndex: number): GuessResult | null {
    if (!current || current.type !== 'name_to_face') return null;
    const matched = optionIndex === current.correctOptionIndex;
    const result: GuessResult = {
      quality: matched ? 5 : 1,
      matched,
      feedback: matched ? 'Correct!' : 'Incorrect.',
      mode: 'multiple_choice',
    };
    setGuessResult(result);
    return result;
  }

  function continueAfterGuess() {
    if (!guessResult) return;
    advanceWithQuality(guessResult.quality, guessResult.mode, guessResult.matched ? 'accepted' : 'rejected');
  }

  return {
    queue,
    current,
    index,
    done: index >= queue.length,
    guessResult,
    start,
    submitGuess,
    submitFaceChoice,
    continueAfterGuess,
  };
}
