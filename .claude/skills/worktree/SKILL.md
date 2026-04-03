---
name: worktree
description: Use when starting feature work that needs isolation from current workspace or before executing implementation plans - creates isolated git worktrees following GitLens conventions
---

# GitLens Worktree Creation

This project uses a custom worktree convention. The `WorktreeCreate` and `WorktreeRemove` hooks in `.claude/settings.json` handle automatic worktree creation. This skill documents the conventions for manual worktree operations.

## Directory Convention

Worktrees live in a **sibling directory** to the main repo, named `<repo-name>.worktrees/`:

```
vscode-gitlens/                          # Main repo
vscode-gitlens.worktrees/                # Worktrees root
├── debt/
│   ├── library/                         # Branch: debt/library
│   ├── library+<session-id>+agent-x/    # Agent worktree from debt/library
│   └── refactor-home/                   # Branch: debt/refactor-home
├── feature/
│   ├── ai-chat/                         # Branch: feature/ai-chat
│   └── graph-actions/                   # Branch: feature/graph-actions
└── bug/
    └── graph-performance/               # Branch: bug/graph-performance
```

Agent worktrees use `+` delimiters: `<branch>+<session-id>+<agent-name>`. This keeps them as siblings to the parent worktree (not nested inside it), groups them by conversation session, and makes it easy to trace back to the originating session.

Branch path segments map directly to directory nesting (e.g., `debt/library` -> `debt/library/`).

## Branch Naming

Follow the conventions in AGENTS.md:

| Type       | Prefix       | Example                                 |
| ---------- | ------------ | --------------------------------------- |
| Feature    | `feature/`   | `feature/search-natural-language`       |
| Bug fix    | `bug/`       | `bug/graph-performance`                 |
| Tech debt  | `debt/`      | `debt/library`                          |
| With issue | include `#N` | `feature/#1234-search-natural-language` |

## Manual Worktree Creation

When creating a worktree manually (not via the hook):

```bash
# 1. Find the worktrees root
REPO_ROOT=$(git rev-parse --path-format=absolute --git-common-dir | sed 's|/.git$||')
REPO_NAME=$(basename "$REPO_ROOT")
WORKTREES_ROOT="$REPO_ROOT/../$REPO_NAME.worktrees"

# 2. Create the worktree
git worktree add "$WORKTREES_ROOT/<type>/<name>" -b "<type>/<name>"

# 3. Install dependencies (automatic when using the hook)
cd "$WORKTREES_ROOT/<type>/<name>"
pnpm install
```

## Setup After Creation

The `WorktreeCreate` hook automatically runs `pnpm install` in the new worktree. No manual setup is needed. Skip test baseline verification — builds are expensive in this project; verify after implementation instead.

## Key Differences from Default Superpowers Skill

- Worktrees are **outside** the repo (sibling `.worktrees/` directory), not inside
- No `.gitignore` verification needed — the directory is outside the repo
- Skip test baseline (build is too slow for setup)
