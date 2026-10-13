/** Inline label + value pair: chips, rank, pool. */
export interface StatProps {
  label: string;
  value: string | number;
  /** money = gold bold (chips, pool) · brand = pink · default = fg-1 */
  tone?: 'default' | 'money' | 'brand';
  /** e.g. "#" for rank, "$" for pool */
  prefix?: string;
}
export declare function Stat(props: StatProps): JSX.Element;
