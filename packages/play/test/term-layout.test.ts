import { describe, expect, test } from "vitest";

import { h, renderLines } from "../src/term/index";
import { stringWidth } from "../src/term/width";

const plain = (node: unknown, width: number) => renderLines(node, { width, color: false });
const ESC = "\x1b";

describe("renderLines layout", () => {
  test("a Box lays its children in a row by default, a column on request", () => {
    expect(plain(h("Box", null, h("Text", null, "ab"), h("Text", null, "cd")), 6)).toEqual(["abcd  "]);
    expect(plain(h("Box", { flexDirection: "column" }, h("Text", null, "ab"), h("Text", null, "cd")), 4)).toEqual([
      "ab  ",
      "cd  ",
    ]);
  });

  test("gap, columnGap and rowGap space the children", () => {
    expect(plain(h("Box", { columnGap: 2 }, h("Text", null, "ab"), h("Text", null, "cd")), 6)).toEqual(["ab  cd"]);
    expect(plain(h("Box", { flexDirection: "column", gap: 1 }, h("Text", null, "a"), h("Text", null, "b")), 1)).toEqual(
      ["a", " ", "b"],
    );
  });

  test("flexWrap moves what does not fit onto the next line, rowGap apart", () => {
    const cells = ["aa", "bb", "cc"].map((text) => h("Box", { width: 2 }, h("Text", null, text)));

    expect(plain(h("Box", { flexWrap: "wrap", columnGap: 1 }, ...cells), 5)).toEqual(["aa bb", "cc   "]);
    expect(plain(h("Box", { flexWrap: "wrap", columnGap: 1, rowGap: 1 }, ...cells), 5)).toEqual([
      "aa bb",
      "     ",
      "cc   ",
    ]);
  });

  test("Text wraps at spaces and splits a word longer than the width", () => {
    expect(plain(h("Text", null, "hello world"), 7)).toEqual(["hello  ", "world  "]);
    expect(plain(h("Text", null, "abcdefgh"), 3)).toEqual(["abc", "def", "gh "]);
    expect(plain(h("Text", null, "one\ntwo"), 5)).toEqual(["one  ", "two  "]);
  });

  test("wrap truncate cuts a line with an ellipsis", () => {
    expect(plain(h("Text", { wrap: "truncate-end" }, "hello world"), 7)).toEqual(["hello …"]);
    expect(plain(h("Text", { wrap: "truncate" }, "short"), 7)).toEqual(["short  "]);
  });

  test("flexGrow takes the free space; items shrink and wrap when the row is short", () => {
    expect(plain(h("Box", null, h("Text", null, "a"), h("Box", { flexGrow: 1 }), h("Text", null, "b")), 10)).toEqual([
      "a        b",
    ]);
    expect(plain(h("Box", null, h("Text", null, "aaaa"), h("Text", null, "bbbb")), 6)).toEqual(["aaabbb", "a  b  "]);
  });

  test("width and minWidth are kept, padding and margins inset", () => {
    expect(plain(h("Box", null, h("Box", { width: 4 }, h("Text", null, "a")), h("Text", null, "b")), 6)).toEqual([
      "a   b ",
    ]);
    expect(plain(h("Box", null, h("Box", { minWidth: 3 }, h("Text", null, "a")), h("Text", null, "b")), 5)).toEqual([
      "a  b ",
    ]);
    expect(plain(h("Box", { paddingX: 2 }, h("Text", null, "x")), 5)).toEqual(["  x  "]);
    expect(
      plain(
        h("Box", { flexDirection: "column", marginTop: 1, marginLeft: 1, marginBottom: 1 }, h("Text", null, "x")),
        3,
      ),
    ).toEqual(["   ", " x ", "   "]);
  });

  test("a round border frames the content; boxes in a row stretch to the tallest", () => {
    expect(plain(h("Box", { borderStyle: "round", width: 5 }, h("Text", null, "hi")), 5)).toEqual([
      "╭───╮",
      "│hi │",
      "╰───╯",
    ]);
    expect(
      plain(
        h(
          "Box",
          null,
          h("Box", { borderStyle: "round" }, h("Text", null, "a")),
          h("Box", { borderStyle: "round" }, h("Text", null, "b\nc")),
        ),
        6,
      ),
    ).toEqual(["╭─╮╭─╮", "│a││b│", "│ ││c│", "╰─╯╰─╯"]);
  });

  test("center alignment and justification", () => {
    expect(plain(h("Box", { flexDirection: "column", alignItems: "center" }, h("Text", null, "abc")), 7)).toEqual([
      "  abc  ",
    ]);
    expect(plain(h("Box", { justifyContent: "center" }, h("Text", null, "ab")), 6)).toEqual(["  ab  "]);
    expect(
      plain(h("Box", { height: 3, alignItems: "center" }, h("Text", null, "x"), h("Text", null, "y\nz\nw")), 2),
    ).toEqual([" y", "xz", " w"]);
  });

  test("Button draws its hotkey then its children (or label), Link its label, function tags are called", () => {
    const Chip = (props: Record<string, unknown>) => h("Text", null, "[", props.children, "]");

    expect(
      plain(
        h(
          "Box",
          { columnGap: 1 },
          h("Button", { hotkey: "h", plain: true }, h("Text", null, "hit")),
          h(Chip, null, "x"),
        ),
        12,
      ),
    ).toEqual(["h: hit [x]  "]);
    expect(plain(h("Button", { plain: true, label: "deal" }), 4)).toEqual(["deal"]);
    expect(plain(h("Button", { hotkey: "", plain: true }, "deal"), 4)).toEqual(["deal"]);
    expect(plain(h("Link", { href: "https://tilt.xyz", label: "deposit" }), 8)).toEqual(["deposit "]);
  });
});

