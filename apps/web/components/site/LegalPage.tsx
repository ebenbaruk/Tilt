import type { ReactNode } from "react";
import { Box } from "@/components/ui/Box";
import { Page } from "./Page";
import styles from "./LegalPage.module.css";

/** Legal pages stay drafts until a lawyer signs them off (spec §12). */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Page eyebrow="legal · draft" title={title}>
      <Box tone="money" title="draft">
        <p>
          This is a working draft pending review by counsel. It is not final, not legal advice, and does not create
          rights or obligations yet. Real-money play is not open until the final version is published.
        </p>
      </Box>
      <article className={styles.article}>{children}</article>
    </Page>
  );
}
