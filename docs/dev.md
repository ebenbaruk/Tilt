# Développer Tilt en local

Tout tourne sur la machine : Solana + rollup MagicBlock + oracle VRF, Postgres, le relais (`apps/wallet`), `api`, le web et le mod Claude Code.

Pour installer le mod chez un testeur (sans cloner le dépôt) : [onboarding.md](onboarding.md).

## Prérequis

| Outil | Version |
| --- | --- |
| Node | 22+ |
| pnpm | 12.3.4 (`npm i -g pnpm@12.3.4`) |
| Rust | 1.89.0 (`rustup toolchain install 1.89.0`) |
| Agave (Solana CLI) | 3.1.x |
| Anchor | 1.0.2 (`avm install 1.0.2 && avm use 1.0.2`) |
| Docker | pour Postgres |
| Claude Code | ≥ 2.1.287 (mods) |

```sh
pnpm install --frozen-lockfile
```

pnpm refuse les paquets publiés il y a moins d'un jour (règle de la chaîne d'approvisionnement). Si un ajout échoue pour cette raison, épingle la version précédente. Ne relâche pas la règle.

## 1. Postgres

```sh
docker run -d --name tilt-pg -e POSTGRES_PASSWORD=tilt -e POSTGRES_DB=tilt_test -p 55432:5432 postgres:17
docker exec tilt-pg psql -U postgres -c "create database tilt_api_test" -c "create database tilt_api" -c "create database tilt" \
  -c "create database tilt_stack_relay" -c "create database tilt_stack_api"   # bases du e2e api (étape 3)
```

## 2. Stack Solana + rollup + VRF

- **Linux :** `chain/scripts/local-stack.sh`.
- **macOS :** `scripts/local-stack-macos.sh`. Le script Linux exige le réseau hôte Docker et `io_uring`, absents sur Mac.

```sh
sudo launchctl limit maxfiles 1000000 1000000                     # une fois par démarrage du Mac
solana-keygen new --no-bip39-passphrase -o /tmp/tilt-admin.json   # clé admin jetable
(cd chain && anchor build --ignore-keys)
ANCHOR_WALLET=/tmp/tilt-admin.json scripts/local-stack-macos.sh   # laisse tourner
ANCHOR_WALLET=/tmp/tilt-admin.json pnpm --filter @tilt/chain e2e  # installe la maison (vault, relais, USDC de test)
```

Ports : Solana `8899`/`8900`, rollup `7799`/`7800`.

## 3. Tests

Tout d'un coup, comme une CI (il n'y a pas de CI GitHub) : `scripts/ci.sh`, et `scripts/ci.sh --e2e` avec la stack de l'étape 2 lancée. À passer avant chaque merge.

Suite par suite :

```sh
pnpm -r typecheck && pnpm lint && pnpm format:check
pnpm --filter @tilt/contract test
TEST_DATABASE_URL=postgres://postgres:tilt@127.0.0.1:55432/tilt_test pnpm --filter @tilt/wallet test
TEST_DATABASE_URL=postgres://postgres:tilt@127.0.0.1:55432/tilt_api_test pnpm --filter @tilt/api test
pnpm --filter @tilt/mod test           # claude plugin validate + test
pnpm --filter @tilt/play test          # cœur partagé des autres harnais
pnpm --filter @tilt/harnesses typecheck
pnpm --filter @tilt/web test && pnpm --filter @tilt/web e2e
(cd chain && cargo +1.89.0 test)
```

De bout en bout, sur la stack de l'étape 2 :

```sh
ANCHOR_WALLET=/tmp/tilt-admin.json pnpm --filter @tilt/chain e2e   # programme
ANCHOR_WALLET=/tmp/tilt-admin.json TEST_DATABASE_URL=postgres://postgres:tilt@127.0.0.1:55432/tilt_test pnpm --filter @tilt/wallet e2e   # relais
ANCHOR_WALLET=/tmp/tilt-admin.json pnpm --filter @tilt/api e2e     # api → relais → programme
```

