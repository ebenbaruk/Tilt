// Tilt inside a coding agent's terminal, as on the reference design "Tilt in Agent CLI": the
// agent is working, the panel takes the keys. Static mock; names and numbers are examples.
import { PlayingCard } from "@/components/tilt/PlayingCard";
import { AgentStatus } from "./AgentStatus";
import styles from "./AgentCliPreview.module.css";

const GAMES = ["Blackjack", "Roulette", "Baccarat", "Slots"];

const BOARD = [
  { rank: "1", handle: "@0xkira", net: "+412.90" },
  { rank: "2", handle: "@segfault_sam", net: "+388.12" },
  { rank: "3", handle: "@tabs_not_spaces", net: "+351.00" },
];

export function AgentCliPreview() {
  return (
    <figure className={styles.figure}>
      <div className={styles.window} role="img" aria-label="Tilt panel inside a coding agent's terminal">
        <div className={styles.chrome} aria-hidden="true">
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.title}>~/acme-api — claude — 120×40</span>
        </div>

        <div className={styles.body}>
          <div className={styles.meta}>claude code · ~/acme-api · main ✓ · tilt plugin enabled</div>
          <div className={styles.prompt}>
            <span className={styles.chevron}>›</span>
            <span className={styles.strong}>fix the flaky auth tests in src/auth</span>
          </div>
          <AgentStatus />

          <section className={styles.panel} aria-label="Tilt panel">
            <div className={styles.panelHead}>
              <span className={styles.wordmark}>TILT</span>
              <span className={styles.dim}>S1</span>
              <div className={styles.tabs}>
                {GAMES.map((game, i) => (
                  <span key={game} className={i === 0 ? styles.tabActive : styles.tab}>
                    [{i + 1}] {game}
                  </span>
                ))}
              </div>
              <span className={styles.spacer} />
              <span className={styles.stat}>
                balance <span className={styles.money}>179.50 USDC</span>
              </span>
              <span className={styles.stat}>
                rank <span className={styles.strong}>#414</span>
              </span>
            </div>

            <div className={styles.panelGrid}>
              <div className={styles.game}>
                <div className={styles.hand}>
                  <div className={styles.label}>
                    DEALER <span className={styles.strong}>6 + ?</span>
                  </div>
                  <div className={styles.cards}>
                    <PlayingCard card={{ rank: "6", suit: "♠" }} />
                    <PlayingCard card={{ hidden: true }} />
                  </div>
                  <div className={styles.label}>
                    YOU <span className={styles.strong}>12</span> <span className={styles.dim}>· bet 5.00</span>
                  </div>
                  <div className={styles.cards}>
                    <PlayingCard card={{ rank: "A", suit: "♥" }} />
                    <PlayingCard card={{ rank: "A", suit: "♠" }} />
                  </div>
                </div>
                <div className={styles.message}>Hit, stand or double.</div>
                <div className={styles.keys}>
                  {[
                    ["H", "hit"],
                    ["S", "stand"],
                    ["D", "double"],
                  ].map(([key, label]) => (
                    <span key={key} className={styles.key}>
                      <span className={styles.keyLetter}>{key}</span> {label}
                    </span>
                  ))}
                </div>
              </div>

              <div className={styles.side}>
                <div className={styles.sponsor}>
                  <span className={styles.eyebrow}>PRESENTED BY</span>
                  <span className={styles.sponsorName}>Northwind Cloud</span>
                  <span className={styles.muted}>
                    daily pool <span className={styles.money}>$3,000</span>
                  </span>
                  <span className={styles.dim}>ends in 14h</span>
                </div>
                <div className={styles.board}>
                  <span className={styles.eyebrow}>LEADERBOARD</span>
                  {BOARD.map((row) => (
                    <div key={row.rank} className={styles.boardRow}>
                      <span className={styles.boardRank}>{row.rank}</span>
                      <span className={styles.boardHandle}>{row.handle}</span>
                      <span className={styles.muted}>{row.net}</span>
                    </div>
                  ))}
                  <div className={styles.gap}>⋮</div>
                  <div className={styles.boardRow}>
                    <span className={`${styles.boardRank} ${styles.you}`}>414</span>
                    <span className={`${styles.boardHandle} ${styles.you}`}>you</span>
                    <span className={styles.money}>+17.95</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className={styles.input}>
            <span className={styles.chevron}>›</span>
            <span className={styles.placeholder}>Agent is working · your keys go to Tilt</span>
          </div>
          <div className={styles.hints}>
            <span>1·2·3·4 switch game</span>
            <span>ctrl+x tab focus tilt</span>
            <span>keys go to the game while the agent works</span>
            <span className={styles.spacer} />
            <span>18+ · USDC on Solana</span>
          </div>
        </div>
      </div>
      <figcaption className={styles.caption}>Tilt next to a working agent. Names and numbers are examples.</figcaption>
    </figure>
  );
}
