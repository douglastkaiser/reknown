export type CardType = 'name_to_face' | 'face_to_name';

export type EnrichMethod = 'linkedin' | 'espn_roster';

export interface Category {
  id: string;
  scope?: string;
  name: string;
  enrichMethod: EnrichMethod;
  espnSport?: string;
  espnLeague?: string;
  espnTeamId?: string;
  espnTeamName?: string;
  espnSeason?: number;
  hiddenFromReview?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Person {
  id: string;
  name: string;
  categoryId: string;
  nicknames?: string[];
  scope?: string;
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
  espnPlayerId?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface EspnSport {
  slug: string;
  leagueSlug: string;
  displayName: string;
}

export interface EspnTeam {
  id: string;
  displayName: string;
  abbreviation: string;
  slug: string;
  logo?: string;
}

export interface EspnPlayer {
  id: string;
  displayName: string;
  fullName: string;
  position: { abbreviation: string; name: string };
  jersey?: string;
  headshot?: { href: string };
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
  /** For name_to_face: photo URLs of options */
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
  id: string;
  scope?: string;
  totalCards: number;
  dueCards: number;
  matureCards: number;
  averageEaseFactor: number;
  totalReviews: number;
  updatedAt: number;
}

export type ReviewOutcome = 'accepted' | 'rejected';
export type ReviewMode = 'typed_guess' | 'multiple_choice';

export interface ReviewEvent {
  id: number;
  /**
   * Firestore document id. Present once the event has been reconciled with
   * cloud sync; used to correlate the numeric IDB key with its remote doc.
   */
  remoteId?: string;
  scope?: string;
  cardId: string;
  cardType: CardType;
  outcome: ReviewOutcome;
  score: number;
  timestamp: number;
  mode: ReviewMode;
}

export interface SessionSummary {
  id: string;
  scope?: string;
  correct: number;
  incorrect: number;
  accuracy: number;
  timestamp: number;
}

export interface AccuracyMetric {
  total: number;
  accepted: number;
  accuracy: number;
}

export interface ReviewMetrics {
  overall: AccuracyMetric;
  faceToName: AccuracyMetric;
  nameToFace: AccuracyMetric;
  trend7d: AccuracyMetric;
  trend30d: AccuracyMetric;
}

export interface Settings {
  id: 'app';
  deckSize: number;
  newCardsWhenQueueSmall: number;
  queueCap: number;
  maturityThreshold: number;
  facerOptionCount: number;
  cardTypeWeights: Record<CardType, number>;
  installPromptDismissedAt: number | null;
  updatedAt: number;
}

export interface CsvPersonRow {
  name: string;
  headline?: string;
  company?: string;
  linkedinUrl?: string;
  photoUrl?: string;
  notes?: string;
}
