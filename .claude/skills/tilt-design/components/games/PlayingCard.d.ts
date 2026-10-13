/** ASCII playing card drawn with box-drawing characters. Red suits use --tilt-red. */
export interface PlayingCardProps {
  rank?: 'A'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'J'|'Q'|'K';
  suit?: '♠'|'♥'|'♦'|'♣';
  /** Face-down (dealer hole card) */
  hidden?: boolean;
}
export declare function PlayingCard(props: PlayingCardProps): JSX.Element;
export interface HandProps {
  /** "DEALER" | "YOU" */
  label: string;
  total?: string | number;
  meta?: string;
  cards?: PlayingCardProps[];
}
export declare function Hand(props: HandProps): JSX.Element;
