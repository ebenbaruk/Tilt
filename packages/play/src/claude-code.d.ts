// The few Claude Code types the mod's view files name (apps/mod/hooks/*.tsx), declared for type
// checking here: Claude Code ships its own only to a machine where the mod has loaded once
// (apps/mod/.claude-plugin/types, git-ignored). At run time `./term` supplies `h`, `Fragment` and
// the elements, so nothing below exists as code.

declare module "claude-code" {
  /** One drawn element; `./term` builds and lays them out. */
  export type RenderElement = object;

  type ElementProps = { readonly [prop: string]: unknown };
  type Component = (props: ElementProps) => RenderElement;

  export interface Elements {
    terminal: { Box: Component; Text: Component; Button: Component; Link: Component };
  }
}

declare const h: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => object;
declare const Fragment: symbol;

declare namespace JSX {
  type Element = object;
  interface IntrinsicAttributes {
    key?: string | number;
  }
  interface ElementChildrenAttribute {
    children: unknown;
  }
}
