/** Game switcher inside the panel header. Numeric hotkeys 1–9. */
export interface GameTab { id: string; keyLabel: string; label: string; }
export interface GameTabsProps {
  tabs: GameTab[];
  active: string;
  onChange?: (id: string) => void;
}
export declare function GameTabs(props: GameTabsProps): JSX.Element;
