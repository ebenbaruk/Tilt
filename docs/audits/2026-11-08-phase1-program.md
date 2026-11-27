# Audit sécurité — Phase 1 : programme on-chain (`chain/`)

**Date :** 2026-11-08 · **Périmètre :** `chain/programs/tilt/src/` intégral (≈ 9 200 lignes) · **Méthode :** 6 revues indépendantes en parallèle (sorties d'argent, autorités, VRF/RNG, invariants/arithmétique, règles de jeux ×2), croisées et vérifiées dans le code. Tests exécutés pendant l'audit : `cargo test -p tilt --lib games::` → 109 passés.

**Verdict global : aucun constat CRITIQUE** (aucune voie de vol direct des fonds joueurs ou du vault par un joueur). Les chemins de paiement (`checked_due`, `checked_forfeit`, `reserved`) sont solides. Les risques réels sont **économiques** (gel de la bankroll) et **opérationnels** (pouvoirs du relais, validation de config).

---

## Constats à corriger

### E1 — ÉLEVÉE — `raise_win_cap` ignore `max_player_win` et `max_win_multiple`
`state.rs:127-148` · Trouvé indépendamment par 3 revues.

Les deux plafonds ne sont vérifiés qu'à `open_account` (`account.rs:66-70`) ; `raise_win_cap` n'exige que `amount <= max_round_gain` et `<= free`. Le plafond d'un joueur peut croître sans borne (le relais le relève à chaque `WinCapReached`, `apps/wallet/src/chain.ts:299-315`), et `checked_due` honore le plafond gonflé. Un joueur chanceux peut concentrer toute la bankroll libre sur son seul compte, au-delà de l'exposition par joueur prévue.

**Correctif :** dans `Ledger::raise_win_cap`, ajouter `self.max_win + amount <= config.max_player_win` (et la borne multiple si voulu). Si le plafond glissant sans borne est l'intention (README §Parcours 2), corriger alors le commentaire de `state.rs:21` et assumer la concentration de risque ailleurs (plafond de retrait).

### E2 — ÉLEVÉE — `max_win` réservé à vie, même à solde nul → gel permanent de la bankroll
`instructions/account.rs:91`, `withdrawals.rs:159`, `state.rs:127-148` · Vérifié : aucune instruction ne baisse `max_win`, pas de `close`.

`open_account` réserve `max_win + credited` au maximum autorisé ; un retrait ne libère que `due` ; `sync_ledger` ne fait que `max()`. Un attaquant ouvre N comptes avec `min_deposit`, retire tout de suite le dépôt : `max_win` reste réservé à vie. `free` fond jusqu'à bloquer `open_account`, `raise_win_cap` et `withdraw_house`. Coût de l'attaque ≈ bankroll / `max_win_multiple`. Seule `apply_checkpoint` libère — et exige que le joueur perde.

**Correctif :** ne pas réserver `max_win` à l'ouverture (fixer `max_win = 0` et laisser `raise_win_cap` croître à la demande), ou ajouter une instruction `release_win_cap` (abaisse `max_win` **et** `reserved` pour un compte à solde nul, en coordonnant le rollup car `sync_ledger` prend le max).

### E3 — ÉLEVÉE — Re-roll des tirages par le relais (`expire_*` + front-run de la réponse VRF)
`instructions/play.rs:88-111, 279-296` et les 5 `expire_*_round` · Trouvé indépendamment par 2 revues.

Le relais voit la sortie VRF dans le mempool du rollup avant consommation ; si le résultat lui déplaît, il soumet `expire_*` (incrément `request_id`, réponse ancienne refusée `StaleRandomness`) et retente jusqu'à un résultat favorable. `Config::validate` accepte `round_timeout_secs = 1`. Un joueur ne peut pas faire cela — c'est un risque de triche de la maison / relais compromis, borné par les plafonds de retrait. Déjà noté dans `docs/audits/2026-10-13-chain-relay.md`.

**Correctif :** imposer `round_timeout_secs` > TTL de la queue VRF (~120 s) dans `validate`, ou refuser le retry tant que la requête figure encore dans la queue ; à terme, borner le nombre de retries et émettre un event `DrawRetried`.

## Constats MOYENS

| # | Constat | Localisation | Correctif |
|---|---|---|---|
| M1 | `max_round_gain` non borné par `validate` ; `check_win_cap` additionne sans contrôle → `hilo_bet` panique (DoS, fail closed) si config absurde | `state.rs:63, 365`, `instructions/hilo.rs:114` | Borne `max_bet + max_round_gain` dans `validate` + `checked_add` |
| M2 | Plancher `min_bet` calé sur « plus petit gain = 95 % » (faux : Limbo 1,01× → gain 1 %) → des manches gagnantes ne paient aucun frais ; RTP effectif > RTP publié | `state.rs:56-59`, `settlement.rs:22-23` | Plancher sur le vrai plus petit ratio (1 % ⇒ `min_bet ≥ 10 000`) ou assumer l'exception |
| M3 | `open_account` n'applique pas `min_deposit` (seulement `amount > onboarding_fee`) ; protection anti-poussière uniquement off-chain (`apps/api/src/routes/web.ts:43-44`) | `instructions/account.rs:63` | `require!(credited >= config.min_deposit)` |
| M4 | `min_withdrawal = 0` passe `validate` → retraits d'une unité en boucle (griefing du relais : 1 commit + 1 Magic Action chacun) | `state.rs:68-74`, `withdraw.rs:58-61` | `min_withdrawal > 0` dans `validate` |
| M5 | Aucun event sur `set_config`, `set_roles`, `withdraw_house`, `withdraw_promo`, `set_promo` : changements de limites et sorties de trésorerie invisibles on-chain | `instructions/admin.rs:58-75, 128-146`, `instructions/promo.rs:239-256` | Events (ancienne/nouvelle valeur, signataire) |
| M6 | Censure de l'oracle = re-roll gratuit (le VRF empêche la forge, pas la rétention) ; hypothèse de confiance non documentée | `play.rs:279-296` | Documenter l'hypothèse ; borner les retries + event |
| M7 | Mise verrouillée sans remboursement si la queue VRF meurt (pas de `cancel_round`) | `state.rs:452-463` | Instruction `cancel_round` après un délai long, sans tirage jamais appliqué |
| M8 | `release_withdrawals` contourne pause et plafonds 24 h sans les consommer (garde `checked_due` uniquement) : la clé admin est la vraie borne | `withdraw.rs:169-183`, `withdrawals.rs:134-156` | Appliquer `payouts_paused` ; documenter que les plafonds ne sont pas une borne dure |

## Constats INFO (à traiter selon le calendrier)

- **Panique théorique** : `gain * FEE_BPS` sans contrôle (`settlement.rs:22-23`) ; `max_bet + max_round_gain` dans `gross()` des jeux plafonnés (`games/mines.rs:123` etc.). Inatteignable avec l'USDC réel et la config actuelle.
- **Pièges latents** : état « zéro » des manches = état gagnant (slots `[0,0,0]` = 250×, roulette `number: 0`, baccarat égalité) si un futur chemin sold sans tirer (`games/slots.rs:27-46`, `instructions/play.rs:252`) ; `MinesBoard::can_cash_out` ne vérifie pas `busted` (`games/mines.rs:110-112`) ; `HiloBoard::can_guess` ne borne pas `n_cards` (`games/hilo.rs:150-159, 189`).
- **Double/split possibles pendant `bets_pause`** (`instructions/play.rs:215-243`, `state.rs:469`) : contrôle d'exploitation, l'exposition reste plafonnée.
- **Garde de layout manquante** pour `Vault`, `Ledger`, `BlackjackTable` (seul `PlayerAccount` est figé par test) : risque de migration, pas d'exploitation (`state.rs:791-794`).
- **Codes d'erreur positionnels** non figés par test (`errors.rs`) ; `debug_assert!(n > 0)` inopérant en release (`rng.rs:29`) ; `Rng::from_vrf` réduit 256 → 64 bits par XOR (négligeable, `rng.rs:9-15`).
- **`onboarding_fee` non borné** par `validate` (`state.rs:54-81`) : le joueur signe et voit le montant, risque opérationnel seulement.
- **Griefing du relais** : aucun limiteur on-chain du *nombre* de demandes de retrait (`withdraw.rs:50-93`) — à traiter côté relais/api.
- **Sortie dépendante du relais** : si le relais estdown, le joueur ne peut pas sortir (déjà listé « reste à faire » du README).

## À confirmer hors dépôt (bloquant avant mainnet)

1. **DLP / Magic Actions** : qui peut programmer une action avec `escrow_authority = relais` ? Si la DLP ne l'exige pas, un tiers peut déclencher `pay_withdrawals`/`apply_checkpoint` (sans vol : destination et montant toujours bornés, mais consommation des plafonds globaux). `instructions/withdraw.rs:116-135, 253-270`.
2. **Autorité de mise à jour → multisig Squads** (elle peut tout contourner par redéploiement). Déjà planifié, `docs/runbook.md:49`.

## Vérifié et SOLIDE

- **Aucun jeu prévisible** : l'aléa est demandé après l'engagement (mise ou `pending` écrit), le callback VRF est la seule écriture du résultat ; `below()` sans biais ; `request_id` monotone, réponse tardive refusée ; RTP exacts recalculés indépendamment (blackjack 99,19 %, roulette 97,297 %, baccarat, slots 96,159 % — conformes).
- **Sorties d'argent** : `checked_due`/`checked_forfeit` corrects (calculs en `u128`, `saturating_sub` pour commits périmés) ; un joueur ne peut jamais toucher le solde d'un autre (`token::authority = ledger.player`, seeds dérivées) ; pas de double paiement ni de double crédit de dépôt ; pas de solde négatif ; `withdraw_house` ne sort que `free` ; retrait pendant une manche sûr.
- **Autorités** : seul le VRF appelle les `consume_*` (`#[vrf_callback]`, PDA scoped) ; seul le relais joue/retire/checkpointe ; `testing.rs` non compilé en prod et absent de l'IDL ; vault/treasury/mint figés à `initialize` (`has_one` partout) ; `initialize` non front-runnable ; `pay_promo` idempotent (PDA `["payout", id]`) ; pool promo isolé de la bankroll.
- **Invariants** : `reserved = Σ (deposited − forfeited − withdrawn_paid + max_win)` maintenu sur les 5 points d'entrée ; `reserved ≤ vault_token.amount` ; frais de 1 % jamais prélevés sur mise/perte/égalité, arrondis en faveur de la maison ; enums en fin d'énumération seulement.
