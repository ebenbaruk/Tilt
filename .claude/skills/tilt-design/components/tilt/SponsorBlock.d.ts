/** Season sponsor slot: name set in type, tied to the prize pool. */
export interface SponsorBlockProps {
  /** Sponsor name as plain text (logos are optional, monochrome only) */
  name: string;
  pool?: string;
  endsIn?: string;
}
export declare function SponsorBlock(props: SponsorBlockProps): JSX.Element;
