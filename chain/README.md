# chain/ — programme on-chain Tilt

Propriétaire : Armand (spec §8). Décisions : spec §6.1 (tout on-chain, D2).

Un seul programme Anchor, `tilt`, déployé sur Solana et utilisé dans un Ephemeral Rollup MagicBlock :

- **L'argent reste sur Solana** : un coffre USDC (`vault_token`) et, par joueur, un registre (`Ledger`) que seul Solana écrit.
- **Le jeu se passe dans le rollup** : le compte du joueur (`PlayerAccount`) y entre à son premier dépôt et y reste. Une manche n'est qu'une mise à jour de solde, avec un tirage VRF MagicBlock (gratuit dans le rollup).
- **Les retraits** sont demandés dans le rollup et payés sur Solana par une Magic Action, après vérification contre le registre.

Adresse du programme (devnet) : `2css9q2M2SH4ekVjLYs9dfnEQpsxMprrYUrM2hWzVokd`. L'IDL partagée avec le reste du monorepo est copiée dans `packages/contract/src/idl` par `scripts/sync-idl.sh` (la CI vérifie qu'elle est à jour).

## Organisation

```
programs/tilt/src/
  lib.rs              points d'entrée
  state.rs            Config, Vault, Ledger, PlayerAccount, Round (et la logique d'une manche)
  settlement.rs       règle des 1 % sur le gain de chaque manche gagnante
  rng.rs              tirages sans biais à partir d'une sortie VRF
  withdrawals.rs      vérifications anti-fraude, plafonds, paiement, pertes libérées
  games/              règles pures des jeux (sans Solana), testées une par une
  instructions/       admin, comptes, manches, retraits et checkpoints, gains promo
scripts/
  local-stack.sh      Solana + rollup + oracle VRF en local (Docker)
  e2e.ts              scénario complet en USDC : jeux, retraits, attaques, checkpoint, gains promo
  sync-idl.sh         copie l'IDL vers packages/contract
  admin.ts            opérations d'admin : état, pauses, libération des retraits, rôles (docs/runbook.md)
```

## Rôles

