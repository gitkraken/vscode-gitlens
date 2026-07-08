# Plan: Expand inline recompose (worktree-aware + create-worktree + merge ranges)

> The original "route compose entry points to graph inline compose" work is **SHIPPED** on `feature/graph-compose-entrypoints` (squashed commit `a6c69966c`; full history at `backup/pre-squash-graph-compose`). This plan is the **follow-on** feature.
>
> **Full self-contained handoff doc:** `.work/dev/recompose-expansion/HANDOFF.md` — Parts 1 (what shipped), 2 (behavior + the key findings), 3 (this plan in detail), plus verification notes and a key-file map.

## Context

After shipping, recompose from the graph stays inline only for the **checked-out primary** branch with a HEAD-ending, merge-free range; everything else falls back to the standalone composer. Two verified findings reframe this:

1. The standalone composer **can't actually apply** a non-checked-out recompose either (the compose-tools library's `rewrite-range` requires HEAD at the branch tip; the standalone doesn't check out). So the fallback is largely a dead end, and inline v1 is at parity with what actually works.
2. Merges are **flattened, not preserved** by the library (and by the standalone) — merge support is blocked only by a **graph-side** first-parent validation, not by the library.

Goal: keep recompose inline for any branch that has (or can get) a worktree, and consume merge ranges — making the standalone composer fully redundant for recompose.

## Approach (3 parts)

### A. Worktree-aware inline recompose — _low risk, caller-level_

In `src/commands/recomposeBranch.ts` and `recomposeFromCommit.ts`, before `resolveRecomposeScope`: look up `getBranchWorktree(container, branch)` (`src/git/utils/-webview/branch.utils.ts:266`). If found (primary or secondary worktree), resolve against **that worktree's** service (`container.git.getRepositoryService(worktree.uri.fsPath)`) and set `target.worktreePath = worktree.path`. Everything downstream already works (verified): `onShowing` repo-switch, secondary WIP-row synthesis (`getWipMetadataBySha`), and the compose IPC service resolution. No `graphWebview.ts` / resolver-signature / engine changes.
Injection points: `recomposeBranch.ts` between `:95` (remote-only guard) and `:102` (resolve); `recomposeFromCommit.ts` between `:90` and `:94`. For a **primary**-worktree branch `worktree.path === repo.path`, so today's code is already correct there — the gap is secondary worktrees + bare refs.

### B. Create-worktree for bare refs — _low-medium risk, caller-level_

When `getBranchWorktree` returns `undefined`: show a **simple confirm modal** ("Branch X isn't checked out — create a worktree to recompose it?"), then `WorktreeActions.create(repoPath, undefined, getReferenceFromBranch(branch))` (`src/git/actions/worktree.ts:13`; `getReferenceFromBranch` at `src/git/utils/-webview/reference.utils.ts:28`) — returns the created `GitWorktree` or `undefined` (cancelled). On success, recompose inline anchored on the new worktree; on cancel, stop (no composer). Prior art: `src/commands/ghpr/openOrCreateWorktree.ts:115-133`. Only the interactive wizard exists (no non-interactive create helper).

### C. Merge-range support — _engine change small; picker UX is the real work_

1. Replace the first-parent walk in `resolveGraphScope` (`src/webviews/plus/graph/compose/integration.ts:569-597`, the two throws) with a `base..head` endpoint computation (`from = oldest selected`, `to = HEAD`, `rewriteFromSha = parent(from)`); reference `resolveOldestInRange` (`composerWebview.ts:1087`). `scopeToComposeSource` (`:607-657`) is already endpoint-based.
2. Relax `resolveRecomposeScope`'s own first-parent walk (`recomposeScope.ts:34-55`, thrown `:151`) for the command path.
3. Surface the library's **`rewrite-range` interior-fork / interior-ref** failures in the compose UI (the real validity boundary; `compose-tools/dist/git/safety-range.js`) — today they'd surface as a generic compose error.
4. Fix the latent bug the relaxation repairs: `buildDefaultScope` (`detailsWorkflowController.ts:2155`) + late re-derive (`detailsActions.ts:2452`) currently throw on a branch with an **unpushed merge** (default `includeShas` isn't first-parent-contiguous).
5. **Picker UX (open decision):** `gl-commits-scope-pane` (`:44`, `:264-268`, `:351-358`) models a contiguous index slice with two drag handles — a merge DAG has no total order. v1 = keep the flattened-log picker (merges already show as unlabeled rows) + rely on the library's interior-fork check + surface errors; polish = label merges / validate the slice up front.

## Sequencing

A → B (both caller-level, ship together — they alone eliminate the standalone for worktree/creatable branches) → C (separate, larger; needs the picker-UX decision).

## Verification

- Build: `pnpm run build` (runs check first). Tests: `DISPLAY=:0 npx vscode-test --run out/tests/.../recomposeScope.test.js` etc. — dead SSH `DISPLAY=localhost:10.0` hangs the runner; use `:0` or unset so Xvfb auto-starts.
- Live (vscode-inspector, self-managed Xvfb): crafted test repo + `execute_command gitlens.plus.simulate.subscription [{state:'Paid',planId:'pro',dismissOnboarding:true}]`. For this feature add a **secondary worktree** (A), a **bare-ref branch** (B), and a branch with an **unpushed merge** (C).
- Per part: A → recompose a secondary-worktree branch → inline anchored on its WIP row (no composer). B → recompose a bare ref → confirm modal → create wizard → inline in the new worktree. C → recompose a merge-containing range → inline (flattened output), and an interior-fork range → clear error (not a generic failure).
