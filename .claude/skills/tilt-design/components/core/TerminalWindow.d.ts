import * as React from 'react';
/** Terminal window chrome hosting the agent session and the Tilt panel. Only element with a shadow. */
export interface TerminalWindowProps {
  /** Centered title in the chrome bar */
  title?: string;
  maxWidth?: string | number;
  children?: React.ReactNode;
}
export declare function TerminalWindow(props: TerminalWindowProps): JSX.Element;
