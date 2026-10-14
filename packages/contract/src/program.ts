// Addresses of the Tilt program and its accounts, for reading state on Solana and in the rollup.
import { PublicKey } from "@solana/web3.js";
import idl from "./idl/tilt.json" with { type: "json" };

export { idl };
export type { Tilt } from "./idl/tilt";

export const PROGRAM_ID = new PublicKey(idl.address);

const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

/** House state and its USDC token account (Solana). */
export const vaultAddress = () => pda(Buffer.from("vault"));
export const vaultTokenAddress = () => pda(Buffer.from("vault_token"));

/** Player balance and current round; lives in the rollup after the first deposit. */
export const playerAccountAddress = (player: PublicKey) => pda(Buffer.from("account"), player.toBuffer());

/** A player's blackjack table (hands and dealer of the current or last round); lives in the
 *  rollup next to the player account. Seed `bjtable`: the split-sized table replaced the old
 *  `table` accounts, which delegated accounts could not grow into. */
export const tableAddress = (player: PublicKey) => pda(Buffer.from("bjtable"), player.toBuffer());

/** Solana's record of a player's deposits and paid withdrawals. */
export const ledgerAddress = (player: PublicKey) => pda(Buffer.from("ledger"), player.toBuffer());

/** Sponsor prize pool and its USDC token account (Solana). */
export const promoAddress = () => pda(Buffer.from("promo"));
export const promoTokenAddress = () => pda(Buffer.from("promo_token"));

/** Record of one promo payout (16-byte payout id, e.g. a UUID's bytes); exists once paid. */
export const promoPayoutAddress = (payoutId: Uint8Array) => pda(Buffer.from("payout"), Buffer.from(payoutId));
