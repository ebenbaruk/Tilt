# Installer Tilt (testeurs invités)

Le testeur colle un prompt dans Claude Code, qui installe et règle le mod Tilt. Il redémarre Claude Code, tape `/tilt login`, se connecte sur le web, dépose et joue. Tout se passe sur devnet : l'argent est de l'USDC de test, sans valeur.

Deux valeurs sont à remplir par l'équipe avant d'envoyer ce document (partout où elles apparaissent) :

- `<TILT_API_URL>` : l'URL publique de `apps/api`, en `https`, sans `/` final.
- `<TILT_WEB_URL>` : l'URL publique de `apps/web`, sur le même hôte que l'api ou sur son domaine parent (voir « Dépannage »).

## Prérequis

- Un accès en lecture au dépôt privé GitHub `ebenbaruk/Tilt` (invitation acceptée).
- Une auth GitHub qui marche pour `git` : `git ls-remote https://github.com/ebenbaruk/Tilt.git HEAD` doit répondre sans erreur. Claude Code clone le dépôt en SSH si SSH est configuré pour GitHub, sinon en HTTPS. Avec la CLI GitHub : `gh auth login`, puis `gh auth setup-git`.
- Claude Code 2.1.287 ou plus récent (`claude --version`).
- Pas besoin de SOL : le relais Tilt paie les frais de transaction.

## Le prompt à coller

Colle ce bloc tel quel dans Claude Code. L'agent lancera les commandes `git` et `claude plugin` ci-dessous ; Claude Code te demande d'approuver chacune. Elles ne touchent qu'à ta config Claude Code (marketplace `tilt`, plugin `tilt@tilt`, son réglage `apiUrl`) et peuvent être relancées sans risque.

```text
Installe le mod Claude Code « Tilt » depuis le dépôt GitHub privé ebenbaruk/Tilt, puis règle son URL d'API. Lance les commandes une par une, exactement comme écrites. Si l'une échoue, arrête-toi, montre-moi la sortie et n'essaie pas de contournement (ne modifie pas ~/.claude/settings.json à la main, ne clone pas le dépôt ailleurs).

1. Vérifie les prérequis :
   - `claude --version` : la version doit être 2.1.287 ou plus. Sinon, arrête-toi et dis-moi de mettre Claude Code à jour.
   - `git ls-remote https://github.com/ebenbaruk/Tilt.git HEAD` : doit afficher un hash. Sinon, arrête-toi et dis-moi que mon accès GitHub au dépôt ne marche pas (invitation non acceptée, ou git sans identifiants : `gh auth login` puis `gh auth setup-git`).
   - L'URL d'API de l'étape 5 doit commencer par https://. Si ce n'est pas le cas, ou si elle contient encore « TILT_API_URL », arrête-toi : le document n'a pas été rempli par l'équipe.
2. Ajoute la marketplace (sans effet si elle est déjà là) :
   `claude plugin marketplace add ebenbaruk/Tilt`
3. Mets-la à jour (utile si elle était déjà ajoutée) :
   `claude plugin marketplace update tilt`
