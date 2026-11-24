// Admin operations of the Tilt program, for the runbook (docs/runbook.md).
//
//   pnpm admin status
//   pnpm admin pause deposits|bets|payouts|promo|all     pnpm admin resume …
//   pnpm admin set-round-timeout <secs>   delay before the relay may request a draw again
//   pnpm admin release <player>        pays a player's held withdrawals after review
//   pnpm admin withdraw-house <usdc>   moves unreserved bankroll to the treasury
//   pnpm admin withdraw-promo <usdc>   moves unspent promo money to the treasury
//   pnpm admin set-relayer <pubkey>    rotates the relay's hot key
//   pnpm admin set-admin <pubkey>      hands the admin role over (e.g. to a Squads vault)
//
// The admin signs with ANCHOR_WALLET. Once the admin is a Squads multisig, pass
// `--squads`: the transaction is printed (base58) for the Squads app instead of being sent.
// RPC: BASE_RPC (default devnet).
import anchor from "@coral-xyz/anchor";
import type { IdlTypes, Program as ProgramT } from "@coral-xyz/anchor";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  idl,
  ledgerAddress,
  playerAccountAddress,
  promoAddress,
  promoTokenAddress,
  type Tilt,
  vaultAddress,
  vaultTokenAddress,
} from "@tilt/contract";
import fs from "node:fs";
import os from "node:os";

type Config = IdlTypes<Tilt>["config"];
const PAUSES = ["deposits", "bets", "payouts", "promo"] as const;
type Pause = (typeof PAUSES)[number];
const CONFIG_FLAG: Record<Exclude<Pause, "promo">, keyof Config> = {
  deposits: "depositsPaused",
  bets: "betsPaused",
  payouts: "payoutsPaused",
};

const args = process.argv.slice(2).filter((a) => a !== "--squads");
const squads = process.argv.includes("--squads");
const [command, arg] = args;
const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET ?? `${os.homedir()}/.config/solana/id.json`, "utf8"))),
);
const base = new Connection(process.env.BASE_RPC ?? "https://api.devnet.solana.com", "confirmed");
const program = new anchor.Program(idl, new anchor.AnchorProvider(base, new anchor.Wallet(wallet), { commitment: "confirmed" })) as ProgramT<Tilt>;
const vault = vaultAddress();
const usdc = (s: string | undefined) => {
  if (!s || !/^\d+(\.\d{1,6})?$/.test(s)) throw new Error("expected a USDC amount, e.g. 125.5");
  const [whole, frac = ""] = s.split(".");
  return new anchor.BN(whole + frac.padEnd(6, "0"));
};
const pubkey = (s: string | undefined) => {
  if (!s) throw new Error("expected a public key");
  return new PublicKey(s);
};

/** Sends as the admin, or prints for the Squads app when the admin is a multisig. */
async function run(admin: PublicKey, ...instructions: TransactionInstruction[]) {
  const tx = new Transaction().add(...instructions);
  tx.feePayer = admin;
  tx.recentBlockhash = (await base.getLatestBlockhash()).blockhash;
  if (squads) {
    console.log(`Squads: TX Builder → Add instruction → Import base58 encoded tx:\n${anchor.utils.bytes.bs58.encode(tx.serializeMessage())}`);
    return;
  }
  tx.sign(wallet);
  const signature = await base.sendRawTransaction(tx.serialize());
  await base.confirmTransaction(signature, "confirmed");
  console.log(`done: ${signature}`);
}

async function setPauses(paused: boolean, which: string | undefined) {
  const targets: readonly Pause[] = which === "all" ? PAUSES : PAUSES.filter((p) => p === which);
  if (!targets.length) throw new Error(`expected one of ${PAUSES.join(", ")}, all`);
  const v = await program.account.vault.fetch(vault);
  const ixs: TransactionInstruction[] = [];
  const configTargets = targets.filter((t): t is Exclude<Pause, "promo"> => t !== "promo");
  if (configTargets.length) {
    const config: Config = { ...v.config, ...Object.fromEntries(configTargets.map((t) => [CONFIG_FLAG[t], paused])) };
    ixs.push(await program.methods.setConfig(config).accountsPartial({ admin: v.admin, vault }).instruction());
  }
  if (targets.includes("promo")) {
    const promo = await program.account.promoPool.fetch(promoAddress());
    ixs.push(await program.methods.setPromo({ ...promo.config, paused }).accountsPartial({ admin: v.admin, vault, promo: promoAddress() }).instruction());
  }
  await run(v.admin, ...ixs);
}

async function main() {
  const v = await program.account.vault.fetch(vault);
  switch (command) {
    case "status": {
      const balance = (await getAccount(base, vaultTokenAddress())).amount;
      const reserved = BigInt(v.reserved.toString());
      const promo = await program.account.promoPool.fetchNullable(promoAddress());
      const promoBalance = promo ? (await getAccount(base, promoTokenAddress())).amount : 0n;
      console.log({
        program: program.programId.toBase58(),
        admin: v.admin.toBase58(),
        relayer: v.relayer.toBase58(),
        vaultBalance: balance.toString(),
        reserved: reserved.toString(),
        free: (balance - reserved).toString(),
        paused: { deposits: v.config.depositsPaused, bets: v.config.betsPaused, payouts: v.config.payoutsPaused, promo: promo?.config.paused },
        promoBalance: promoBalance.toString(),
        roundTimeoutSecs: v.config.roundTimeoutSecs.toString(),
      });
      return;
    }
    case "pause":
    case "resume":
      return setPauses(command === "pause", arg);
    case "set-round-timeout": {
      if (!arg || !/^\d+$/.test(arg)) throw new Error("expected a number of seconds, e.g. 300");
      const config: Config = { ...v.config, roundTimeoutSecs: new anchor.BN(arg) };
      return run(v.admin, await program.methods.setConfig(config).accountsPartial({ admin: v.admin, vault }).instruction());
    }
    case "release": {
      const player = pubkey(arg);
      return run(v.admin, await program.methods.releaseWithdrawals()
        .accountsPartial({
          admin: v.admin,
          vault,
          account: playerAccountAddress(player),
          vaultToken: vaultTokenAddress(),
          playerToken: getAssociatedTokenAddressSync(v.mint, player),
          mint: v.mint,
          ledger: ledgerAddress(player),
        })
        .instruction());
    }
    case "withdraw-house":
      return run(v.admin, await program.methods.withdrawHouse(usdc(arg))
        .accountsPartial({ admin: v.admin, vault, vaultToken: vaultTokenAddress(), treasury: v.treasury, mint: v.mint }).instruction());
    case "withdraw-promo":
      return run(v.admin, await program.methods.withdrawPromo(usdc(arg))
        .accountsPartial({ admin: v.admin, vault, promo: promoAddress(), promoToken: promoTokenAddress(), treasury: v.treasury, mint: v.mint }).instruction());
    case "set-relayer":
      return run(v.admin, await program.methods.setRoles(v.admin, pubkey(arg)).accountsPartial({ admin: v.admin, vault }).instruction());
    case "set-admin":
      return run(v.admin, await program.methods.setRoles(pubkey(arg), v.relayer).accountsPartial({ admin: v.admin, vault }).instruction());
    default:
      throw new Error("usage: see the header of scripts/admin.ts");
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
