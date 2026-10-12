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

**Touches :**
- `1`/`2`/`3` : changer de jeu.
- `h`/`s`/`d` : actions du blackjack.
- `b` : changer la mise.
- `Ctrl+X Tab` : donner ou rendre le focus au panneau.
- Tab et les flèches sont réservés par Claude Code.

**Contraintes techniques (mods Claude Code) :**
- Claude Code ≥ v2.1.287.
- Le panneau doit avoir le focus pour recevoir les touches.
- Sous 110–144 colonnes de terminal, le panneau ne s'ouvre pas tout seul : il faut une version compacte (bande au-dessus du prompt).

**Le sponsor est toujours visible.** Le bloc « Presented by » ne peut pas être masqué, et il est clairement marqué comme sponsorisé (l'Usage Policy d'Anthropic interdit le contenu sponsorisé non signalé).

### 4.3 Jeux

| Jeu | Version | Notes |
| --- | --- | --- |
| Blackjack | v1 | Règles standard, 6 decks, le croupier reste sur 17, blackjack payé 3:2. Pas de split en v1 (🟡). |
| Roulette | v1.1 | Européenne (un seul zéro). |
| Slots | v1.1 | 3 rouleaux, table de gains publique, RTP affiché. |
| Autres (crash, dice, mines…) | plus tard | Très adaptés au terminal et rapides à jouer. |

Chaque jeu affiche son **RTP** (taux de retour au joueur) et est **provably fair** (§6.4).

### 4.4 Ton et confiance

- **Le mod ne lit jamais les prompts ni le code de l'utilisateur.** Il n'utilise que les événements de début et de fin de tour. On l'écrit noir sur blanc et le code du mod est lisible par tous, car les mods ont accès à tout.
- **Jeu responsable :** limites de dépôt et de perte, auto-exclusion, pause « je travaille ». Obligatoire en mode argent réel.

## 5. Architecture

```
            ┌──────────────┐        ┌─────────────────────────┐
 Claude ──▶ │  mod (TS)    │──HTTP─▶│  api  (game server)     │
 Code       │  UI + touches│        │  auth, jeux, RNG,       │
            └──────────────┘        │  compétitions, sponsors │
                                    └───────────┬─────────────┘
            ┌──────────────┐                    │ HTTP interne (contrat §7)
 Navigateur▶│  web (Next)  │──┐                 ▼
            │  landing,    │  │     ┌─────────────────────────┐      ┌──────────┐
            │  connect,    │  └────▶│  wallet  (money service)│─────▶│ Solana   │
            │  dépôt/retrait│       │  Privy, ledger, dépôts, │      │ (vault,  │
            └──────────────┘        │  retraits, bankroll     │      │  USDC…)  │
                                    └─────────────────────────┘      └──────────┘
```

**Principe :** tout ce qui touche à l'argent est dans `wallet` (Armand). Tout ce qui touche au jeu et au produit est dans `mod` / `api` / `web` (Eli). Les deux mondes ne se parlent que par le contrat du §7.

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

### 6.1 Modèle de règlement des paris (🟡 D2, décision structurante)

- **(a) Hybride, solde off-chain** *(recommandé pour la v1).* Dépôts et retraits on-chain ; les paris sont débités et crédités dans un ledger Postgres. C'est le modèle de la plupart des casinos crypto.
  - **Pour :** instantané (une main de blackjack = plusieurs actions), aucun frais par mise, aucune signature à chaque mise, simple.
  - **Contre :** custodial, donc la confiance repose sur nous. On compense avec du provably fair et une preuve de réserves.
- **(b) Full on-chain :** chaque pari est une transaction vers un programme Anchor, avec un aléa VRF (Switchboard / ORAO).
  - **Pour :** trustless, ce qui est un argument « crypto ».
  - **Contre :** latence et frais à chaque action, signature via les session signers de Privy, programme à auditer, beaucoup plus long à sortir.
- **(c) Hybride d'abord, puis migration** des jeux simples (dice, slots) on-chain en v2.

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