- **admin** (destiné à un multisig Squads) : `set_config`, `set_roles`, `withdraw_house`, `release_withdrawals`, `init_promo`, `set_promo`, `withdraw_promo`. Seule l'autorité de mise à jour du programme peut appeler `initialize`, et elle en devient l'admin.
- **relayer** (clé chaude du relais `apps/wallet`, remplaçable par l'admin) : ouvre les comptes et paie les rents, joue et retire pour les joueurs dans le rollup, finance les Magic Actions, verse les gains promo. Aucune autre clé ne peut jouer pour un joueur.

## Jeux

| Jeu | Règles | RTP avant les 1 % Tilt | Gain max (mise 1) |
|---|---|---|---|
| Blackjack | Sans carte cachée (la 2e carte du croupier n'est tirée qu'après le joueur), sabot infini, croupier reste sur 17, blackjack 3:2, double sur les 2 premières cartes. Pas de split (v1.1, D11) | ≈ 98,7 % avec une stratégie de base simple (simulé, 400 000 mains) | 2 (double gagné) |
| Roulette | Européenne, un pari par tour : plein (35:1), rouge/noir, pair/impair, manque/passe (1:1), douzaine, colonne (2:1) | 97,30 % (exact) | 35 |
| Baccarat | Punto Banco, règles de 3e carte standard, sabot infini. Joueur 1:1, Banque 1:1 − 5 % de commission, Égalité 8:1 | Joueur 98,76 %, Banque 98,94 %, Égalité ≈ 85,9 % (exact) | 8 |
| Slots | 3 rouleaux identiques pondérés, table publique dans `games/slots.rs` | 96,16 % (exact) | 249 |

Chaque tirage a un identifiant de requête (`round.request_id`) transmis avec la requête VRF : seule la réponse à la requête en cours peut jouer la manche, une réponse tardive est refusée. À la fin de chaque manche, l'événement `RoundSettled` (jeu, mise, gain, frais, aléa) est émis dans le rollup ; en rejouant l'aléa dans les règles des jeux, on retrouve le résultat. Les 1 % Tilt sont pris sur le gain de chaque manche gagnante, jamais sur la mise ni sur une perte ou une égalité.

## Parcours

1. **Ouverture (Solana)** : `open_account` + `delegate_account` dans la même transaction, payée par le relais. Tilt se rembourse en USDC sur ce premier dépôt (`onboarding_fee`, versé à la trésorerie). Sans dépôt, impossible d'entrer dans le rollup ; la délégation ne peut viser que le validateur configuré. Le joueur n'a besoin d'aucun SOL.
2. **Dépôt (Solana)** : `deposit`, possible pendant que le compte est dans le rollup ; crédité à la manche suivante (jamais deux fois, même si le rollup lit une copie en retard du registre).
3. **Manches (rollup)** : `blackjack_bet/hit/stand/double`, `roulette_spin`, `baccarat_deal`, `slots_spin` ; le VRF rappelle `consume_randomness`. Une manche non terminée survit à une déconnexion ; après `round_timeout_secs`, le relais la clôt avec `expire_round` (stand automatique, ou nouveau tirage si le précédent n'est jamais arrivé).
4. **Retrait (rollup → Solana)** : `withdraw` débite le solde, inscrit le compte sur Solana et programme `pay_withdrawals`. Autorisé pendant une manche (la mise est déjà sortie du solde). Le compte reste dans le rollup.
5. **Checkpoint (rollup → Solana)** : `checkpoint` constate les pertes du joueur et `apply_checkpoint` les retire de la réserve du coffre, pour que les gains de la maison puissent sortir (`withdraw_house`). À lancer régulièrement par le relais.
6. **Gains promo (Solana)** : les sponsors alimentent un pool séparé de la bankroll (`fund_promo`) ; le relais verse un gain de compétition ou un drop directement dans le wallet du gagnant (`pay_promo`), dans la limite d'un plafond par gain et par 24 h, une seule fois par identifiant de gain (`PromoPayout`). L'admin peut mettre le pool en pause ou reprendre le reste (`withdraw_promo`).

## Protections

- **Le rollup n'est pas cru sur parole** : `checked_due` refuse tout état où le joueur aurait été crédité de plus que ses dépôts réels, ou retirerait plus que ses dépôts − pertes libérées + son plafond de gains. `checked_forfeit` borne de la même façon les pertes déclarées.
- **Limites** (`Config`, vérifiée par `Config::validate`) : mise min et max, gain max par manche, plafond de gains par joueur (borné par un maximum et par un multiple du premier dépôt), dépôt min (≥ retrait min), retrait min, plafond par retrait (≤ plafonds journaliers), par joueur et par 24 h, global par 24 h (seul l'argent de la maison y est compté : ce qui dépasse les dépôts du joueur moins ses pertes déjà libérées). Au-delà, le retrait est **mis en attente** et libéré par l'admin. Pauses séparées : dépôts, mises, paiements.
  - Les fenêtres de 24 h sont des blocs fixes, pas glissantes : autour d'un changement de bloc, jusqu'à 2 × le plafond peut sortir en peu de temps. Les plafonds sont à régler en conséquence.
  - Dès qu'un retrait est en attente pour un joueur, ses retraits suivants le sont aussi (tout ou rien, dans l'ordre) jusqu'à la libération par l'admin.
  - Le plafond de gains d'un joueur est à vie ; les pertes libérées par checkpoint le rouvrent d'autant.
- **Solvabilité** : `vault.reserved` = somme sur les joueurs de (dépôts − pertes libérées − retraits payés + plafond de gains) ; `withdraw_house` ne peut sortir que l'excédent.
- **Seul le VRF** peut appeler `consume_randomness`, **seule une Magic Action** financée par le relais peut appeler `pay_withdrawals` et `apply_checkpoint`, **seul le relais** peut jouer pour un joueur.

## Commandes

Prérequis : Rust, Solana CLI 3.1.9, Anchor 1.0.2 (`avm`), Node 22 + pnpm, Docker (pour le rollup local).

```bash
cargo test                      # règles des jeux, RTP exacts, anti-fraude, limites
cargo clippy --all-targets -- -D warnings
anchor build && ./scripts/sync-idl.sh
pnpm install
./scripts/local-stack.sh        # Solana + rollup + VRF locaux
pnpm e2e                        # scénario complet sur la stack locale
pnpm --filter @tilt/wallet e2e  # même stack, à travers le relais (Postgres : TEST_DATABASE_URL)
docker rm -f tilt-mb-stack tilt-vrf
```

Sur devnet (rollup MagicBlock EU) :

```bash
BASE_RPC=https://api.devnet.solana.com ER_RPC=https://devnet-eu.magicblock.app ER_WS=wss://devnet-eu.magicblock.app \
VALIDATOR=MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e VRF_ER_QUEUE=5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc \
POLL_MS=150 pnpm e2e
```

La clé du programme (`target/deploy/tilt-keypair.json`) n'est pas versionnée : la garder hors du dépôt et la sauvegarder. Un changement de structure des comptes (comme celui de `Vault`) demande un nouveau déploiement ou une migration.

## Reste à faire avant le mainnet

- Sortie de secours si le rollup tombe (récupérer le compte sur Solana et rembourser).
- Admin sur un multisig Squads, autorité de mise à jour sur le même multisig ; build vérifiable.
- Programme plus léger (Pinocchio) pour réduire la rent de déploiement, avant l'audit.
- Split au blackjack (v1.1), plusieurs paris par tour de roulette.
- Audit externe.
