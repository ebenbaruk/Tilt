"use client";

// The hero's terminal: Claude Code fixing tests while the Tilt panel plays blackjack beside it. The
// agent finishes mid-hand and the hand waits, saved, as the mod hands the keys back.
import { GameTabs } from "@/components/tilt/GameTabs";
import { Leaderboard } from "@/components/tilt/Leaderboard";
import { Notice } from "@/components/tilt/Notice";
import { SponsorBlock } from "@/components/tilt/SponsorBlock";
import { Stat } from "@/components/tilt/Stat";
import { TerminalWindow } from "@/components/tilt/TerminalWindow";
import { TiltPanel } from "@/components/tilt/TiltPanel";
import { TranscriptLine } from "@/components/tilt/TranscriptLine";
import { type BlackjackScript, BLACKJACK_KEYS, blackjackFrame, draw, firstDeal } from "./blackjack";
import { useDemoClock } from "./clock";
import { GameScreen } from "./GameScreen";
import { spinnerAt } from "./script";
import type { GameDemo } from "./types";
import styles from "./HeroTerminal.module.css";

const LOOP_MS = 15_000;
/** Shown still: the agent done, the second hand waiting on your move. */
const STILL_MS = 11_500;
const SECOND_HAND_AT = 7_500;
const AGENT_DONE_AT = 10_400;
/** The agent's clock starts at 10s and runs three times fast: done "in 41s". */
const AGENT_START_S = 10;
const AGENT_PACE = 3;

const FIRST_HAND: BlackjackScript = {
  bet: "5.00",
  deals: [...firstDeal(900, ["9♣", "10♠", "7♦"]), draw(3100, "you", "4♥"), draw(4800, "dealer", "8♣")],
  presses: [
    [700, "n"],
    [3000, "h"],
    [4300, "s"],
  ],
  turnEndsAt: 4300,
  result: { at: 5300, tag: "WIN", stake: "5.00", text: "20 beats 18.", net: "+5.00" },
};

const SECOND_HAND: BlackjackScript = {
  bet: "5.00",
  deals: firstDeal(SECOND_HAND_AT + 100, ["A♠", "6♦", "6♥"]),
  presses: [[SECOND_HAND_AT, "n"]],
  turnEndsAt: Number.POSITIVE_INFINITY,
};

const HERO_GAME: GameDemo = {
  id: "blackjack",
  name: "Blackjack",
  rtp: "≈ 99.2%",
  rule: "",
  about: "",
  keys: BLACKJACK_KEYS,
  loopMs: LOOP_MS,
  stillMs: STILL_MS,
  frame: (t) => blackjackFrame(t < SECOND_HAND_AT ? FIRST_HAND : SECOND_HAND, t),
};

const TOOLS = [
  { at: 400, verb: "Reading", name: "Read", arg: "src/auth/session.test.ts", out: "Read 182 lines" },
  { at: 2600, verb: "Searching", name: "Grep", arg: '"retry", src/auth', out: "6 matches in 3 files" },
  { at: 5000, verb: "Editing", name: "Edit", arg: "src/auth/session.ts", out: "+4 −2 · await the token refresh" },
  { at: 7600, verb: "Testing", name: "Bash", arg: "pnpm test src/auth", out: "42 passed · 0 failed" },
];
/** A tool's output shows this long after its call. */
const OUTPUT_MS = 900;
/** The transcript keeps its last two calls on screen, as a terminal scrolls. */
const SHOWN_TOOLS = 2;

const TABS = [
  { id: "blackjack", keyLabel: "1", label: "Blackjack" },
  { id: "roulette", keyLabel: "2", label: "Roulette" },
  { id: "baccarat", keyLabel: "3", label: "Baccarat" },
  { id: "slots", keyLabel: "4", label: "Slots" },
  { id: "more", keyLabel: "0", label: "more" },
];

const BOARD = [
  { rank: 1, handle: "@0xkira", net: "+412.90" },
  { rank: 2, handle: "@segfault_sam", net: "+388.12" },
  { rank: 3, handle: "@tabs_not_spaces", net: "+351.00" },
];

export function HeroTerminal() {
  const { ref, elapsed } = useDemoClock<HTMLElement>();
  const t = elapsed === null ? STILL_MS : elapsed % LOOP_MS;
  const isDone = t >= AGENT_DONE_AT;
  const started = TOOLS.filter((tool) => tool.at <= t);
  const current = started[started.length - 1];
  const seconds = AGENT_START_S + Math.floor((t * AGENT_PACE) / 1000);
  const balance = t >= (FIRST_HAND.result?.at ?? 0) ? "184.50" : "179.50";

  return (
    <figure ref={ref} className={styles.figure}>
      <div className={styles.frame} aria-hidden="true">
        <TerminalWindow title="~/acme-api — claude — 120×40">
          <div className={styles.meta}>claude code · ~/acme-api · main ✓ · tilt plugin enabled</div>
          <TranscriptLine kind="prompt">fix the flaky auth tests in src/auth</TranscriptLine>
          <div className={styles.transcript}>
            {started.slice(-SHOWN_TOOLS).map((tool) => (
              <TranscriptLine
                key={tool.name}
                kind="tool"
                name={tool.name}
                arg={tool.arg}
                out={t >= tool.at + OUTPUT_MS ? tool.out : undefined}
              />
            ))}
          </div>
          <div className={styles.status}>
            {isDone ? (
              <span className={styles.done}>✓ 4 tool calls · 1 file changed · tests pass</span>
            ) : (
              <>
                <span className={styles.spinner}>{spinnerAt(t)}</span> {current?.verb ?? "Thinking"}…{" "}
                <span className={styles.dim}>({seconds}s · esc to interrupt)</span>
              </>
            )}
          </div>

          <TiltPanel
            tabs={<GameTabs tabs={TABS} active="blackjack" />}
            stats={
              <>
                <Stat label="balance" value={`${balance} USDC`} tone="money" />
                <Stat label="rank" value="#414" />
              </>
            }
            notice={
              isDone ? (
                <Notice actions={<span className={styles.action}>⏎ review diff</span>}>
                  ✓ agent finished in 41s · your hand is saved
                </Notice>
              ) : (
                <Notice tone="brand">
                  <span className={styles.spinner}>{spinnerAt(t)}</span> agent is working · your move
                </Notice>
              )
            }
            side={
              <>
                <SponsorBlock name="Northwind Cloud" pool="$3,000" poolLabel="daily pool" endsIn="14h" />
                <Leaderboard rows={BOARD} you={{ rank: 414, handle: "you", net: "+17.95" }} />
              </>
            }
          >
            <GameScreen game={HERO_GAME} t={t} />
          </TiltPanel>

          <div className={styles.input}>
            <span className={styles.chevron}>›</span>
            {isDone ? (
              <span className={Math.floor(t / 500) % 2 === 0 ? styles.cursor : styles.cursorOff} />
            ) : (
              <span className={styles.placeholder}>Agent is working · your keys go to Tilt</span>
            )}
          </div>
          <div className={styles.hints}>
            <span>1·2·3·4 switch game</span>
            <span>ctrl+x tab focus tilt</span>
            <span className={styles.spacer} />
            <span>18+ · USDC on Solana</span>
          </div>
        </TerminalWindow>
      </div>
      <figcaption className={styles.caption}>
        Claude Code fixes a test suite while a blackjack hand plays in the Tilt panel; when the agent finishes, the hand
        waits. Names and numbers are examples.
      </figcaption>
    </figure>
  );
}
