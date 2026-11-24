# Installer Tilt (testeurs invités)

Le testeur colle un prompt dans son agent de code (Claude Code, omp, pi, OpenCode, Kilo Code, DeepSeek Harness, Amp, Copilot CLI, Grok, Qwen Code, Kimi Code, Droid, Cursor CLI, Codex CLI, Gemini CLI, goose, Cline, Crush, CodeWhale ou Aider) : l'agent trouve l'intégration Tilt qui lui correspond, audite son code, l'installe une fois que le testeur a donné son feu vert, puis la règle. Le testeur se connecte ensuite sur le web, dépose et joue. Tout se passe sur devnet : l'argent est de l'USDC de test, sans valeur. La suite du document détaille le cas Claude Code ; pour les autres agents, la manière de jouer et de se connecter est dans `harnesses/<nom>/README.md`, que l'agent résume à la fin du prompt.

Deux valeurs sont à remplir par l'équipe avant d'envoyer ce document (partout où elles apparaissent) :

- `<TILT_API_URL>` : l'URL publique de `apps/api`, en `https`, sans `/` final.
- `<TILT_WEB_URL>` : l'URL publique de `apps/web`, sur le même hôte que l'api ou sur son domaine parent (voir « Dépannage »).

## Prérequis

- Un accès en lecture au dépôt privé GitHub `ebenbaruk/tilt-client` (invitation acceptée). Il ne contient que le code qui tourne chez le testeur ; le monorepo `ebenbaruk/Tilt` ne s'ouvre jamais aux testeurs.
- Une auth GitHub qui marche pour `git` : `git ls-remote https://github.com/ebenbaruk/tilt-client.git HEAD` doit répondre sans erreur. Claude Code clone le dépôt en SSH si SSH est configuré pour GitHub, sinon en HTTPS ; les autres agents le clonent en HTTPS dans `~/.tilt/src`. Avec la CLI GitHub : `gh auth login`, puis `gh auth setup-git`.
- Un agent de la liste ci-dessus. Pour Claude Code : 2.1.287 ou plus récent (`claude --version`).
- Pas besoin de SOL : le relais Tilt paie les frais de transaction.

## Le prompt à coller

C'est le même prompt que sur la landing, dans la section « How it works » (`apps/web/components/landing/InstallPrompt.tsx`, à garder identique). Le testeur le colle dans son agent, et l'agent :

1. identifie l'agent dans lequel il tourne et son dossier : `apps/mod` pour Claude Code, `harnesses/<nom>` pour les autres. S'il n'est pas dans la liste, il s'arrête : Tilt n'a pas encore d'intégration pour lui ;
2. récupère le dépôt sans rien installer (comme marketplace pour Claude Code, en clone dans `~/.tilt/src` sinon) et note le commit ;
3. audite le code qui va tourner (pour Claude Code `apps/mod` ; sinon `harnesses/<nom>`, `packages/play/src`, les fichiers partagés de `apps/mod/hooks/` et `harnesses/companion` si le README s'en sert), point par point avec `fichier:ligne` : réseau vers l'API Tilt seulement, seule commande l'ouverture du lien de login, fichiers écrits seulement sous `~/.tilt` (plus la config de l'agent indiquée par le README), hooks qui ne lisent pas stdin, rien qui lise prompts, réponses, code, appels d'outils ou transcripts, pas de script d'install ni de dépendance. Puis il donne un verdict et **attend le feu vert du testeur** ;
4. demande l'URL de l'invitation (`<TILT_API_URL>`) et installe : pour Claude Code, il installe le plugin, vérifie que la copie installée est exactement celle qu'il a auditée et règle `apiUrl` ; sinon il suit `harnesses/<nom>/README.md` avec `<TILT_DIR>` = `~/.tilt/src` et l'URL en `TILT_API_URL` ou `apiUrl` ;
5. explique comment jouer dans cet agent (touche, commande, ou commande du compagnon à lancer dans un panneau à côté) et comment se connecter.

L'agent demande d'approuver chaque commande. Pour Claude Code, elles ne touchent qu'à sa config (marketplace `tilt`, plugin `tilt@tilt`, son réglage `apiUrl`) ; pour les autres, au clone `~/.tilt/src` et à la config indiquée par le README. Elles peuvent être relancées.

