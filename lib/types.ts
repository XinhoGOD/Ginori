export type Player = {
  id: string;
  name: string;
  position: string | null;
  team: string | null;
  espnId: string | null;
  gsisId: string | null;
  pfrId: string | null;
  active: boolean | null;
};

export type AdpPoint = {
  capturedAt: string;
  source: string;
  format: string | null;
  adp: number | null;
  auctionValue: number | null;
};

export type WaiverPoint = {
  capturedAt: string;
  lookbackHours: number;
  adds: number | null;
  drops: number | null;
  netAdds: number | null;
  ratio: number | null;
  activityStatus?: "reported" | "partial" | "not_listed";
};

export type MarketMetrics = {
  currentAdp: number | null;
  adpMovement: Record<string, number | null>;
  currentAuctionValue: number | null;
  currentRank: number | null;
  adds: Record<string, number | null>;
  drops: Record<string, number | null>;
  netAdds: Record<string, number | null>;
  ratios: Record<string, number | null>;
  waiverVelocity: number | null;
  acceleration: import("../config/signals").AccelerationLabel;
  adpSources: string[];
};

export type Signal = {
  key: string;
  label: string;
  tone: "positive" | "warning" | "neutral";
  detail: string;
};

export type PlayerProfile = {
  player: Player;
  sourceIds: Array<{
    source: string;
    sourceId: string;
    sourceName: string | null;
    resolveTier: string | null;
  }>;
  metrics: MarketMetrics;
  adpHistory: AdpPoint[];
  waiverHistory: WaiverPoint[];
  signals: Signal[];
  score: number | null;
  scoreBreakdown: Record<string, number>;
  marketInsights: MarketStatInsight[];
  phase2: Phase2Profile;
};

export type WeekOption = {
  season: number;
  week: number;
  label: string;
  locked: boolean;
  current: boolean;
  unlocksAt: string | null;
};

export type WeeklySummaryRow = {
  player: Player;
  season: number;
  week: number;
  opponent: string | null;
  rosteredPct: number | null;
  rosteredChangePct: number | null;
  startedPct: number | null;
  startedChangePct: number | null;
  adds: number | null;
  drops: number | null;
};

export type WeeklyMarket = {
  season: number;
  week: number;
  opponent: string | null;
  kickoffAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  adpStart: number | null;
  adpPregame: number | null;
  adpMovement: number | null;
  adds: number | null;
  drops: number | null;
  netAdds: number | null;
  ratio: number | null;
};

export type StatLine = {
  games: number;
  offensiveSnaps: number | null;
  attempts: number | null;
  completions: number | null;
  passingYards: number | null;
  passingTds: number | null;
  interceptions: number | null;
  rushAttempts: number | null;
  rushingYards: number | null;
  rushingTds: number | null;
  targets: number | null;
  receptions: number | null;
  receivingYards: number | null;
  receivingTds: number | null;
  targetShareAvg: number | null;
  snapPctAvg: number | null;
  routeParticipationAvg: number | null;
  yardsPerReception: number | null;
  touches: number | null;
  opportunityShareAvg: number | null;
};

export type StatGame = StatLine & {
  season: number;
  week: number;
  gameId: string;
  date: string | null;
  team: string | null;
  opponent: string | null;
};

export type OpponentHistory = StatGame;

export type OpponentSummary = {
  opponent: string;
  games: number;
  attemptsAvg: number | null;
  completionsAvg: number | null;
  passingYardsAvg: number | null;
  passingTdsAvg: number | null;
  interceptionsAvg: number | null;
  rushAttemptsAvg: number | null;
  targetsAvg: number | null;
  receptionsAvg: number | null;
  receivingYardsAvg: number | null;
  receivingTdsAvg: number | null;
  rushingYardsAvg: number | null;
  rushingTdsAvg: number | null;
  touchesAvg: number | null;
};

export type DefenseVsPosition = {
  opponent: string;
  position: string;
  games: number;
  rankTotal: number;
  targetsAllowed: number | null;
  receptionsAllowed: number | null;
  receivingYardsAllowed: number | null;
  receivingTdsAllowed: number | null;
  carriesAllowed: number | null;
  rushingYardsAllowed: number | null;
  rushingTdsAllowed: number | null;
  passingYardsAllowed: number | null;
  passingTdsAllowed: number | null;
  interceptionsAllowed: number | null;
  qbRushingYardsAllowed: number | null;
  ranks: Record<string, number | null>;
};

export type MarketStatInsight = {
  key: string;
  label: string;
  tone: "positive" | "warning" | "neutral";
  detail: string;
  evidence: string[];
};

export type Phase2Profile = {
  weeks: WeekOption[];
  selectedWeek: number;
  currentWeek: number;
  weeklyMarket: WeeklyMarket | null;
  statsSeason: number | null;
  seasonStats: StatLine | null;
  previousStatsSeason: number | null;
  previousSeasonStats: StatLine | null;
  recentStats: StatGame[];
  opponentHistory: OpponentHistory[];
  opponentSummary: OpponentSummary | null;
  defenseVsPosition: DefenseVsPosition | null;
};
