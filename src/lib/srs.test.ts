import { describe, expect, it } from 'vitest';
import { DAY_IN_MS, MIN_EASE_FACTOR, reviewSRS } from './srs';
import type { SRSData } from '../types';

const NOW = Date.UTC(2026, 0, 1);

function makeSRS(overrides: Partial<SRSData> = {}): SRSData {
  return {
    interval: 0,
    repetitions: 0,
    easeFactor: 2.5,
    dueAt: NOW,
    lastReviewedAt: null,
    ...overrides,
  };
}

describe('reviewSRS (SM-2)', () => {
  it('new card grade 5 => interval 1', () => {
    const result = reviewSRS(makeSRS(), 5, NOW);

    expect(result.interval).toBe(1);
    expect(result.repetitions).toBe(1);
    expect(result.dueAt).toBe(NOW + DAY_IN_MS);
  });

  it('rep1 grade 5 => interval 6', () => {
    const result = reviewSRS(makeSRS({ interval: 1, repetitions: 1 }), 5, NOW);

    expect(result.interval).toBe(6);
    expect(result.repetitions).toBe(2);
  });

  it('rep2+ grade 5 => interval from previous interval * EF', () => {
    const current = makeSRS({ interval: 6, repetitions: 2, easeFactor: 2.5 });
    const result = reviewSRS(current, 5, NOW);

    expect(result.interval).toBe(Math.round(6 * 2.6));
    expect(result.repetitions).toBe(3);
  });

  it('grade 0/2 reset behavior', () => {
    const current = makeSRS({ interval: 20, repetitions: 4, easeFactor: 2.5 });
    const failedHard = reviewSRS(current, 0, NOW);
    const failedSoft = reviewSRS(current, 2, NOW);

    expect(failedHard.repetitions).toBe(0);
    expect(failedHard.interval).toBe(1);
    expect(failedSoft.repetitions).toBe(0);
    expect(failedSoft.interval).toBe(1);
    expect(failedHard.dueAt).toBe(NOW + DAY_IN_MS);
    expect(failedSoft.dueAt).toBe(NOW + DAY_IN_MS);
  });

  it('EF floor 1.3', () => {
    const current = makeSRS({ easeFactor: 1.31, interval: 10, repetitions: 3 });
    const result = reviewSRS(current, 0, NOW);

    expect(result.easeFactor).toBe(MIN_EASE_FACTOR);
  });

  it('EF changes for quality 5 and 3', () => {
    const quality5 = reviewSRS(makeSRS({ easeFactor: 2.5 }), 5, NOW);
    const quality3 = reviewSRS(makeSRS({ easeFactor: 2.5 }), 3, NOW);

    expect(quality5.easeFactor).toBeCloseTo(2.6, 10);
    expect(quality3.easeFactor).toBeCloseTo(2.36, 10);
  });

  it('consecutive failures', () => {
    const first = reviewSRS(makeSRS({ interval: 8, repetitions: 3 }), 2, NOW);
    const second = reviewSRS(first, 1, NOW + DAY_IN_MS);

    expect(first.repetitions).toBe(0);
    expect(first.interval).toBe(1);
    expect(second.repetitions).toBe(0);
    expect(second.interval).toBe(1);
    expect(second.lastReviewedAt).toBe(NOW + DAY_IN_MS);
  });

  it('accelerating intervals over long streaks', () => {
    let current = makeSRS({ interval: 0, repetitions: 0, easeFactor: 2.5 });

    for (let i = 0; i < 8; i += 1) {
      current = reviewSRS(current, 5, NOW + i * DAY_IN_MS);
    }

    expect(current.repetitions).toBe(8);
    expect(current.interval).toBeGreaterThan(6);
    expect(current.interval).toBeGreaterThan(20);
  });
});
