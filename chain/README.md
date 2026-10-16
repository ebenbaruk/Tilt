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
| Blackjack | 1 à 6 mains de même mise contre un seul croupier, jouées de gauche à droite (mises min/max par main). Sans carte cachée (la 2e carte du croupier n'est tirée qu'une fois toutes les mains finies), sabot infini, croupier reste sur 17, blackjack 3:2, double sur les 2 premières cartes. Split des 2 premières cartes de même valeur (10, V, D, R valent 10), 4 par manche au plus (10 mains max), une mise de main en plus ; la nouvelle main se place juste après celle qu'on sépare. Re-split et double après split permis, sauf pour les as : une carte chacun, main finie. Un 21 issu d'un split n'est pas un blackjack (payé 1:1) | ≈ 99,2 % avec une stratégie de base simple, splits compris (simulé, 400 000 mains ; 98,7 % sans split) | 2 par main, split compris (double gagné) |
| Roulette | Européenne. `roulette_spin` : un pari ; `roulette_chips` : 1 à 20 jetons sur des paris distincts, chacun entre `min_bet` et `max_bet`. Plein (35:1), rouge/noir, pair/impair, manque/passe (1:1), douzaine, colonne (2:1) ; le 0 fait perdre les paris extérieurs | 97,30 % (exact, par jeton) | 35 par jeton ; pour une disposition, le meilleur numéro (max sur les 37 cases de Σ gains − mise totale), borné par `max_round_gain` |
| Baccarat | Punto Banco, règles de 3e carte standard, sabot infini. Joueur 1:1, Banque 1:1 − 5 % de commission, Égalité 8:1 | Joueur 98,76 %, Banque 98,94 %, Égalité ≈ 85,9 % (exact) | 8 |
| Slots | 3 rouleaux identiques pondérés, table publique dans `games/slots.rs` | 96,16 % (exact) | 249 |
| Mines | Grille 5×5, 1 à 24 mines au choix. Aucune disposition n'est tirée d'avance (tout est lisible on-chain) : chaque case cliquée tire un nouvel aléa, mine si `below(25 − k) < mines` (k cases déjà sûres), ce qui suit exactement une disposition uniforme. Multiplicateur `0,99 × C(25, k) / C(25 − mines, k)` ; encaissement dès 1 case sûre ; la manche s'encaisse seule quand le gain atteint le plafond ou que toutes les cases sûres sont ouvertes | 99,00 % (exact, à chaque point d'encaissement) | `0,99 × C(25, mines) − 1`, borné par `max_round_gain` |
| Dice | Tirage `below(10000)`, au-dessus ou en dessous d'un seuil, chance de 1 % à 98 % | 98,00 % (exact) | `9800 / W − 1` (W issues gagnantes sur 10 000) |
| Limbo | Résultat `clamp(98 × 2³² / (below(2³²) + 1), 1,00×, 1 000 000×)`, gagne s'il atteint la cible (1,01× à 10 000×) | ≤ 98,00 % (arrondi en faveur de la maison) | cible − 1 |
| Flip | 1 à 10 pièces `below(2)`, toutes du côté choisi | 98,00 % (exact) | `0,98 × 2ⁿ − 1` |
| Keno | 1 à 10 numéros sur 40, 10 tirés sans remise (Fisher–Yates), table `keno::PAYTABLES` | 94,90 à 95,00 % selon le nombre de numéros (exact, testé) | 999 (10/10) |
| Wheel | 10 à 50 segments, risque faible/moyen/élevé, tables `wheel::multiplier` de somme `98 × segments` | 98,00 % (exact) | `0,98 × segments − 1` (risque élevé) |
| Hilo | Carte `below(52)`, as bas. Plus haut ou égal / plus bas ou égal ; au roi, plus bas strict ; à l'as, plus haut strict (aucun pari n'est certain) ; 10 cartes passées au plus, 64 cartes par manche. Multiplicateur `0,98 × Π 13 / issues gagnantes` (virgule fixe 10⁻⁶, arrondie vers le bas) | 98,00 % à chaque point d'encaissement | borné par `max_round_gain` |
| Tower | 9 étages ; facile 3/4, moyen 2/3, difficile 1/2, expert 1/3, maître 1/4 cases sûres ; chaque case tirée au clic (`below(cases) < sûres`) ; `0,98 × (cases / sûres)^étages` | 98,00 % à chaque point d'encaissement | `0,98 × (cases / sûres)⁹ − 1`, borné par `max_round_gain` |

