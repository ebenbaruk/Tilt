// One-off setup of the relay's Privy signer. Private keys are generated here and never sent:
// - relay env file: PRIVY_AUTHORIZATION_KEY / PRIVY_KEY_QUORUM_ID (the key the relay signs
//   with), PRIVY_POLICY_ID (only Tilt program instructions may be signed) and
//   PRIVY_ADMIN_QUORUM_ID (owner of the policy);
// - admin file (`<env file>.admin`): PRIVY_ADMIN_KEY, the only key that can change or delete the
//   policy. Move it offline: if the relay's env leaks, the policy still holds.
// The web attaches the policy when the player adds the signer:
// `additional_signers: [{ signer_id: PRIVY_KEY_QUORUM_ID, override_policy_ids: [PRIVY_POLICY_ID] }]`.
//
// Usage: tsx scripts/privy-setup.ts [~/.config/tilt/relay.env]  (file must hold PRIVY_APP_ID and PRIVY_APP_SECRET)
import { generateP256KeyPair, PrivyClient } from "@privy-io/node";
import { PROGRAM_ID } from "@tilt/contract";
import fs from "node:fs";
import os from "node:os";

const file = process.argv[2] ?? `${os.homedir()}/.config/tilt/relay.env`;
const adminFile = `${file}.admin`;
const read = (): Record<string, string> =>
  Object.fromEntries(
    fs.readFileSync(file, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
const append = (path: string, entries: Record<string, string>) => {
  fs.appendFileSync(path, Object.entries(entries).map(([k, v]) => `\n${k}=${v}`).join("") + "\n", { mode: 0o600 });
  fs.chmodSync(path, 0o600);
};

const vars = read();
if (!vars.PRIVY_APP_ID || !vars.PRIVY_APP_SECRET) throw new Error(`${file} must define PRIVY_APP_ID and PRIVY_APP_SECRET`);
const privy = new PrivyClient({ appId: vars.PRIVY_APP_ID, appSecret: vars.PRIVY_APP_SECRET });

async function createQuorum(displayName: string): Promise<{ id: string; privateKey: string }> {
  const keys = await generateP256KeyPair();
  const quorum = await privy.keyQuorums().create({ public_keys: [keys.publicKey], authorization_threshold: 1, display_name: displayName });
  return { id: quorum.id, privateKey: keys.privateKey };
}

if (!vars.PRIVY_KEY_QUORUM_ID) {
  const relay = await createQuorum("tilt-relay");
  append(file, { PRIVY_AUTHORIZATION_KEY: relay.privateKey, PRIVY_KEY_QUORUM_ID: relay.id });
  console.log(`Relay key quorum ${relay.id} created`);
}

if (!read().PRIVY_ADMIN_QUORUM_ID) {
  const admin = await createQuorum("tilt-policy-admin");
  append(adminFile, { PRIVY_ADMIN_KEY: admin.privateKey, PRIVY_ADMIN_QUORUM_ID: admin.id });
  append(file, { PRIVY_ADMIN_QUORUM_ID: admin.id });
  console.log(`Policy admin key quorum ${admin.id} created; its key is in ${adminFile}: move it offline`);
}

if (!read().PRIVY_POLICY_ID) {
  const policy = await privy.policies().create({
    version: "1.0",
    name: `tilt-only ${PROGRAM_ID.toBase58().slice(0, 8)}`,
    chain_type: "solana",
    owner_id: read().PRIVY_ADMIN_QUORUM_ID,
    rules: [
      {
        name: "Only Tilt program instructions",
        method: "signTransaction",
        action: "ALLOW",
        conditions: [{ field_source: "solana_program_instruction", field: "programId", operator: "eq", value: PROGRAM_ID.toBase58() }],
      },
    ],
  });
  append(file, { PRIVY_POLICY_ID: policy.id });
  console.log(`Policy ${policy.id} created for program ${PROGRAM_ID.toBase58()}, owned by the admin quorum`);
}
