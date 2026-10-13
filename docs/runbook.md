# Runbook — argent, programme et relais

Pour l'équipe d'astreinte. Outil : `cd chain && BASE_RPC=<rpc> npx tsx scripts/admin.ts <commande>` (en-tête du script). Tant que l'admin est une clé (`ANCHOR_WALLET`), les commandes sont envoyées directement ; une fois l'admin passé sur un multisig Squads, ajouter `--squads` et faire signer la transaction imprimée dans l'app Squads.

## Alertes du relais

Le relais (`apps/wallet`) écrit une ligne JSON `{"level":"alert","code":…}` à chaque passage du monitoring (30 s par défaut, indépendant du cron de réconciliation).

| Code | Gravité | Ce que ça veut dire | Action |
| --- | --- | --- | --- |
| `INSOLVENT` | critique | Le coffre détient moins que ce qu'il peut devoir (`vault.reserved`). Ne doit jamais arriver. | `pause all`, puis enquête (bug du programme ou incident rollup). Ne rien reprendre avant d'avoir compris. |
| `LOW_FREE_BANKROLL` | avertissement | Peu de bankroll libre : les nouveaux comptes et les gros plafonds de gains vont être refusés (`VaultTooSmall`). | Alimenter le coffre (`fund_vault`) ou baisser `max_player_win`. |
| `LOW_RELAYER_SOL` | critique | Le relais paie les frais et les rents : sans SOL, plus rien ne passe. | Envoyer du SOL à l'adresse du relayer (`status`). |
| `LOW_ESCROW` | critique | L'escrow MagicBlock du relayer paie les Magic Actions : sans lui, retraits et checkpoints restent bloqués. | Recharger l'escrow (`createTopUpEscrowInstruction` du SDK MagicBlock, voir `scripts/e2e.ts`). |
| `STUCK_INTENTS` | avertissement | Des intentions sont `pending` depuis plus de 10 min : la réconciliation n'arrive pas à trancher. Une intention du rollup que le rollup ne retrouve plus reste toujours `pending` (elle a pu passer), et bloque le joueur. | Regarder les signatures en base (`intents`) sur l'explorateur ; vérifier les RPC. Pour le rollup, comparer avec l'état du compte joueur (manche, solde, retraits) avant de passer l'intention à la main en `submitted` ou `failed`. |
| `PAUSED` | avertissement | Une pause est active. | Normal pendant un incident ; sinon `resume`. |
| `MONITOR_FAILED` | critique | Le relais n'a pas pu lire l'état (RPC Solana ou Postgres injoignable) : toutes les autres alertes sont muettes tant que ça dure. | Vérifier les RPC et la base (`/health`) ; surveiller le coffre à la main (`status`) en attendant. |

Les lignes `sweep stuck` (un passage du cron dure plus de 5 min) et `intent settled differently by reconciliation` sont à traiter comme des alertes.

## Interrupteurs

| Commande | Effet |
| --- | --- |
| `pause deposits` | Plus de premier dépôt ni de dépôt. |
| `pause bets` | Plus de nouvelle manche (les manches en cours peuvent finir). |
| `pause payouts` | Tous les retraits sont mis en attente (rien ne sort sans `release`). |
| `pause promo` | Plus aucun gain promo. |
| `pause all` / `resume …` | Tout, ou levée. |

## Incidents

**Retraits mis en attente** (`WithdrawalHeld` : au-delà des plafonds, ou pendant une pause). Vérifier le joueur (KYC, historique des manches), puis `release <wallet du joueur>`. Le contrôle anti-fraude s'applique quand même.

**Fuite de la clé du relayer.** `pause all`, générer une nouvelle clé, `set-relayer <nouvelle clé>` une fois les retraits et checkpoints en vol arrivés, recharger SOL et escrow de la nouvelle clé, mettre à jour `RELAYER_SECRET_KEY`, redémarrer le relais (il refuse de démarrer si sa clé n'est pas celle du coffre), `resume all`. Ce que la clé volée pouvait faire : jouer avec l'argent des joueurs (dans les limites du programme) et verser des gains promo (plafond du pool, 2 × le plafond journalier au pire autour d'un changement de bloc).

**Fuite des secrets Privy du relais** (`PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`). La policy (possédée par la clé d'admin hors ligne) n'autorise que les instructions du programme Tilt : pas de transfert hors du programme. Tourner l'app secret dans le dashboard Privy, créer un nouveau key quorum (`apps/wallet/scripts/privy-setup.ts` sur un fichier vierge), le faire ajouter comme signer par le web, puis retirer l'ancien.

**Fuite de la clé `RELAY_API_KEYS`.** Ajouter une nouvelle clé à la liste (deux clés acceptées), la déployer côté `api`, retirer l'ancienne. Les plafonds de dépôt du relais (`MAX_DEPOSIT`, `DAILY_DEPOSIT_LIMIT`) bornent les dégâts entre-temps.

**Rollup MagicBlock en panne.** Les fonds sont sur Solana (coffre) ; les comptes joueurs sont figés dans le rollup. `pause deposits` et `pause bets` pour ne pas accepter d'argent qu'on ne peut pas jouer. Il n'existe pas encore de sortie de secours (récupérer les comptes sur Solana) : chantier ouvert avant le mainnet (`chain/README.md`).

**Crash du relais.** Le redémarrer : les intentions interrompues sont retrouvées sur la chaîne par la réconciliation (aucune n'est rejouée). Vérifier ensuite l'absence de `STUCK_INTENTS`.

## Passage de l'admin sur un multisig

1. Créer le multisig Squads (Armand + Eli, seuil 2) et noter l'adresse de son vault.
2. `set-admin <vault Squads>` (dernière commande signée par la clé admin seule).
3. `solana program set-upgrade-authority <programme> --new-upgrade-authority <vault Squads>` : les mises à jour du programme passent aussi par le multisig.
4. La policy Privy reste possédée par sa propre clé d'admin hors ligne (`relay.env.admin`), à garder hors de toute machine en ligne.

Vérifié sur devnet avec un multisig Squads v4 de test (1 sur 1) : `set-admin <vault>`, puis la transaction imprimée par `set-admin <clé> --squads` exécutée par le vault du multisig (SDK `@sqds/multisig` : vault transaction, proposition, approbation, exécution) ; l'admin est bien revenu. [INFERENCE] Non testé : l'import de ce texte base58 dans l'interface web de Squads (TX Builder → Add instruction → « Import base58 encoded tx ») ; à essayer sur devnet avant de passer l'admin de production.
