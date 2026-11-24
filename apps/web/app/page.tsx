import type { Viewport } from "next";
import Link from "next/link";
import { Badge } from "@/components/landing/Badge";
import { GamesFloor } from "@/components/landing/demo/Games";
import { HeroTerminal } from "@/components/landing/demo/HeroTerminal";
import { VerifyOutput } from "@/components/landing/demo/VerifyOutput";
import { Chip, Die } from "@/components/landing/Illustrations";
import { InstallPrompt } from "@/components/landing/InstallPrompt";
import { WaitlistForm } from "@/components/landing/WaitlistForm";
import { WavyWordmark } from "@/components/landing/WavyWordmark";
import { SponsorBlock } from "@/components/tilt/SponsorBlock";
import styles from "./home.module.css";

export const viewport: Viewport = { themeColor: "#0b0b0c", colorScheme: "dark" };

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#games", label: "Games" },
  { href: "#fair", label: "Fair play" },
  { href: "#faq", label: "FAQ" },
];

/** Sized to run once around the badge in the mono face (Badge stretches it the rest of the way). */
const BADGE_RING = "PLAY WHILE YOUR AGENT CODES · 12 GAMES · USDC ON SOLANA · PROVABLY FAIR · ";

const TICKER = [
  ["♠", "Blackjack"],
  ["●", "Roulette"],
  ["♦", "Baccarat"],
  ["7", "Slots"],
  ["✸", "Mines"],
  ["▼", "Dice"],
  ["×", "Limbo"],
  ["(H)", "Flip"],
  ["[12]", "Keno"],
  ["◉", "Wheel"],
  ["▲▼", "Hilo"],
  ["◆", "Tower"],
];

const FACTS = [
  { value: "12", label: "games, one key per move" },
  { value: "1%", label: "fee, on winning rounds only" },
  { value: "0", label: "SOL needed: Tilt pays the network fees" },
];

const STEPS = [
  {
    title: "Install the mod",
    command: "paste the install prompt",
    body: "Paste the prompt below into your coding agent: Claude Code, Codex, OpenCode, omp, Gemini CLI and more. Your agent audits Tilt's code first, tells you what it can and cannot do, and installs it only on your go. Tilt only sees when a turn starts and ends: never your prompts, your code or your tool calls.",
  },
  {
    title: "Log in, add USDC",
    command: "/tilt login",
    body: "Opens your browser. Log in with email, Google or X and a Solana wallet is made for you. Enter the code your terminal shows, then add USDC on your account page, by card or from another wallet. No SOL needed.",
  },
  {
    title: "Play while it works",
    command: "n deal · 5.00",
    body: "Send a prompt and the table opens in your agent, or in a pane beside it. One key per move, and when the agent finishes, your hand waits for the next turn.",
  },
];

const FAQ = [
  {
    flag: "--join",
    q: "How do I get in?",
    a: "Paste the install prompt into your coding agent: the code is public, and your agent audits it before installing. Tilt runs on Solana devnet for now, with test USDC that has no value: log in, ask the team for test USDC, deposit and play. Join the waitlist to hear when Tilt launches.",
  },
  {
    flag: "--agents",
    q: "Does it work in Codex, Grok or other agents?",
    a: "Yes. Tilt runs inside Claude Code, omp, pi, OpenCode, Kilo and DeepSeek Harness, shows its status in Amp, Copilot, Grok, Qwen, Kimi, Droid and Cursor, and plays in a companion pane next to Codex, Gemini CLI, goose, Cline, Crush, CodeWhale and Aider. The install prompt finds your agent's integration and stops if there is none.",
  },
  {
    flag: "--demo",
    q: "Are the games on this page real?",
    a: "No. They are scripted demos: each replays one example round on a loop, with no draw and no money. In the mod, every card, roll and spin comes from a verifiable random draw on Solana.",
  },
  {
    flag: "--currency",
    q: "What do I play with?",
    a: "USDC on Solana, a dollar stablecoin. Your balance shows in dollars and cents.",
  },
  {
    flag: "--wallet",
    q: "Do I need a crypto wallet?",
    a: "No. Log in with email, Google or X and a Solana wallet is created for you.",
  },
  {
    flag: "--fees",
    q: "Do I need SOL for fees?",
    a: "No. Tilt pays the Solana network fees. The only fee is 1% of the gain on the rounds you win.",
  },
  {
    flag: "--deposit",
    q: "Is there a minimum deposit?",
    a: "Yes. The first deposit has a minimum, and a small one-time fee opens your on-chain account. Your account page shows both before you confirm.",
  },
  {
    flag: "--withdraw",
    q: "How do withdrawals work?",
    a: "From this website only, never from the terminal. You confirm with a fresh login and the USDC goes to your own wallet. Daily caps apply; large withdrawals can be held for review.",
  },
  {
    flag: "--custody",
    q: "Who can move my money?",
    a: "Your balance lives in the Tilt program on Solana. Tilt's key can only sign Tilt program instructions for your wallet, and every deposit or withdrawal needs your fresh login.",
  },
  {
    flag: "--limits",
    q: "Can I set limits?",
    a: "Yes: daily deposit and loss limits, and self-exclusion from a day to ten years, from your account page. Lowering a limit is immediate; raising one takes 24 hours.",
  },
  {
    flag: "--region",
    q: "Where is Tilt available?",
    a: "Not in the United States, the United Kingdom, France or other restricted countries. You must be 18 or older.",
  },
];

