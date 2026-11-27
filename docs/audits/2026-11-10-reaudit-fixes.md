# Re-audit des correctifs — Phase 1 : programme on-chain (`chain/`)

**Date :** 2026-11-10 · **Périmètre :** branche `fix/audit-phase1-high` (commit `b04f615`) contre `prod` · **Objet :** vérification des correctifs des constats ÉLEVÉS du rapport du [2026-11-08](2026-11-08-phase1-program.md). Le rapport d'origine reste la référence pour la description des constats E1–E3 et M1–M8 ; ce document ne reprend que leur verdict post-correctif.

---

## Constats ÉLEVÉS — verdict post-correctif

### E1 — `raise_win_cap` ignore `max_player_win` et `max_win_multiple` → **CORRIGÉ, vérifié**

Sur `fix/audit-phase1-high`, `raise_win_cap` (`state.rs`, autour des lignes 135-166) exige désormais :

```rust
max_win <= config.max_player_win
    && max_win as u128 <= self.deposited as u128 * config.max_win_multiple as u128,
TiltError::MaxWinTooHigh
```

avant toute écriture de `reserved`/`max_win`, avec des calculs en `checked_add`. En cas de refus, rien n'est réservé. Couvert par le nouveau test `the_rolling_cap_stops_at_the_per_player_bounds` et la propriété `raises_never_reserve_more_than_the_vault_holds` (10 000 itérations). Constat trouvé indépendamment par 3 revues lors de l'audit initial.

### E2 — `max_win` réservé à vie, gel permanent de la bankroll → **CORRIGÉ, vérifié**

Le relais envoie `max_win = 0` à l'ouverture (`apps/wallet/src/chain.ts:247`, commentaire citant l'audit E2) ; le cap ne monte que via `raiseWinCap` quand une mise est refusée `WinCapReached` : le relais parse `Win cap short by <n>` (`winCapShortfall`, `chain.ts:107-112`), appelle `raiseWinCap` du shortfall exact puis rejoue la mise (`chain.ts:291-303`). Fail-closed vérifié : si le raise échoue, la mise n'est pas jouée et les fonds restent retirables.

**Deux réserves mineures :**

1. **(a)** timeout silencieux de `raiseWinCap` après `WIN_CAP_READY_MS = 20 s` — `Ok` retourné sans erreur dédiée ; sûr, mais à améliorer.
2. **(b)** un petit dépôt peut ne pas couvrir le worst-case slots — pari refusé jusqu'à plus de dépôt ; à documenter côté produit.

### E3 — Re-roll des tirages par le relais → **CORRIGÉ, vérifié**

`MIN_ROUND_TIMEOUT_SECS = 120` (`state.rs:55-56`) et `validate` exige `round_timeout_secs >= 120` (`state.rs:81`). Le TTL VRF MagicBlock est confirmé à 120 s dans le dépôt amont (`solana-vrf` `api/src/consts.rs:25`) — la requête est morte avant tout retry possible. L'event `DrawRetried { player, round, game, abandoned_request_id }` est émis **avant** l'incrément de `request_id` (`play.rs:290-315`), ce qui suffit pour auditer fréquence et bénéficiaires.

**Résiduel assumé** (frontière M6, non aggravée) : après 120 s de silence de l'oracle, un relais peut encore front-run une réponse en mempool, au plus une fois par période de 120 s.

**Réserve test :** le chemin heureux retry → nouvelle réponse VRF n'est testé qu'en unitaires, pas en e2e — à valider sur devnet.

---

## Constats MOYENS — M1-M8

**NON CORRIGÉS sur la branche** (un seul commit `b04f615`, E1-E3 uniquement), sauf atténuations dérivées :

- **M6 — atténué** : la fenêtre de front-run est réduite par le timeout de 120 s.
- **M3 — partiellement neutralisé côté gel** : le fix E2 supprime le levier du compte poussière, mais `open_account` n'applique toujours pas `min_deposit` on-chain.
- **M1, M2, M4, M5, M7, M8 — inchangés.**

---

## Régression

**Aucune trouvée.** Vérifié par reaudit-mid :

- IDL resynchronisé byte-identique à un build `idl-build` de `b04f615`, discriminateur `DrawRetried` correct ;
- `checked_due`/`checked_forfeit` intacts ;
- l'invariant `reserved = Σ(deposited − forfeited − withdrawn_paid + max_win)` tient avec `max_win` partant de 0 (property test, 10 000 itérations) ;
- gardes d'autorité inchangées.

**Tests :** `cargo test -p tilt --lib` → 192 passed (`prod` 192, branche 193 dont le nouveau test du plafond) ; `clippy -D warnings` propre ; typecheck 4 packages OK ; tests wallet 57 passés. e2e non exécutable (pas de stack Solana locale).

---

## Verdict global

Les 3 correctifs ÉLEVÉS sont corrects, complets et sans régression. **La branche est bonne à fusionner après :**

1. décision produit sur le working tree sale de `prod` (limite promo, conflit probable avec `apps/wallet`) ;
2. validation du flux retry complet sur devnet ;
3. suivi des M1-M8 dans un ticket dédié (aucun n'est critique).
