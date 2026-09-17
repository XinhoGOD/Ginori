export const LIVE_SOURCES = {
  espn: (season: number) =>
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info`,
  sleeperState: "https://api.sleeper.app/v1/state/nfl",
  sleeperProjections: (season: number) => `https://api.sleeper.app/v1/projections/nfl/regular/${season}`,
  yahooPlayers: (start: number, count: number) =>
    `https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/game/nfl/players;position=ALL;count=${count};start=${start};sort=AR/draft_analysis?format=json_f`,
} as const;
