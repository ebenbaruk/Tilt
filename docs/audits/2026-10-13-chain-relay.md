# Audit — programme `chain/`, relais `apps/wallet`, contrat `packages/contract`

- **Date :** 2026-10-13
- **Par :** Eli (+ Claude), pour Armand
- **Périmètre :** branche `armand/chain-program` @ `7c0b1a2`
- **Méthode :**
  - relecture complète du code par trois angles (programme, relais, intégration) ;
  - test de propriétés aléatoire sur la comptabilité des retraits ;
  - exécution de toutes les suites locales.

Ce n'est **pas** un audit externe (spec M5) : il le prépare.

## Résultat en bref

- **Programme :** aucun problème critique, élevé ou moyen. Les chemins d'argent tiennent.
  - Le test de propriétés (3 000 graines × 200 opérations honnêtes, actions livrées dans le désordre) n'a jamais rejeté une demande honnête.
  - Il vérifie aussi que `vault.reserved` égale toujours Σ(déposé − perdu libéré − retiré payé + max_win).
- **Relais :** **2 problèmes élevés**, tous deux sur ce que permet une clé API fuitée, et 3 moyens. Tous sont corrigés dans la PR `eli/armand-fixes`.
- **CI :** l'échec du job `build` est expliqué et corrigé.

## Tests exécutés (macOS, 2026-10-13)

| Suite | Avant | Après correctifs |
| --- | --- | --- |
| `cargo fmt --check`, `clippy -D warnings` (Rust 1.89.0) | ✅ | ✅ |
| `cargo test` | ✅ 51/51 | ✅ 53/53 |
| `anchor build --ignore-keys` + IDL synchronisée | ✅ | ✅ |
| `pnpm -r typecheck` | ✅ | ✅ |
| Contrat (vitest) | ✅ 5/5 | ✅ 7/7 |
| Relais (vitest + Postgres 17) | ✅ 16/16 | ✅ 25/25 |
| E2E programme + relais (stack locale MagicBlock) | ⏳ via la CI Linux | ⏳ via la CI Linux |

**`chain/scripts/local-stack.sh` ne marche pas sur macOS.** Il utilise `grep -P`, `--network host` et des binaires Linux. Dans Docker sur Mac, le validateur exige `io_uring`, que l'émulation x86 ne fournit pas.

En natif, la base L1 démarre. Le rollup exige en plus `sudo launchctl limit maxfiles 1000000 1000000`.

## Constats

Statut : ✅ corrigé dans `eli/armand-fixes` (commit) · 🟡 laissé à Armand (décision de conception).

### Relais et contrat

