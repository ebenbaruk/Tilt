import * as React from 'react';
/** Full-width bar at the top of the panel body. Primary use: the agent has finished. */
export interface NoticeProps {
  tone?: 'success' | 'info';
  children?: React.ReactNode;
  /** Right-aligned inline actions (KeyButton variant="ghost" or plain spans) */
  actions?: React.ReactNode;
}
export declare function Notice(props: NoticeProps): JSX.Element;
