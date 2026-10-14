# Git workflow (every agent, every session)

Read this before any git or GitHub action in this repo. The goal: `main` always works, every change is reviewable, and nothing stale lies around (no dead branches, no forgotten PRs, no stashes).

## Start of a session

```sh
git switch main && git pull --ff-only && git fetch --prune
git branch -vv          # local branches; "[gone]" means the remote branch was deleted
gh pr list --state open # what is waiting for review
```

Clean up what is yours (see "After a merge"). Never delete another person's branch or unmerged work: ask them.

## One task, one branch

- Branch from an up-to-date `main`: `git switch -c <owner>/<topic>` (`armand/vrf-retry`, `eli/mod-setup`).
- One concern per branch. Unrelated fix? Another branch.
- Stay in your zone (CLAUDE.md, spec §8). `packages/contract` needs both people.

## While working

- Small commits, imperative subject (`Add split to blackjack`), the why in the body when it isn't obvious.
- Stage files by name. Never `git add -A` blindly: no `.env*`, keys, build output, `node_modules`, logs.
- Before pushing: the tests, linter and type checker of what you touched pass (docs/dev.md §3).
- Keep the branch fresh: `git fetch && git rebase origin/main`. Rebase your own branch only; never rewrite `main` or someone else's branch.

## Pull request

- `git push -u origin <branch>`, then `gh pr create` with a short summary, how it was tested, and the `Sécurité :` line.
- PRs touching money, the contract, sessions, RNG or rate limits need both Eli and Armand.
- Answer review comments with new commits; don't open a second PR for the same change.

## After a merge (do it right away)

```sh
gh pr merge <n> --squash --delete-branch   # or merge from GitHub, then delete the branch there
git switch main && git pull --ff-only
git branch -d <branch>                     # local copy
git fetch --prune                          # forget deleted remote branches
```

## Abandoned or superseded work

- Close the PR and delete its branch, with a one-line reason: `gh pr close <n> --delete-branch --comment "Superseded by #<m>"`.
- A branch with no PR and no commit for two weeks: open a PR or delete it. Ask its owner first if it isn't yours.
- Drop old stashes (`git stash list`, `git stash drop`) and worktrees you made (`git worktree list`, `git worktree remove`).

## Never

- Force-push `main`, or push secrets anywhere (if one slips in: tell Eli and Armand, rotate it; deleting the commit is not enough).
- Make the repo public.
- Leave a session with uncommitted changes nobody knows about: commit to your branch, or say what is left.