Chaque suite remet ses propres tables à zéro. N'utilise pas la même base pour deux branches différentes : leurs migrations divergent.

## 4. Lancer les apps

Copie les `.env.example` en `.env` dans `apps/wallet`, `apps/api` et `apps/web` (les `.env` ne sont jamais commités), puis :

```sh
pnpm --filter @tilt/wallet start   # relais, 127.0.0.1:8787 (réseau privé uniquement)
pnpm --filter @tilt/api start      # api, :8080
pnpm --filter @tilt/web dev        # web, http://localhost:3000
```

**Config :**
- `RELAY_API_KEY` (api) doit être l'une des `RELAY_API_KEYS` (relais).
- Géo-blocage et IP client : en local, il n'y a pas de proxy, donc `GEO_ALLOW_UNKNOWN=true`. En production, `api` doit être derrière un proxy (edge) qui écrase l'en-tête pays (`COUNTRY_HEADER`), ajoute `x-tilt-edge: <EDGE_SECRET>` et ajoute l'IP du client à `X-Forwarded-For`. Mets alors `TRUST_PROXY=true`, `EDGE_SECRET` (32 caractères ou plus), `TRUSTED_PROXY_HOPS` (nombre de proxys qui ajoutent une entrée à `X-Forwarded-For`, 1 par défaut) et `GEO_ALLOW_UNKNOWN=false`. Sans le bon secret, le pays est inconnu, donc refusé.
- Site et api sur deux hôtes (devnet : site sur Vercel, api sur notre serveur derrière un tunnel) : avec `API_UPSTREAM` (URL `https:`, sinon le site refuse de démarrer) et `EDGE_SECRET`, `apps/web/proxy.ts` relaie `/v1` et `/health` vers l'api, sans les cookies, avec `x-tilt-edge: <EDGE_SECRET du site>`, l'IP de l'appelant dans `x-tilt-client-ip` et son pays dans `x-tilt-country` (il écrase les valeurs envoyées par le client). Vercel ne transmet pas ses `x-vercel-*` et le tunnel remplace `X-Forwarded-For` par l'adresse de Vercel, donc une passerelle entre le tunnel et l'api doit rétablir le contrat ci-dessus :
  - comparer `x-tilt-edge` au secret du site, en temps constant ;
  - secret bon : `X-Forwarded-For` devient la seule adresse de `x-tilt-client-ip` (si c'est une IP), et `COUNTRY_HEADER` la valeur de `x-tilt-country` (si ce sont deux lettres) ;
  - secret absent ou faux : aucun pays (donc refusé), et `X-Forwarded-For` devient la dernière entrée de celui reçu (écrite par le tunnel), à défaut l'adresse de la connexion ;
  - dans tous les cas, supprimer les `x-tilt-edge`, `x-tilt-client-ip`, `x-tilt-country` et `COUNTRY_HEADER` reçus, puis ajouter `x-tilt-edge: <EDGE_SECRET de l'api>` ;
  - côté api, `TRUSTED_PROXY_HOPS` est la position de l'IP du client, en partant de la droite, dans le `X-Forwarded-For` reçu : 1 quand la passerelle le remplace par cette seule IP.

  Sans ce contrat, tous les joueurs ont l'adresse de Vercel pour l'api, et le compartiment d'auth (`RATE_AUTH_PER_MIN`, 10 par minute et par IP) bloque tout le monde. Implémentation de référence, en service sur le devnet : `ops/gateway.mjs` du déploiement devnet (hors dépôt).
- Privy : une app de développement. Le relais a besoin de `PRIVY_AUTHORIZATION_KEY` (quorum de clés) ; `api` et le web ont besoin de l'id de l'app ; `api` a aussi besoin de `PRIVY_KEY_QUORUM_ID` / `PRIVY_POLICY_ID`. Le script `apps/wallet/scripts/privy-setup.ts` crée le quorum et la policy.

## 5. Le mod dans Claude Code

```sh
claude --plugin-dir apps/mod
```

Pour essayer une disposition sans toucher à `~/.claude/settings.json`, passe les réglages pour la session seulement :

```sh
claude --plugin-dir apps/mod --settings '{"tui":"default","pluginConfigs":{"tilt":{"options":{"apiUrl":"http://127.0.0.1:8080","layout":"bottom","cards":"large"}}}}'
```

`tui` : `default` (panneau sous le transcript) ou `fullscreen` (panneau à droite). `layout` : `side`, `bottom` ou `compact`. Attention : `/tilt setup` enregistre ses choix dans les réglages utilisateur, comme `/config`.

Dans la session :
1. Règle `apiUrl` sur `http://127.0.0.1:8080` (`/config`, ou `pluginConfigs.tilt.options.apiUrl` dans `~/.claude/settings.json`).
2. `/tilt login`, puis approuve le code dans le navigateur.
3. Envoie un prompt : le panneau s'ouvre pendant que l'agent travaille.

Touches (partout) : `1`–`4` pour les jeux, `n` pour donner ou lancer, `v`/`b` pour baisser/monter la mise par main, au blackjack `j`/`k` pour une main de moins/de plus (1 à 6) et `h`/`s`/`d`/`p` (hit, stand, double, split quand la main est une paire) sur la main marquée `▶`. Le focus passe au panneau avec `Ctrl+X Tab`. En plein écran (`claude --plugin-dir apps/mod --settings '{"tui":"fullscreen"}'`), un clic sur la table lui donne les touches brutes : `Espace`/`Entrée` rejoue avec la même mise et les mêmes mains (en cours de main `Espace` tire, `Entrée` reste, `d` double, `p` sépare), `←`/`→` la mise, `↑`/`↓` les mains.

Le premier chargement dépose les types du moteur dans `apps/mod/.claude-plugin/types/` (ignorés par git), ce qui rend utile `pnpm --filter @tilt/mod typecheck`.

## 6. Admin (sponsors, compétitions, prix)

```sh
pnpm --filter @tilt/api admin campaign:create …
pnpm --filter @tilt/api admin competition:open …
pnpm --filter @tilt/api admin competition:close …   # refusé tant que l'indexeur n'a pas dépassé la fin (--force : journalisé)
pnpm --filter @tilt/api admin prize:list
pnpm --filter @tilt/api admin prize:approve …
pnpm --filter @tilt/api admin prize:pay   # idempotent : relancer ne paie rien deux fois
```

`pnpm --filter @tilt/api admin` sans argument affiche l'aide.

## 7. Autres harnais

Tilt se joue aussi dans d'autres agents de code (omp, OpenCode, Codex, Gemini CLI…) : index, niveaux d'intégration et installation dans [`harnesses/README.md`](../harnesses/README.md).

Pour un essai sans la stack, lance la fausse API puis pointe le harnais (ou le compagnon) dessus :

```sh
bun packages/play/test/fake-api.ts 8099
TILT_API_URL=http://127.0.0.1:8099 harnesses/companion/bin/tilt
```

## Publier le client

Les testeurs n'ont jamais accès à ce monorepo. Ils clonent et auditent `ebenbaruk/tilt-client` (public), qui ne contient que `apps/mod`, `packages/play` et `harnesses` (sans les tests), plus `scripts/client/` (README et marketplace).

Après un merge qui touche ces dossiers, depuis `main` à jour et `scripts/ci.sh` vert :

```sh
scripts/publish-client.sh   # un commit « Publish Tilt <sha> » sur tilt-client
```

Le prompt d'installation (landing, `docs/onboarding.md`) pointe vers `tilt-client` : chaque publication arrive chez les testeurs à leur prochain passage du prompt, qui refait l'audit.
