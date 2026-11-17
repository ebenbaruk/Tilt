// A Yoga subset, as Ink lays out a Box tree: measure each node, then place its children. Rows lay
// their items left to right (wrapping onto new lines with `flexWrap`), columns stack them; free
// space on the main axis goes to `flexGrow`, missing space is taken by `flexShrink` (in proportion to
// size, as Yoga does); the cross axis stretches, centers or starts each item. Every size is a whole
// number of cells: Yoga rounds edges to the grid, so the rounding is done on cumulative edges.

import type { Align, BoxNode, Edges, Glyph, TermNode, TextNode } from "./tree";

const ELLIPSIS = "…";
const NO_EDGES: Edges = { top: 0, right: 0, bottom: 0, left: 0 };

/** A child placed inside its parent's border box. */
export interface Placed {
  node: TermNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Arranged {
  items: Placed[];
  contentHeight: number;
}

/** How a node sits in its parent's flow: a Text as a Box with no layout props of its own. */
interface Item {
  margin: Edges;
  width: number | undefined;
  minWidth: number | undefined;
  height: number | undefined;
  minHeight: number | undefined;
  grow: number;
  shrink: number;
  alignSelf: Align | undefined;
}

const TEXT_ITEM: Item = {
  margin: NO_EDGES,
  width: undefined,
  minWidth: undefined,
  height: undefined,
  minHeight: undefined,
  grow: 0,
  shrink: 1,
  alignSelf: undefined,
};

const itemOf = (node: TermNode): Item => (node.kind === "box" ? node : TEXT_ITEM);

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

const lineWidth = (line: readonly Glyph[]): number => sum(line.map((glyph) => glyph.width));

const atLeast = (value: number, min: number | undefined): number => Math.max(value, min ?? 0);

/** Padding plus border on each side. */
function chromeOf(box: BoxNode): Edges {
  const border = box.hasBorder ? 1 : 0;

  return {
    top: box.padding.top + border,
    right: box.padding.right + border,
    bottom: box.padding.bottom + border,
    left: box.padding.left + border,
  };
}

function truncated(line: Glyph[], width: number): Glyph[] {
  if (lineWidth(line) <= width) {
    return line;
  }

  const kept: Glyph[] = [];
  let used = 0;

  for (const glyph of line) {
    if (used + glyph.width > width - 1) {
      kept.push({ text: ELLIPSIS, width: 1, style: glyph.style });
      break;
    }

    kept.push(glyph);
    used += glyph.width;
  }

  return kept;
}

/** Word wrap as Ink's (wrap-ansi, hard): break at spaces, split a word longer than the width. */
function wrapped(line: Glyph[], width: number): Glyph[][] {
  const rows: Glyph[][] = [[]];
  let used = 0;
  const newRow = () => {
    rows.push([]);
    used = 0;
  };
  const put = (glyph: Glyph) => {
    rows[rows.length - 1]?.push(glyph);
    used += glyph.width;
  };
  const tokens: { glyphs: Glyph[]; isSpace: boolean }[] = [];

  for (const glyph of line) {
    const isSpace = glyph.text === " ";
    const last = tokens[tokens.length - 1];

    if (last !== undefined && last.isSpace === isSpace) {
      last.glyphs.push(glyph);
    } else {
      tokens.push({ glyphs: [glyph], isSpace });
    }
  }

  for (const { glyphs, isSpace } of tokens) {
    const tokenWidth = lineWidth(glyphs);

    if (used + tokenWidth <= width) {
      glyphs.forEach(put);
    } else if (isSpace) {
      // The spaces a line breaks at are dropped.
      newRow();
    } else if (used > 0 && tokenWidth <= width) {
      const row = rows[rows.length - 1] ?? [];

      while (row.length > 0 && row[row.length - 1]?.text === " ") {
        row.pop();
      }

      newRow();
      glyphs.forEach(put);
    } else {
      for (const glyph of glyphs) {
        if (used > 0 && used + glyph.width > width) {
          newRow();
        }

        put(glyph);
      }
    }
  }

  return rows;
}

const linesCache = new WeakMap<TextNode, Map<number, Glyph[][]>>();

/** The rows a Text draws at `width` columns: wrapped, or one per hard line cut with an ellipsis. */
export function textLines(node: TextNode, width: number): Glyph[][] {
  if (node.isEmpty) {
    return [];
  }

  const cache = linesCache.get(node) ?? new Map<number, Glyph[][]>();
  const cached = cache.get(width);

  if (cached !== undefined) {
    return cached;
  }

  const columns = Math.max(1, width);
  const lines = node.isTruncated
    ? node.lines.map((line) => truncated(line, columns))
    : node.lines.flatMap((line) => wrapped(line, columns));

  cache.set(width, lines);
  linesCache.set(node, cache);

  return lines;
}

const maxCache = new WeakMap<TermNode, number>();

/** The width a node takes with all the room it wants: no wrapping, no shrinking. */
export function maxContentWidth(node: TermNode): number {
  const cached = maxCache.get(node);

  if (cached !== undefined) {
    return cached;
  }

  let width: number;

  if (node.kind === "text") {
    width = Math.max(0, ...node.lines.map(lineWidth));
  } else if (node.width !== undefined) {
    width = atLeast(node.width, node.minWidth);
  } else {
    const chrome = chromeOf(node);
    const outer = node.children.map((child) => {
      const margin = itemOf(child).margin;

      return maxContentWidth(child) + margin.left + margin.right;
    });
    const content = node.isRow ? sum(outer) + node.columnGap * Math.max(0, outer.length - 1) : Math.max(0, ...outer);

    width = atLeast(content + chrome.left + chrome.right, node.minWidth);
  }

  maxCache.set(node, width);

  return width;
}

/** The height a node takes at `width` columns. */
export function heightAt(node: TermNode, width: number): number {
  if (node.kind === "text") {
    return textLines(node, width).length;
  }

  if (node.height !== undefined) {
    return atLeast(node.height, node.minHeight);
  }

  const chrome = chromeOf(node);

  return atLeast(arrange(node, width, null).contentHeight + chrome.top + chrome.bottom, node.minHeight);
}

/**
 * Sizes along the main axis: free space shared by `flexGrow`, missing space taken by `flexShrink`
 * weighted by size (an item stops at its minimum, the rest share what is left), then rounded on
 * cumulative edges so the whole stays whole.
 */
function flexSizes(bases: number[], items: Item[], mins: (number | undefined)[], free: number): number[] {
  const sizes = [...bases];

  if (free > 0) {
    const totalGrow = sum(items.map((item) => item.grow));

    if (totalGrow > 0) {
      items.forEach((item, index) => {
        sizes[index] = (sizes[index] ?? 0) + (free * item.grow) / totalGrow;
      });
    }
  } else if (free < 0) {
    const frozen = new Set<number>();
    let missing = -free;

    for (;;) {
      const active = bases.map((_, index) => index).filter((index) => !frozen.has(index));
      const weight = sum(active.map((index) => (items[index]?.shrink ?? 0) * (bases[index] ?? 0)));

      if (weight === 0 || missing <= 0) {
        break;
      }

      const clamped = active.filter((index) => {
        const base = bases[index] ?? 0;
        const next = base - (missing * (items[index]?.shrink ?? 0) * base) / weight;

        return next < (mins[index] ?? 0);
      });

      if (clamped.length === 0) {
        active.forEach((index) => {
          const base = bases[index] ?? 0;

          sizes[index] = base - (missing * (items[index]?.shrink ?? 0) * base) / weight;
        });
        break;
      }

      clamped.forEach((index) => {
        const min = mins[index] ?? 0;

        missing -= (bases[index] ?? 0) - min;
        sizes[index] = min;
        frozen.add(index);
      });
    }
  }

  let total = 0;
  let edge = 0;

  return sizes.map((size) => {
    total += Math.max(0, size);
    const next = Math.round(total);
    const whole = next - edge;

    edge = next;

    return whole;
  });
}

/** The leading offset and the extra gap `justifyContent` gives `remaining` free cells. */
function justified(box: BoxNode, remaining: number, count: number): { start: number; between: number } {
  if (remaining <= 0) {
    return { start: 0, between: 0 };
  }

  switch (box.justify) {
    case "center":
      return { start: Math.round(remaining / 2), between: 0 };
    case "flex-end":
      return { start: remaining, between: 0 };
    case "space-between":
      return { start: 0, between: count > 1 ? remaining / (count - 1) : 0 };
    default:
      return { start: 0, between: 0 };
  }
}

/** Where a cross size `size` sits in `room` cells. */
function crossOffset(align: Align, room: number, size: number): number {
  if (align === "center") {
    return Math.round((room - size) / 2);
  }

  return align === "flex-end" ? room - size : 0;
}

function arrangeRow(box: BoxNode, chrome: Edges, innerWidth: number, innerHeight: number | null): Arranged {
  const entries = box.children.map((node) => {
    const item = itemOf(node);
    const marginX = item.margin.left + item.margin.right;
    const base = atLeast(
      item.width ?? Math.min(maxContentWidth(node), Math.max(0, innerWidth - marginX)),
      item.minWidth,
    );

    return { node, item, marginX, marginY: item.margin.top + item.margin.bottom, base };
  });
  const lines: (typeof entries)[] = [];
  let lineUsed = 0;

  for (const entry of entries) {
    const outer = entry.base + entry.marginX;
    const line = lines[lines.length - 1];

    if (line === undefined || (box.isWrapped && line.length > 0 && lineUsed + box.columnGap + outer > innerWidth)) {
      lines.push([entry]);
      lineUsed = outer;
    } else {
      line.push(entry);
      lineUsed += box.columnGap + outer;
    }
  }

  const items: Placed[] = [];
  let lineY = chrome.top;

  lines.forEach((line, lineIndex) => {
    const gaps = box.columnGap * (line.length - 1);
    const used = sum(line.map((entry) => entry.base + entry.marginX)) + gaps;
    const widths = flexSizes(
      line.map((entry) => entry.base),
      line.map((entry) => entry.item),
      line.map((entry) => entry.item.minWidth),
      innerWidth - used,
    );
    const heights = line.map((entry, index) =>
      atLeast(entry.item.height ?? heightAt(entry.node, widths[index] ?? 0), entry.item.minHeight),
    );
    const lineHeight =
      !box.isWrapped && innerHeight !== null
        ? innerHeight
        : Math.max(0, ...line.map((entry, index) => (heights[index] ?? 0) + entry.marginY));
    const remaining = innerWidth - sum(widths) - sum(line.map((entry) => entry.marginX)) - gaps;
    const { start, between } = justified(box, remaining, line.length);
    let x = chrome.left + start;

    line.forEach((entry, index) => {
      const width = widths[index] ?? 0;
      const align = entry.item.alignSelf ?? box.alignItems;
      const isStretched = align === "stretch" && entry.item.height === undefined;
      const height = isStretched ? Math.max(0, lineHeight - entry.marginY) : (heights[index] ?? 0);

      x += entry.item.margin.left;
      items.push({
        node: entry.node,
        x: Math.round(x),
        y: lineY + entry.item.margin.top + crossOffset(align, lineHeight - entry.marginY, height),
        width,
        height,
      });
      x += width + entry.item.margin.right + box.columnGap + between;
    });

    lineY += lineHeight + (lineIndex < lines.length - 1 ? box.rowGap : 0);
  });

  return { items, contentHeight: lineY - chrome.top };
}

function arrangeColumn(box: BoxNode, chrome: Edges, innerWidth: number, innerHeight: number | null): Arranged {
  const entries = box.children.map((node) => {
    const item = itemOf(node);
    const align = item.alignSelf ?? box.alignItems;
    const marginX = item.margin.left + item.margin.right;
    const room = Math.max(0, innerWidth - marginX);
    const width = atLeast(
      item.width ?? (align === "stretch" ? room : Math.min(maxContentWidth(node), room)),
      item.minWidth,
    );
    const base = atLeast(item.height ?? heightAt(node, width), item.minHeight);

    return { node, item, align, marginX, marginY: item.margin.top + item.margin.bottom, width, base };
  });
  const gaps = box.rowGap * Math.max(0, entries.length - 1);
  const used = sum(entries.map((entry) => entry.base + entry.marginY)) + gaps;
  const heights =
    innerHeight === null
      ? entries.map((entry) => entry.base)
      : flexSizes(
          entries.map((entry) => entry.base),
          entries.map((entry) => entry.item),
          entries.map((entry) => entry.item.minHeight),
          innerHeight - used,
        );
  const contentHeight = sum(heights) + sum(entries.map((entry) => entry.marginY)) + gaps;
  const { start, between } = justified(box, (innerHeight ?? contentHeight) - contentHeight, entries.length);
  let y = chrome.top + start;
  const items = entries.map((entry, index) => {
    const height = heights[index] ?? 0;

    y += entry.item.margin.top;

    const placed = {
      node: entry.node,
      x: chrome.left + entry.item.margin.left + crossOffset(entry.align, innerWidth - entry.marginX, entry.width),
      y: Math.round(y),
      width: entry.width,
      height,
    };

    y += height + entry.item.margin.bottom + box.rowGap + between;

    return placed;
  });

  return { items, contentHeight };
}

const arrangeCache = new WeakMap<BoxNode, Map<string, Arranged>>();

/** A box's children placed in its border box, `width` × `height` (null: as tall as they need). */
export function arrange(box: BoxNode, width: number, height: number | null): Arranged {
  const key = `${width}:${height ?? ""}`;
  const cache = arrangeCache.get(box) ?? new Map<string, Arranged>();
  const cached = cache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const chrome = chromeOf(box);
  const innerWidth = Math.max(0, width - chrome.left - chrome.right);
  const innerHeight = height === null ? null : Math.max(0, height - chrome.top - chrome.bottom);
  const arranged = box.isRow
    ? arrangeRow(box, chrome, innerWidth, innerHeight)
    : arrangeColumn(box, chrome, innerWidth, innerHeight);

  cache.set(key, arranged);
  arrangeCache.set(box, cache);

  return arranged;
}