function Command({ children }: { children: string }) {
  return (
    <p className={styles.command} aria-hidden="true">
      <span className={styles.dollar}>$</span> {children}
    </p>
  );
}

export default function Landing() {
  return (
    <div className={styles.page}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <header className={styles.header}>
        <Link href="/" className={styles.logo} aria-label="Tilt home">
          TILT
        </Link>
        <nav aria-label="Main" className={styles.nav}>
          {NAV.map((item, i) => (
            <a key={item.href} href={item.href} className={styles.navLink}>
              <span className={styles.navKey} aria-hidden="true">
                [{i + 1}]
              </span>{" "}
              {item.label}
            </a>
          ))}
        </nav>
        <a href="#waitlist" className={styles.headerCta}>
          <span aria-hidden="true">⏎</span>Join the waitlist
        </a>
      </header>

      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroText}>
            <p className={styles.heroMeta}>
              <span className={styles.pink}>›</span> for claude code, codex, opencode and more · 12 games · usdc on
              solana · 18+
            </p>
            <WavyWordmark id="hero" className={styles.wordmark} />
            <h1 id="hero-title" className={styles.tagline}>
              The casino you play while your agent codes
            </h1>
            <p className={styles.lede}>
              Blackjack, roulette and ten more games inside your coding agent. Real USDC on Solana, every draw provably
              fair, and the table steps aside the second your agent needs you.
            </p>
            <div id="waitlist" className={styles.waitlist}>
              <WaitlistForm />
              <p className={styles.note}>
                Tilt isn&apos;t open yet. Leave your email and we&apos;ll tell you when the tables open. One email, no
                spam.
              </p>
            </div>
          </div>
          <div className={styles.heroDemo}>
            <Badge className={styles.badge} text={BADGE_RING} />
            <HeroTerminal />
          </div>
        </section>

        <div className={styles.tape} aria-hidden="true">
          <div className={styles.tapeTrack}>
            {[0, 1].map((copy) => (
              <span key={copy} className={styles.tapeRun}>
                {TICKER.map(([glyph, name]) => (
                  <span key={name} className={styles.tapeItem}>
                    <span className={styles.tapeGlyph}>{glyph}</span> {name}
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>

        <section className={styles.intro} aria-labelledby="intro-title">
          <div className={styles.introText}>
            <Command>tilt --why</Command>
            <h2 id="intro-title" className={styles.display}>
              The most fun way to wait on your agent.
            </h2>
            <p className={styles.lede}>
              Your agent works for a minute; you play a hand. The moment it&apos;s done, Tilt hands the keys back and
              your hand is saved for the next turn.
            </p>
          </div>
          <ul className={styles.facts}>
            {FACTS.map((fact) => (
              <li key={fact.label} className={styles.fact}>
                <span className={styles.factValue}>{fact.value}</span>
                <span className={styles.factLabel}>{fact.label}</span>
              </li>
            ))}
          </ul>
          <Die className={styles.introDie} fill="var(--tilt-pink)" />
          <Chip className={styles.introChip} fill="var(--tilt-gold)" />
        </section>

        <section id="games" className={styles.section} aria-labelledby="games-title">
          <div className={styles.sectionHead}>
            <Command>tilt games --all</Command>
            <h2 id="games-title" className={styles.display}>
              The games
            </h2>
            <p className={styles.headNote}>
              Return to player before Tilt&apos;s fee: 1% of the gain, on winning rounds only. Wins are capped at
              10,000× the stake. The tables below are scripted demos: each replays one example round on a loop, with no
              draw and no money.
            </p>
          </div>
          <GamesFloor />
        </section>

        <section id="how" className={styles.section} aria-labelledby="how-title">
          <div className={styles.sectionHead}>
            <Command>tilt --setup</Command>
            <h2 id="how-title" className={styles.display}>
              How it works
            </h2>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((step, i) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <code className={styles.stepCommand}>
                  <span className={styles.pink} aria-hidden="true">
                    ›{" "}
                  </span>
                  {step.command}
                </code>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
          <div className={styles.installPrompt}>
            <InstallPrompt />
          </div>
        </section>

        <section id="fair" className={styles.fair} aria-labelledby="fair-title">
          <div className={styles.fairText}>
            <Command>tilt verify</Command>
            <h2 id="fair-title" className={styles.display}>
              Provably fair
            </h2>
            <p className={styles.manifesto}>
              Every card, pocket and reel comes from a verifiable random draw on Solana. The game rules run in a public
              program, not on our servers. Each round records its randomness: replay it and you get the same cards and
              the same payout. You don&apos;t have to trust us. Check.
            </p>
          </div>
          <figure className={styles.fairDemo}>
            <VerifyOutput />
            <figcaption className={styles.caption}>
              Checking a round: its randomness, a replay in the public program, the same payout. Values are examples.
            </figcaption>
          </figure>
        </section>

        <section id="brands" className={styles.brands} aria-labelledby="brands-title">
          <div className={styles.brandsText}>
            <p className={styles.eyebrow}>For brands</p>
            <h2 id="brands-title" className={styles.displaySmall}>
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
          <div className={styles.sponsorCard} role="group" aria-label="Example sponsor block">
            <div className={styles.sponsorHead} aria-hidden="true">
              <span className={styles.sponsorMark}>TILT</span>
              <span>S1 · daily competition</span>
            </div>
            <div className={styles.sponsorBody}>
              <SponsorBlock name="Your Brand" pool="$3,000" poolLabel="daily pool" endsIn="14h" />
              <p className={styles.sponsorMeta}>top 50 paid · drops every hour</p>
            </div>
          </div>
        </section>

        <section id="faq" className={styles.section} aria-labelledby="faq-title">
          <div className={styles.sectionHead}>
            <Command>tilt help</Command>
            <h2 id="faq-title" className={styles.display}>
              Questions
            </h2>
          </div>
          <div className={styles.faq}>
            {FAQ.map((item) => (
              <details key={item.q} className={styles.faqItem}>
                <summary className={styles.faqQ}>
                  <span className={styles.faqFlag} aria-hidden="true">
                    {item.flag}
                  </span>
                  {item.q}
                </summary>
                <p className={styles.faqA}>
                  <span className={styles.faqBranch} aria-hidden="true">
                    └
                  </span>
                  <span>{item.a}</span>
                </p>
              </details>
            ))}
          </div>
        </section>

        <section id="responsible" className={styles.responsible} aria-labelledby="rg-title">
          <p className={styles.rgTag} aria-hidden="true">
            18+ · real money · the house has an edge
          </p>
          <h2 id="rg-title" className={styles.displaySmall}>
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
          <Link href="/legal/responsible-gaming" className={styles.rgLink}>
            Responsible gaming and where to get help
          </Link>
        </section>

        <section className={styles.closing} aria-labelledby="closing-title">
          <h2 id="closing-title" className={styles.display}>
            Get in early
          </h2>
          <p className={styles.lede}>The tables open soon. One email when they do.</p>
          <a href="#waitlist" className={styles.closingCta}>
            <span aria-hidden="true">⏎</span>Join the waitlist
          </a>
        </section>
      </main>

      <footer className={styles.footer}>
        <WavyWordmark id="footer" className={styles.footerMark} />
        <div className={styles.footerRow}>
          <nav aria-label="Footer" className={styles.footerNav}>
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
