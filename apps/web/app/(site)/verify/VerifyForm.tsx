"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { isSignature } from "@/lib/solana";
import styles from "./verify.module.css";

export function VerifyForm({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const signature = value.trim();
    if (!isSignature(signature)) {
      setError("That isn't a Solana transaction signature (base58, about 88 characters).");
      return;
    }
    setError(null);
    router.push(`/verify/${signature}`);
  }

  return (
    <form onSubmit={onSubmit} className={styles.form} noValidate>
      <Field
        label="round signature"
        placeholder="5h3Kx…"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={error}
        hint="Shown in the panel after each round, and in your round history."
      />
      <div>
        <Button type="submit" variant="solid">
          verify
        </Button>
      </div>
    </form>
  );
}
