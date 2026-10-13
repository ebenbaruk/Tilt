/** Single slot reel window; symbols are unicode glyphs. */
export interface SlotReelProps {
  /** One of 7 ◆ ★ ♣ ¤ */
  symbol?: string;
  size?: number;
}
export declare function SlotReel(props: SlotReelProps): JSX.Element;
export interface SlotMachineProps { symbols?: string[]; }
export declare function SlotMachine(props: SlotMachineProps): JSX.Element;
