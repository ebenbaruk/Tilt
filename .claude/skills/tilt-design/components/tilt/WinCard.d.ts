/**
 * Big-win banner with sponsor credit and share actions. Shown when net win ≥ 700 chips.
 * @startingPoint section="Moments" subtitle="Shareable big-win banner" viewport="700x200"
 */
export interface WinCardProps {
  /** Formatted net win, e.g. "1,250" */
  amount: string;
  game?: string;
  sponsor?: string;
  /** Share-card quote; defaults to "won {amount} on {game} while my agent shipped" */
  caption?: string;
  onShare?: (network: 'x' | 'tiktok') => void;
  /** e.g. "card copied · link ready" */
  shareStatus?: string;
}
export declare function WinCard(props: WinCardProps): JSX.Element;