C'est le standard des casinos crypto ; on n'en a pas besoin en option (b).
- Le serveur s'engage sur `hash(serverSeed)` avant le jeu.
- Le client fournit un `clientSeed`.
- Chaque main est tirée avec `HMAC-SHA256(serverSeed, clientSeed:nonce)`.
- Après rotation, on révèle `serverSeed` ; une page web permet de tout vérifier.

**Propriétaire : Eli** (dans `api`), car c'est de la logique de jeu. Armand relit.

### 6.5 Responsabilités d'Armand

- Intégration Privy : config, login, wallets embarqués, export de clé.
- Détection des dépôts (webhook ou indexeur), confirmations, crédit du ledger.
- Retraits : file d'attente, signature, limites, contrôles anti-fraude.
- Ledger : double entrée, idempotent, réconciliation avec la chaîne.
- Bankroll : wallet de la maison (multisig Squads recommandé), plafonds, monitoring.
- Onramp carte.
- Si option (b) ou (c) : programme Anchor + VRF + audit.
- Paiement des prix de compétition et des drops depuis le pool sponsor.
- Token Tilt éventuel (🟡 D4).

## 7. Contrat entre `api` (Eli) et `wallet` (Armand)

**Seule frontière entre les deux.** Les types vivent dans `packages/contract` ; aucune modification sans l'accord des deux.

