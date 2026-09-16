import { sleeperFetch } from './client';

export type SleeperPlayer = {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  team?: string | null;
  position?: string | null;
  sport?: string;
  active?: boolean;
  espn_id?: string | null;
};

export async function fetchSleeperPlayers() {
  return sleeperFetch<Record<string, SleeperPlayer>>('https://api.sleeper.app/v1/players/nfl');
}
