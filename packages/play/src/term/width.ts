// Display width of terminal text, as Ink's string-width counts it: East Asian wide characters and
// emoji take two columns, combining marks and controls none, everything else (box drawing, suits,
// braille, block elements) one.

const segmenter = new Intl.Segmenter();

/** Code point ranges East Asian Width calls Wide or Fullwidth (the emoji are matched apart). */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1b000, 0x1b2ff],
  [0x1f200, 0x1f2ff],
  [0x20000, 0x3fffd],
];

const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const MARK = /^\p{Mark}/u;
const ZWJ = "\u200d";
const EMOJI_VARIATION = "\ufe0f";

export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/** Columns one grapheme cluster takes: 0, 1 or 2. */
export function graphemeWidth(grapheme: string): number {
  const code = grapheme.codePointAt(0);

  if (code === undefined || code < 0x20 || (code >= 0x7f && code < 0xa0) || code === 0x200b || code === 0x200d) {
    return 0;
  }

  if (MARK.test(grapheme)) {
    return 0;
  }

  const first = String.fromCodePoint(code);

  if (EMOJI_PRESENTATION.test(first)) {
    return 2;
  }

  if ((grapheme.includes(EMOJI_VARIATION) || grapheme.includes(ZWJ)) && PICTOGRAPHIC.test(first)) {
    return 2;
  }

  return WIDE_RANGES.some(([low, high]) => code >= low && code <= high) ? 2 : 1;
}

export function stringWidth(text: string): number {
  return graphemes(text).reduce((sum, grapheme) => sum + graphemeWidth(grapheme), 0);
}
