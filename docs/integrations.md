# Intégrer Tilt dans les outils de code IA

Recherche faite le 2026-10-12, d'après les docs officielles. Non testé en conditions réelles sauf mention contraire.

**Décision :** on part sur **Claude Code CLI** (mod), qui couvre aussi l'onglet Code de l'app Desktop.

## Résumé

| Surface | Jeu interactif possible ? | Technique |
| --- | --- | --- |
| Claude Code CLI (terminal) | ✅ Oui | Mod Claude Code |
| Claude Desktop, onglet Code | ✅ Oui (quelques éléments réservés au terminal) | Même mod |
| Claude Desktop / claude.ai, onglet Chat | ✅ Oui, autre format | MCP App (UI web dans la conversation) |
| Claude Desktop, onglet Cowork | ⚠️ Non confirmé | Plugins Cowork : skills, connecteurs, hooks ; pas de mods |
| Claude Code sous `claude -p`, Agent SDK, VS Code, WSL, cloud | ❌ Non | Les hooks tournent mais rien ne s'affiche |
| Codex CLI (TUI) | ❌ Non | Aucune surface d'UI pour les extensions |
| Codex dans l'app Desktop | ⚠️ Non confirmé | Plugin Codex + MCP App (le protocole le permet) |
| ChatGPT (Chat / Work) | ✅ Oui | Plugin / MCP App |
| Extension IDE Codex | ❌ Non | Ne prend pas en charge les plugins |

## Claude Code : les mods

Un mod est un plugin Claude Code (TypeScript) qui dessine dans l'interface et lit le clavier. Il faut Claude Code ≥ v2.1.287 en terminal, ≥ v2.1.286 dans le Desktop.

Correspondance avec la maquette :

| Élément | Comment |
| --- | --- |
| Panneau TILT | `Pane` (panneau) ou bande `AbovePrompt` au-dessus du prompt |
| Touches `H`/`S`/`D`, `1`/`2`/`3` | `Button` avec `hotkey` (un chiffre ou une lettre minuscule) |
| « agent finished in 6m 14s » | Événements `turn.start` / `turn.complete` + chrono |
| Leaderboard, sponsor en direct | Requêtes réseau vers notre backend, rafraîchissement via `$.clock` |
| Lancement | Commande `/tilt` |
| Installation | `/plugin install tilt --marketplace <owner>/<repo>` |

Limites :
- **Focus clavier :** le panneau doit avoir le focus (ouverture avec `focus`, ou `Ctrl+X Tab`). Tant qu'on écrit dans le prompt, les touches vont au prompt.
- **Touches réservées :** Tab et les flèches ne sont pas disponibles (les docs suggèrent w/a/s/d pour les jeux).
- **Confiance :** un mod tourne avec les droits de l'utilisateur et voit tous les prompts et appels d'outils. Il faudra rassurer les utilisateurs.
- Les docs mentionnent un « kill switch » distant pour les mods.

Autres points d'extension (sans saisie clavier) :
- **Hooks** (33 événements : `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, …), utilisables aussi en mode async.
- **Status line :** sortie texte multi-lignes avec couleurs, mais pas d'entrée clavier, et un plugin ne peut pas la définir.

Sources : [mods overview](https://code.claude.com/docs/en/plugins/mods/overview), [mods interface](https://code.claude.com/docs/en/plugins/mods/interface), [hooks](https://code.claude.com/docs/en/hooks), [statusline](https://code.claude.com/docs/en/statusline), [headless](https://code.claude.com/docs/en/headless).

## Claude Chat et Cowork : MCP Apps

- **Chat :** une MCP App est un serveur MCP qui affiche une interface web interactive dans la conversation (en ligne, plein écran ou incrustée). Ça marche sur le web, le Desktop et le mobile ; sur mobile, il faut d'abord ajouter le connecteur sur le web ou le Desktop.
- **Réseau :** les domaines externes sont bloqués par défaut ; on les autorise avec `_meta.ui.csp.connectDomains`.
- **Format :** les consignes d'Anthropic préfèrent des tâches « avec un début et une fin claire » plutôt que des interfaces qui restent ouvertes longtemps. Le jeu prendrait plutôt la forme « une main, une carte ».
- **Cowork :** charge skills, commandes, agents, hooks et serveurs MCP. Les mods n'y sont pas, et l'affichage des MCP Apps n'est pas confirmé.

Sources : [connectors](https://claude.com/docs/connectors/overview), [MCP Apps design guidelines](https://claude.com/docs/connectors/building/mcp-apps/design-guidelines), [Cowork plugins](https://claude.com/docs/cowork/guide/plugins.md).

## Codex

- **Plugins :** ils peuvent contenir des skills, des serveurs MCP (avec UI optionnelle), des extensions navigateur et des hooks. Ils fonctionnent dans ChatGPT, dans Codex (app Desktop) et dans Codex CLI via `/plugins`. Les hooks dans un plugin ne marchent qu'en installation manuelle dans le Desktop, et un plugin avec hooks ne peut pas être listé dans l'annuaire.
- **TUI :** aucune surface d'UI. La status line n'accepte qu'une liste d'éléments fixes ; les hooks n'affichent que du texte (`statusMessage`, `systemMessage`).
- **Hooks Codex :** `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, … configurés dans `~/.codex/hooks.json`, `<repo>/.codex/hooks.json` ou `config.toml`. L'utilisateur doit approuver chaque hook dans `/hooks`.

Contournements possibles pour le terminal :
1. **Panneau à côté :** le jeu tourne dans un split (tmux, Ghostty), alimenté par les hooks Codex.
2. **Notre propre interface :** on pilote Codex via `codex app-server` (JSON-RPC) ou le SDK `@openai/codex-sdk`, et on affiche le chat et le jeu ensemble.
3. **Un fork :** la licence Apache-2.0 l'autorise, mais le code évolue très vite.

Sources : [Codex hooks](https://developers.openai.com/codex/hooks), [Codex plugins](https://developers.openai.com/codex/plugins), [app-server](https://developers.openai.com/codex/app-server), [repo](https://github.com/openai/codex).

## Règles des plateformes (point bloquant)

- **Anthropic :** l'annuaire (Software Directory Policy §4) refuse les logiciels qui affichent de la publicité ou du contenu sponsorisé, ou qui existent surtout pour ça. Il refuse aussi ceux qui transfèrent de l'argent. Les CGU de Claude Code et l'AUP n'ont pas de clause sur les jeux, mais l'AUP interdit le contenu sponsorisé non signalé : il faut afficher clairement « Presented by ».
- **OpenAI :** pas de publicité dans les plugins. Le jeu d'argent réel, les crédits de casino et les tokens de crypto-casino sont interdits, ce qui exclut la version Solana chez eux.
- **Conséquence :** avec le panneau sponsor, on ne passe probablement pas dans les annuaires officiels. On distribue en dehors : marketplace GitHub pour le mod, connecteur personnalisé par URL pour une MCP App, installation manuelle pour un plugin Codex.

Sources : [Anthropic Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy), [review criteria](https://claude.com/docs/connectors/building/review-criteria.md), [OpenAI Apps SDK guidelines](https://developers.openai.com/apps-sdk/llms-full.txt).

## Architecture suggérée

Séparer la logique du jeu (règles, état, backend : RNG côté serveur, comptes, leaderboard) de l'affichage, pour réutiliser le même moteur dans le mod Claude Code puis dans une éventuelle MCP App ou un panneau Codex.
