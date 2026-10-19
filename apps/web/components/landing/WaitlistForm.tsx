"use client";

import { useState, type FormEvent } from "react";
import terminal from "./WaitlistForm.module.css";
import paper from "./WaitlistFormPaper.module.css";

type State = { status: "idle" | "sending" | "done" } | { status: "error"; message: string };

/** `look`: the terminal landing's, or "paper" for the archived first landing. */
export function WaitlistForm({ look = "terminal" }: { look?: "terminal" | "paper" }) {
  const styles = look === "paper" ? paper : terminal;
  const [state, setState] = useState<State>({ status: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState({ status: "sending" });
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), website: form.get("website") }),
      });
      if (response.ok) return setState({ status: "done" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setState({ status: "error", message: body.error ?? "Something went wrong. Try again." });
    } catch {
      setState({ status: "error", message: "Network error. Try again." });
    }
  }

  if (state.status === "done") {
    return (
      <p className={styles.done} role="status">
        <span className={styles.check} aria-hidden="true">
          ✓{" "}
        </span>
        You&apos;re on the list. We&apos;ll email you when the tables open.
      </p>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <label htmlFor="waitlist-email" className={styles.label}>
        Email
      </label>
      <div className={styles.row}>
        <span className={styles.field}>
          <span className={styles.prompt} aria-hidden="true">
            ›
          </span>
          <input
            id="waitlist-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            maxLength={254}
            className={styles.input}
            aria-invalid={state.status === "error" ? true : undefined}
            aria-describedby={state.status === "error" ? "waitlist-error" : undefined}
          />
        </span>
        <button type="submit" className={styles.button} disabled={state.status === "sending"}>
          <span className={styles.key} aria-hidden="true">
            ⏎
          </span>
          {state.status === "sending" ? "Joining…" : "Join the waitlist"}
        </button>
      </div>
      {/* Honeypot for bots: hidden from people and from assistive tech. */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className={styles.honeypot} />
      {state.status === "error" && (
        <p id="waitlist-error" className={styles.error} role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
