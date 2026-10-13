import * as React from 'react';
/** One line of agent session transcript, for context around the Tilt panel in mocks. */
export interface TranscriptLineProps {
  kind?: 'prompt' | 'meta' | 'tool' | 'text' | 'done';
  /** tool: Read, Grep, Edit, Bash… */
  name?: string;
  arg?: string;
  out?: string;
  children?: React.ReactNode;
}
export declare function TranscriptLine(props: TranscriptLineProps): JSX.Element;
