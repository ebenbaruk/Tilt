import type { Viewport } from "next";
import Link from "next/link";
import { AgentCliPreview } from "@/components/landing/AgentCliPreview";
import { Badge } from "@/components/landing/Badge";
import { CopyPill } from "@/components/landing/CopyPill";
import {
  Burst,
  CardBuddy,
  Chip,
  Die,
  Fan,
  Minefield,
  Reels,
  Terminal,
  Wheel,
} from "@/components/landing/Illustrations";
import { INSTALL_COMMANDS } from "@/components/landing/InstallSnippet";
import { WavyWordmark } from "@/components/landing/WavyWordmark";
import styles from "./landing.module.css";

export const viewport: Viewport = { themeColor: "#ffe26e", colorScheme: "light" };

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#games", label: "Games" },
  { href: "#fair", label: "Fair play" },
  { href: "#faq", label: "FAQ" },
];

const STEPS = [
  {
    title: "Install the mod",
    body: "Two commands in Claude Code. The mod only sees when a turn starts and ends: never your prompts, your code or your tool calls.",
    art: <Terminal />,
  },
  {
    title: "Log in, add USDC",
    body: "/tilt login opens your browser. Email, Google, X or Phantom; a Solana wallet is made for you. Fund it by card. No SOL needed.",
    art: <Chip />,
  },
  {
    title: "Play while it works",
    body: "Send a prompt and the panel opens. One key per move. When the agent finishes, your hand waits for the next turn.",
    art: <CardBuddy />,
  },
];

const GAMES = [
  {
    name: "Blackjack",
    rtp: "99.00%",
    rules: "No hole card, dealer stands on 17, blackjack pays 3:2, double on your first two cards, split pairs.",
    tone: styles.toneOrange,
    art: <CardBuddy />,
  },
  {
    name: "Roulette",
    rtp: "97.30%",
    rules: "European, single zero. Straight up, red or black, odd or even, low or high, dozens, columns.",
    tone: styles.toneSky,
    art: <Wheel />,
  },
  {
    name: "Baccarat",
    rtp: "98.94%",
    rules: "Punto Banco. Player 1:1, banker 1:1 less 5%, tie 8:1. Banker shown; player 98.76%, tie 85.9%.",
    tone: styles.tonePink,
    art: <Fan />,
  },
  {
    name: "Slots",
    rtp: "96.16%",
    rules: "Three weighted reels, a public paytable and a top win of 250× your stake.",
    tone: styles.toneGreen,
    art: <Reels />,
  },
  {
    name: "Mines",
    rtp: "99.00%",
    rules: "Pick 1 to 24 mines on a 5×5 board, reveal tiles one by one and cash out before you hit a mine.",
    tone: styles.tonePaper,
    art: <Minefield />,
  },
];

const FAQ = [
  {
    q: "What do I play with?",
    a: "USDC on Solana, a dollar stablecoin. Your balance shows in dollars and cents.",
  },
  {
    q: "Do I need a crypto wallet?",
    a: "No. Log in with email, Google or X and a Solana wallet is created for you. Already on Phantom? Use it.",
  },
  {
    q: "Do I need SOL for fees?",
    a: "No. Tilt pays the Solana network fees. The only fee is 1% of the gain on the rounds you win.",
  },
  {
    q: "Is there a minimum deposit?",
    a: "Yes. The first deposit has a minimum, and a small one-time fee opens your on-chain account. Your account page shows both before you confirm.",
  },
  {
    q: "How do withdrawals work?",
    a: "From this website only, never from the terminal. You confirm with a fresh login and the USDC goes to your own wallet. Daily caps apply; large withdrawals can be held for review.",
  },
  {
    q: "Who can move my money?",
    a: "Your balance lives in the Tilt program on Solana. Tilt's key can only sign Tilt program instructions for your wallet, and every deposit or withdrawal needs your fresh login.",
  },
  {
    q: "Can I set limits?",
    a: "Yes: daily deposit and loss limits, and self-exclusion from a day to ten years, from your account page. Lowering a limit is immediate; raising one takes 24 hours.",
  },
  {
    q: "Where is Tilt available?",
    a: "Not in the United States, the United Kingdom, France or other restricted countries. You must be 18 or older.",
  },
];

