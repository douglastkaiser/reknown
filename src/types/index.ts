export type CardType = 'name_to_face' | 'face_to_name' | 'headline' | 'company';

export interface Person {
  id: string;
  name: string;
  similarity?: {
    normalizedDescriptors?: string[];
    clusterIds?: string[];
    nearestNeighborIds?: string[];
  };
  headline?: string;
  company?: string;
  notes?: string;
  photoDataUrl?: string;
  photoUrl?: string;
  linkedinUrl?: string;
  tags?: string[];
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
  type: CardType;
  prompt: string;
  answer: string;
  options?: string[];
  correctOptionIndex?: number;
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
  id: 'app';
  totalCards: number;
  dueCards: number;
  matureCards: number;
  averageEaseFactor: number;
  totalReviews: number;
  updatedAt: number;
}

export interface Settings {
  id: 'app';
  deckSize: number;
  newCardsWhenQueueSmall: number;
  queueCap: number;
  maturityThreshold: number;
  facerOptionCount: number;
  facerHardOptionCount: number;
  hardModeEnabled: boolean;
  cardTypeWeights: Record<CardType, number>;
  installPromptDismissedAt: number | null;
  updatedAt: number;
}

export interface ReviewGrade {
  cardId: string;
  quality: number;
  reviewedAt: number;
}

export interface CsvPersonRow {
  name: string;
  headline?: string;
  company?: string;
  linkedinUrl?: string;
  photoUrl?: string;
  notes?: string;
}
