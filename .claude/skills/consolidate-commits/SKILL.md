---
name: consolidate-commits
description: Consolidate a feature branch's commits into the minimum number of valuable commits with no add-then-undo churn, verifying the final tree is byte-identical. Use whenever the user asks to clean up, consolidate, squash, restructure, or curate a branch's commits, wants "reviewable commits" before landing or opening a PR, or complains that a branch's history is messy or has churn — even if they don't say "squash".
---

# Consolidate Branch Commits

Restructure the current branch's commits (`main..HEAD`) into the best-organized set of commits, judged on four criteria in tension:

- **Minimum count** — every commit must earn its place; iterations on unshipped work are fixups, not history.
- **Mergeability** — each commit leaves the repo in a plausible building state, so any prefix of the branch could land (and bisect lands on real boundaries).
- **Reviewability** — a commit is sized and scoped so a reviewer can hold it: one story per commit, told once.
- **Separation of concerns** — don't fuse unrelated concerns just to shrink the count; a commit that mixes a parser fix with a UI redesign is worse than two clean commits. When minimum-count and concerns pull apart, concerns win. The test for whether a split is real: each piece must be able to answer "why do I exist" **on its own**. If the parts only make sense together — none is motivated without the rest — that's one changeset wearing several hats, and it should be one commit no matter how many files or layers it touches.

And two hard properties that are never traded away:

1. **One path through the history** — the branch tells a single line of development. No commit introduces an approach that a later commit undoes or significantly redirects; a reader stepping commit-by-commit watches each concern built once, in its final direction. _Building on_ earlier work is exactly what history is for — extending an API, adding cases, layering features. _Replacing_ earlier work is churn: if commit 3 lays out design A and commit 7 rips it out for design B, squash them (or restructure) so only B's construction is visible. This covers both literal add-then-undo (lines added then deleted) and approach churn where the rewrite shares few literal lines with what it replaced.
2. **Byte-identical result** — consolidation only rewrites history; the final tree must exactly match the branch tip before you started. This is what makes the whole operation safe to verify mechanically.

## What makes a commit worth keeping separate

Keep a commit standalone when it has independent life:

- **A fix for a bug that exists on the base branch** — it can be cherry-picked or bisected to without the feature. Only valid if its diff _survives verbatim_ to the branch tip (verify below); if later commits rewrote its mechanism, fold it in.
- **A pure package/foundation commit** (e.g. new primitives in `packages/*` with their tests) — self-contained, testable at its own boundary, keeps per-package history clean.
- **A distinct concern** — a self-contained unit whose review benefits from isolation, even when it could technically squash into a neighbor.

Everything else — refinement commits, "fixes from testing", chrome tweaks to code a later commit rewrites — folds into the commit it refines.

## Step 1 — Inventory and audit

```bash
git log --format='=== %h%n%B' main..HEAD   # full messages
git log --oneline --stat main..HEAD        # per-commit files
```

Then hunt add-then-undo pairs. For each early commit `C` and the tip `T`:

```bash
# lines later work removes from files C touched — non-empty output = churn
git diff C T -- <files C touched> | grep "^-" | grep -v "^---"
```

Interpret what you find — removal of lines that _main_ had is fine; removal of lines _C added_ is the churn you're eliminating. For a keep-candidate fix, confirm its added lines survive verbatim in the tip (grep the tip's file for them). Also check nothing was deleted outright: `git diff --diff-filter=D --name-only <base> <tip>`.

The line audit misses **approach churn** — a redesign shares few literal lines with what it replaced, so the diff shows adds and removes that never intersect. Catch it by reading, not diffing: for commits that touch the same area, ask whether the later one _builds on_ the earlier one's approach or _replaces_ it. "Adds X", then "Redesigns X" or "Reworks X into Y", is a replace — one path means only the final construction survives as history.

## Step 2 — Plan the groups

Work the criteria in order: first draw concern boundaries (which commits belong to which story), then squash within each concern until it reads as one path, then check each result for mergeability (builds at its boundary) and review size. Only merge across concerns when one of them is too small to stand alone.

- Groups must be **contiguous** runs of commits — reordering non-adjacent commits invites conflicts and, worse, silent content drift.
- Exception that costs nothing: when a file's entire evolution on the branch is confined to identifiable commits, you may promote that file's **final state** into the earliest commit that touches it (e.g. a utils module refined by a later commit — finalize it in the foundation commit so nothing downstream rewrites it). The intermediate state must still be coherent (its tests move with it).
- Each resulting commit should leave the repo in a plausible building state — bisect lands on these boundaries.
- If the squash would merge changes a later _kept_ commit undoes, enlarge the group until the undo pair is inside one commit.

## Step 3 — Execute (never interactive rebase, never stash)

`git rebase -i` is unavailable in this environment, and the stash stack is shared across worktrees — use commits and cherry-picks only:

```bash
git branch backup/pre-consolidate                 # safety ref
git add <uncommitted files> && git commit --no-verify -m "WIP (drop me)"   # shield uncommitted work
git checkout --detach <last-kept-commit>
git cherry-pick -n <c1> <c2> <c3>                 # a squash group…
git commit --no-verify -m "<new message>"          # …becomes one commit
# For the FINAL group (everything remaining), skip cherry-picks entirely:
git checkout <old-tip> -- .                        # stage the final tree wholesale
git commit --no-verify -m "<new message>"
git checkout -B <branch>                           # move the branch here
git checkout <WIP-sha> -- <uncommitted files> && git reset -q <files>   # restore uncommitted
```

`--no-verify` is safe here: the content already passed hooks when originally committed. The `checkout <old-tip> -- .` shortcut is only valid for the terminal group and only when the deletions check in Step 1 came back empty.

To amend a kept commit with a promoted file's final state: detach at it, `git checkout <old-tip> -- <paths>`, `git commit --amend`.

## Step 4 — Verify (non-negotiable)

```bash
git diff backup/pre-consolidate HEAD     # MUST be empty — trees identical
```

If it isn't empty, something was lost or invented — do not rationalize the diff; return to the backup (`git reset --hard backup/pre-consolidate`) and redo. Then:

- Re-run the Step 1 undo audit across the new commits (every pair should come back clean).
- Run the cheap relevant test suites for touched packages (GitLens: `pnpm --filter '<package>' run test`).
- Only after the empty-diff proof, delete the backup branch. No rebuild is needed — the tree content is unchanged.

If the branch has been **pushed**, consolidation is a history rewrite for everyone downstream — surface that and get explicit confirmation before starting.

## Messages

Follow the repo's commit conventions — in GitLens, the `/commit` skill; everywhere, Eric's global rules (subject: third-person present, concrete artifact; body: `- ` bullets, need-to-know only; **no trailers**; match the surrounding repo's verb set via `git log`). A squashed commit's message describes the **final state as of that commit** — merge the group's bullets, and drop any fact a later commit in the group superseded (don't document the 9-key layout the same commit's final content replaced with 8).
