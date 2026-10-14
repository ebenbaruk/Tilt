import { Button } from "@/components/ui/Button";
import { Status } from "@/components/ui/Status";
import { solanaTxUrl } from "@/lib/solana";
import type { MoneyPhase } from "@/lib/intent";

export function MoneyStatus({
  phase,
  doneText,
  onCheckAgain,
}: {
  phase: MoneyPhase;
  doneText: string;
  onCheckAgain: () => void;
}) {
  switch (phase.kind) {
    case "idle":
      return null;
    case "working":
      return <Status tone="pending">{phase.label}</Status>;
    case "stillPending":
      return (
        <div>
          <Status tone="pending">{phase.message}</Status>
          <Button onClick={onCheckAgain}>check again</Button>
        </div>
      );
    case "done":
      return (
        <Status tone="success">
          {doneText}
          {phase.signature && (
            <>
              {" · "}
              <a href={solanaTxUrl(phase.signature)} target="_blank" rel="noreferrer">
                view transaction
              </a>
            </>
          )}
        </Status>
      );
    case "failed":
      return <Status tone="loss">{phase.message}</Status>;
  }
}
