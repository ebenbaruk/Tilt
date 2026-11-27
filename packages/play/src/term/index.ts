// Draws the Claude Code mod's view (apps/mod/hooks/view.tsx) in any terminal: `h`/`Fragment` are
// the JSX factory the view's files compile to, `termUi` the elements it draws with, and
// `renderLines` lays the tree out as Ink would and paints it as rows of text, exactly `width`
// columns each, with ANSI styles only when asked.

import { arrange, heightAt, textLines } from "./layout";
import { Fragment, type Glyph, h, type Style, type TermNode, toNodes } from "./tree";

export { Fragment, h };
export type { TermElement } from "./tree";

export const termUi = { Box: "Box", Text: "Text", Button: "Button", Link: "Link" } as const;

/**
 * Runs `draw` with `globalThis.h` and `globalThis.Fragment` set to ours, which the view's files
 * call (their JSX pragmas), then puts back whatever the host had there.
 */
export function withJsx<T>(draw: () => T): T {
  const names = ["h", "Fragment"] as const;
  const host = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));

  Object.assign(globalThis, { h, Fragment });

  try {
    return draw();
  } finally {
    names.forEach((name, index) => {
      const own = host[index];

      if (own === undefined) {
        Reflect.deleteProperty(globalThis, name);
      } else {
        Object.defineProperty(globalThis, name, own);
      }
    });
  }
}

export interface RenderOptions {
  width: number;
  color: boolean;
}

/** One screen cell: a glyph, or the second half of a wide one (`width` 0). */
type Cell = Glyph;

const BLANK: Cell = { text: " ", width: 1, style: {} };
const RESET = "\x1b[0m";
/** Claude Code's `inactive` grey, readable on dark and light grounds. */
const INACTIVE_RGB: readonly [number, number, number] = [153, 153, 153];
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function rgbOf(color: string | undefined): readonly [number, number, number] | null {
  if (color === "inactive") {
    return INACTIVE_RGB;
  }

  const match = color === undefined ? null : HEX.exec(color);

  if (match === null) {
    return null;
  }

  const hex = match[1] ?? "";
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
  const channel = (at: number) => Number.parseInt(full.slice(at, at + 2), 16);

  return [channel(0), channel(2), channel(4)];
}

function sgrOf(style: Style): string {
  const codes: string[] = [];
  const fg = rgbOf(style.fg);
  const bg = rgbOf(style.bg);

  if (style.bold === true) codes.push("1");
  if (style.dim === true) codes.push("2");
  if (style.italic === true) codes.push("3");
  if (style.underline === true) codes.push("4");
  if (style.inverse === true) codes.push("7");
  if (style.strike === true) codes.push("9");
  if (fg !== null) codes.push(`38;2;${fg.join(";")}`);
  if (bg !== null) codes.push(`48;2;${bg.join(";")}`);

  return codes.length === 0 ? "" : `\x1b[${codes.join(";")}m`;
}

// Fields are declared, not constructor parameter properties: Node only strips erasable syntax.
class Canvas {
  readonly width: number;
  readonly rows: Cell[][];

  constructor(width: number, height: number) {
    this.width = width;
    this.rows = Array.from({ length: height }, () => Array.from({ length: width }, () => BLANK));
  }

  /** Writes a glyph at a cell, keeping the ground's background under a glyph that has none. */
  put(x: number, y: number, glyph: Glyph): void {
    const row = this.rows[y];

    if (row === undefined || x < 0 || x >= this.width || glyph.width === 0) {
      return;
    }

    // A wide glyph with one column left is drawn as a space, as a terminal would.
    const shown = glyph.width === 2 && x + 1 >= this.width ? { ...glyph, text: " ", width: 1 } : glyph;
    const under = row[x] ?? BLANK;

    this.split(row, x);

    if (shown.width === 2) {
      this.split(row, x + 1);
    }

    const style = shown.style.bg === undefined ? { ...shown.style, bg: under.style.bg } : shown.style;

    row[x] = { text: shown.text, width: shown.width, style };

    if (shown.width === 2) {
      row[x + 1] = { text: "", width: 0, style };
    }
  }

  /** Before a cell is overwritten: the wide glyph it is half of becomes a space. */
  private split(row: Cell[], x: number): void {
    const cell = row[x];

    if (cell?.width === 0 && x > 0) {
      row[x - 1] = { text: " ", width: 1, style: row[x - 1]?.style ?? {} };
    } else if (cell?.width === 2 && x + 1 < this.width) {
      row[x + 1] = { text: " ", width: 1, style: cell.style };
    }
  }

  fill(x: number, y: number, width: number, height: number, background: string): void {
    for (let row = y; row < y + height; row++) {
      for (let column = x; column < x + width; column++) {
        this.put(column, row, { text: " ", width: 1, style: { bg: background } });
      }
    }
  }

  line(row: Cell[], color: boolean): string {
    let out = "";
    let current = "";

    for (const cell of row) {
      if (cell.width === 0) {
        continue;
      }

      if (color) {
        const sgr = sgrOf(cell.style);

        if (sgr !== current) {
          out += (current === "" ? "" : RESET) + sgr;
          current = sgr;
        }
      }

      out += cell.text;
    }

    return current === "" ? out : out + RESET;
  }
}

function paintBorder(canvas: Canvas, x: number, y: number, width: number, height: number, color?: string): void {
  if (width < 2 || height < 2) {
    return;
  }

  const style: Style = { fg: color };
  const right = x + width - 1;
  const bottom = y + height - 1;

  for (let column = x + 1; column < right; column++) {
    canvas.put(column, y, { text: "─", width: 1, style });
    canvas.put(column, bottom, { text: "─", width: 1, style });
  }

  for (let row = y + 1; row < bottom; row++) {
    canvas.put(x, row, { text: "│", width: 1, style });
    canvas.put(right, row, { text: "│", width: 1, style });
  }

  canvas.put(x, y, { text: "╭", width: 1, style });
  canvas.put(right, y, { text: "╮", width: 1, style });
  canvas.put(x, bottom, { text: "╰", width: 1, style });
  canvas.put(right, bottom, { text: "╯", width: 1, style });
}

function paint(canvas: Canvas, node: TermNode, x: number, y: number, width: number, height: number): void {
  if (node.kind === "text") {
    textLines(node, width).forEach((line, row) => {
      let column = x;

      for (const glyph of line) {
        canvas.put(column, y + row, glyph);
        column += glyph.width;
      }
    });

    return;
  }

  const border = node.hasBorder ? 1 : 0;

  if (node.background !== undefined) {
    canvas.fill(x + border, y + border, width - 2 * border, height - 2 * border, node.background);
  }

  if (node.hasBorder) {
    paintBorder(canvas, x, y, width, height, node.borderColor);
  }

  for (const item of arrange(node, width, height).items) {
    paint(canvas, item.node, x + item.x, y + item.y, item.width, item.height);
  }
}

/** The tree drawn `width` columns wide: one string per row, each exactly `width` columns. */
export function renderLines(node: unknown, options: RenderOptions): string[] {
  const width = Math.max(0, Math.floor(options.width));
  // The root is a column as wide as the terminal, as Ink's.
  const [root] = toNodes(h(Fragment, null, node));

  if (root === undefined) {
    return [];
  }

  const height = heightAt(root, width);
  const canvas = new Canvas(width, height);

  paint(canvas, root, 0, 0, width, height);

  return canvas.rows.map((row) => canvas.line(row, options.color));
}