```text
Install Tilt, the casino at https://github.com/ebenbaruk/tilt-client, in the coding agent you are running in. Audit it before anything runs, and stop at the first problem.

1. Identify the agent you are running in and its folder: Claude Code 2.1.287+ (apps/mod); omp or pi (harnesses/pi); OpenCode or Kilo Code (harnesses/opencode); DeepSeek Harness (harnesses/deepseek); Amp (harnesses/amp); GitHub Copilot CLI (harnesses/copilot); Grok Build or grok-cli (harnesses/grok); Qwen Code (harnesses/qwen); Kimi Code (harnesses/kimi); Factory Droid (harnesses/droid); Cursor CLI (harnesses/cursor); Codex CLI (harnesses/codex); Gemini CLI (harnesses/gemini); goose (harnesses/goose); Cline (harnesses/cline); Crush (harnesses/crush); CodeWhale (harnesses/codewhale); Aider (harnesses/aider). If none matches, stop and tell me Tilt has no integration for it yet.
2. Fetch it without installing. Claude Code: `claude plugin marketplace add ebenbaruk/tilt-client` (`claude plugin marketplace update tilt` if it is already there); <folder> is its installLocation in `claude plugin marketplace list --json`. Any other agent: `git clone --depth 1 https://github.com/ebenbaruk/tilt-client ~/.tilt/src` (`git -C ~/.tilt/src pull --ff-only` if it is already there); <folder> is ~/.tilt/src. If GitHub refuses, stop: my access to the repo is missing (invite not accepted, or git without credentials: `gh auth login`, then `gh auth setup-git`). Note `git -C <folder> rev-parse HEAD`.
3. Audit the code that will run, and confirm each point with file:line. Claude Code: <folder>/apps/mod. Others: <folder>/harnesses/<name> with its README.md, packages/play/src, apps/mod/hooks/{protocol,guards,keys,format,model}.ts, and harnesses/companion if the README uses it.
   - network calls only to the Tilt API URL;
   - the only command it runs opens the login URL in my browser;
   - files written only under ~/.tilt, plus the harness config the README tells you to edit (Claude Code: only its own plugin settings);
   - hook scripts never read stdin, and nothing reads my prompts, your replies, my code, tool calls or transcripts;
   - no install script, and nothing downloaded at run time.
   Flag anything else it can do and anything obfuscated. Give me a verdict with the commit you audited, and wait for my go.
