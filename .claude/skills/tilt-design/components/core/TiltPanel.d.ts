import * as React from 'react';
/**
 * The Tilt panel: pink-framed region inside the agent session. Header (wordmark, tabs, stats), optional notice, game area, optional sponsor sidebar.
 * @startingPoint section="Layout" subtitle="Empty Tilt panel shell" viewport="1000x360"
 */
export interface TiltPanelProps {
  season?: string;
  /** Usually <GameTabs/> */
  tabs?: React.ReactNode;
  /** Usually <Stat/>s, right-aligned */
  stats?: React.ReactNode;
  /** Usually <Notice/> when the agent finishes */
  notice?: React.ReactNode;
  /** Sidebar content (SponsorBlock + Leaderboard). Omit to go single-column. */
  side?: React.ReactNode;
  children?: React.ReactNode;
}
export declare function TiltPanel(props: TiltPanelProps): JSX.Element;
