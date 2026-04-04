export interface Person {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface SRSData {
  interval: number;
  repetitions: number;
  easeFactor: number;
  dueAt: number;
  lastReviewedAt: number | null;
}

export interface ReviewCard {
  id: string;
  personId: Person['id'];
  prompt: string;
  answer: string;
  srs: SRSData;
  createdAt: number;
  updatedAt: number;
}

export interface SessionStats {
  reviewed: number;
  correct: number;
  incorrect: number;
  startedAt: number;
  endedAt: number | null;
}

export interface AppStats {
  totalCards: number;
  dueCards: number;
  matureCards: number;
  averageEaseFactor: number;
  totalReviews: number;
}