4. On my go, ask me for the API URL from my invite (it must start with https://). Claude Code: `claude plugin install tilt@tilt --scope user`, check that `diff -r <folder>/apps/mod <installPath>` (installPath from `claude plugin list --json`) shows nothing but the .in_use marker, then `printf '%s\n' '{"apiUrl":"<url>"}' | claude plugin configure tilt@tilt --values-stdin`. Others: install exactly as <folder>/harnesses/<name>/README.md says, with <TILT_DIR> = ~/.tilt/src and the URL as TILT_API_URL or apiUrl, as it says.
5. Tell me how to start playing in this agent (its key or command, or the companion command to run in a split pane) and how to log in.
```

## Après le prompt

1. **Relance l'agent** (Claude Code ne charge le plugin et son réglage qu'au démarrage ; pour les autres, suis ce que dit `harnesses/<nom>/README.md`).
2. **Connexion** : `/tilt login` dans Claude Code, omp, pi, OpenCode, Copilot et DeepSeek Harness, `Tilt: login` dans Amp, `Ctrl+L` dans le panneau compagnon ; pour les autres agents, voir leur README. Tilt demande un code à l'api et ouvre `<TILT_WEB_URL>/connect` dans le navigateur (sinon, il affiche le lien et le code). Le code expire après 10 minutes.
3. **Sur la page web** : « log in to approve », connexion Privy par e-mail, Google ou X. Privy crée à la connexion un wallet Solana intégré (embedded wallet) pour chaque joueur. Tape le code affiché dans ton terminal (jamais un code reçu de quelqu'un d'autre), puis « approve this terminal ». Le mod reçoit une session de jeu seulement : elle peut jouer, jamais retirer.
4. **Dépôt** sur `<TILT_WEB_URL>/account` : la page montre l'adresse de ton wallet et l'USDC qu'il contient. Il te faut de l'USDC de test du coffre devnet sur ce wallet (voir « Ce qui manque encore »). Le premier dépôt doit atteindre un minimum affiché sur la page, dont une commission d'ouverture unique ; avant lui, tu approuves le signataire de Tilt sur ton wallet (il ne peut signer que les instructions de jeu de Tilt). Les retraits se font aussi sur cette page ; le mod ne déplace jamais d'argent.
5. **Jouer** (Claude Code) : envoie un prompt à l'agent, le panneau s'ouvre pendant qu'il travaille (ou tape `/tilt`). `ctrl+x tab` donne le clavier à la table, `Esc` le rend ; `1`–`4` change de jeu, `v`/`b` la mise, `n` donne ou lance. Toutes les touches : `apps/mod/README.md` (section « Use »). Ailleurs, la table s'ouvre dans l'agent ou dans le compagnon lancé dans un panneau à côté : touches et commandes dans `harnesses/<nom>/README.md`.
6. **Disposition** (Claude Code) : `/tilt setup` montre chaque choix avec un aperçu (côté, bas, compact ; taille des cartes ; ouverture automatique ; sons) et l'enregistre.

## Mise à jour et désinstallation

Pour mettre à jour, quel que soit l'agent, recolle le prompt : il récupère la nouvelle version, l'audite et attend ton feu vert avant de réinstaller. Ne fais jamais de `git pull` seul dans `~/.tilt/src` : les hooks et plugins exécutent directement ses fichiers, sans nouvel audit.

Pour Claude Code, la réinstallation passe par `claude plugin update tilt@tilt`, qui compare la `version` de `apps/mod/.claude-plugin/plugin.json` : tant qu'elle reste `0.1.0`, il répond « already at the latest version ». Dans ce cas, désinstalle puis réinstalle (étape 4 du prompt).

Désinstaller : déconnecte-toi d'abord (`/tilt logout` dans Claude Code ; les sessions se révoquent aussi depuis la page compte). Pour Claude Code, ensuite :

```sh
claude plugin uninstall tilt@tilt
claude plugin marketplace remove tilt
```

Pour les autres agents, suis la section « Uninstall » de `harnesses/<nom>/README.md`.

## Dépannage

- **`git ls-remote` ou `marketplace add` échoue (repository not found, authentication failed)** : invitation au dépôt non acceptée, ou git sans identifiants GitHub. `gh auth status`, puis `gh auth login` et `gh auth setup-git`, et relance le prompt.
- **Tilt dit qu'il ne joint pas l'api, ou la connexion échoue tout de suite** : URL de l'api fausse. Claude Code : `claude plugin configure tilt@tilt` montre les réglages ; corrige avec la commande `claude plugin configure` de l'étape 4, puis relance Claude Code. Autres agents : corrige `TILT_API_URL` ou `apiUrl` là où le README l'a mis, puis relance l'agent. Tilt n'accepte que `https` (le `http` simple seulement sur `localhost` / `127.0.0.1`).
- **La connexion refuse le lien de login** : Tilt n'ouvre l'URL de login que si elle est en `https` sur l'hôte de l'api ou sur son domaine parent (api `api.exemple.xyz` → web `api.exemple.xyz` ou `exemple.xyz`). Un web sur un autre domaine fait échouer le login : c'est à corriger côté hébergement, pas chez le testeur.
- **La page web dit « not available in your region »** : l'api refuse les pays de sa liste de blocage (dont la France par défaut) et, en production, les pays inconnus. À régler côté équipe pour le devnet de test.
- **« code not accepted »** : code expiré, déjà utilisé ou mal recopié. Relance la connexion.

## Ce qui manque encore côté équipe

- **Héberger api, relais et web sur devnet** et remplir `<TILT_API_URL>` / `<TILT_WEB_URL>`. Contraintes : api en `https` ; web sur le même hôte que l'api ou sur son domaine parent (sinon le mod refuse le lien de login et n'affiche pas le lien de dépôt) ; relais sur réseau privé ; `LANDING_ONLY` vide sur ce déploiement web (sinon toutes les pages hors landing redirigent vers `/`) ; app Privy de dev avec le domaine du web autorisé ; `WEB_URL` / `WEB_ORIGIN` de l'api pointant sur le web.
- **Géo-blocage** : la liste par défaut (`apps/api/src/config.ts`) bloque la France et d'autres pays où sont peut-être les testeurs, et la production exige un proxy edge (`EDGE_SECRET`, `TRUST_PROXY`) sinon le pays est inconnu, donc refusé. Il faut décider la config du déploiement de test (`BLOCKED_COUNTRIES`, edge) ; la page de connexion et l'approbation passent toutes deux par ce contrôle.
- **USDC de test pour les testeurs : aucun faucet n'existe.** Le coffre devnet utilise son propre mint de test, `JAybbeVX1MQn9NDBWsE1RH1zdLVwT4fSE9Df4ADTLCYk` (autorité de mint `6aEPgBvxq7QBzC4VZ8vL6epiXn24eHbPyq2sVZY93t2N`, lu sur devnet le 2026-10-28). Seule la personne qui détient cette clé peut en envoyer, à la main, sur l'adresse que le testeur lit sur `/account` :
  `cd chain && ANCHOR_WALLET=<clé> pnpm admin mint-test <adresse> <montant>` (refusé hors devnet, si la clé n'est pas l'autorité du mint, pour 0 ou plus de 10 000 USDC par appel).
  Le bouton « add funds by card » de `/account` vise l'USDC devnet de Circle (`4zMMC9…`), pas ce mint : sur devnet il ne crédite rien de déposable.
- **Mises à jour du mod** : `claude plugin update` a répondu « already at the latest version (0.1.0) » après un `marketplace update` ; sans incrément de `version` dans `apps/mod/.claude-plugin/plugin.json`, les testeurs ne reçoivent probablement rien (non vérifié avec un vrai changement).
- **Clé du réglage** : la CLI enregistre `apiUrl` sous `pluginConfigs."tilt@tilt".options` dans `~/.claude/settings.json`, alors que `apps/mod/README.md` et `docs/dev.md` (section 5) parlent de `pluginConfigs.tilt.options`. Le prompt passe par la CLI, donc il n'est pas touché ; ces deux docs sont à vérifier pour une install par marketplace.
- **Phantom** : il n'est pas branché (`apps/web/components/privy/PrivyProviders.tsx`). #18 le retire des pages qui l'annonçaient.
- **Mise à jour et audit** : à chaque changement du mod, monter sa `version`. Sinon `claude plugin update` ne fait rien, et à la relance du prompt la vérification « copie installée = copie auditée » échoue : l'agent s'arrête, ce qui est voulu.
