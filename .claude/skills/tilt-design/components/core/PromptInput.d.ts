/** Agent prompt box at the bottom of the terminal. Placeholder reflects who owns the keyboard. */
export interface PromptInputProps {
  placeholder?: string;
  value?: string;
  onChange?: (v: string) => void;
}
export declare function PromptInput(props: PromptInputProps): JSX.Element;
