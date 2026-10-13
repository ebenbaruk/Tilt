import * as React from 'react';
/**
 * Keyboard-first action. Every Tilt action has a hotkey; the key letter is always shown.
 * @startingPoint section="Controls" subtitle="Hotkey action buttons" viewport="700x200"
 */
export interface KeyButtonProps {
  /** Hotkey shown in gold, e.g. "H", "␣", "N" */
  keyLabel?: string;
  children?: React.ReactNode;
  onClick?: (e: any) => void;
  /** default: outlined · solid: light fill for the one primary share action · ghost: no border */
  variant?: 'default' | 'solid' | 'ghost';
  disabled?: boolean;
}
export declare function KeyButton(props: KeyButtonProps): JSX.Element;
