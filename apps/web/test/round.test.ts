import { describe, expect, it } from "vitest";
import { rouletteWins, type RouletteBet } from "@/lib/round";

const POCKETS = Array.from({ length: 37 }, (_, n) => n);

function winners(bet: RouletteBet): number[] {
  return POCKETS.filter((n) => rouletteWins(bet, n));
}

describe("rouletteWins", () => {
  it("pays a straight on its number only, zero included", () => {
    expect(winners({ kind: "straight", number: 0 })).toEqual([0]);
    expect(winners({ kind: "straight", number: 17 })).toEqual([17]);
  });

  it("splits 1–36 between each pair of even-money bets, zero losing both", () => {
    const pairs: [RouletteBet, RouletteBet][] = [
      [{ kind: "red" }, { kind: "black" }],
      [{ kind: "odd" }, { kind: "even" }],
      [{ kind: "low" }, { kind: "high" }],
    ];
    for (const [a, b] of pairs) {
      expect(winners(a)).toHaveLength(18);
      expect([...winners(a), ...winners(b)].sort((x, y) => x - y)).toEqual(POCKETS.slice(1));
    }
    expect(winners({ kind: "red" })).toContain(1);
    expect(winners({ kind: "low" })).toContain(18);
  });

  it("covers dozens in runs of twelve and columns by row", () => {
    expect(winners({ kind: "dozen", dozen: 2 })).toEqual(POCKETS.slice(13, 25));
    expect(winners({ kind: "column", column: 1 })).toEqual(POCKETS.filter((n) => n % 3 === 1));
    expect(winners({ kind: "column", column: 3 })).toEqual(POCKETS.filter((n) => n !== 0 && n % 3 === 0));
  });
});