export default function Landing() {
  return (
    <div className={styles.landing}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <header className={styles.header}>
        <Link href="/" className={styles.logo} aria-label="Tilt home">
          TILT
        </Link>
        <nav aria-label="Main" className={styles.nav}>
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className={styles.navLink}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className={styles.headerActions}>
          <a href="#install" className={styles.pill}>
            Get the mod
          </a>
          <Link href="/account" className={styles.circle}>
            Log in
          </Link>
        </div>
      </header>

      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroMain}>
            <h1 id="hero-title" className={styles.kicker}>
              The casino you play while your agent codes
            </h1>
            <WavyWordmark id="hero" className={styles.wordmark} />
          </div>
          <div className={styles.heroSide}>
            <Badge className={styles.badge} />
            <p className={styles.blob}>Your hand is saved the moment the agent is done.</p>
          </div>
        </section>

        <section className={styles.intro} aria-labelledby="intro-title">
          <div className={styles.introArt}>
            <span className={`${styles.disc} ${styles.discPink}`} />
            <span className={`${styles.disc} ${styles.discSky}`} />
            <Die className={styles.introDie} />
            <CardBuddy className={styles.introBuddy} />
            <Chip className={styles.introChip} />
          </div>
          <div className={styles.introText}>
            <h2 id="intro-title" className={styles.serifTitle}>
              The most fun way to wait on your agent.
            </h2>
            <p className={styles.lede}>
              Blackjack, roulette, baccarat, slots and mines in a panel inside Claude Code. Real USDC on Solana, every
              draw provably fair, and the panel steps aside the second your agent needs you.
            </p>
            <div className={styles.row}>
              <a href="#install" className={styles.pill}>
                Get the mod
              </a>
              <a href="#games" className={styles.pillGhost}>
                See the games
              </a>
            </div>
          </div>
        </section>

        <section id="install" className={styles.section} aria-labelledby="install-title">
          <div className={styles.sectionHead}>
            <h2 id="install-title" className={styles.displayTitle}>
              Three lines to install
            </h2>
            <Burst className={styles.headBurst} />
          </div>
          <div className={styles.installGrid}>
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.cardLabel}>In Claude Code</span>
                <CopyPill text={INSTALL_COMMANDS.join("\n")} className={styles.pillSmall} />
              </div>
              <pre className={styles.code} aria-label="Install commands">
                {INSTALL_COMMANDS.map((line) => (
                  <code key={line} className={styles.codeLine}>
                    <span aria-hidden="true">› </span>
                    {line}
                    {"\n"}
                  </code>
                ))}
              </pre>
              <p className={styles.note}>Needs Claude Code 2.1.287 or later, in the terminal or the desktop app.</p>
            </div>
            <div className={styles.demo}>
              <AgentCliPreview />
            </div>
          </div>
        </section>

        <section id="how" className={styles.section} aria-labelledby="how-title">
          <div className={styles.sectionHead}>
            <h2 id="how-title" className={styles.displayTitle}>
              How it works
            </h2>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((step, i) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {i + 1}
                </span>
                <div className={styles.stepArt}>{step.art}</div>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="games" className={styles.section} aria-labelledby="games-title">
          <div className={styles.sectionHead}>
            <h2 id="games-title" className={styles.displayTitle}>
              The games
            </h2>
            <p className={styles.headNote}>
              Return to player before Tilt&apos;s fee: 1% of the gain, on winning rounds only.
            </p>
          </div>
          <ul className={styles.games}>
            {GAMES.map((game) => (
              <li key={game.name} className={`${styles.game} ${game.tone}`}>
                <div className={styles.gameArt}>{game.art}</div>
                <h3 className={styles.gameName}>{game.name}</h3>
                <p className={styles.rtp}>
                  <span className={styles.rtpValue}>{game.rtp}</span> RTP
                </p>
                <p>{game.rules}</p>
              </li>
            ))}
          </ul>
          <p className={styles.footnote}>Blackjack assumes basic strategy.</p>
        </section>

        <section id="fair" className={styles.fair} aria-labelledby="fair-title">
          <div className={styles.fairText}>
            <h2 id="fair-title" className={styles.displayTitle}>
              Provably fair
            </h2>
            <p className={styles.manifesto}>
              Every card, pocket and reel comes from a verifiable random draw on Solana. The game rules run in a public
              program, not on our servers. Each round records its randomness: replay it and you get the same cards and
              the same payout. You don&apos;t have to trust us. Check.
            </p>
            <Link href="/verify" className={styles.pillInk}>
              Verify a round
            </Link>
          </div>
          <div className={styles.fairArt}>
            <Die className={styles.fairDie} fill="var(--pink)" />
            <Wheel className={styles.fairWheel} />
            <Chip className={styles.fairChip} fill="var(--green)" />
          </div>
        </section>

        <section id="brands" className={styles.brands} aria-labelledby="brands-title">
          <div className={styles.brandsText}>
            <p className={styles.eyebrow}>For brands</p>
            <h2 id="brands-title" className={styles.serifTitle}>
              Be the name next to the prize pool.
            </h2>
            <p>
              Sponsors hold the <strong>Presented by</strong> slot for a day, a week or a season: on every table, next
              to the pool and on win cards, in front of developers watching their screen. Always labelled as sponsored.
            </p>
            <p>
              Your budget funds the prize pool. Competitions rank net gain, not balance, and random drops give every
              hand a ticket. You get a report: time on screen, players, hands and shares.
            </p>
          </div>
          <div className={styles.sponsorCard} aria-label="Example sponsor block">
            <span className={styles.cardLabel}>Presented by · sponsored</span>
            <span className={styles.sponsorName}>Your Brand</span>
            <span>
              Daily pool <strong>$3,000</strong>
            </span>
            <span className={styles.muted}>Ends in 14h · top 50 paid · drops every hour</span>
          </div>
        </section>

        <section id="faq" className={styles.section} aria-labelledby="faq-title">
          <div className={styles.sectionHead}>
            <h2 id="faq-title" className={styles.displayTitle}>
              Questions
            </h2>
          </div>
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
          <h2 id="rg-title" className={styles.serifTitle}>
            Play with what you can afford to lose.
          </h2>
          <p>
            Tilt is real-money gambling for adults 18 and over, and the house has an edge on every game. Set deposit and
            loss limits or self-exclude from your account at any time. The agent doesn&apos;t need you watching.
          </p>
          <p>
            Not available in the United States, the United Kingdom, France or other countries where online casino games
            are restricted. Real-money play opens only where Tilt is licensed.
          </p>
          <Link href="/legal/responsible-gaming" className={styles.linkLight}>
            Responsible gaming and where to get help
          </Link>
        </section>
      </main>

      <footer className={styles.footer}>
        <WavyWordmark id="footer" className={styles.footerMark} />
        <div className={styles.footerRow}>
          <nav aria-label="Footer" className={styles.footerNav}>
            <Link href="/leaderboard">Leaderboard</Link>
            <Link href="/verify">Verify</Link>
            <Link href="/account">Account</Link>
            <Link href="/legal/terms">Terms</Link>
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/responsible-gaming">Responsible gaming</Link>
          </nav>
          <p>© 2026 Tilt · 18+ · Play responsibly</p>
        </div>
      </footer>
    </div>
  );
}