Service interne, authentifié par une clé partagée (variable d'environnement). Tous les montants sont des strings d'entiers en base units.

```ts
// packages/contract — esquisse, à affiner ensemble
type Currency = 'USDC' | 'SOL'
type Amount = string // entier, base units

// Utilisateurs (l'identité vient de Privy)
GET  /users/:privyUserId            -> { userId, solanaAddress }

// Soldes
GET  /balances/:userId              -> { available: Amount, locked: Amount, currency }

// Paris — idempotents par betId
POST /bets/reserve  { betId, userId, amount, currency }   -> { ok } | { error: 'INSUFFICIENT_FUNDS' | 'LIMIT_REACHED' | 'MAX_BET' }
POST /bets/settle   { betId, payout: Amount }              -> { ok, balance }   // payout = 0 si perdu
POST /bets/cancel   { betId }                              -> { ok }            // libère la mise réservée

// Promotions (prix de compétition, drops) — payées depuis un pool sponsor
POST /payouts/promo { payoutId, userId, amount, currency, poolId, reason } -> { ok }

// Événements wallet -> api (webhooks signés)
deposit.confirmed     { userId, amount, currency, txSig }
withdrawal.completed  { userId, amount, currency, txSig }
limit.changed         { userId, ... }   // jeu responsable
```

**Règles :**
- `reserve` bloque la mise au début de la main ; `settle` la solde à la fin.
- Une main abandonnée est soldée par `api` selon les règles du jeu après expiration.
- Rejouer un appel avec le même `betId` ou `payoutId` ne fait rien (idempotence).
- `api` ne touche jamais aux clés ni à la chaîne. `wallet` ne connaît jamais les règles des jeux.

**Développement en parallèle :** Eli code contre un **mock** du wallet (un ledger en mémoire qui respecte le contrat). Armand teste avec un petit client qui appelle le contrat. On branche les deux en jalon M3.

## 8. Répartition du travail

| Zone | Dossier | Propriétaire |
| --- | --- | --- |
| Mod Claude Code (UI, touches, événements agent) | `apps/mod` | **Eli** |
| Game server : jeux, RNG provably fair, sessions, compétitions, drops, leaderboard, sponsors | `apps/api` | **Eli** |
| Landing, page connect, pages dépôt/retrait, vérif provably fair, cartes de partage | `apps/web` | **Eli** (composants Privy et dépôt fournis par Armand) |
| Money service : Privy, ledger, dépôts, retraits, bankroll, onramp | `apps/wallet` | **Armand** |
| Programmes Solana (si D2 = b/c), token (si D4) | `chain/` | **Armand** |
| Contrat partagé | `packages/contract` | **Les deux** (relecture croisée obligatoire) |
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

- **Compétition** (ex. 24 h) : le classement se fait au **gain net** sur la période (et non au solde total, qui favoriserait les gros dépôts 🟡 D10). Répartition sur le top N (ex. 50 % / 25 % / 10 % / reste partagé).
- **Drops aléatoires :** une partie du pool (ex. 20 %) est distribuée en petits gains tirés au sort parmi les mains jouées. Une main = un ticket, quelle que soit la mise, pour que les petits joueurs gardent une chance.
- **Anti-abus :** mise minimum pour qu'une main compte, plafond de tickets par heure, un compte par personne (Privy + vérifs), aucun drop sur des mains annulées.

### 9.3 Ce qu'on livre au sponsor

- Rapport : impressions (temps d'affichage du panneau), joueurs uniques, mains jouées, partages.
- Plus tard : dashboard sponsor en self-service.

## 10. Sécurité (non négociable)

On gère l'argent des joueurs et une bankroll. **On part du principe que des attaquants vont essayer de nous vider dès le premier jour** : des bots, des gens qui lisent notre mod, des gens qui rejouent nos requêtes. Chaque feature est pensée avec sa menace avant d'être codée.

### 10.1 Principes

- **Le serveur fait autorité.** Le mod et le web n'envoient que des *intentions* (« je tire une carte »). Le serveur décide de tout : état, aléa, gains. Rien de ce qui vient du client n'est cru sans vérification.
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
| Double dépense / solde négatif | Ledger en **double entrée** dans Postgres. `CHECK (balance >= 0)` en base. Verrou par utilisateur ou transactions `SERIALIZABLE`. Invariant : la somme de toutes les écritures vaut 0. |
| Désynchronisation chaîne ↔ ledger | **Réconciliation automatique** (au moins horaire) entre soldes on-chain et ledger. Au moindre écart inexpliqué, pause des retraits et alerte. |
| Bug du programme on-chain (si D2 = b/c) | Audit externe avant le mainnet, fuzzing, autorité d'upgrade sur le multisig, limites dans le programme lui-même. |
| Arrêt d'urgence | **Kill switches** séparés : dépôts, paris, retraits, payouts promo. Activables en une commande par l'un ou l'autre. |

### 10.3 Ne pas se faire exploiter côté jeu (Eli)

| Risque | Parade |
| --- | --- |
| Triche sur l'état (envoyer « j'ai gagné », rejouer une action) | Chaque main est une **machine à états** côté serveur. Une action n'est valide que dans l'état attendu. Transitions atomiques en base. Une main ne peut être soldée qu'**une seule fois** (`betId` unique). |
| Requêtes concurrentes (deux mises en parallèle, double `stand`) | Verrou par utilisateur et par main. Tests de concurrence dédiés (§11). |
| Prédire l'aléa | `serverSeed` issu d'un CSPRNG, jamais révélé avant rotation. Nonce strictement croissant. Aucun aléa côté client. |
| Erreur dans les gains (RTP réel ≠ annoncé) | Table de gains en un seul endroit. **Tests de simulation** sur des millions de mains : le RTP mesuré doit rester dans la tolérance annoncée. Gain max par pari plafonné (§6.3). |
| Option gratuite (laisser une main ouverte pour attendre) | Expiration des mains avec règlement automatique et défavorable à l'attente (stratégie de base). Pas de mise sur une main déjà commencée. |
| Abus des compétitions et des drops | Une main ne compte que si elle respecte la mise minimum. Plafond de tickets par heure. Prix retenus pendant une revue anti-fraude avant paiement. Aucun prix pour les mains annulées ou remboursées. |

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

- Le mod **ne lit pas** les prompts, le code ni les appels d'outils ; il n'utilise que les événements de début et de fin de tour. Il n'exécute aucune commande shell.
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
- Fonctions courtes, logique pure séparée des entrées/sorties (moteur de jeu et calcul du ledger testables sans base ni réseau).
- Erreurs typées, jamais avalées. Logs structurés, sans secrets ni données personnelles.
- Les règles de `CLAUDE.md` s'appliquent à tout le monde, humains et IA.

### 11.2 Pyramide de tests

| Niveau | Quoi | Outil proposé |
| --- | --- | --- |
| Unitaires | Règles de chaque jeu, calcul des gains, provably fair, limites | Vitest |
| Propriétés | Invariants : solde jamais négatif, somme du ledger = 0, une main soldée une seule fois, déterminisme du RNG | fast-check |
| Simulation | RTP sur des millions de mains, dans la tolérance | Vitest (job dédié) |
| Intégration | api et wallet contre un **vrai Postgres** | Testcontainers |
| Concurrence | Requêtes parallèles : double mise, double retrait, double settle | Tests dédiés |
| Contrat | api et wallet testés chacun contre `packages/contract` (le mock d'Eli et le vrai wallet d'Armand passent les mêmes tests) | Vitest |
| Mod | Rendu, touches, cycle de tour | `claude plugin test` |
| Web | Parcours login, dépôt, retrait | Playwright |
| Bout en bout | Devnet : login → dépôt → mains → gain → retrait, en CI | Script E2E |

**Couverture :** ≥ 90 % sur le code argent et jeux (`wallet`, moteurs de jeu, ledger, RNG). Pas d'objectif de vanité ailleurs. Chaque bug corrigé arrive avec un test de régression.

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

- **Licence :** un casino en ligne en argent réel exige une licence (souvent Curaçao, Anjouan, ou d'autres juridictions), avec une société dédiée. Il faut compter plusieurs semaines à plusieurs mois et un budget.
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
| D2 | Règlement des paris | hybride / on-chain / hybride puis on-chain | Hybride |
| D3 | Monnaie | USDC / SOL / les deux | USDC |
| D4 | Token Tilt propre | oui / non / plus tard | Plus tard |
| D5 | Liquidité 30–50 k$ | source, conditions, qui supporte les pertes | À écrire noir sur blanc |
| D6 | Onramp carte | Privy funding / Stripe / MoonPay | Ce que Privy fournit nativement |
| D7 | Stack | voir §5.1 | TS monorepo |
| D8 | Juridique | qui s'en charge, juridiction, société | Avocat avant M4 |
| D9 | Commission sur les budgets sponsors | % | ~40 % |
| D10 | Classement des compétitions | gain net / volume / solde | Gain net |
| D11 | Split au blackjack v1 | oui / non | Non (v1.1) |
| D12 | Nom de domaine et marque | — | — |

## 14. Jalons

| Jalon | Contenu | Eli | Armand |
| --- | --- | --- | --- |
| **M0 — Fondations** | Valider la spec, monorepo, contrat v0, mock du wallet, **CI complète dès le jour 1** (§11.3) | Squelette mod + api | Squelette wallet + Privy sandbox |
| **M1 — Ça se joue** | Blackjack jouable dans Claude Code, jetons fictifs, bandeau de fin de tour | Mod + moteur blackjack + provably fair | Ledger + `reserve/settle` sur Postgres |
| **M2 — Comptes** | `/tilt login` via Privy, wallet créé, solde réel affiché (devnet) | Page connect, session mod | Wallets Privy, dépôts devnet |
| **M3 — Branchement** | api ↔ wallet réels sur devnet, dépôts et retraits de bout en bout, **E2E devnet en CI, revue de sécurité interne** | Intégration | Retraits, réconciliation |
| **M4 — Sponsors** | Bloc sponsor, compétition 24 h, drops, leaderboard, carte de partage | Tout | Payouts promo |
| **M5 — Bêta mainnet** | **Prérequis : audit externe passé, kill switches testés, runbook écrit.** Bêta fermée, limites basses, blocage géographique, KYC | Landing, jeu responsable | Bankroll, multisig, monitoring |
| **v1.1** | Roulette, slots, version compacte du panneau | | |

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
