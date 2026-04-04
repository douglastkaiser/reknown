import type { SRSData } from '../types';

const MIN_EASE_FACTOR = 1.3;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function calculateEaseFactor(easeFactor: number, quality: number): number {
  const nextEaseFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  return Math.max(MIN_EASE_FACTOR, nextEaseFactor);
}

export function reviewSRS(current: SRSData, quality: number, now: number = Date.now()): SRSData {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) {
    throw new Error('Quality must be an integer from 0 to 5.');
  }

  const easeFactor = calculateEaseFactor(current.easeFactor, quality);

  if (quality < 3) {
    return {
      ...current,
      interval: 1,
      repetitions: 0,
      easeFactor,
      lastReviewedAt: now,
      dueAt: now + DAY_IN_MS,
    };
  }

  const repetitions = current.repetitions + 1;

  let interval: number;
  if (repetitions === 1) {
    interval = 1;
  } else if (repetitions === 2) {
    interval = 6;
  } else {
    interval = Math.round(current.interval * easeFactor);
  }

  return {
    ...current,
    interval,
    repetitions,
    easeFactor,
    lastReviewedAt: now,
    dueAt: now + interval * DAY_IN_MS,
  };
}

export { MIN_EASE_FACTOR, DAY_IN_MS };
