// JSX for the terminal: `h` builds plain elements, and `toNodes` turns a tree of them into the
// boxes and texts the layout places. The tags are the mod's `ui` (Box, Text, Button, Link).

import { graphemes, graphemeWidth } from "./width";

export const Fragment = Symbol("Fragment");

export interface TermElement {
  type: unknown;
  props: Record<string, unknown>;
  children: unknown[];
}

export function h(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): TermElement {
  return { type, props: props ?? {}, children };
}

export interface Style {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  inverse?: boolean;
}

/** One grapheme cluster on screen, with its width and style. */
export interface Glyph {
  text: string;
  width: number;
  style: Style;
}

export interface TextNode {
  kind: "text";
  /** Hard lines (split on `\n`), each a run of glyphs. */
  lines: Glyph[][];
  isTruncated: boolean;
  /** Ink measures an empty Text as nothing at all: no row. */
  isEmpty: boolean;
}

export type Align = "stretch" | "flex-start" | "center" | "flex-end";
export type Justify = "flex-start" | "center" | "flex-end" | "space-between";

export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BoxNode {
  kind: "box";
  isRow: boolean;
  isWrapped: boolean;
  columnGap: number;
  rowGap: number;
  padding: Edges;
  margin: Edges;
  width: number | undefined;
  minWidth: number | undefined;
  height: number | undefined;
  minHeight: number | undefined;
  grow: number;
  shrink: number;
  alignItems: Align;
  alignSelf: Align | undefined;
  justify: Justify;
  hasBorder: boolean;
  borderColor: string | undefined;
  background: string | undefined;
  children: TermNode[];
}

export type TermNode = BoxNode | TextNode;

const isElement = (value: unknown): value is TermElement =>
  typeof value === "object" && value !== null && "type" in value && "props" in value && "children" in value;

const numberProp = (props: Record<string, unknown>, name: string): number | undefined => {
  const value = props[name];

  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;
};

const stringProp = (props: Record<string, unknown>, name: string): string | undefined => {
  const value = props[name];

  return typeof value === "string" ? value : undefined;
};

/** Ink's shorthand order: `padding`, then `paddingX`/`paddingY`, then each side. */
function edgesOf(props: Record<string, unknown>, prefix: "padding" | "margin"): Edges {
  const all = numberProp(props, prefix) ?? 0;
  const x = numberProp(props, `${prefix}X`) ?? all;
  const y = numberProp(props, `${prefix}Y`) ?? all;

  return {
    top: numberProp(props, `${prefix}Top`) ?? y,
    right: numberProp(props, `${prefix}Right`) ?? x,
    bottom: numberProp(props, `${prefix}Bottom`) ?? y,
    left: numberProp(props, `${prefix}Left`) ?? x,
  };
}

function alignOf(value: unknown): Align | undefined {
  return value === "stretch" || value === "flex-start" || value === "center" || value === "flex-end"
    ? value
    : undefined;
}

function boxOf(props: Record<string, unknown>, children: TermNode[], isColumn = false): BoxNode {
  const gap = numberProp(props, "gap") ?? 0;
  const justify = props.justifyContent;

  return {
    kind: "box",
    isRow: isColumn ? false : props.flexDirection !== "column" && props.flexDirection !== "column-reverse",
    isWrapped: props.flexWrap === "wrap",
    columnGap: numberProp(props, "columnGap") ?? gap,
    rowGap: numberProp(props, "rowGap") ?? gap,
    padding: edgesOf(props, "padding"),
    margin: edgesOf(props, "margin"),
    width: numberProp(props, "width"),
    minWidth: numberProp(props, "minWidth"),
    height: numberProp(props, "height"),
    minHeight: numberProp(props, "minHeight"),
    grow: numberProp(props, "flexGrow") ?? 0,
    shrink: numberProp(props, "flexShrink") ?? 1,
    alignItems: alignOf(props.alignItems) ?? "stretch",
    alignSelf: alignOf(props.alignSelf),
    justify: justify === "center" || justify === "flex-end" || justify === "space-between" ? justify : "flex-start",
    hasBorder: typeof props.borderStyle === "string",
    borderColor: stringProp(props, "borderColor"),
    background: stringProp(props, "backgroundColor"),
    children,
  };
}

