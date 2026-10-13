import Link from "next/link";
import { InstallSnippet } from "@/components/landing/InstallSnippet";
import { TerminalDemo } from "@/components/landing/TerminalDemo";
import styles from "./page.module.css";

const STEPS = [
  {
    n: "01",
    title: "Install the mod",
    body: "Two commands in Claude Code. The mod only sees when a turn starts and ends: never your prompts, your code or your tool calls. Its source is public.",
  },
  {
    n: "02",
    title: "Log in, deposit USDC",
    body: "/tilt login opens the browser. Sign in with email, Google, X or Phantom; a Solana wallet is made for you. Fund it by card or transfer. No SOL needed: Tilt pays network fees.",
  },
  {
    n: "03",
    title: "Play while it works",
    body: "Send a prompt and the panel opens. One key per move. When the agent finishes you get a green line and your hand waits for the next turn.",
  },
];

const GAMES = [
  {
    name: "Blackjack",
    rtp: "≈ 99.00%",
    rules: "No hole card, infinite shoe, dealer stands on 17, blackjack pays 3:2, double on the first two cards.",
  },
  {
    name: "Roulette",
    rtp: "97.30%",
    rules: "European, single zero. One bet per spin: straight, red/black, odd/even, low/high, dozen, column.",
  },
  {
    name: "Baccarat",
    rtp: "98.76 / 98.94 / ≈ 85.9%",
    rules: "Punto Banco, infinite shoe. Player 1:1, banker 1:1 minus 5% commission, tie 8:1.",
  },
  { name: "Slots", rtp: "96.16%", rules: "Three weighted reels, public paytable, top win 250×." },
];

const FAQ = [
  {
    q: "What do I play with?",
    a: "USDC on Solana, a dollar stablecoin. Balances show in dollars with cents; amounts are whole base units on-chain, never rounded floats.",
  },
  {
    q: "Do I need a crypto wallet?",
    a: "No. Log in with email, Google or X and Privy creates a Solana wallet for you. Already on Phantom? Log in with it.",
  },
  {
    q: "Do I need SOL for fees?",
    a: "No. Tilt pays the Solana network fees. The only fee is 1% of the gain on rounds you win.",
  },
  {
    q: "Is there a minimum deposit?",
    a: "Yes. The first deposit has a minimum, and a small one-time onboarding fee is taken from it to open your on-chain account. The account page shows both before you confirm.",
  },
  {
    q: "How do withdrawals work?",
    a: "From this website only, never from the terminal. You confirm with a fresh login and the USDC goes to your own wallet. Per-withdrawal and daily caps apply; large withdrawals can be held for review.",
  },
  {
    q: "Who can move my money?",
    a: "Your balance lives in the Tilt program on Solana. Tilt's server key can sign only Tilt program instructions for your wallet, enforced by a signing policy it does not control.",
  },
  {
    q: "Can I set limits?",
    a: "Yes: daily deposit and loss limits, and self-exclusion from 1 day to 10 years, on your account page. Lowering a limit is immediate; raising one takes 24 hours.",
  },
  {
    q: "Where is Tilt available?",
    a: "Not in the United States, the United Kingdom, France or other restricted jurisdictions. You must be 18 or older. Region and identity are checked.",
  },
];

