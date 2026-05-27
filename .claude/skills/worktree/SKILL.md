---
name: worktree
description: Use when starting feature work that needs isolation from current workspace or before executing implementation plans - creates isolated git worktrees following GitLens conventions
---

# GitLens Worktree Creation

This project uses a custom worktree convention: worktrees live in a sibling `<repo-name>.worktrees/` directory (the layout the `worktree.mts` hook in `.claude/settings.json` is built around), **not** in the `EnterWorktree` default location.

Because of that, the flow has two steps:

1. **Create** the worktree with `git worktree add` following the convention below (so it lands in the sibling `.worktrees/` dir with the right name).
2. **Switch into it** by calling the built-in `EnterWorktree` primitive with `path`. This moves the session's working directory into the worktree — a plain `cd` in Bash does not.

> **Do not** call `EnterWorktree` with `name` to create the worktree. Inside a git repo it ignores the hook and places the worktree in `.claude/worktrees/` (which is not gitignored) on a branch off `origin/main`, breaking this project's convention. Always create first, then enter by `path`.

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

## Creating and Entering a Worktree

```bash
# 1. Find the worktrees root
REPO_ROOT=$(git rev-parse --path-format=absolute --git-common-dir | sed 's|/.git$||')
REPO_NAME=$(basename "$REPO_ROOT")
WORKTREES_ROOT="$REPO_ROOT/../$REPO_NAME.worktrees"

# 2. Create the worktree (branch path segments map to directory nesting)
git worktree add "$WORKTREES_ROOT/<type>/<name>" -b "<type>/<name>"

# 3. Install dependencies
pnpm install --dir "$WORKTREES_ROOT/<type>/<name>"
```

Then switch the session into it with the **`EnterWorktree`** primitive, passing the path you just created:

```
EnterWorktree({ path: "<absolute path to $WORKTREES_ROOT/<type>/<name>>" })
```

`EnterWorktree` requires an absolute path that already appears in `git worktree list` — which is why creation comes first. After this, all subsequent tool calls run inside the worktree.

## Leaving a Worktree

When the work is done (or you need to return to the original repo), call **`ExitWorktree`**:

```
ExitWorktree({ action: "keep" })
```

Use `action: "keep"` — `ExitWorktree` will **not** remove a worktree that was entered by `path` (only ones it created via `name`), so `keep` is the correct, non-destructive choice here. The worktree and its branch stay on disk; remove them later with `git worktree remove` if needed.

## Setup Notes

- Skip test baseline verification — builds are expensive in this project; verify after implementation instead.

## Key Differences from Default Superpowers Skill

- Worktrees are **outside** the repo (sibling `.worktrees/` directory), not inside
- No `.gitignore` verification needed — the directory is outside the repo
- Create with `git worktree add` first, then enter via `EnterWorktree({ path })` — never create with `EnterWorktree({ name })` (it bypasses the convention)
- Skip test baseline (build is too slow for setup)
