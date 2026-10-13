import type { AccountResponse } from "@tilt/api/public";
import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/Button";
import { formatAmount } from "@/lib/amount";
import { accountUrl } from "@/lib/solana";
import styles from "./account.module.css";

export function Overview({ account, onLogout }: { account: AccountResponse; onLogout: () => void }) {
  const { totals } = account;
  return (
    <Box title="balance">
      <div className={styles.figures}>
        <Figure label="tilt balance" value={`${formatAmount(account.balance)} USDC`} money />
        <Figure label="in your wallet" value={`${formatAmount(account.walletUsdc)} USDC`} />
        <Figure label="deposited" value={formatAmount(totals.deposited)} />
        <Figure label="withdrawn" value={formatAmount(totals.withdrawn)} />
        <Figure label="fees paid" value={formatAmount(totals.fees)} />
        <Figure label="rounds" value={totals.rounds.toLocaleString("en-US")} />
      </div>
      <p className={styles.muted}>
        wallet{" "}
        <a href={accountUrl(account.solanaAddress)} target="_blank" rel="noreferrer" className={styles.address}>
          {account.solanaAddress}
        </a>
      </p>
      <div>
        <Button onClick={onLogout}>log out</Button>
      </div>
    </Box>
  );
}

function Figure({ label, value, money = false }: { label: string; value: string; money?: boolean }) {
  return (
    <div className={styles.figure}>
      <span className={styles.muted}>{label}</span>
      <span className={money ? styles.money : styles.value}>{value}</span>
    </div>
  );
}
