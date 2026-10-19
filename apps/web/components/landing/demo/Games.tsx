"use client";

// The games section's moving parts: one big terminal with the twelve tabs, playing a round of each
// in turn until the visitor picks one, and a grid with every game playing small at once.
import { type KeyboardEvent, useRef, useState } from "react";
import { GAMES } from "./catalog";
import { useDemoClock } from "./clock";
import { GameScreen } from "./GameScreen";
import type { GameDemo } from "./types";
import styles from "./Games.module.css";

/** Games 1 to 9 have a digit key, as in the mod; the rest are reached with the arrows. */
const DIGIT_KEYS = 9;
/** Grid cards start their rounds apart, so the twelve never move in step. */
const GRID_STAGGER_MS = 900;
const PROGRESS_STEPS = 12;

interface Pick {
  index: number;
  /** The clock's time when this game started. */
  from: number;
  /** Untouched, the showcase moves to the next game after each round. */
  isAuto: boolean;
}

/** The game on the showcase and how far into its round it is. */
function playing(pick: Pick, elapsed: number | null): { index: number; t: number } {
  const game = GAMES[pick.index];
  if (elapsed === null) return { index: pick.index, t: game.stillMs };
  let t = elapsed - pick.from;
  if (!pick.isAuto) return { index: pick.index, t: t % game.loopMs };
  let index = pick.index;
  while (t >= GAMES[index].loopMs) {
    t -= GAMES[index].loopMs;
    index = (index + 1) % GAMES.length;
  }
  return { index, t };
}

const tabId = (game: GameDemo) => `game-tab-${game.id}`;
const PANEL_ID = "game-panel";

export function GamesFloor() {
  const { ref, elapsed } = useDemoClock<HTMLDivElement>();
  const [pick, setPick] = useState<Pick>({ index: 0, from: 0, isAuto: true });
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const { index, t } = playing(pick, elapsed);
  const game = GAMES[index];
  const next = GAMES[(index + 1) % GAMES.length];

  function select(target: number, focus: boolean) {
    const chosen = (target + GAMES.length) % GAMES.length;
    setPick({ index: chosen, from: elapsed ?? 0, isAuto: false });
    if (focus) tabs.current[chosen]?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (/^[1-9]$/.test(event.key)) select(Number(event.key) - 1, true);
    else if (event.key === "ArrowRight") select(index + 1, true);
    else if (event.key === "ArrowLeft") select(index - 1, true);
    else if (event.key === "Home") select(0, true);
    else if (event.key === "End") select(GAMES.length - 1, true);
    else return;
    event.preventDefault();
  }

  // Focus in the showcase holds the game on screen: autoplay must not move what someone is reading.
  function hold() {
    if (pick.isAuto) setPick({ index, from: (elapsed ?? 0) - t, isAuto: false });
  }

  function watch(target: number) {
    select(target, false);
    document.getElementById("showcase")?.scrollIntoView({ block: "start" });
    tabs.current[target]?.focus({ preventScroll: true });
  }

  const progress = Math.min(PROGRESS_STEPS, Math.floor((t / game.loopMs) * PROGRESS_STEPS) + 1);

  return (
    <>
      <div id="showcase" ref={ref} className={styles.window} onKeyDown={onKeyDown} onFocus={hold}>
        <div className={styles.chrome} aria-hidden="true">
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.title}>~/acme-api — claude — tilt</span>
        </div>
        <div className={styles.panel}>
          <div className={styles.header}>
            <span className={styles.wordmark} aria-hidden="true">
              TILT
            </span>
            <div role="tablist" aria-label="Games" className={styles.tabs}>
              {GAMES.map((each, i) => (
                <button
                  key={each.id}
                  ref={(node) => {
                    tabs.current[i] = node;
                  }}
                  type="button"
                  role="tab"
                  id={tabId(each)}
                  aria-selected={i === index}
                  aria-controls={PANEL_ID}
                  tabIndex={i === index ? 0 : -1}
                  className={i === index ? styles.tabActive : styles.tab}
                  onClick={() => select(i, false)}
                >
                  {i < DIGIT_KEYS && <span aria-hidden="true">[{i + 1}] </span>}
                  {each.name}
                </button>
              ))}
            </div>
          </div>

          <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(game)} className={styles.body}>
            <div className={styles.main}>
              <GameScreen game={game} t={t} />
            </div>
            <div className={styles.side}>
              <p className={styles.eyebrow}>
                GAME {String(index + 1).padStart(2, "0")} / {GAMES.length}
              </p>
              <p className={styles.name}>{game.name}</p>
              <p className={styles.rtp}>
                <span className={styles.rtpValue}>{game.rtp}</span> rtp
              </p>
              <p className={styles.rule}>{game.rule}</p>
              <p className="visually-hidden">Demo round: {game.about}</p>
              <p className={styles.status} aria-hidden="true">
                <span className={styles.progress}>
                  {"▰".repeat(progress)}
                  <span className={styles.progressRest}>{"▱".repeat(PROGRESS_STEPS - progress)}</span>
                </span>
                {pick.isAuto ? `autoplay · next ${next.name}` : "your pick · on loop"}
              </p>
            </div>
          </div>

          <div className={styles.footer} aria-hidden="true">
            <span>rtp {game.rtp} · 1% fee on wins</span>
            <span className={styles.spacer} />
            <span>
              <span className={styles.footKey}>1–9 ← →</span> switch game
            </span>
          </div>
        </div>
      </div>

      <ul className={styles.grid}>
        {GAMES.map((each, i) => (
          <GameCard key={each.id} game={each} index={i} isShown={i === index} onWatch={() => watch(i)} />
        ))}
      </ul>
    </>
  );
}

function GameCard({
  game,
  index,
  isShown,
  onWatch,
}: {
  game: GameDemo;
  index: number;
  isShown: boolean;
  onWatch: () => void;
}) {
  const { ref, elapsed } = useDemoClock<HTMLLIElement>();
  const t = elapsed === null ? game.stillMs : (elapsed + index * GRID_STAGGER_MS) % game.loopMs;
  const headingId = `game-${game.id}`;
  return (
    <li ref={ref} className={isShown ? styles.cardShown : styles.card} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <span className={styles.cardKey} aria-hidden="true">
          {index < DIGIT_KEYS ? `[${index + 1}]` : "[·]"}
        </span>
        <h3 id={headingId} className={styles.cardName}>
          {game.name}
        </h3>
        <span className={styles.cardRtp}>
          <span className="visually-hidden">RTP </span>
          {game.rtp}
        </span>
      </div>
      <div className={styles.cardScreen}>
        <GameScreen game={game} t={t} size="compact" />
      </div>
      <p className={styles.cardRule}>{game.rule}</p>
      <p className="visually-hidden">Demo round: {game.about}</p>
      <button type="button" className={styles.watch} onClick={onWatch}>
        <span aria-hidden="true">▸ </span>
        Play {game.name} in the big terminal
      </button>
    </li>
  );
}