export default function Home() {
  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroText}>
          <p className={styles.eyebrow}>TILT · for claude code</p>
          <h1 id="hero-title" className={styles.heroTitle}>
            The casino you play while your agent codes.
          </h1>
          <p className={styles.lede}>
            Blackjack, roulette, baccarat and slots in a panel next to your agent. USDC on Solana, every draw provably
            fair, and your hand saved the moment the agent is done.
          </p>
          <InstallSnippet />
          <p className={styles.small}>18+ · not available in the US, UK, France and other restricted countries</p>
        </div>
        <TerminalDemo />
      </section>

      <section id="how" className={styles.section} aria-labelledby="how-title">
        <h2 id="how-title" className={styles.sectionTitle}>
          How it works
        </h2>
        <ol className={styles.steps}>
          {STEPS.map((step) => (
            <li key={step.n} className={styles.step}>
              <span className={styles.stepNumber}>{step.n}</span>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="games" className={styles.section} aria-labelledby="games-title">
        <h2 id="games-title" className={styles.sectionTitle}>
          Games
        </h2>
        <p className={styles.sectionLede}>
          Return to player (RTP) is shown before Tilt&apos;s fee: 1% of the gain, on winning rounds only. Losing rounds
          pay no fee.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">game</th>
                <th scope="col">rtp</th>
                <th scope="col">rules</th>
              </tr>
            </thead>
            <tbody>
              {GAMES.map((game) => (
                <tr key={game.name}>
                  <th scope="row">{game.name}</th>
                  <td className={styles.money}>{game.rtp}</td>
                  <td>{game.rules}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.small}>
          Baccarat RTP by bet: player / banker / tie. Blackjack RTP assumes basic strategy.
        </p>
      </section>

      <section id="fair" className={styles.split} aria-labelledby="fair-title">
        <div className={styles.splitText}>
          <h2 id="fair-title" className={styles.sectionTitle}>
            Provably fair, on-chain
          </h2>
          <p>
            Games, odds and draws run in the Tilt program on Solana. Every card, pocket and reel comes from a VRF: the
            program accepts randomness only from the oracle, and only for the draw it asked for.
          </p>
          <p>
            Each settled round records its randomness. Replay it with the public rules and you get the same cards and
            the same payout. Nothing depends on trusting a Tilt server.
          </p>
          <p>
            <Link href="/verify">verify a round →</Link>
          </p>
        </div>
        <pre className={styles.fairMock} aria-label="Example verification output">
          {`round 1,204 · blackjack\nrandomness  9f3c…a71e\nreplay      you 20 · dealer 19\non-chain    stake 1.00 · payout 2.00 · fee 0.01\n`}
          <span className={styles.ok}>✓ replay matches on-chain</span>
        </pre>
      </section>

      <section id="sponsors" className={styles.split} aria-labelledby="sponsors-title">
        <div className={styles.splitText}>
          <p className={styles.eyebrow}>for brands</p>
          <h2 id="sponsors-title" className={styles.sectionTitle}>
            Be the name next to the prize pool.
          </h2>
          <p>
            Sponsors hold the <span className={styles.strong}>Presented by</span> slot for a day, a week or a season: on
            every table, next to the pool and on win cards, in front of developers while they watch the screen. Always
            labelled as sponsored.
          </p>
          <p>
            Your budget funds a prize pool. Competitions rank net gain over the window, not balance; part of the pool
            goes to random drops, one ticket per hand whatever the stake. You get a report: time on screen, unique
            players, hands, shares.
          </p>
        </div>
        <div className={styles.sponsorMock}>
          <span className={styles.mockEyebrow}>PRESENTED BY · SPONSORED</span>
          <span className={styles.sponsorName}>Your Brand</span>
          <span>
            daily pool <span className={styles.money}>$3,000</span>
          </span>
          <span className={styles.muted}>ends in 14h · top 50 paid · drops every hour</span>
        </div>
      </section>

      <section id="faq" className={styles.section} aria-labelledby="faq-title">
        <h2 id="faq-title" className={styles.sectionTitle}>
          Fair questions
        </h2>
        <div className={styles.faq}>
          {FAQ.map((item) => (
            <details key={item.q} className={styles.faqItem}>
              <summary className={styles.faqQ}>{item.q}</summary>
              <p className={styles.faqA}>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="responsible" className={styles.responsible} aria-labelledby="rg-title">
        <h2 id="rg-title" className={styles.sectionTitle}>
          Play with what you can afford to lose
        </h2>
        <p>
          Tilt is real-money gambling for adults 18 and over. The house has an edge on every game. Set deposit and loss
          limits or self-exclude from your account at any time, and take breaks: the agent doesn&apos;t need you
          watching.
        </p>
        <p>
          Not available in the United States, the United Kingdom, France or other jurisdictions where online casino
          games are restricted. Licensing is in progress; real-money play opens only where it is licensed and permitted.
        </p>
        <p>
          <Link href="/legal/responsible-gaming">responsible gaming and where to get help →</Link>
        </p>
      </section>
    </div>
  );
}
