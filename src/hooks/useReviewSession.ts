import { useMemo, useState } from 'react';
import type { Person, ReviewCard, ReviewMode, Settings } from '../types';
import { buildReviewQueue, generateCardsForPeople } from '../lib/card-generator';
import { selectDistractors } from '../lib/face-distractors';
import { makeReviewCard, recordReviewEvent, recordSessionSummary } from '../lib/storage';
import { reviewSRS } from '../lib/srs';

export interface GuessEvaluation {
  quality: number;
  matched: boolean;
  feedback: string;
  mode: ReviewMode;
}

function normalize(value: string) {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function evaluateGuess(answer: string, guess: string): GuessEvaluation {
  const normalizedAnswer = normalize(answer);
  const normalizedGuess = normalize(guess);

  if (normalizedGuess === normalizedAnswer) {
    return { quality: 5, matched: true, feedback: 'Correct — great recall.', mode: 'typed_guess' };
  }

  if (normalizedGuess && (normalizedAnswer.includes(normalizedGuess) || normalizedGuess.includes(normalizedAnswer))) {
    return { quality: 3, matched: false, feedback: `Close. Correct answer: ${answer}`, mode: 'typed_guess' };
  }

  return { quality: 1, matched: false, feedback: `Not quite. Correct answer: ${answer}`, mode: 'typed_guess' };
}

function withFaceOptions(cards: ReviewCard[], people: Person[], settings: Settings): ReviewCard[] {
  const optionCount = settings.hardModeEnabled ? settings.facerHardOptionCount : settings.facerOptionCount;
  if (optionCount < 2) return cards;

  return cards.map((card) => {
    if (card.type !== 'face_to_name') return card;

    const distractorPeople = selectDistractors(
      card.personId,
      people,
      Math.max(0, optionCount - 1),
      'similar-first'
    );
    const distractorNames = distractorPeople.map((person) => person.name);
    const options = [card.answer, ...distractorNames]
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort(() => Math.random() - 0.5);
    const correctOptionIndex = options.findIndex((value) => value === card.answer);
    return { ...card, options, correctOptionIndex };
  });
}

export function useReviewSession(people: Person[], settings: Settings | null) {
  const [pool, setPool] = useState<ReviewCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [guessEvaluation, setGuessEvaluation] = useState<GuessEvaluation | null>(null);
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
    const fallback = withFaceOptions(people.map((p) => makeReviewCard(p, 'face_to_name')), people, settings);
    setPool(newPool.length ? newPool : fallback);
    setIndex(0);
    setRevealed(false);
    setGuessEvaluation(null);
    setCorrectInSession(0);
    setIncorrectInSession(0);
    setSessionSummarySaved(false);
  }

  function reveal() {
    setRevealed(true);
  }

  function toggleReveal() {
    setRevealed((value) => !value);
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
    if (outcome === 'accepted') {
      setCorrectInSession(nextCorrect);
    } else {
      setIncorrectInSession(nextIncorrect);
    }

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

    setIndex((value) => value + 1);
    setRevealed(false);
    setGuessEvaluation(null);
  }

  function grade(quality: number) {
    advanceWithQuality(quality, 'manual_grade', quality >= 3 ? 'accepted' : 'rejected');
  }

  function submitGuess(guess: string): GuessEvaluation | null {
    if (!current || current.type !== 'face_to_name') return null;
    const evaluated = evaluateGuess(current.answer, guess);
    setGuessEvaluation(evaluated);
    return evaluated;
  }

  function continueAfterGuess() {
    if (!guessEvaluation) return;
    advanceWithQuality(guessEvaluation.quality, guessEvaluation.mode, guessEvaluation.matched ? 'accepted' : 'rejected');
  }

  function submitChoice(optionIndex: number): GuessEvaluation | null {
    if (!current || current.type !== 'face_to_name') return null;
    const matched = optionIndex === current.correctOptionIndex;
    const feedback = matched ? 'Correct — great recall.' : `Not quite. Correct answer: ${current.answer}`;
    const evaluated = { quality: matched ? 5 : 1, matched, feedback, mode: 'multiple_choice' as const };
    setGuessEvaluation(evaluated);
    return evaluated;
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
    submitChoice,
    continueAfterGuess,
  };
}