| ID | Gravité | Constat | Statut |
| --- | --- | --- | --- |
| F1 | **Élevée** | Aucune preuve de consentement. Quiconque a la clé API peut ouvrir, déposer, miser et retirer pour n'importe quel `userId` (`intents.ts`, `executor.ts`, `app.ts`). Les retraits ne peuvent pas être détournés (`withdraw.rs` impose `ledger.player`). | ✅ `7a35797` : `consent.identityToken` Privy obligatoire pour `open_account` / `deposit` / `withdraw`, appartenant au joueur et de moins de 5 min, sinon 403 `CONSENT_REQUIRED`. Plus un plafond global de dépôts sur 24 h. |
| F2 | **Élevée** | Une clé fuitée vide le pool promo vers le wallet de l'attaquant : le relais n'a qu'un minimum par paiement (`app.ts`, `intents.ts`). | ✅ `c39ecc6` : `MAX_PROMO_PAYOUT` + `DAILY_PROMO_LIMIT`, sous verrou. |
| F3 | Moyenne | Une erreur RPC sur une seule intention arrête tout le balayage, `expireRound` et `checkpoint` compris (`sweeper.ts`, `intents.ts`). | ✅ `e4bf095` |
| F4 | Moyenne | Le monitoring partage le verrou du balayage : il saute pendant un balayage lent, et ses propres échecs ne sont pas des alertes (`main.ts`). | ✅ `e7ca199` : minuterie dédiée, `MONITOR_FAILED` (runbook à jour) |
| F5 | Moyenne (soupçonnée) | Une intention rollup absente du cache de statuts du rollup peut être marquée `failed` alors qu'elle a abouti. Le client renvoie alors avec un nouvel id, et la mise ou le retrait passe deux fois (`chain.ts`, `intents.ts`). | ✅ `b4408dc` : jamais `failed` sur un statut absent côté rollup ; reste `pending` → `STUCK_INTENTS`. Effet de bord : le joueur reste `PLAYER_BUSY` jusqu'à un règlement manuel (runbook). |
| F6 | Faible | Aucune limite de taille des requêtes. | ✅ `dc317f1` : 8 Ko, réponse 413 |
| F7 | Faible | `userId` non validé : les ids inconnus coûtent un appel Privy, et `.`/`..` provoquent une 500. | ✅ `e433836` : `PrivyUserId` dans le contrat |
| F8 | Faible | Texte d'erreur interne brut stocké et renvoyé (corps Privy et RPC, noms de contraintes). La fuite d'URL RPC est réfutée. | ✅ `348abef` |
| F9 | Faible | Le cache du wallet Privy n'est jamais rafraîchi. Pas de vol possible. | 🟡 TTL ou nouvelle lecture sur échec de signature |
| F10 | Info | Les paiements promo partagent le verrou « une intention en vol » avec le jeu. | ✅ `33c6fd5` |
| F11 | Info | Solde du pool promo non surveillé ; `/health` sans authentification (expose seulement l'état de la base). | 🟡 |

### Programme

| ID | Gravité | Constat | Statut |
| --- | --- | --- | --- |
| L1 | Faible (soupçonnée) | Après une rotation, l'ancienne clé du relais reste acceptée dans le rollup tant que le clone du `Vault` n'est pas rafraîchi (`play.rs`, `withdraw.rs`). Aucun fonds ne sort à tort, mais l'attaquant peut encore miser avec les soldes. | 🟡 runbook : mettre les mises en pause et vérifier que le rollup voit la nouvelle clé avant la rotation |
| L2 | Faible | Changement d'admin en une seule étape (`admin.rs`) : une faute de frappe bloque l'admin définitivement. | 🟡 `pending_admin` + `accept_admin` |
| L3 | Faible | À `min_bet = 100`, un gain Banker ne rapporte aucun frais de 1 % (`baccarat.rs`, `settlement.rs`). | ✅ `c6519f8` : `min_bet ≥ 106` exigé |
| L4 | Faible | `Config::validate` accepte des configs qui bloquent les slots ou qui débordent (`stake × 250`) (`state.rs`). | ✅ `c6519f8` : `max_bet × 250` vérifié |
| L5 | Faible | Le plafond global journalier sous-compte l'argent de la maison tant qu'un checkpoint n'est pas appliqué (`withdrawals.rs`). | 🟡 calculer avec `max(ledger.forfeited, claim.forfeited)` |
| I1 | Info | Une mise énorme fait paniquer le programme au lieu de renvoyer `AmountOutOfRange` (`play.rs`). | ✅ `d976c55` |
| I2 | Info | Le double ignore la pause des mises, et la mise peut atteindre 2 × `max_bet`. Ça semble voulu. | 🟡 à documenter |
| I3 | Info | Le compte du callback VRF n'est pas contraint par ses seeds ; sa sûreté repose sur le programme VRF de MagicBlock (`play.rs`). | ✅ `2d445fd` : seeds ajoutées (l'E2E CI doit confirmer le coût en compute) |
| I4 | Info | Le premier dépôt peut créditer une poussière sous `min_deposit` (`account.rs`). | 🟡 |
| I5 | Info | `mul_div` tronque silencieusement (`as u64`). | ✅ `4dcc0a2` |
| I6 | Info | `PromoPayout` ne peut jamais être fermé (la rent n'est jamais récupérée) ; aucun moyen de changer le treasury. | 🟡 |

### Modèle de confiance (décisions de conception, à trancher par Armand)

- **Relais seul signataire dans le rollup.** C'est voulu : ça garantit le KYC et le blocage géographique. Une clé du relais fuitée peut miser avec les soldes, dans la limite des plafonds. Elle ne peut pas les retirer ailleurs.
- **Aucune sortie de secours.** Si le rollup ou le relais tombe, les fonds sont bloqués.
- **Confiance dans le validateur du rollup.** Il est borné par joueur à `deposited − forfeited + max_win`. Les plafonds journaliers limitent la vitesse, pas le total.
- **`expire_round` permet de relancer un tirage en attente.** Si la maison voit la réponse de l'oracle avant qu'elle n'arrive, elle peut relancer un tirage favorable au joueur. `round_timeout_secs = 1` est accepté.
- **Une seule clé admin et d'upgrade** jusqu'au passage sur Squads.
- **Fenêtres de 24 h fixes :** jusqu'à 2 × le plafond peut sortir autour d'une bascule.
- **`max_win` se remet à zéro à chaque checkpoint.** Les gains sur toute la vie du joueur sont donc illimités, mais la réservation reste couverte.

### Vérifié et sain

- **Signers, owners, mints et PDA :** vérifiés sur tous les chemins d'argent ; aucune collision de seeds.
- **Réservation et solvabilité :** `withdraw_house` est borné ; le pool promo est séparé.
- **Idempotence :** `withdrawn_paid`, `forfeited` et les ids promo.
- **Machine à états des manches :** `request_id` est vérifié.
- **Règles et RTP des 4 jeux :** l'échantillonnage par rejet n'introduit pas de biais.
- **Arithmétique :** `overflow-checks` est actif.
- **Relais :** SQL paramétré, auth en temps constant, schéma `Amount` strict, idempotence et concurrence, enregistrement avant envoi (crash-safe), comptes dérivés uniquement de PDA, secrets jamais journalisés.

## Changements de contrat (impact `apps/api`)

- **`PrivyUserId` :** `^did:privy:[a-z0-9]{20,40}$` pour `userId` ; `GET /users/:id` renvoie 400 si l'id est invalide.
- **`IntentRequest.consent?: { identityToken }` :** obligatoire pour `open_account`, `deposit` et `withdraw`. Une erreur `CONSENT_REQUIRED` est renvoyée en 403, et rien n'est enregistré.
- **`LIMIT_EXCEEDED` (422)** couvre aussi le plafond global de dépôts et les plafonds promo.
- **413** au-delà de 8 Ko.
- **Messages d'erreur fixes par code**, sauf le nom de l'erreur Anchor pour `PROGRAM_ERROR`.
- **IDL :** `consume_randomness.account` porte ses seeds.