describe("renderLines width and color", () => {
  test("wide characters and emoji count two columns, suits and box drawing one", () => {
    expect(stringWidth("日本")).toBe(4);
    expect(stringWidth("🎰")).toBe(2);
    expect(stringWidth("e\u0301")).toBe(1);
    expect(stringWidth("♠♥╭─▀⠋")).toBe(6);
    expect(plain(h("Text", null, "日本"), 6)).toEqual(["日本  "]);
    // A wide glyph that would straddle the last column is drawn as a space.
    expect(plain(h("Text", { wrap: "truncate" }, "ab日"), 3)).toEqual(["ab…"]);
    expect(plain(h("Box", null, h("Box", { width: 2 }, h("Text", null, "a")), h("Text", null, "🎰")), 3)).toEqual([
      "a  ",
    ]);
  });

  test("nested Text concatenates spans, each with its own style", () => {
    const [line] = renderLines(
      h("Text", { color: "#ff0000" }, "a", h("Text", { bold: true }, "b"), h("Text", { color: "inactive" }, "c")),
      { width: 3, color: true },
    );

    expect(line).toBe(
      `${ESC}[38;2;255;0;0ma${ESC}[0m${ESC}[1;38;2;255;0;0mb${ESC}[0m${ESC}[38;2;153;153;153mc${ESC}[0m`,
    );
    expect(renderLines(h("Text", { color: "text", dimColor: true }, "a"), { width: 1, color: true })).toEqual([
      `${ESC}[2ma${ESC}[0m`,
    ]);
  });

  test("a Box's backgroundColor fills its area and stays under its Text", () => {
    const lines = renderLines(h("Box", { backgroundColor: "#000000", width: 3, height: 2 }, h("Text", null, "a")), {
      width: 4,
      color: true,
    });

    expect(lines).toEqual([`${ESC}[48;2;0;0;0ma  ${ESC}[0m `, `${ESC}[48;2;0;0;0m   ${ESC}[0m `]);
    expect(renderLines(h("Text", { backgroundColor: "#ffffff" }, "a"), { width: 2, color: true })).toEqual([
      `${ESC}[48;2;255;255;255ma${ESC}[0m `,
    ]);
  });

  test("color off writes no escape code at all", () => {
    const styled = h(
      "Box",
      { borderStyle: "round", borderColor: "#f779ba", backgroundColor: "#222222" },
      h("Text", { color: "#ffffff", bold: true, inverse: true }, "x"),
    );

    expect(plain(styled, 5).join("")).not.toContain(ESC);
  });
});
