import { GameTabs } from "@/components/tilt/GameTabs";
import { KeyHint } from "@/components/tilt/KeyHint";
import { Leaderboard } from "@/components/tilt/Leaderboard";
import { Notice } from "@/components/tilt/Notice";
import { Hand } from "@/components/tilt/PlayingCard";
import { SponsorBlock } from "@/components/tilt/SponsorBlock";
import { Stat } from "@/components/tilt/Stat";
import { TerminalWindow } from "@/components/tilt/TerminalWindow";
import { TiltPanel } from "@/components/tilt/TiltPanel";
import { TranscriptLine } from "@/components/tilt/TranscriptLine";
import styles from "./TerminalDemo.module.css";

const TABS = [
  { id: "blackjack", keyLabel: "1", label: "Blackjack" },
  { id: "roulette", keyLabel: "2", label: "Roulette" },
  { id: "baccarat", keyLabel: "3", label: "Baccarat" },
  { id: "slots", keyLabel: "4", label: "Slots" },
];

const BOARD = [
  { rank: 1, handle: "@0xkira", net: "+412.90" },
  { rank: 2, handle: "@mira.builds", net: "+288.15" },
  { rank: 3, handle: "@segfault_sam", net: "+201.40" },
];

/** Static mock of Tilt inside a Claude Code session. Names and numbers are illustrative. */
export function TerminalDemo() {
  return (
    <figure className={styles.figure}>
      <TerminalWindow title="~/shop — claude">
        <TranscriptLine kind="prompt">fix the flaky checkout tests</TranscriptLine>
        <TranscriptLine kind="tool" name="Read" arg="src/checkout/cart.test.ts" out="Read 212 lines" />
        <TranscriptLine kind="tool" name="Bash" arg="pnpm test checkout" out="3 failed · 41 passed" />
        <TranscriptLine kind="text">The retries race on a shared fake clock. Giving each test its own.</TranscriptLine>
        <TiltPanel
          season="S1"
          tabs={<GameTabs tabs={TABS} active="blackjack" />}
          stats={
            <>
              <Stat label="balance" value="12.40 USDC" tone="money" />
              <Stat label="rank" value="#414" />
            </>
          }
          notice={
            <Notice actions={<span className={styles.action}>⏎ review diff</span>}>
              ✓ agent finished in 6m 14s · your hand is saved
            </Notice>
          }
          side={
            <>
              <SponsorBlock name="Northwind Cloud" pool="$3,000" poolLabel="daily pool" endsIn="14h" />
              <Leaderboard rows={BOARD} you={{ rank: 414, handle: "you", net: "+17.95" }} />
            </>
          }
        >
          <Hand label="DEALER" total="9 + ?" cards={[{ rank: "9", suit: "♥" }, { hidden: true }]} />
          <Hand
            label="YOU"
            total={11}
            meta="bet 0.50"
            cards={[
              { rank: "3", suit: "♣" },
              { rank: "8", suit: "♦" },
            ]}
          />
          <div className={styles.keys}>
            <KeyHint keyLabel="H">hit</KeyHint>
            <KeyHint keyLabel="S">stand</KeyHint>
            <KeyHint keyLabel="D">double</KeyHint>
            <KeyHint keyLabel="B">bet</KeyHint>
          </div>
        </TiltPanel>
      </TerminalWindow>
      <figcaption className={styles.caption}>
        Tilt next to a running agent. Mock: names and numbers are examples.
      </figcaption>
    </figure>
  );
}
