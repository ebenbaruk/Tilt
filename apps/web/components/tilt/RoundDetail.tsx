import type { RoundView } from "@tilt/api/public";
import {
  describeRouletteBet,
  hundredths,
  pocketColor,
  type BlackjackHand,
  type Card,
  type DiceDetail,
  type FlipDetail,
  type HiloDetail,
  type KenoDetail,
  type LimboDetail,
  type MinesDetail,
  type TowerDetail,
  type WheelDetail,
} from "@/lib/round";
import { Hand, PlayingCard, rankLabel, type CardFace } from "./PlayingCard";
import styles from "./RoundDetail.module.css";

function faces(cards: Card[]): CardFace[] {
  return cards.map((card) => ({ rank: rankLabel(card.rank), suit: card.suit }));
}

/** "split · doubled · win": what happened to a blackjack hand, once known. */
function handMeta(hand: BlackjackHand): string | undefined {
  const parts = [hand.split ? "split" : null, hand.doubled ? "doubled" : null, hand.result].filter(
    (part) => part !== null,
  );
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

const MINES_TILES = 25;
const MINES_COLUMNS = 5;

function tileName(tile: number): string {
  return `row ${Math.floor(tile / MINES_COLUMNS) + 1} column ${(tile % MINES_COLUMNS) + 1}`;
}

/** "cashed out at ×1.4500": how a mines round ended, once known. */
function minesOutcome(detail: MinesDetail): string {
  if (detail.busted !== null) return `hit a mine at ${tileName(detail.busted)}`;
  if (detail.pending !== null) return `${tileName(detail.pending)} awaiting its draw`;
  if (detail.revealed.length === 0) return "no tile revealed";
  return `cashed out at ×${detail.multiplier}`;
}

/** The 5×5 board: safe tiles numbered in reveal order, the busting mine, the rest hidden. */
function MinesBoard({ detail }: { detail: MinesDetail }) {
  const order = new Map(detail.revealed.map((tile, i) => [tile, i + 1]));
  const outcome = minesOutcome(detail);
  return (
    <div className={styles.stack}>
      <div className={styles.mines} role="img" aria-label={`${detail.revealed.length} safe tiles revealed, ${outcome}`}>
        {Array.from({ length: MINES_TILES }, (_, tile) => {
          const step = order.get(tile);
          if (tile === detail.busted)
            return (
              <span key={tile} className={`${styles.tile} ${styles.mine}`}>
                ✸
              </span>
            );
          if (step !== undefined)
            return (
              <span key={tile} className={`${styles.tile} ${styles.safe}`}>
                {step}
              </span>
            );
          return (
            <span key={tile} className={styles.tile}>
              {tile === detail.pending ? "…" : "·"}
            </span>
          );
        })}
      </div>
      <p className={styles.muted}>
        {detail.mines} {detail.mines === 1 ? "mine" : "mines"} · {outcome}
      </p>
    </div>
  );
}

const DICE_OUTCOMES = 10_000;

/** The roll on a 0.00–99.99 track: the winning range lit, a marker where the roll landed. */
function DiceRoll({ detail }: { detail: DiceDetail }) {
  const target = hundredths(detail.target);
  const side = `${detail.over ? "over" : "under"} ${target}`;
  const chance = hundredths(detail.over ? DICE_OUTCOMES - detail.target : detail.target);
  const rules = `${side} · ${chance}% chance · ×${detail.multiplier}`;
  if (detail.roll === null) return <p className={styles.muted}>not rolled · {rules}</p>;
  const won = detail.over ? detail.roll >= detail.target : detail.roll < detail.target;
  // The roll reads 00.00 to 99.99, like the panel's.
  const roll = hundredths(detail.roll).padStart(5, "0");
  const percent = (n: number) => `${(n * 100) / DICE_OUTCOMES}%`;
  return (
    <div className={styles.stack}>
      <span className={`${styles.big} ${won ? styles.win : styles.lose}`}>{roll}</span>
      <div className={styles.track} role="img" aria-label={`rolled ${roll}, ${side}: ${won ? "win" : "lose"}`}>
        <span
          className={styles.trackWin}
          style={detail.over ? { left: percent(detail.target), right: 0 } : { left: 0, width: percent(detail.target) }}
        />
        <span className={styles.trackMarker} style={{ left: percent(detail.roll) }} />
      </div>
      <p className={styles.muted}>{rules}</p>
    </div>
  );
}

function LimboResult({ detail }: { detail: LimboDetail }) {
  if (detail.result === null) return <p className={styles.muted}>not drawn · target ×{detail.target}</p>;
  // Both are formatted with exactly two decimals: compare them as integer hundredths.
  const won = Number(detail.result.replace(".", "")) >= Number(detail.target.replace(".", ""));
  return (
    <div className={styles.stack}>
      <span className={`${styles.big} ${won ? styles.win : styles.lose}`}>×{detail.result}</span>
      <p className={styles.muted}>
        target ×{detail.target} · {won ? "reached" : "missed"}
      </p>
    </div>
  );
}

function FlipCoins({ detail }: { detail: FlipDetail }) {
  const call = `called ${detail.side} on ${detail.flips} ${detail.flips === 1 ? "coin" : "coins"} · ×${detail.multiplier}`;
  if (detail.results === null) return <p className={styles.muted}>not flipped · {call}</p>;
  const matching = detail.results.filter((side) => side === detail.side).length;
  return (
    <div className={styles.stack}>
      <div className={styles.coins} role="img" aria-label={`coins ${detail.results.join(" ")}`}>
        {detail.results.map((side, i) => (
          <span key={i} className={`${styles.coin} ${side === detail.side ? styles.win : styles.lose}`}>
            {side === "heads" ? "H" : "T"}
          </span>
        ))}
      </div>
      <p className={styles.muted}>
        {call} · {matching} of {detail.flips} {detail.side}
      </p>
    </div>
  );
}

const KENO_NUMBERS = 40;

/** The 1–40 board: picks outlined, drawn numbers filled, hits (both) in gold. */
function KenoBoard({ detail }: { detail: KenoDetail }) {
  const picks = new Set(detail.picks);
  const drawn = new Set(detail.drawn ?? []);
  const summary =
    detail.hits === null
      ? `${detail.picks.length} picks, not drawn`
      : `${detail.picks.length} picks, ${detail.hits} ${detail.hits === 1 ? "hit" : "hits"}`;
  return (
    <div className={styles.stack}>
      <div className={styles.keno} role="img" aria-label={summary}>
        {Array.from({ length: KENO_NUMBERS }, (_, i) => {
          const n = i + 1;
          const kind = picks.has(n) ? (drawn.has(n) ? styles.hit : styles.picked) : drawn.has(n) ? styles.drawn : "";
          return (
            <span key={n} className={`${styles.tile} ${kind}`}>
              {n}
            </span>
          );
        })}
      </div>
      <p className={styles.muted}>
        {summary}
        {detail.hits !== null && ` · pays ×${detail.paytable[detail.hits]}`}
      </p>
      <p className={styles.muted}>
        paytable by hits:{" "}
        {detail.paytable.map((pay, hits) => (
          <span key={hits} className={hits === detail.hits ? styles.chosen : undefined}>
            {hits}: ×{pay}{" "}
          </span>
        ))}
      </p>
    </div>
  );
}

function WheelSegments({ detail }: { detail: WheelDetail }) {
  const setup = `${detail.segments} segments · ${detail.risk} risk`;
  const summary =
    detail.segment === null
      ? `${setup} · not spun`
      : `${setup} · landed on segment ${detail.segment + 1}, ×${detail.multipliers[detail.segment]}`;
  return (
    <div className={styles.stack}>
      <div className={styles.wheel} role="img" aria-label={summary}>
        {detail.multipliers.map((multiplier, i) => (
          <span key={i} className={`${styles.segment} ${i === detail.segment ? styles.chosen : ""}`}>
            {multiplier}
          </span>
        ))}
      </div>
      <p className={styles.muted}>{summary}</p>
    </div>
  );
}

const HILO_GUESS_LABELS: Record<HiloDetail["guesses"][number], string> = {
  higher: "↑ higher",
  lower: "↓ lower",
  skip: "↷ skip",
};

function hiloOutcome(detail: HiloDetail): string {
  if (detail.busted) return "wrong guess";
  if (detail.pending !== null) return `${detail.pending} awaiting its draw`;
  if (detail.guesses.every((guess) => guess === "skip")) return "no guess made";
  return `cashed out at ×${detail.multiplier}`;
}

/** The cards in draw order, each one under the guess it answered; the last one busts a lost round. */
function HiloSequence({ detail }: { detail: HiloDetail }) {
  const last = detail.cards.length - 1;
  return (
    <div className={styles.stack}>
      <div className={styles.sequence}>
        {faces(detail.cards).map((face, i) => {
          // Card i answers guess i - 1; the first card was dealt on the bet.
          const guess = detail.guesses[i - 1];
          return (
            <div key={i} className={styles.step}>
              <PlayingCard card={face} />
              <span className={detail.busted && i === last ? styles.lose : styles.muted}>
                {guess === undefined ? "start" : HILO_GUESS_LABELS[guess]}
              </span>
            </div>
          );
        })}
      </div>
      <p className={styles.muted}>{hiloOutcome(detail)}</p>
    </div>
  );
}

function towerOutcome(detail: TowerDetail): string {
  const level = detail.climbed.length + 1;
  if (detail.busted !== null) return `fell at level ${level}, tile ${detail.busted + 1}`;
  if (detail.pending !== null) return `level ${level}, tile ${detail.pending + 1} awaiting its draw`;
  if (detail.climbed.length === 0) return "no level climbed";
  return `cashed out at ×${detail.multiplier}`;
}

/** Nine levels, top first: the tile picked on each safe level, the busting one, the rest unknown. */
function TowerLevels({ detail }: { detail: TowerDetail }) {
  const outcome = towerOutcome(detail);
  const current = detail.climbed.length;
  return (
    <div className={styles.stack}>
      <div
        className={styles.tower}
        style={{ gridTemplateColumns: `repeat(${detail.tiles}, 40px)` }}
        role="img"
        aria-label={`${current} ${current === 1 ? "level" : "levels"} climbed, ${outcome}`}
      >
        {Array.from({ length: detail.levels }, (_, i) => detail.levels - 1 - i).flatMap((level) =>
          Array.from({ length: detail.tiles }, (_, tile) => {
            const key = `${level}-${tile}`;
            if (level < current && detail.climbed[level] === tile)
              return (
                <span key={key} className={`${styles.tile} ${styles.safe}`}>
                  ◆
                </span>
              );
            if (level === current && tile === detail.busted)
              return (
                <span key={key} className={`${styles.tile} ${styles.mine}`}>
                  ✸
                </span>
              );
            return (
              <span key={key} className={styles.tile}>
                {level === current && tile === detail.pending ? "…" : "·"}
              </span>
            );
          }),
        )}
      </div>
      <p className={styles.muted}>
        {detail.difficulty} · {outcome}
      </p>
    </div>
  );
}

/** The cards, pocket, reels or board of one round, drawn the way the panel draws them. */
export function RoundDetail({ detail }: { detail: RoundView["detail"] }) {
  switch (detail.game) {
    case "blackjack":
      return (
        <div className={styles.stack}>
          <Hand label="DEALER" total={detail.dealerTotal} cards={faces(detail.dealer)} />
          {detail.hands.map((hand, i) => (
            <Hand
              key={i}
              label={detail.hands.length === 1 ? "YOU" : `HAND ${i + 1}`}
              total={hand.soft ? `soft ${hand.total}` : hand.total}
              meta={handMeta(hand)}
              cards={faces(hand.cards)}
            />
          ))}
        </div>
      );
    case "baccarat":
      return (
        <div className={styles.stack}>
          <Hand label="PLAYER" total={detail.playerPoints} cards={faces(detail.player)} />
          <Hand label="BANKER" total={detail.bankerPoints} cards={faces(detail.banker)} />
          <p className={styles.muted}>bet on {detail.bet}</p>
        </div>
      );
    case "roulette":
      return (
        <div className={styles.stack}>
          {detail.number === null ? (
            <p className={styles.muted}>no pocket drawn</p>
          ) : (
            <span className={`${styles.pocket} ${styles[pocketColor(detail.number)]}`}>{detail.number}</span>
          )}
          <p className={styles.muted}>bet {describeRouletteBet(detail.bet)}</p>
        </div>
      );
    case "slots":
      return detail.reels === null ? (
        <p className={styles.muted}>reels not drawn</p>
      ) : (
        <div className={styles.reels} role="img" aria-label={`reels ${detail.reels.join(" ")}`}>
          {detail.reels.map((symbol, i) => (
            <span key={i} className={styles.reel}>
              {symbol}
            </span>
          ))}
        </div>
      );
    case "mines":
      return <MinesBoard detail={detail} />;
    case "dice":
      return <DiceRoll detail={detail} />;
    case "limbo":
      return <LimboResult detail={detail} />;
    case "flip":
      return <FlipCoins detail={detail} />;
    case "keno":
      return <KenoBoard detail={detail} />;
    case "wheel":
      return <WheelSegments detail={detail} />;
    case "hilo":
      return <HiloSequence detail={detail} />;
    case "tower":
      return <TowerLevels detail={detail} />;
  }
}