function styleOf(props: Record<string, unknown>, parent: Style): Style {
  const flag = (name: string, inherited: boolean | undefined) =>
    typeof props[name] === "boolean" ? (props[name] as boolean) : inherited;

  return {
    fg: stringProp(props, "color") ?? parent.fg,
    bg: stringProp(props, "backgroundColor") ?? parent.bg,
    bold: flag("bold", parent.bold),
    dim: flag("dimColor", parent.dim),
    italic: flag("italic", parent.italic),
    underline: flag("underline", parent.underline),
    strike: flag("strikethrough", parent.strike),
    inverse: flag("inverse", parent.inverse),
  };
}

/** A function tag is called with its props and children; anything else is kept as written. */
function resolved(value: unknown): unknown {
  let current = value;

  while (isElement(current) && typeof current.type === "function") {
    const component = current.type as (props: Record<string, unknown>) => unknown;

    current = component({ ...current.props, children: current.children });
  }

  return current;
}

/** Claude Code's accent (its `claude` theme color), which a plain Button's hotkey is drawn in. */
const HOTKEY_COLOR = "#d77757";

/**
 * What a Button or a Link shows: its children, else its label (a Link's address last). A Button
 * with a hotkey shows it first, as Claude Code's plain Button: the letter in the accent, a colon,
 * then the label (`1: Yes`).
 */
function labelChildren(element: TermElement): unknown[] {
  const content =
    element.children.length > 0
      ? element.children
      : [stringProp(element.props, "label") ?? stringProp(element.props, "href") ?? ""];
  const hotkey = element.type === "Button" ? stringProp(element.props, "hotkey") : undefined;

  return hotkey === undefined || hotkey === ""
    ? content
    : [h("Text", { color: HOTKEY_COLOR }, hotkey), ": ", ...content];
}

/** Whether a Button's children are text only, so it draws inline as a Text. */
function isInline(children: unknown[]): boolean {
  return children.every((child) => {
    const value = resolved(child);

    if (Array.isArray(value)) {
      return isInline(value);
    }

    return !isElement(value) || value.type === "Text" || value.type === "Link" || value.type === "Button";
  });
}

/** The glyphs of a Text's content, nested Texts (and Buttons, Links) adding their styles. */
function glyphsOf(children: unknown[], style: Style, out: Glyph[]): void {
  for (const child of children) {
    const value = resolved(child);

    if (value === null || value === undefined || typeof value === "boolean") {
      continue;
    }

    if (Array.isArray(value)) {
      glyphsOf(value, style, out);
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
      for (const text of graphemes(String(value))) {
        out.push({ text, width: text === "\n" ? 0 : graphemeWidth(text), style });
      }
    } else if (isElement(value)) {
      const isLabelled = value.type === "Button" || value.type === "Link";

      glyphsOf(isLabelled ? labelChildren(value) : value.children, styleOf(value.props, style), out);
    }
  }
}

function textOf(children: unknown[], props: Record<string, unknown>, parent: Style = {}): TextNode {
  const glyphs: Glyph[] = [];

  glyphsOf(children, styleOf(props, parent), glyphs);

  const lines: Glyph[][] = [[]];

  for (const glyph of glyphs) {
    if (glyph.text === "\n" || glyph.text === "\r\n") {
      lines.push([]);
    } else {
      lines[lines.length - 1]?.push(glyph);
    }
  }

  const wrap = props.wrap;

  return {
    kind: "text",
    lines,
    isTruncated: typeof wrap === "string" && wrap.startsWith("truncate"),
    isEmpty: glyphs.length === 0,
  };
}

/** The boxes and texts a JSX tree draws, in order. */
export function toNodes(value: unknown): TermNode[] {
  const node = resolved(value);

  if (node === null || node === undefined || typeof node === "boolean") {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap(toNodes);
  }

  if (!isElement(node)) {
    return [textOf([node], {})];
  }

  const children = node.children;

  switch (node.type) {
    case "Text":
      return [textOf(children, node.props)];
    case "Button":
    case "Link": {
      const label = labelChildren(node);

      return isInline(label) ? [textOf(label, node.props)] : [boxOf({}, label.flatMap(toNodes))];
    }
    case "Box":
      return [boxOf(node.props, children.flatMap(toNodes))];
    default:
      // A fragment, or a tag this surface does not know: Claude Code draws a column Box around the children.
      return [boxOf({}, children.flatMap(toNodes), true)];
  }
}
