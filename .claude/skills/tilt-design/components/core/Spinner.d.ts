/** Agent activity line: braille spinner, gerund verb, muted meta. */
export interface SpinnerProps {
  /** Gerund, capitalised: "Running tests" */
  verb?: string;
  /** e.g. "2m 14s · esc to interrupt" */
  meta?: string;
}
export declare function Spinner(props: SpinnerProps): JSX.Element;
