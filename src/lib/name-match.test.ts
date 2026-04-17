import { describe, expect, it } from 'vitest';
import { matchHumanNameGuess, normalizeName } from './name-match';

describe('normalizeName', () => {
  it('trims, lowercases, strips punctuation/diacritics, and collapses whitespace', () => {
    expect(normalizeName('  José   O\'Neill-Smith!  ')).toBe('jose o neill smith');
  });
});

describe('matchHumanNameGuess', () => {
  it('accepts minor typos as near matches', () => {
    const result = matchHumanNameGuess('Jhon Smth', 'John Smith');

    expect(result.accepted).toBe(true);
    expect(result.reason).toBe('near-match');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('accepts transposed characters', () => {
    const result = matchHumanNameGuess('Ailce Johnson', 'Alice Johnson');

    expect(result.accepted).toBe(true);
    expect(result.verdict).toBe('correct');
  });

  it('allows missing surname when confidence is high', () => {
    const result = matchHumanNameGuess('Madonna', 'Madonna Ciccone');

    expect(result.accepted).toBe(true);
    expect(result.reason).toBe('partial-high-confidence');
    expect(result.verdict).toBe('almost');
  });

  it('accepts surname-only guess', () => {
    const result = matchHumanNameGuess('Messi', 'Lionel Messi');

    expect(result.accepted).toBe(true);
    expect(result.reason).toBe('partial-high-confidence');
    expect(result.verdict).toBe('almost');
  });

  it('accepts an exact nickname token from a longer name', () => {
    const result = matchHumanNameGuess('Elle', 'Donnelly (Elle) Carroll');

    expect(result.accepted).toBe(true);
    expect(result.reason).toBe('partial-high-confidence');
  });

  it('rejects a single-letter guess for longer names', () => {
    const result = matchHumanNameGuess('a', 'alex');

    expect(result.accepted).toBe(false);
    expect(result.verdict).toBe('incorrect');
  });

  it('handles initials and punctuation as acceptable guesses', () => {
    const result = matchHumanNameGuess('J. R. R. Tolkien', 'John Ronald Reuel Tolkien');

    expect(result.accepted).toBe(true);
    expect(['near-match', 'partial-high-confidence']).toContain(result.reason);
  });

  it('rejects clearly wrong names', () => {
    const result = matchHumanNameGuess('Bruce Wayne', 'Diana Prince');

    expect(result.accepted).toBe(false);
    expect(result.verdict).toBe('incorrect');
    expect(result.reason).toBe('low-confidence-mismatch');
  });
});