Les jeux à un tirage refusent (`RoundGainTooHigh`) un choix dont le gain max dépasse `max_round_gain`, sans jamais le plafonner (ce qui changerait le RTP). Mines, Hilo et Tower plafonnent le gain et s'encaissent seuls au plafond.

Chaque tirage a un identifiant de requête (`round.request_id`) transmis avec la requête VRF : seule la réponse à la requête en cours peut jouer la manche, une réponse tardive est refusée. À la fin de chaque manche, l'événement `RoundSettled` (jeu, mise, gain, frais, aléa) est émis dans le rollup ; en rejouant l'aléa dans les règles des jeux, on retrouve le résultat. Les 1 % Tilt sont pris sur le gain de chaque manche gagnante, jamais sur la mise ni sur une perte ou une égalité.

## Parcours

1. **Ouverture (Solana)** : `open_account` + `delegate_account` dans la même transaction, payée par le relais. Tilt se rembourse en USDC sur ce premier dépôt (`onboarding_fee`, versé à la trésorerie). Sans dépôt, impossible d'entrer dans le rollup ; la délégation ne peut viser que le validateur configuré. Le joueur n'a besoin d'aucun SOL. La table de blackjack du joueur (`BlackjackTable`, PDA `["bjtable", joueur]`) s'ouvre de même avec `open_table` + `delegate_table`, rent payée par le relais. Un compte délégué ne se redimensionne pas : la table à 10 mains a pris une nouvelle graine, les anciennes tables `["table", joueur]` sont abandonnées.
2. **Dépôt (Solana)** : `deposit`, possible pendant que le compte est dans le rollup ; crédité à la manche suivante (jamais deux fois, même si le rollup lit une copie en retard du registre).
   **Plafond de gains glissant (Solana)** : `raise_win_cap(amount)`, signé par le relais quand une mise est refusée `WinCapReached` : relève le plafond du joueur dans le registre et réserve autant de bankroll libre (au plus le gain max d'une manche par appel, refusé `VaultTooSmall` si la bankroll libre ne couvre pas, ou pendant la pause des mises). Le rollup prend le nouveau plafond au coup suivant, comme un dépôt ; le relais renvoie alors la mise.
3. **Manches (rollup)** : `blackjack_bet(amount, hands)/hit/stand/double/split` (sur la table, passée en compte optionnel `table` ; les autres jeux la laissent vide), `roulette_spin`, `baccarat_deal`, `slots_spin` ; le VRF rappelle `consume_randomness`. Un stand qui laisse une main à jouer ne tire rien. Un split revérifie la manche comme une nouvelle mise (gain max par manche et plafond de gains, pire cas : chaque main doublée et gagnée) et est refusé s'il les dépasse ; rien n'est réservé d'avance pour les splits. Une manche non terminée survit à une déconnexion, et une main en attente du joueur n'est jamais clôturée à sa place : il la reprend quand il veut. Seul un tirage jamais arrivé est relancé par le relais avec `expire_round`, après `round_timeout_secs`.
   Mines vit sur son propre plateau (`MinesBoard`, PDA `["mines", joueur]`, ouvert et délégué par le relais au premier coup avec `open_mines_board` + `delegate_mines_board`) : `mines_bet(amount, mines)` ne tire rien, `mines_reveal(tile)` tire la case et le VRF rappelle `consume_mines_randomness` (compte + plateau), `mines_cashout` règle sans tirage (`RoundSettled` avec un aléa nul). Un plateau en attente du joueur n'expire jamais ; un tirage de case jamais arrivé est relancé avec `expire_mines_round` (`expire_round` refuse une manche Mines).
   Roulette à jetons : `RouletteTable` (`["roulette", joueur]`, ouverte et déléguée par le relais au premier `roulette_chips`) garde les jetons et la case ; rappel `consume_roulette_randomness`, relance `expire_roulette_round` (`expire_round` refuse un tour à jetons). `roulette_spin` reste inchangé pour un pari seul.
   Dice, limbo, flip, keno et wheel partagent une table par joueur (`QuickTable`, PDA `["quick", joueur]`) : `dice_roll`, `limbo_play`, `flip_play`, `keno_play`, `wheel_spin`, rappel `consume_quick_randomness`, relance `expire_quick_round`. Hilo (`HiloBoard`, `["hilo", joueur]`) : `hilo_bet` tire la première carte, `hilo_guess`, `hilo_cashout`, rappel `consume_hilo_randomness`, relance `expire_hilo_round`. Tower (`TowerBoard`, `["tower", joueur]`) : `tower_bet` sans tirage, `tower_climb`, `tower_cashout`, rappel `consume_tower_randomness`, relance `expire_tower_round`. Chaque compte est ouvert et délégué par le relais au premier coup du jeu. Un choix invalide est refusé `InvalidChoice` (6022), une case invalide `InvalidTile` (6021).
4. **Retrait (rollup → Solana)** : `withdraw` débite le solde, inscrit le compte sur Solana et programme `pay_withdrawals`. Autorisé pendant une manche (la mise est déjà sortie du solde). Le compte reste dans le rollup.
5. **Checkpoint (rollup → Solana)** : `checkpoint` constate les pertes du joueur et `apply_checkpoint` les retire de la réserve du coffre, pour que les gains de la maison puissent sortir (`withdraw_house`). À lancer régulièrement par le relais.
6. **Gains promo (Solana)** : les sponsors alimentent un pool séparé de la bankroll (`fund_promo`) ; le relais verse un gain de compétition ou un drop directement dans le wallet du gagnant (`pay_promo`), dans la limite d'un plafond par gain et par 24 h, une seule fois par identifiant de gain (`PromoPayout`). L'admin peut mettre le pool en pause ou reprendre le reste (`withdraw_promo`).

## Protections

- **Le rollup n'est pas cru sur parole** : `checked_due` refuse tout état où le joueur aurait été crédité de plus que ses dépôts réels, ou retirerait plus que ses dépôts − pertes libérées + son plafond de gains. `checked_forfeit` borne de la même façon les pertes déclarées.
- **Limites** (`Config`, vérifiée par `Config::validate`) : mise min et max, gain max par manche, plafond de gains par joueur (borné par un maximum et par un multiple du premier dépôt), dépôt min (≥ retrait min), retrait min, plafond par retrait (≤ plafonds journaliers), par joueur et par 24 h, global par 24 h (seul l'argent de la maison y est compté : ce qui dépasse les dépôts du joueur moins ses pertes déjà libérées). Au-delà, le retrait est **mis en attente** et libéré par l'admin. Pauses séparées : dépôts, mises, paiements.
  - Les fenêtres de 24 h sont des blocs fixes, pas glissantes : autour d'un changement de bloc, jusqu'à 2 × le plafond peut sortir en peu de temps. Les plafonds sont à régler en conséquence.
  - Dès qu'un retrait est en attente pour un joueur, ses retraits suivants le sont aussi (tout ou rien, dans l'ordre) jusqu'à la libération par l'admin.
  - Le plafond de gains d'un joueur n'est plus à vie : fixé au premier dépôt, il est relevé automatiquement (`raise_win_cap`) tant que la bankroll libre le couvre, et les pertes libérées par checkpoint le rouvrent d'autant. `checked_due` borne toujours chaque retrait par ce plafond : un rollup compromis ne peut sortir que ce que le relais a réservé, dans les plafonds de retrait par joueur et par 24 h.
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

Sur devnet (rollup MagicBlock EU). Le coffre devnet est partagé : le scénario y pose des limites de test pendant qu'il tourne, d'où le drapeau explicite ; il remet la config et les rôles trouvés au départ à la fin, en cas d'échec et sur Ctrl-C (pas sur un `kill -9`).

```bash
BASE_RPC=https://api.devnet.solana.com ER_RPC=https://devnet-eu.magicblock.app ER_WS=wss://devnet-eu.magicblock.app \
VALIDATOR=MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e VRF_ER_QUEUE=5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc \
POLL_MS=150 pnpm e2e --shared-vault
```

La clé du programme (`target/deploy/tilt-keypair.json`) n'est pas versionnée : la garder hors du dépôt et la sauvegarder. Un changement de structure des comptes (comme celui de `Vault`) demande un nouveau déploiement ou une migration.

## Reste à faire avant le mainnet

- Sortie de secours si le rollup tombe (récupérer le compte sur Solana et rembourser).
- Admin sur un multisig Squads, autorité de mise à jour sur le même multisig ; build vérifiable.
- Programme plus léger (Pinocchio) pour réduire la rent de déploiement, avant l'audit.
- Split au blackjack (v1.1), plusieurs paris par tour de roulette.
- Audit externe.
