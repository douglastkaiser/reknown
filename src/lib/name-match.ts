export type NameMatchReason =
  | 'exact-normalized-match'
  | 'near-match'
  | 'partial-high-confidence'
  | 'low-confidence-mismatch'
  | 'empty-input';

export type NameMatchVerdict = 'correct' | 'almost' | 'incorrect';

export interface NameMatchResult {
  accepted: boolean;
  score: number;
  reason: NameMatchReason;
  verdict: NameMatchVerdict;
  normalizedGuess: string;
  normalizedTarget: string;
}

const NEAR_MATCH_THRESHOLD = 0.75;
const ALMOST_MATCH_THRESHOLD = 0.65;
const PARTIAL_TOKEN_THRESHOLD = 0.93;

export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenize(value: string): string[] {
  if (!value) {
    return [];
  }

  return value.split(' ').filter(Boolean);
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }

  for (let col = 0; col < cols; col += 1) {
    matrix[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const substitutionCost = a[row - 1] === b[col - 1] ? 0 : 1;

      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + substitutionCost,
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function similarity(a: string, b: string): number {
  if (!a && !b) {
    return 1;
  }

  if (!a || !b) {
    return 0;
  }

  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);

  return Math.max(0, 1 - distance / maxLength);
}

function tokenSimilarity(a: string | undefined, b: string | undefined): number {
  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  if (a.length === 1 && b.startsWith(a)) {
    return 0.95;
  }

  if (b.length === 1 && a.startsWith(b)) {
    return 0.95;
  }

  return similarity(a, b);
}

function tokenOverlapScore(guessTokens: string[], targetTokens: string[]): number {
  if (!guessTokens.length || !targetTokens.length) {
    return 0;
  }

  const bestMatches = guessTokens.map((guessToken) => {
    let best = 0;

    for (const targetToken of targetTokens) {
      best = Math.max(best, tokenSimilarity(guessToken, targetToken));
    }

    return best;
  });

  return bestMatches.reduce((total, value) => total + value, 0) / bestMatches.length;
}

function orderedTokenScore(guessTokens: string[], targetTokens: string[]): number {
  if (!guessTokens.length || !targetTokens.length || guessTokens.length > targetTokens.length) {
    return 0;
  }

  const scores = guessTokens.map((guessToken, index) =>
    tokenSimilarity(guessToken, targetTokens[index]),
  );

  return scores.reduce((total, value) => total + value, 0) / scores.length;
}

export function matchHumanNameGuess(guess: string, target: string): NameMatchResult {
  const normalizedGuess = normalizeName(guess);
  const normalizedTarget = normalizeName(target);

  if (!normalizedGuess || !normalizedTarget) {
    return {
      accepted: false,
      score: 0,
      reason: 'empty-input',
      verdict: 'incorrect',
      normalizedGuess,
      normalizedTarget,
    };
  }

  if (normalizedGuess === normalizedTarget) {
    return {
      accepted: true,
      score: 1,
      reason: 'exact-normalized-match',
      verdict: 'correct',
      normalizedGuess,
      normalizedTarget,
    };
  }

  const guessTokens = tokenize(normalizedGuess);
  const targetTokens = tokenize(normalizedTarget);

  const fullNameSimilarity = similarity(normalizedGuess, normalizedTarget);
  const overlap = tokenOverlapScore(guessTokens, targetTokens);
  const orderedScore = orderedTokenScore(guessTokens, targetTokens);

  const firstTokenScore = tokenSimilarity(guessTokens[0], targetTokens[0]);
  const lastTokenScore = tokenSimilarity(
    guessTokens[guessTokens.length - 1],
    targetTokens[targetTokens.length - 1],
  );

  const boundaryScore = (firstTokenScore + lastTokenScore) / 2;
  const score = Math.min(
    1,
    fullNameSimilarity * 0.35 + overlap * 0.25 + boundaryScore * 0.2 + orderedScore * 0.2,
  );

  const hasMissingSurname = targetTokens.length >= 2 && guessTokens.length === 1;

  if (score >= NEAR_MATCH_THRESHOLD) {
    return {
      accepted: true,
      score,
      reason: 'near-match',
      verdict: 'correct',
      normalizedGuess,
      normalizedTarget,
    };
  }

  if (
    hasMissingSurname &&
    (firstTokenScore >= PARTIAL_TOKEN_THRESHOLD || lastTokenScore >= PARTIAL_TOKEN_THRESHOLD) &&
    overlap >= PARTIAL_TOKEN_THRESHOLD
  ) {
    return {
      accepted: true,
      score,
      reason: 'partial-high-confidence',
      verdict: 'almost',
      normalizedGuess,
      normalizedTarget,
    };
  }

  if (orderedScore >= PARTIAL_TOKEN_THRESHOLD && lastTokenScore >= PARTIAL_TOKEN_THRESHOLD) {
    return {
      accepted: true,
      score,
      reason: 'partial-high-confidence',
      verdict: 'correct',
      normalizedGuess,
      normalizedTarget,
    };
  }

  if (score >= ALMOST_MATCH_THRESHOLD) {
    return {
      accepted: true,
      score,
      reason: 'near-match',
      verdict: 'almost',
      normalizedGuess,
      normalizedTarget,
    };
  }

  return {
    accepted: false,
    score,
    reason: 'low-confidence-mismatch',
    verdict: 'incorrect',
    normalizedGuess,
    normalizedTarget,
  };
}