4. Installe le plugin pour mon utilisateur (sans effet s'il est déjà installé) :
   `claude plugin install tilt@tilt --scope user`
5. Règle l'URL de l'API (remplace la valeur précédente, garde les autres réglages) :
   `printf '%s\n' '{"apiUrl":"<TILT_API_URL>"}' | claude plugin configure tilt@tilt --values-stdin`
6. Vérifie :
   - `claude plugin list` doit montrer `tilt@tilt`, scope `user`, statut enabled.
   - `claude plugin configure tilt@tilt --json` doit montrer `"apiUrl": "<TILT_API_URL>"` dans `inputs`.
7. Dis-moi : « Tilt est installé. Quitte Claude Code et relance-le, puis tape /tilt login. »
```

## Après le prompt

1. **Relance Claude Code** (le plugin et son réglage ne sont chargés qu'au démarrage).
2. **`/tilt login`** : le mod demande un code à l'api et ouvre `<TILT_WEB_URL>/connect` dans le navigateur (sinon, le panneau affiche le lien et le code). Le code expire après 10 minutes.
3. **Sur la page web** : « log in to approve », connexion Privy par e-mail, Google ou X. Privy crée à la connexion un wallet Solana intégré (embedded wallet) pour chaque joueur. Tape le code affiché dans ton terminal (jamais un code reçu de quelqu'un d'autre), puis « approve this terminal ». Le mod reçoit une session de jeu seulement : elle peut jouer, jamais retirer.
4. **Dépôt** sur `<TILT_WEB_URL>/account` : la page montre l'adresse de ton wallet et l'USDC qu'il contient. Il te faut de l'USDC de test du coffre devnet sur ce wallet (voir « Ce qui manque encore »). Le premier dépôt doit atteindre un minimum affiché sur la page, dont une commission d'ouverture unique ; avant lui, tu approuves le signataire de Tilt sur ton wallet (il ne peut signer que les instructions de jeu de Tilt). Les retraits se font aussi sur cette page ; le mod ne déplace jamais d'argent.
5. **Jouer** : envoie un prompt à l'agent, le panneau s'ouvre pendant qu'il travaille (ou tape `/tilt`). `ctrl+x tab` donne le clavier à la table, `Esc` le rend ; `1`–`4` change de jeu, `v`/`b` la mise, `n` donne ou lance. Toutes les touches : `apps/mod/README.md` (section « Use »).
6. **Disposition** : `/tilt setup` montre chaque choix avec un aperçu (côté, bas, compact ; taille des cartes ; ouverture automatique ; sons) et l'enregistre.

## Mise à jour et désinstallation

Mettre à jour (puis relancer Claude Code) :

```sh
claude plugin marketplace update tilt
claude plugin update tilt@tilt
```

`claude plugin update` compare la `version` de `apps/mod/.claude-plugin/plugin.json` : tant qu'elle reste `0.1.0`, il répond « already at the latest version ». Dans ce cas, désinstalle puis réinstalle (étapes 4 et 5 du prompt).

Désinstaller : `/tilt logout` dans Claude Code d'abord (les sessions se révoquent aussi depuis la page compte), puis :

```sh
claude plugin uninstall tilt@tilt
claude plugin marketplace remove tilt
```

## Dépannage

- **`git ls-remote` ou `marketplace add` échoue (repository not found, authentication failed)** : invitation au dépôt non acceptée, ou git sans identifiants GitHub. `gh auth status`, puis `gh auth login` et `gh auth setup-git`, et relance le prompt.
- **Le panneau dit qu'il ne joint pas l'api, ou `/tilt login` échoue tout de suite** : `apiUrl` faux. `claude plugin configure tilt@tilt` montre les réglages ; corrige avec la commande de l'étape 5, puis relance Claude Code. Le mod n'accepte que `https` (le `http` simple seulement sur `localhost` / `127.0.0.1`).
- **`/tilt login` refuse le lien de connexion** : le mod n'ouvre l'URL de login que si elle est en `https` sur l'hôte de l'api ou sur son domaine parent (api `api.exemple.xyz` → web `api.exemple.xyz` ou `exemple.xyz`). Un web sur un autre domaine fait échouer le login : c'est à corriger côté hébergement, pas chez le testeur.
- **La page web dit « not available in your region »** : l'api refuse les pays de sa liste de blocage (dont la France par défaut) et, en production, les pays inconnus. À régler côté équipe pour le devnet de test.
- **« code not accepted »** : code expiré, déjà utilisé ou mal recopié. Relance `/tilt login`.

## Ce qui manque encore côté équipe

- **Héberger api, relais et web sur devnet** et remplir `<TILT_API_URL>` / `<TILT_WEB_URL>`. Contraintes : api en `https` ; web sur le même hôte que l'api ou sur son domaine parent (sinon le mod refuse le lien de login et n'affiche pas le lien de dépôt) ; relais sur réseau privé ; `LANDING_ONLY` vide sur ce déploiement web (sinon toutes les pages hors landing redirigent vers `/`) ; app Privy de dev avec le domaine du web autorisé ; `WEB_URL` / `WEB_ORIGIN` de l'api pointant sur le web.
- **Géo-blocage** : la liste par défaut (`apps/api/src/config.ts`) bloque la France et d'autres pays où sont peut-être les testeurs, et la production exige un proxy edge (`EDGE_SECRET`, `TRUST_PROXY`) sinon le pays est inconnu, donc refusé. Il faut décider la config du déploiement de test (`BLOCKED_COUNTRIES`, edge) ; la page de connexion et l'approbation passent toutes deux par ce contrôle.
- **USDC de test pour les testeurs : aucun faucet n'existe.** Le coffre devnet utilise son propre mint de test, `JAybbeVX1MQn9NDBWsE1RH1zdLVwT4fSE9Df4ADTLCYk` (autorité de mint `6aEPgBvxq7QBzC4VZ8vL6epiXn24eHbPyq2sVZY93t2N`, lu sur devnet le 2026-10-28). Aujourd'hui, seule la personne qui détient cette clé peut en envoyer, à la main, sur l'adresse que le testeur lit sur `/account`, par exemple :
  `spl-token create-account JAybbeVX1MQn9NDBWsE1RH1zdLVwT4fSE9Df4ADTLCYk --owner <adresse> --fee-payer <clé> --url devnet` puis `spl-token mint JAybbeVX1MQn9NDBWsE1RH1zdLVwT4fSE9Df4ADTLCYk <montant> --recipient-owner <adresse> --url devnet`.
  Le bouton « add funds by card » de `/account` vise l'USDC devnet de Circle (`4zMMC9…`), pas ce mint : sur devnet il ne crédite rien de déposable.
- **Mises à jour du mod** : `claude plugin update` a répondu « already at the latest version (0.1.0) » après un `marketplace update` ; sans incrément de `version` dans `apps/mod/.claude-plugin/plugin.json`, les testeurs ne reçoivent probablement rien (non vérifié avec un vrai changement).
- **Clé du réglage** : la CLI enregistre `apiUrl` sous `pluginConfigs."tilt@tilt".options` dans `~/.claude/settings.json`, alors que `apps/mod/README.md` et `docs/dev.md` (section 5) parlent de `pluginConfigs.tilt.options`. Le prompt passe par la CLI, donc il n'est pas touché ; ces deux docs sont à vérifier pour une install par marketplace.
- **Page de connexion** : elle annonce « email, Google, X or Phantom », mais Phantom n'est pas encore branché (`apps/web/components/privy/PrivyProviders.tsx`).
