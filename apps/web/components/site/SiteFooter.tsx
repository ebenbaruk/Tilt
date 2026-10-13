import Link from "next/link";
import styles from "./SiteFooter.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.row}>
          <span className={styles.wordmark}>TILT</span>
          <span className={styles.adult}>18+</span>
          <span>real-money games · play with what you can afford to lose</span>
        </div>
        <nav aria-label="Legal" className={styles.links}>
          <Link href="/legal/terms">terms</Link>
          <Link href="/legal/privacy">privacy</Link>
          <Link href="/legal/responsible-gaming">responsible gaming</Link>
          <Link href="/verify">verify a round</Link>
          <Link href="/#sponsors">sponsors</Link>
        </nav>
        <p className={styles.small}>
          Not available in the United States, the United Kingdom, France or other restricted jurisdictions. Access is
          checked by region and identity. Licensing is in progress; real-money play opens only where and when it is
          permitted.
        </p>
      </div>
    </footer>
  );
}
