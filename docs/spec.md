# Tilt — Spec v0.1

> **Statut :** brouillon à valider par Eli et Armand. Les points marqués **🟡 À TRANCHER** sont des décisions ouvertes (liste complète en §13).
> **Date :** 2026-10-12 · **Auteurs :** Eli (+ Claude) · **Relecteur :** Armand
> **Docs liées :** [idea.md](idea.md) (pitch d'origine), [integrations.md](integrations.md) (recherche technique Claude Code / Codex)

---

## 1. Le produit en une phrase

Tilt est un casino crypto sur Solana qui se joue **directement dans Claude Code**, pendant que l'agent travaille. Toujours accompagné d'un sponsor visible à l'écran.

On lance une tâche à Claude, on joue une main de blackjack dans un panneau sous la conversation, l'agent termine, on revient au code. La main est sauvegardée.

## 2. Objectifs et non-objectifs

**Objectifs v1**
- Capter le temps mort pendant que l'agent IA travaille, et garder l'attention de l'utilisateur.
- Jouer à de vrais jeux de casino (blackjack d'abord), en tokens réels sur Solana.
- Afficher en permanence un sponsor sur le front (tables, écrans de gain, leaderboard).
- Onboarding ultra simple : pas besoin d'avoir un wallet (Privy), achat par carte possible.
- Sortir vite. Projet volontairement petit.
- **Eli et Armand travaillent en parallèle sans se marcher dessus** (§8).
- **Sécurité maximale, non négociable** : impossible de vider la trésorerie, d'exploiter un jeu ou de spammer (§10). Code professionnel testé de bout en bout (§11).

**Hors périmètre v1**
- Codex, Claude Chat, Cowork, VS Code (voir integrations.md). Uniquement **Claude Code** : terminal + onglet Code de l'app Desktop.
- App mobile, poker multijoueur, live dealer.
- Token Tilt propre (🟡 voir D4).

## 3. Les deux modèles en discussion

Le projet a deux visions. La décision de principe est prise : **on part sur Solana et le vrai casino**. Reste à savoir ce qu'on garde de l'idée d'origine.

| | **Vision Armand : casino réel** | **Vision Eli d'origine : free-to-play sponsorisé** |
| --- | --- | --- |
| Mise | Vrais tokens (SOL / USDC) | Jetons gratuits |
| Gain | Vrais tokens, retirables | Cash prize de fin de compétition |
| Financement des gains | Bankroll de la maison (liquidité 30–50 k$) | Budget sponsor |
| Revenu | Avantage de la maison (house edge) + sponsors | Commission sur le budget sponsor |
| Acceptabilité | Faible (casino) | Meilleure |
| Juridique | Licence de jeu obligatoire | Règles de concours / loterie |

**Ce qu'on garde de la vision d'origine, même en mode casino réel :**
1. **Le sponsor finance des compétitions.** Ex. : un sponsor paie 5 000 €, Tilt garde une commission (ex. 2 000 €), les 3 000 € restants vont dans un prize pool.
2. **Compétitions courtes** (ex. 24 h) : classement au nombre de jetons gagnés sur la période.
3. **Gains aléatoires ("drops")** : de temps en temps, une main est tirée au sort et rapporte un bonus (ex. 50 €), payé par le pool sponsor. Les petits joueurs gardent une chance de gagner.

**🟡 D1 — Modes de jeu au lancement :**
- **(a)** Casino réel uniquement.
- **(b)** Casino réel + compétitions/drops sponsorisés. *Recommandé.*
- **(c)** Les deux, avec en plus un mode « jetons gratuits » pour ceux qui n'ont pas déposé (l'entonnoir d'acquisition).

## 4. Expérience utilisateur

### 4.1 Parcours

1. **Découverte :** landing page ou partage sur X.
2. **Installation :** `/plugin marketplace add <owner>/tilt` puis `/plugin install tilt`, dans Claude Code.
3. **Connexion :** `/tilt login` ouvre le navigateur sur `tilt.xxx/connect`. Connexion via Privy (email, Google, X ou wallet Phantom existant). Un wallet Solana est créé automatiquement si besoin. Le mod récupère un jeton de session.
4. **Dépôt :** depuis le web (carte via onramp, ou envoi SOL/USDC sur son adresse). Le solde apparaît dans le mod.
5. **Jeu :** l'utilisateur envoie un prompt à Claude. Le panneau Tilt s'ouvre (ou `/tilt`). Il joue avec les touches.
6. **Fin de tâche :** bandeau « ✓ agent finished in 6m 14s · your hand is saved ». La main reste en pause et reprend au tour suivant.
7. **Gain :** carte partageable sur X / TikTok.
8. **Retrait :** depuis le web, vers n'importe quelle adresse Solana.

### 4.2 Le panneau dans Claude Code

Référence visuelle : la maquette d'Eli (image partagée dans la conversation, et les fichiers Claude Design qu'Eli transmettra).

```
┌ TILT  S3  [1] Blackjack  [2] Roulette  [3] Slots        balance 12.40 USDC  rank #414 ┐
│ ✓ agent finished in 6m 14s · your hand is saved                    ⏎ review diff     │
├──────────────────────────────────────────────────┬───────────────────────────────────┤
│ DEALER 9 + ?                                     │ PRESENTED BY                      │
│ [9♥] [▒▒]                                         │ Northwind Cloud                   │
│                                                  │ daily pool $3,000 · ends 14h      │
│ YOU 11 · bet 0.50                                │ LEADERBOARD                       │
│ [3♣] [8♦]                                         │ 1 @0xkira   +412.90               │
│                                                  │ …                                 │
│ [H] hit  [S] stand  [D] double                   │ 414 you     +17.95                │
└──────────────────────────────────────────────────┴───────────────────────────────────┘
```

**Touches :** deux modes, toujours disponibles tous les deux.
- Lettres (partout : panneau et bande, écran principal ou plein écran ; `Ctrl+X Tab` donne ou rend le focus) :
  - `1`–`4` : changer de jeu ; `n` : donner ou lancer.
  - `v` / `b` : baisser / monter la mise par main (bloquée au minimum et au maximum de la table).
  - Blackjack : `j` / `k` une main de moins / de plus (1 à 6), `h`/`s`/`d` sur la main active, `p` la sépare (split) quand elle le peut.
  - Un raccourci ne peut être qu'un chiffre ou une lettre minuscule : Espace, Entrée, `+` et `-` sont refusés pour un bouton.
- Plein écran + clic : la table est une surface (`Client`) qui reçoit les touches brutes après un clic sur elle (`Esc` rend le focus). `Espace` ou `Entrée` rejoue avec la même mise et les mêmes mains ; en cours de main `Espace` tire, `Entrée` reste, `d` double, `p` sépare ; `←`/`→` la mise, `↑`/`↓` les mains, `1`–`4` le jeu. Sur l'écran principal, la surface ne reçoit jamais de touches : la table y est dessinée fixe et se joue aux lettres.

**Blackjack multi-mains :** 1 à 6 mains contre un seul croupier, même mise sur chaque main, jouées de gauche à droite (main active marquée `▶`). Une paire se sépare (`p`, au plus 4 splits par manche, donc jusqu'à 10 mains, renvoyées à la ligne selon la largeur) ; une main née d'un split porte la marque `split`, et son 21 en deux cartes n'est pas un blackjack. Chaque main affiche son total, BUST/BLACKJACK, le double, sa mise et, une fois soldée, son résultat (BJ/WIN/PUSH/LOSE) ; une ligne résume le net de la manche et compte les mains nées d'un split.

**Contraintes techniques (mods Claude Code) :**
- Claude Code ≥ v2.1.287.
- Le panneau (ou la table, en plein écran) doit avoir le focus pour recevoir les touches. Tab ne donne pas les touches à la table.
- Sous 110–144 colonnes de terminal, le panneau ne s'ouvre pas tout seul : il faut une version compacte (bande au-dessus du prompt).

**Le sponsor est toujours visible.** Le bloc « Presented by » ne peut pas être masqué, et il est clairement marqué comme sponsorisé (l'Usage Policy d'Anthropic interdit le contenu sponsorisé non signalé).

### 4.3 Jeux

| Jeu | Version | Règles (implémentées dans `chain/`, détail dans `chain/README.md`) |
| --- | --- | --- |
| Blackjack | v1 | Sans carte cachée (2e carte du croupier tirée après le joueur), sabot infini, croupier reste sur 17, blackjack payé 3:2, double sur les 2 premières cartes. Split des deux premières cartes de même valeur (10, V, D, R valent tous 10 ; as seulement avec as) pour une mise de base de plus : la nouvelle main se place juste après, chacune reçoit une carte. Au plus 4 splits par manche (jusqu'à 6 + 4 = 10 mains). Re-split et double après split permis, sauf pour les as : un as splitté reçoit une seule carte et la main est finie. Un 21 en deux cartes né d'un split n'est pas un blackjack (payé 1:1). RTP ≈ 99 % en stratégie de base. |
| Roulette | v1 | Européenne (un seul zéro). Jetons sur tout le tapis : de 1 à 20 paris par tour, chacun avec sa mise (plein, rouge/noir, pair/impair, manque/passe, douzaine, colonne), chaque mise entre les limites de la table. RTP 97,30 %. |
| Baccarat | v1 | Punto Banco, sabot infini : joueur (1:1), banque (1:1, commission 5 %) et égalité (8:1). RTP 98,76 % / 98,94 % / ≈ 85,9 %. |
| Slots | v1 | 3 rouleaux pondérés, table de gains publique, gain max 250×. RTP 96,16 %. |
| Mines | v1 | Grille 5×5, 1 à 24 mines. Chaque case cliquée est tirée à l'instant par le VRF (aucune disposition stockée d'avance, lisible on-chain sinon). Multiplicateur 0,99 × C(25, k) / C(25 − mines, k) après k cases sûres, encaissement à tout moment dès une case ; retour plafonné à 10 000 × la mise et par manche (`max_round_gain`), comme le plafond de profit de Stake. RTP 99,00 %. |
| Dice | v1 | Tirage 00,00–99,99, pari au-dessus ou en dessous d'un seuil, chance de 1 % à 98 %, gain 98 / chance. RTP 98,00 %. |
| Limbo | v1 | Multiplicateur cible de 1,01× à 10 000× ; le tirage (0,98 / U) doit l'atteindre. RTP 98,00 %. |
| Flip | v1 | Pile ou face sur 1 à 10 pièces, toutes du côté choisi : 0,98 × 2ⁿ. RTP 98,00 %. |
| Keno | v1 | 1 à 10 numéros sur 40, 10 tirés, table de gains publique par nombre de numéros (jusqu'à 1 000× à 10/10). RTP entre 94,90 et 95,00 % selon le nombre de numéros. |
| Wheel | v1 | Roue de 10 à 50 segments, risque faible, moyen ou élevé, table publique. RTP 98,00 %. |
| Hilo | v1 | Sabot infini : plus haut ou égal / plus bas ou égal que la carte suivante ; au roi, plus bas strict ; à l'as, plus haut strict (aucun pari n'est certain). 10 cartes passées au plus, encaissement dès une bonne réponse. Multiplicateur 0,98 × Π 13 / issues gagnantes ; retour plafonné à 10 000 × la mise et par `max_round_gain`. RTP 98,00 %. |
| Tower | v1 | Dragon Tower : 9 étages, 5 difficultés (4 cases dont 3 sûres … 4 cases dont 1 sûre), chaque case tirée au clic, encaissement dès un étage, 0,98 × (cases / sûres)^étages, retour plafonné à 10 000 × la mise et par `max_round_gain`. RTP 98,00 %. |
| Autres (crash, plinko…) | plus tard | |

Chaque jeu affiche son **RTP** (taux de retour au joueur, avant les 1 % Tilt) et est **provably fair** (§6.4).

### 4.4 Ton et confiance

- **Le mod ne lit jamais les prompts ni le code de l'utilisateur.** Il n'utilise que les événements de début et de fin de tour. On l'écrit noir sur blanc et le code du mod est lisible par tous, car les mods ont accès à tout.
- **Jeu responsable :** limites de dépôt et de perte, auto-exclusion, pause « je travaille ». Obligatoire en mode argent réel.

## 5. Architecture

```
            ┌──────────────┐        ┌─────────────────────────┐
 Claude ──▶ │  mod (TS)    │──HTTP─▶│  api  (Eli)             │◀── événements du programme
 Code       │  UI + touches│        │  sessions du mod,       │    (indexeur)
            └──────────────┘        │  historique, classement,│
                                    │  compétitions, sponsors │
            ┌──────────────┐        └───────────┬─────────────┘
 Navigateur▶│  web (Next)  │                    │ intentions (contrat §7)
            │  landing,    │                    ▼
            │  connect,    │        ┌─────────────────────────┐      ┌────────────────────┐
            │  dépôt/retrait,      │  wallet = relais (Armand)│─────▶│ chain/ (Armand)     │
            │  vérif       │        │  Privy, signers, fee    │      │ programme Anchor :  │
            └──────────────┘        │  payer, envoi des tx    │      │ jeux, VRF, bankroll │
                                    └─────────────────────────┘      └────────────────────┘
```

**Principe :** tout ce qui touche à l'argent et aux règles des jeux est on-chain ou dans le relais (Armand). Tout ce qui touche au produit est dans `mod` / `api` / `web` (Eli). Le mod **affiche** l'état lu sur la chaîne et ne recalcule aucune règle. Les deux mondes ne se parlent que par le contrat du §7.

### 5.1 Stack proposée (🟡 D7)

| Composant | Choix proposé | Pourquoi |
| --- | --- | --- |
| Langage | TypeScript partout (+ Rust/Anchor si programme on-chain) | Le mod est forcément en TS ; un seul langage |
| Repo | Monorepo `pnpm` : `apps/mod`, `apps/api`, `apps/web`, `apps/wallet`, `packages/contract`, `chain/` | Contrat partagé et typé |
| API / wallet | Node + Hono (ou Fastify), Postgres | Simple et standard |
| Web | Next.js sur Vercel | Landing + pages connect/dépôt |
| Auth + wallet | Privy (embedded wallets Solana) | Pas de wallet requis pour l'utilisateur |
| Onramp carte | Privy funding (MoonPay / Coinbase) ou Stripe crypto onramp | 🟡 D6 |
| Solana | `@solana/kit`, Anchor si programme | |

## 6. Le cœur « argent » (Armand)

### 6.1 Modèle de règlement des paris (D2 : tout on-chain, décidé par Armand le 2026-10-12)

**Décision :** les jeux, les cotes et les tirages (cartes, roulette, rouleaux) sont **entièrement on-chain**, dans un programme Anchor sur Solana. Chaque mise et chaque gain est une transaction ; chaque tirage vient d'un VRF vérifié on-chain. Le joueur qui veut vérifier lit le programme et ses transactions ; rien ne dépend de notre serveur.

Options écartées : hybride avec solde off-chain (custodial, confiance reposant sur nous), hybride puis migration.

**L'utilisateur n'a pas besoin de savoir que c'est de la crypto :**
- Connexion Privy (email, Google, X) ; un wallet Solana est créé sans qu'il voie d'adresse.
- Dépôt par carte via l'onramp de Privy ; le solde s'affiche en « $ » (USDC, voir D3).
- **Tilt paie les frais réseau** (Solana permet un *fee payer* distinct du joueur) : le joueur n'a jamais besoin de SOL.
- Pas de signature à chaque main : signers Privy côté serveur, avec une policy qui n'autorise que les instructions du programme Tilt (une policy Privy ne lit pas les montants d'un programme : ils sont plafonnés par le relais, `MAX_DEPOSIT` et `DAILY_DEPOSIT_LIMIT`, et par le programme). La policy appartient à une clé d'administration gardée hors ligne, pas au relais. Les retraits restent signés par le joueur.
- Celui qui veut creuser vérifie le programme (build vérifiable) et les tirages sur la chaîne.

**Aléa : VRF MagicBlock** (chiffres annoncés par les fournisseurs, non mesurés ; SOL à 200 $).

| Option | Latence | Coût par tirage |
| --- | --- | --- |
| MagicBlock, Ephemeral Rollup | < 50 ms | gratuit (+ ~0,003 SOL de délégation par session) |
| MagicBlock, Solana rapide | < 500 ms | 0,0008 SOL |
| MagicBlock, Solana standard | 1–2 s | 0,0005 SOL |
| ORAO | sub-seconde possible, 4–20 s | 0,001 SOL |

- Solana suffit : la latence vient de l'oracle VRF, pas de la chaîne. On vise l'**Ephemeral Rollup** MagicBlock.
- Blackjack : environ 3 tirages par main (donne, chaque carte demandée, tirage du croupier après « stand »). La carte cachée du croupier n'existe pas on-chain avant d'être révélée ; on tire donc à la demande (équivalent d'un sabot quasi infini, RTP à recalculer et à afficher).
- Roulette, baccarat, slots, dice, limbo, flip, keno, wheel : un tirage par tour. Mines et Tower : un tirage par case cliquée ; Hilo : un tirage par carte (dont la première) ; aucun pour la mise de Mines et Tower ni pour un encaissement.

**Frais : Tilt prend 1 % sur le gain de chaque manche gagnante**, ce qui finance les tirages VRF et les frais réseau. Les RTP affichés par jeu (§4.3) sont **avant** ces 1 % ; le mod affiche aussi le taux effectif après les 1 %.

| Par main de blackjack | Mise 10 $ | Mise 1 $ |
| --- | --- | --- |
| Revenu moyen des 1 % sur les gains | ≈ 0,047 $ | ≈ 0,005 $ |
| Tirages sur Solana rapide | ≈ 0,48 $ | ≈ 0,48 $ |
| Tirages sur Solana standard | ≈ 0,30 $ | ≈ 0,30 $ |
| Tirages en Ephemeral Rollup (session de 50 mains) | ≈ 0,012 $ | ≈ 0,012 $ |

Sans rollup, les tirages coûtent 6 à 10× ce que rapportent les 1 % : le rollup est nécessaire. À petite mise, l'avantage de la maison complète.

**Accès au programme :** dans le rollup, seules les transactions signées par le relais Tilt (autorité du compte) peuvent jouer ou retirer. Un joueur qui exporterait sa clé ne peut donc pas contourner le KYC ni le blocage géographique. Les dépôts sur Solana restent signés par le joueur.

**Résultats du spike (2026-10-12/13, devnet + rollup MagicBlock EU) et modèle retenu : le compte du joueur reste en permanence dans le rollup.**
- Il entre dans le rollup à son **premier dépôt**, dans la même transaction (sans dépôt, refusé : pas de spam de comptes). Tilt avance les rents en SOL (≈ 6,4 M lamports) et se rembourse en USDC sur ce dépôt (`onboarding_fee`).
- Les dépôts suivants se font sur Solana pendant que le compte est dans le rollup ; ils sont crédités à la manche suivante (visibles en ≈ 25 ms).
- Une manche ne coûte **rien** à Tilt sur Solana : tirage VRF gratuit dans le rollup, ≈ 165 ms par tirage mesurés sur devnet.
- Un retrait est demandé dans le rollup puis payé sur Solana par une Magic Action (≈ 1,2–1,4 s), sans faire sortir le compte. Sur devnet, MagicBlock a payé cette transaction (40 200 lamports) : à confirmer pour le mainnet.
- **Le rollup n'est pas cru sur parole** : le paiement vérifie la demande contre le registre Solana (dépôts réels, gains réservés du joueur). Plafond par retrait et par 24 h, mise en attente puis libération par Tilt, pause globale.
- Une manche non terminée survit à une déconnexion et ne bloque pas les retraits. Une main en attente du joueur lui reste 6 h depuis son dernier coup ; passé ce délai le relais la clôt (stand au blackjack, encaissement à la valeur du moment ailleurs). Un tirage VRF jamais arrivé est relancé par le relais après un délai.
- **Pool de risque** (2026-10-19, remplace le plafond de gains glissant du 2026-10-15) : la maison ne bloque plus le pire cas de chaque manche. Un pool unique dans le rollup tient, pour toutes les manches ouvertes, la réserve qu'exige l'inégalité de Bernstein à ε = 10⁻⁹ (jamais plus que la somme des pires cas), contre une ligne de bankroll réservée sur Solana et alimentée par le relais. Une manche réglée rend aussitôt ce qu'elle tenait ; les gains ne sont réservés pour le joueur qu'au retrait qui les emporte, et rendus à la maison au checkpoint s'il les a reperdus. Au-delà de la ligne, les mises sont refusées (`RiskPoolFull`) et les retraits de gains attendent ; les dépôts restent couverts à 100 %. Détails : `chain/README.md`.
- Restent à concevoir : sortie de secours si le rollup tombe, multisig, audit (`chain/README.md`).

**Conséquences sur le reste de la spec (D13) :** la logique des jeux et l'aléa passent dans `chain/` ; le ledger Postgres, l'ancien contrat `reserve/settle` et le provably fair serveur disparaissent. L'architecture (§5), le contrat (§7), la répartition (§8) et les jalons (§14) sont réécrits en conséquence.

### 6.2 Monnaie (🟡 D3)

- **USDC** : stable, lisible (« 12,40 $ »), sans risque de change pour la bankroll. *Recommandé.*
- **SOL** : natif, plus « degen », mais la bankroll est exposée au prix du SOL.
- **Les deux :** plus complexe (deux ledgers, deux plafonds).

Tous les montants sont stockés en **unités entières** (base units : 6 décimales pour USDC, lamports pour SOL). Jamais de flottants.

### 6.3 Bankroll et risque

- La liquidité de départ annoncée est de 30–50 k$. 🟡 D5 : d'où vient-elle, à quelles conditions (prêt, part des revenus, equity), et qui supporte les pertes ?
- **Mise max** et **gain max par pari** plafonnés selon la bankroll (règle courante : un gain max ≤ 1 % de la bankroll, donc ~300–500 $).
- Exposition max par joueur et par jour.
- Alerte et coupure automatique si la bankroll passe sous un seuil.
- Comptes séparés : bankroll de la maison ≠ pools sponsors ≠ dépôts des joueurs.

### 6.4 Équité (provably fair)

Assurée on-chain par le VRF (§6.1) : le programme n'accepte un tirage que de l'oracle VRF MagicBlock (signature vérifiée) et seulement s'il répond à la requête en cours (identifiant de requête). Chaque fin de manche émet `RoundSettled` avec l'aléa reçu : en le rejouant dans les règles des jeux (code public), on retrouve le résultat. Une page web permet de retrouver et de vérifier les transactions d'une main. Le schéma `serverSeed` / `clientSeed` n'est plus nécessaire.

**Propriétaire :** Armand (programme `chain/`) ; Eli pour la page de vérification dans `web`.

### 6.5 Responsabilités d'Armand

- **Spike devnet d'abord** (§6.1) : tout le reste en dépend.
- **Programme Anchor (`chain/`)** : bankroll (vault), comptes de main, règles et gains des 4 jeux, 1 % sur les gains, plafonds (mise max, gain max selon la bankroll), interrupteur de pause, VRF MagicBlock en Ephemeral Rollup. Tests, fuzzing, simulations de RTP, audits externes.
- **IDL** (types des comptes et événements) publiée tôt dans `packages/contract`, pour qu'Eli code contre.
- **Relais (`apps/wallet`)** : wallets Privy, signers et policies, Tilt comme fee payer, construction et envoi des transactions à partir des intentions d'`api`, idempotence.
- **Paiement des prix** de compétition et des drops depuis le pool sponsor.
- **Exploitation** : multisig Squads (bankroll et autorité d'upgrade), build vérifiable, monitoring, kill switches.
- Onramp carte.
- Token Tilt éventuel (🟡 D4).

## 7. Contrat entre Eli et Armand

**Seule frontière entre les deux.** Tout vit dans `packages/contract` ; aucune modification sans l'accord des deux. Il remplace l'ancien contrat `reserve/settle`, qui supposait un ledger off-chain.

**1. L'IDL du programme (Armand la possède, Eli la consomme).** Générée par Anchor, elle donne les types TypeScript :
- **Comptes :** `PlayerAccount` (solde, dépôts crédités, retraits, manche en cours ou dernière manche : jeu, mise, cartes ou résultat, statut, gain, frais), `Vault` (rôles, config, réserve), `Ledger` (dépôts et retraits côté Solana).
- **Événements :** `RoundSettled` (fin de manche, dans le rollup), `WithdrawalPaid`, `WithdrawalHeld`, `LossReleased` (sur Solana). Le détail d'une manche en cours se lit dans `PlayerAccount.round`.

**2. L'API du relais (`apps/wallet`), appelée uniquement par `api`**, sur réseau privé, authentifiée par clé partagée (`Authorization: Bearer`, deux clés acceptées pendant une rotation). Montants en strings d'entiers en base units. Schémas zod : `packages/contract/src/relay.ts`.

```ts
GET  /users/:userId    -> { userId, solanaAddress, accountOpen }        // 404 UNKNOWN_USER
POST /intents { intentId, userId, action, consent? } -> { intentId, status, signature?, error? }
GET  /intents/:intentId -> même réponse
// action : open_account | deposit {amount} · blackjack_bet {amount (par main), hands 1..6} | blackjack_hit | blackjack_stand | blackjack_double | blackjack_split
//          roulette_spin {amount, bet} (un pari) · roulette_chips {chips: [{bet, amount}] 1..20, paris distincts}
//          baccarat_deal {amount, bet} · slots_spin {amount}
//          mines_bet {amount, mines 1..24} | mines_reveal {tile 0..24} | mines_cashout
//          dice_roll {amount, target, over} · limbo_play {amount, target ×100} · flip_play {amount, side, flips 1..10}
//          keno_play {amount, picks 1..10 de 1..40} · wheel_spin {amount, segments, risk}
//          hilo_bet {amount} | hilo_guess {guess} | hilo_cashout · tower_bet {amount, difficulty} | tower_climb {tile} | tower_cashout · withdraw {amount}
// status : pending (en vol ou issue inconnue, le relais la tranche seul) | submitted (arrivée on-chain) | failed
// error.code : PROGRAM_ERROR (message = nom de l'erreur Anchor, ex. InsufficientBalance), ACCOUNT_NOT_OPEN,
//              TABLE_NOT_READY (table de blackjack pas encore ouverte dans le rollup ; rien n'est joué, renvoyer l'action), …
// 409 INTENT_CONFLICT (id réutilisé pour autre chose) ou PLAYER_BUSY (une intention du joueur est déjà en vol)
// 403 CONSENT_REQUIRED : open_account, deposit et withdraw exigent consent.identityToken (jeton d'identité Privy du joueur, émis il y a moins de 5 min).
// 422 LIMIT_EXCEEDED (plafonds du relais : dépôts par joueur et global, gains promo) ; rien n'est enregistré, le même intentId peut être renvoyé.
POST /payouts/promo { payoutId, userId, amount, poolId, reason } -> { payoutId, status, signature?, error? }
GET  /payouts/promo/:payoutId -> même réponse
// Verse un gain de compétition ou un drop depuis le pool promo (séparé de la bankroll) dans le wallet du joueur.
// Plafonds par gain et par 24 h et pause dans le programme ; un payoutId ne paie qu'une fois, même on-chain.
```

**Règles :**
- Rejouer un appel avec le même `intentId` ou `payoutId` ne fait rien (idempotence), même après un crash du relais : l'intention est enregistrée avant la signature et la signature avant l'envoi ; le relais retrouve l'issue sur la chaîne.
- Une seule intention en vol par joueur.
- Le programme reste l'arbitre : une intention invalide est rejetée on-chain même si le relais l'a laissée passer.
- `api` ne touche jamais aux clés. Le relais ne garde aucun état de jeu : il le lit sur la chaîne.
- `api` lit l'état et les événements directement sur la chaîne (RPC / indexeur), pas via le relais.
- La clé Privy du relais ne peut signer, pour le joueur, que des transactions du programme Tilt (policy Privy `PRIVY_POLICY_ID`, possédée par une clé d'administration hors ligne ; à attacher par le web quand le joueur ajoute le signer : `additional_signers: [{ signer_id: PRIVY_KEY_QUORUM_ID, override_policy_ids: [PRIVY_POLICY_ID] }]`). Vérifié en live : transfert USDC refusé, seul ou à côté d'une instruction Tilt ; la clé du relais ne peut pas modifier la policy.
- Consentement du joueur : pour `open_account`, `deposit` et `withdraw`, `api` transmet le jeton d'identité Privy du joueur ; le relais vérifie sa signature, qu'il appartient à `userId` et qu'il a moins de 5 minutes (sinon 403 `CONSENT_REQUIRED`), et ne le stocke pas. Une clé API volée ne suffit donc plus à déplacer l'argent d'un joueur.

**Développement en parallèle :** Armand publie très tôt l'IDL v0 (forme des comptes et événements) et le contrat du relais. Eli code le mod et `api` contre un **faux relais** qui rejoue des événements enregistrés. On branche tout sur devnet en M3.

**3. Le protocole mod ↔ `api` et web ↔ `api` (Eli).** Le mod ne peut importer que ses propres fichiers : ses types sont dans `apps/mod/hooks/protocol.ts` (source de vérité, sans import), ceux du web dans `apps/api/src/public.ts`. `api` vérifie ses schémas zod contre ces types à la compilation.
- **Connexion du mod :** flux par code (`/tilt login` → `/connect?code=` sur le web → approbation avec le jeton Privy). Le jeton du mod est opaque, haché en base, valable 30 jours, révocable, **limité au jeu**.
- **Consentement (mouvements d'argent) :** le web envoie un jeton d'identité Privy frais (`X-Privy-Identity-Token`) ; `api` le vérifie puis le transmet au relais (`IntentRequest.consent`), qui le vérifie à son tour (moins de 5 min, même joueur). Le jeton n'est jamais stocké.

## 8. Répartition du travail

| Zone | Dossier | Propriétaire |
| --- | --- | --- |
| Mod Claude Code (UI, touches, événements agent, version compacte) : affiche l'état on-chain | `apps/mod` | **Eli** |
| Sessions du mod, lecture des événements du programme, historique, classement, compétitions, drops, sponsors | `apps/api` | **Eli** |
| Landing, page connect, pages dépôt/retrait, vérification d'une main on-chain, cartes de partage | `apps/web` | **Eli** (composants Privy et dépôt fournis par Armand) |
| Relais : Privy, signers et policies, fee payer, envoi des transactions, paiement des prix, onramp | `apps/wallet` | **Armand** |
| Programme Solana : 4 jeux, VRF, bankroll, 1 %, plafonds, pause ; token (si D4) | `chain/` | **Armand** |
| Contrat partagé (IDL + API du relais) | `packages/contract` | **Les deux** (relecture croisée obligatoire) |
| Juridique / licence / KYC | — | 🟡 D8 |

**Règles de collaboration :**
- **Branches :** une branche par tâche, PR vers `main`. On ne relit que les PR qui touchent à l'autre zone ou au contrat.
- **Fichiers :** on ne modifie pas les fichiers de l'autre ; si on en a besoin, on ouvre une issue ou on demande.
- **IA :** chacun travaille avec son IA. `CLAUDE.md` à la racine donne les règles communes ; chaque app peut avoir son propre `CLAUDE.md` pour le contexte local.
- **Mise à jour de la spec :** toute décision prise met à jour cette spec, dans la PR qui l'applique.
- **Sécurité et qualité :** chaque PR respecte §10 et §11. Une PR qui touche à l'argent, au contrat, aux sessions ou au RNG doit être relue par **les deux**.

## 9. Sponsors et compétitions (Eli)

### 9.1 Ce qu'achète un sponsor

- Un **slot de visibilité** sur une période (ex. 24 h, une semaine, une saison) : logo, nom et accroche dans le bloc « Presented by », sur les écrans de gain et sur les cartes de partage.
- Un **budget prize pool**. Tilt prend une commission 🟡 D9 (ex. 40 %), le reste est redistribué.

### 9.2 Comment le pool est redistribué

- **Compétition** (ex. 24 h) : le classement se fait au **gain net sur toutes les manches** du joueur pendant la période (et non au solde total, qui favoriserait les gros dépôts 🟡 D10). Répartition sur le top N (ex. 50 % / 25 % / 10 % / reste partagé). Un prix de rang exige un gain net positif.
- **Drops aléatoires :** une partie du pool (ex. 20 %) est distribuée en petits gains tirés au sort parmi les mains jouées. Une main = un ticket, quelle que soit la mise, pour que les petits joueurs gardent une chance. Tirage par **engagement puis révélation** : le hash de la graine est publié à l'ouverture, la graine à la clôture ; les gagnants sortent de HMAC(graine, signature de la manche). Un drop max par joueur.
- **Anti-abus :**
  - la mise minimum se juge sur la **mise initiale** (la mise de base fois les mains distribuées : un double ou un split au blackjack ne compte pas), et ne décide que de l'éligibilité au classement et des tickets ; le gain net, lui, compte toutes les manches, sinon un joueur choisirait les mains qui comptent ;
  - plafond de tickets par heure, un compte par personne (Privy + vérifs), aucun drop sur des mains annulées ;
  - une compétition ne se clôt que lorsque l'indexeur a traité tout ce qui précède sa fin ;
  - les prix sont bloqués en revue avant paiement, et chaque `payoutId` est déterministe (payé une seule fois).

### 9.3 Ce qu'on livre au sponsor

- Rapport : impressions (temps d'affichage du panneau), joueurs uniques, mains jouées, partages.
- Plus tard : dashboard sponsor en self-service.

## 10. Sécurité (non négociable)

On gère l'argent des joueurs et une bankroll. **On part du principe que des attaquants vont essayer de nous vider dès le premier jour** : des bots, des gens qui lisent notre mod, des gens qui rejouent nos requêtes. Chaque feature est pensée avec sa menace avant d'être codée.

### 10.1 Principes

- **Le programme on-chain fait autorité.** Le mod et le web n'envoient que des *intentions* (« je tire une carte »). Le programme décide de l'état et des gains, l'aléa vient du VRF. Rien de ce qui vient du client n'est cru sans vérification.
- **Fail closed.** En cas de doute, d'erreur ou d'incohérence, on refuse et on bloque plutôt que de payer.
- **Moindre privilège.** Chaque service, clé et utilisateur de base de données n'a accès qu'au strict nécessaire.
- **Défense en profondeur.** Pour chaque risque d'argent, au moins deux barrières indépendantes : une règle applicative **et** une contrainte en base ou une limite globale.
- **Tout est idempotent et traçable.** Chaque mouvement d'argent a une clé unique et une ligne dans un journal d'audit immuable.

### 10.2 Ne pas se faire drainer côté crypto (Armand)

| Risque | Parade |
| --- | --- |
| Vol des clés de la trésorerie | **Hot wallet** limité au besoin des retraits du jour (plafond fixe) ; le reste en **cold**, dans un multisig Squads (2-sur-3, clés sur hardware wallets). Aucune clé privée dans le code, les `.env` locaux ou les logs. Signature via Privy server wallets / KMS avec politiques de signature. |
| Faux dépôt | Crédit uniquement après **finalisation** de la transaction. Vérifier le **mint exact** (vrai USDC, pas un faux token homonyme), le montant, l'adresse de destination. Idempotence par signature de transaction. |
| Retraits frauduleux (compte volé, session volée) | Retrait **uniquement depuis le web**, jamais depuis le mod. Réauthentification fraîche + confirmation email ou 2FA. Délai et plafond réduit sur une nouvelle adresse et après tout changement de compte. Revue manuelle au-dessus d'un seuil. |
| Vidage par volume | Plafonds de retrait par utilisateur, par jour et **global**. Disjoncteur automatique : si les retraits du jour dépassent X % de la bankroll, tout se met en pause et nous sommes alertés. |
| Double dépense / solde négatif | Les soldes sont on-chain : le programme vérifie le solde et l'état de la manche à chaque instruction ; une manche ne se règle qu'une fois (machine à états + identifiant de requête VRF). Sur Solana, chaque retrait est revérifié contre le registre (`checked_due`) et la réserve du coffre couvre toujours ce que chaque joueur peut encore retirer (tests unitaires et e2e). |
| Désynchronisation chaîne ↔ index | La chaîne fait foi. L'index d'`api` n'est qu'un cache d'affichage, reconstruisible depuis l'état des comptes et les événements ; aucun paiement ne se décide sur l'index. |
| Bug du programme on-chain | Audits externes avant le mainnet, fuzzing, autorité d'upgrade sur le multisig, build vérifiable, limites dans le programme lui-même. |
| Arrêt d'urgence | **Kill switches** séparés : dépôts, paris, retraits, payouts promo. Activables en une commande par l'un ou l'autre. |

### 10.3 Ne pas se faire exploiter côté jeu

Depuis D2, les règles, les tirages et les gains sont dans le programme (Armand). `api` ne décide d'aucun résultat : il affiche l'état lu sur la chaîne et transmet des intentions.

| Risque | Parade | Qui |
| --- | --- | --- |
| Triche sur l'état (« j'ai gagné », rejouer une action) | Machine à états **dans le programme** : chaque instruction n'est valide que dans le statut attendu ; une manche se solde une fois (`request_id`) ; le mod n'envoie que des intentions. | Armand |
| Requêtes concurrentes | Une intention en vol par joueur (relais) ; `intentId` idempotent de bout en bout (mod → `api` → relais). | Armand + Eli |
| Prédire ou choisir l'aléa | VRF MagicBlock, callback limité à l'oracle et à la requête en cours (§6.4) ; `expire_round` ne doit pas permettre de relancer un tirage favorable (point ouvert, audit). | Armand |
| RTP réel ≠ annoncé | RTP exact testé dans le programme ; `api` rejoue chaque manche avec les règles portées en TS, vérifiées contre le code Rust (380 vecteurs). | Armand + Eli |
| Option gratuite (main laissée ouverte) | Aucune valeur à attendre : la mise est déjà prélevée et les cartes ne sont tirées qu'à la demande (VRF), donc le temps n'apporte aucune information. La main reste ouverte 6 h après le dernier coup, puis le relais la clôt comme le joueur aurait pu le faire (stand, ou encaissement à sa valeur, égale à ce que vaut la manche en moyenne). | Armand |
| Abus des compétitions et des drops | Mise minimum pour qu'une manche compte, plafond de tickets par heure, un drop max par joueur, prix bloqués en revue avant paiement, `payoutId` déterministe (payé une fois). | Eli |

### 10.4 Anti-spam, anti-bots, anti-multicomptes

- **Rate limiting** par utilisateur, par session, par IP et global, sur tous les endpoints. Plus strict sur login, paris et retraits. Délai minimum entre deux mains.
- **Un compte par personne :** Privy, KYC obligatoire pour le mode argent réel et pour recevoir un prix de compétition au-dessus d'un seuil.
- **Détection des bots :** timing des actions trop régulier, volume anormal, comptes liés (même device, même IP, mêmes adresses de retrait). Signalement, puis gel des gains en attente de revue.
- **Bonus et inscription :** pas de bonus d'inscription retirable sans mise. Jetons gratuits (D1-c) jamais convertibles en argent réel hors compétition.

### 10.5 Comptes, sessions et services

- **Session du mod :** obtenue via un flux type *device code* (`/tilt login` → navigateur → Privy). Jeton d'accès court et rafraîchissable, **limité au jeu** (aucun droit de retrait ni de changement de compte), révocable depuis le web.
- **api ↔ wallet :** réseau privé, authentification forte (secret partagé tourné régulièrement, ou mTLS). Le wallet n'est **jamais** exposé sur Internet.
- **Webhooks :** signés (HMAC), horodatés, rejet des rejeux.
- **Entrées :** validées par schéma (ex. Zod) à chaque frontière. Requêtes SQL paramétrées uniquement. Montants en entiers, jamais en flottants.
- **Secrets :** gestionnaire de secrets de l'hébergeur, rotation, jamais commités (scan automatique en CI).

### 10.6 Le mod et la chaîne d'approvisionnement

- Le mod **ne lit pas** les prompts, le code ni les appels d'outils ; il n'utilise que les événements de début et de fin de tour. La seule commande qu'il lance est `open <url>` pour la connexion (`/tilt login`) ; il n'accède pas aux fichiers.
- Le jeton du mod ne permet que de jouer (aucun dépôt, retrait ni changement de compte) ; il est révocable depuis le web. `http` n'est accepté que vers `127.0.0.1` (développement).
- Code du mod lisible et relu ; versions publiées depuis la CI uniquement, avec un tag Git.
- Dépendances : lockfile commité, versions épinglées, mises à jour automatiques relues (Renovate/Dependabot), `pnpm audit` en CI, scripts `postinstall` des dépendances désactivés.

### 10.7 Exploitation

- Journal d'audit immuable pour chaque mouvement d'argent et action d'admin.
- Monitoring et alertes : écart de réconciliation, pic de retraits, RTP réel qui dérive, taux d'erreurs, rate limits atteints.
- Sauvegardes Postgres chiffrées et testées (on restaure pour vérifier).
- Accès admin : 2FA, comptes nominatifs, aucune action d'argent manuelle sans trace.
- **Runbook d'incident :** qui coupe quoi, comment on communique, comment on rembourse.

### 10.8 Process

- Chaque PR contient une ligne **« Sécurité : »** qui décrit la menace considérée, ou « aucun impact ».
- Revue croisée obligatoire (Eli + Armand) sur : argent, contrat, sessions, RNG, rate limits.
- **Revue de sécurité interne** à M3, et **audit externe** (code wallet + programme on-chain s'il existe) avant toute mise en argent réel sur mainnet (M5).
- Bug bounty après le lancement.

## 11. Qualité du code et tests

Objectif : un code qu'une équipe pro relirait sans grimacer, et une **chaîne testée de bout en bout**.

### 11.1 Standards

- TypeScript `strict`, aucun `any`, ESLint + Prettier, imports propres.
- Fonctions courtes, logique pure séparée des entrées/sorties (règles des jeux, vues et classements testables sans base ni réseau).
- Erreurs typées, jamais avalées. Logs structurés, sans secrets ni données personnelles.
- Les règles de `CLAUDE.md` s'appliquent à tout le monde, humains et IA.

### 11.2 Pyramide de tests

| Niveau | Quoi | Où |
| --- | --- | --- |
| Unitaires | Règles des jeux, gains, frais, plafonds (programme) ; vues, formats, sessions, classements (`api`, mod, web) | `cargo test`, Vitest, `claude plugin test` |
| Propriétés | Réservation de la trésorerie toujours couverte ; classement et drops déterministes | Rust, fast-check |
| Simulation / vecteurs | RTP exact par jeu (programme) ; règles TS de `api` = règles Rust (vecteurs générés depuis le Rust) | `cargo test`, Vitest |
| Intégration | Relais et `api` contre un **vrai Postgres** | Vitest + Postgres 17 |
| Concurrence | Même `intentId` en parallèle, double paiement de prix, double approbation de code | Vitest |
| Contrat | `api` testée contre un faux relais construit sur les schémas de `packages/contract` ; le relais valide les mêmes schémas | Vitest |
| Mod | Rendu des 4 jeux, touches, cycle de tour, connexion | `claude plugin test` |
| Web | Landing, connexion, vérification, classement, en-têtes de sécurité | Playwright |
| Bout en bout | Stack locale (Solana + rollup + VRF) : programme, relais, puis `api` → relais → programme (connexion, dépôt, 4 jeux, indexation, vérification, retrait, prix) | scripts `e2e` |

**Couverture :** ≥ 90 % sur le code argent et jeux (programme, relais, règles et vues de `api`). Pas d'objectif de vanité ailleurs. Chaque bug corrigé arrive avec un test de régression.

### 11.3 CI et branches

- GitHub Actions sur chaque PR : typecheck, lint, tests, build, `pnpm audit`, scan de secrets (gitleaks).
- `main` protégée : PR obligatoire, CI verte obligatoire, pas de push direct ni de force-push.
- Déploiements uniquement depuis la CI. Environnements séparés : local → devnet/staging → mainnet.

### 11.4 Définition de « fini »

Une feature est finie quand :
1. Elle fait ce que la spec dit.
2. Elle est testée au bon niveau, et la CI est verte.
3. La ligne « Sécurité : » de la PR est remplie.
4. Elle est relue (croisée si elle touche à une zone sensible).
5. La spec et la doc sont à jour.

## 12. Juridique et conformité (⚠️ bloquant pour le mode argent réel)

À valider par un avocat **avant tout lancement en argent réel**. Ce qui suit n'est pas un avis juridique.

- **Licence : Curaçao** (décision du 2026-10-12), avec une société dédiée. Il faut compter plusieurs semaines à plusieurs mois et un budget.
- **France :** les jeux de casino en ligne y sont **interdits** (l'ANJ n'autorise que paris sportifs, hippiques et poker). Les joueurs français sont donc à bloquer, et le montage de la société doit être vérifié, puisque les fondateurs sont en France.
- **Blocage géographique :** au minimum les États-Unis, le Royaume-Uni, la France et les autres pays sans licence locale. Blocage par IP, plus une déclaration de pays, plus le KYC.
- **KYC / AML :** vérification d'âge (18+), d'identité au-delà de certains seuils, surveillance des flux. Prestataire à choisir (🟡).
- **Token propre :** risque d'être qualifié de titre financier, et MiCA s'applique en Europe. Raison de plus pour le repousser (D4).
- **Compétitions sponsorisées :** règlement officiel publié.
- **Plateformes :** Anthropic n'interdit pas le jeu dans les plugins, mais refusera Tilt dans son annuaire officiel à cause du contenu sponsorisé. On distribue via notre propre marketplace GitHub. Risque de plateforme : Anthropic peut changer les règles des mods (il existe un « kill switch » distant).

**Option de repli pendant l'obtention de la licence :** lancer en mode compétitions sponsorisées et jetons gratuits (D1-c), sans dépôt, pour bâtir l'audience. Le mode argent réel s'active au moment où la licence arrive.

## 13. Décisions à trancher (Eli + Armand)

| # | Décision | Options | Reco |
| --- | --- | --- | --- |
| D1 | Modes de jeu au lancement | réel seul / réel + sponsors / + jetons gratuits | Réel + sponsors, et jetons gratuits tant que la licence n'est pas là |
| D2 | Règlement des paris | hybride / on-chain / hybride puis on-chain | ✅ **Tout on-chain** (§6.1) |
| D3 | Monnaie | USDC / SOL / les deux | USDC |
| D4 | Token Tilt propre | oui / non / plus tard | Plus tard |
| D5 | Liquidité 30–50 k$ | source, conditions, qui supporte les pertes | À écrire noir sur blanc |
| D6 | Onramp carte | Privy funding / Stripe / MoonPay | Ce que Privy fournit nativement |
| D7 | Stack | voir §5.1 | TS monorepo |
| D8 | Juridique | qui s'en charge, juridiction, société | Juridiction : ✅ **Curaçao**. Reste : qui s'en charge, société, avocat avant M4 |
| D9 | Commission sur les budgets sponsors | % | ~40 % |
| D10 | Classement des compétitions | gain net / volume / solde | Gain net |
| D11 | Split au blackjack v1 | oui / non | ✅ **Oui** : paires de même valeur, 4 splits max par manche, re-split et double après split, as splittés : une carte et c'est fini |
| D12 | Nom de domaine et marque | — | — |
| D13 | Répartition après D2 on-chain | qui porte la logique des jeux (`chain/`), que devient `api`, contrat §7 | ✅ **Validé par Eli** (2026-10-13) : jeux on-chain chez Armand, `api` en lecture + produit chez Eli |

## 14. Jalons

| Jalon | Contenu | Eli | Armand |
| --- | --- | --- | --- |
| **M0 — Fondations** | Valider la spec, monorepo, IDL v0 + contrat du relais, faux relais, **CI complète dès le jour 1** (§11.3) | Squelette mod + api | **Spike devnet** (§6.1), squelette `chain/` + relais, Privy sandbox |
| **M1 — Ça se joue** | Blackjack jouable dans Claude Code, bandeau de fin de tour | Mod + api contre le faux relais | Blackjack on-chain sur localnet (programme + VRF), tests et simulation de RTP |
| **M2 — Comptes** | `/tilt login` via Privy, wallet créé, solde réel affiché (devnet) | Page connect, session mod | Wallets Privy, signers, fee payer, relais sur devnet |
| **M3 — Branchement** | Tout branché sur devnet, de bout en bout, **E2E devnet en CI, revue de sécurité interne** | Intégration, lecture des événements | Ephemeral Rollup en conditions réelles, retraits |
| **M4 — Sponsors** | Bloc sponsor, compétition 24 h, drops, leaderboard, carte de partage | Tout | Payouts promo |
| **M5 — Bêta mainnet** | **Prérequis : audit externe du programme passé, kill switches testés, runbook écrit.** Bêta fermée, limites basses, blocage géographique, KYC | Landing, jeu responsable | Bankroll, multisig, monitoring |
| **v1.1** | Roulette, baccarat, slots, version compacte du panneau | | |

## 15. Indicateurs

- Activation : % d'installations qui jouent au moins une main.
- Mains par session Claude Code, et temps de panneau ouvert par tour d'agent.
- Joueurs qui déposent / joueurs actifs ; dépôt moyen.
- Revenu net de la maison (GGR) ; revenu sponsor ; coût des prix.
- Partages par gain.

## 16. Questions ouvertes (hors décisions)

- Design : Eli transmet les fichiers Claude Design et les tokens de style ; à placer dans `docs/design/`.
- Version compacte du panneau pour les terminaux étroits.
- Que se passe-t-il quand l'utilisateur ferme Claude Code en pleine main ? (Proposition : la main reste en pause côté serveur, puis est soldée au bout de 24 h selon la stratégie de base du blackjack.)
- Faut-il supporter l'onglet Code de l'app Desktop dès la v1 (même mod, quelques éléments différents) ?
