/** Public season leaderboard: top rows, ellipsis, then the player's own row in pink. */
export interface LeaderboardRow { r: number | string; n: string; c: string; }
export interface LeaderboardProps {
  rows: LeaderboardRow[];
  /** The current player; always shown even when far down */
  you?: { r: number | string; c: string };
}
export declare function Leaderboard(props: LeaderboardProps): JSX.Element;
