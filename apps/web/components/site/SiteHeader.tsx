import Link from "next/link";
import styles from "./SiteHeader.module.css";

const NAV = [
  { href: "/#how", label: "how it works" },
  { href: "/#games", label: "games" },
  { href: "/leaderboard", label: "leaderboard" },
  { href: "/verify", label: "verify" },
  { href: "/account", label: "account" },
];

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <a href="#main" className="skip-link">
        skip to content
      </a>
      <div className={styles.inner}>
        <Link href="/" className={styles.wordmark} aria-label="Tilt home">
          TILT
        </Link>
        <nav aria-label="Main" className={styles.nav}>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={styles.link}>
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
