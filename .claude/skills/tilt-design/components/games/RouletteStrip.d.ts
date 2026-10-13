/** Horizontal roulette window centred on the ball pocket, gold ring on the hit. */
export interface RouletteStripProps {
  /** Pocket 0–36 the ball sits on */
  value?: number;
  /** Pockets shown either side (default 4 → 9 cells) */
  reach?: number;
}
export declare function RouletteStrip(props: RouletteStripProps): JSX.Element;
export declare function pocketColor(n: number): 'red' | 'black' | 'green';
