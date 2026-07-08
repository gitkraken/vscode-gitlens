# Compose → Graph Inline Compose — Work Summary & Handoff

**Branch:** `feature/graph-compose-entrypoints` (worktree: `vscode-gitlens.worktrees/feature/graph-compose-entrypoints`)
**Shipped work:** squashed to a single commit `a6c69966c` on top of `main` (`ff6656ccd`).
**Full history backup:** branch `backup/pre-squash-graph-compose` = `3c47e5b38` (the original 14 commits, if you want to re-split with `git rebase -i`).
**Status:** shipped part is merge-ready (all reviews clean, build + unit tests green, live-verified). Not pushed. A follow-on feature is designed below but **not implemented**.

---

## Part 1 — What shipped

Goal: **route every compose entry point to the Commit Graph's inline compose mode instead of the standalone Composer webview**, and add inline commit-range ("recompose") support.

### Phase 1 — WIP compose entries → inline

- `gitlens.composeCommits` (palette + `:scm`), tree views, Home, Welcome, Walkthrough, and the MCP/GK-CLI tool now open the graph via `gitlens.showGraph { action: 'enter-compose' }` (mirrors `ResolveConflictsCommand`). AI instructions ride through as a **seed-only** `composeInstructions`.
- Dead compose UI removed (the never-rendered `gl-details-wip-panel` compose button; the dormant `compose-open-composer` listener + `openComposer` action). Compose menus gated on `gitlens:ai:allowed`.
- Key files: `src/commands/composer.ts`, `src/commands/welcome.ts`, `src/commands/walkthroughs.ts`, `src/env/node/gk/cli/commands.ts`, `contributions.json`.

### Phase 2 — inline commit-range compose

- New host resolver `src/plus/coretools/compose/recomposeScope.ts`: `resolveRecomposeScope(container, svc, request)` + a pure, unit-tested `coverContiguousFromHead`. Turns a branch / range / commit-selection into a validated **first-parent-contiguous** sha set ending at HEAD.
- Protocol: `GraphComposeScopeSeed { shas, includeWip }` threaded through `showGraph` → `onShowing` → `State.pendingAction` → `graph-app.consumePendingAction` → panel `enterModeForWip` → controller `enterComposeWithScope`. (Mirrors the `composeInstructions` plumbing.)
- Webview seeds `state.scope.includeShas` and enters compose anchored on the WIP row; `ensureBranchCommitsCover` pages the picker to cover the range. `scope.kind` telemetry; pushed-commit warning.
- Key files: `protocol.ts`, `registration.ts`, `graphWebview.ts`, `stateProvider.ts`, `graph-app.ts`, `gl-graph-details-panel.ts`, `detailsWorkflowController.ts`, `detailsActions.ts`, `gl-details-compose-mode-panel.ts`, `constants.telemetry.ts`.

### Phase 3 — recompose reroutes

- `recomposeBranch`, `recomposeFromCommit`, and the rebase editor resolve their range and open inline compose when possible, **falling back to the standalone composer** otherwise. The graph's own recompose context menus inherit this (they delegate to those base commands — no `graphWebview.ts` menu change needed).
- Key files: `src/commands/recomposeBranch.ts`, `src/commands/recomposeFromCommit.ts`, `src/webviews/rebase/rebaseWebviewProvider.ts`.

### Live-exercise pass (3 bugs found & fixed — all re-verified live via vscode-inspector)

- **F1** (`91fe8b01f` in backup): WIP-compose entries landed on the _unpushed-commits_ scope on cold load. Fix: the late `fetchBranchCommits` scope re-derivation now mirrors `buildDefaultScope`'s full priority (working/staged → unpushed → HEAD). `detailsActions.ts`.
- **F2** (`48e568176`): a recompose invoked while already idle-composing dropped the seed. Fix: `enterModeForWip`'s `composeScope` branch runs before the re-click guard; `enterComposeWithScope` switches scope **in place** when idle, **preserves** an already-started plan. `gl-graph-details-panel.ts`, `detailsWorkflowController.ts`. + regression test.
- **pushed-warning** (`c2d5a6f68`): only rendered in `renderPlan()` (ready state); hoisted to the top of `render()` so it shows in the idle picker too. `gl-details-compose-mode-panel.ts`.

### The standalone composer webview stays registered as a **dormant fallback** (no user-facing entries except the Phase-3 recompose fallback).

---

## Part 2 — Current behavior & the boundary that prompted the follow-on

| Flow                                                                                 | Result                |
| ------------------------------------------------------------------------------------ | --------------------- |
| WIP compose entries (palette/SCM/views/Home/Welcome/Walkthrough/MCP)                 | **inline** ✅         |
| Recompose on the **checked-out (primary)** branch, range ends at HEAD, **no merges** | **inline** ✅         |
| Recompose of a branch checked out in a **secondary worktree**                        | standalone (fallback) |
| Recompose of a **bare ref** (no worktree)                                            | standalone (fallback) |
| Recompose range containing a **merge**                                               | standalone (fallback) |
| Rebase-editor recompose (HEAD often detached mid-rebase)                             | standalone (fallback) |

**The reframing finding (verified):** the standalone composer does **NOT actually support** applying a non-checked-out recompose. The `@gitkraken/compose-tools` library's `rewrite-range` apply requires _"HEAD non-detached and at the source's tip"_ (`node_modules/@gitkraken/compose-tools/dist/workflows/compose.d.ts:276-277`), and the standalone applies against the **primary** repo service without checking out. So it opens for a non-checked-out branch but would **fail at commit time**. → The inline v1 is already at parity with what the standalone can actually _apply_; the standalone fallback for these cases is largely a dead end.

**Also verified:** the composer webview does **not** let you refine a range after it opens — only shift-click a contiguous _subset_ of the pre-loaded commits (`app.ts:978-1005`). The graph's inline scope picker (`gl-commits-scope-pane`, start/end handles) is at parity. And **merges are flattened, not preserved** by both the composer and the library — the library takes the net `diffTree(parent(from), to)` and the AI re-partitions it into a fresh linear chain.

---

## Part 3 — Follow-on feature (DESIGNED, NOT IMPLEMENTED)

**Goal:** make recompose stay inline for _any_ branch that has (or can get) a working tree, and consume merge-containing ranges — so the standalone composer becomes fully redundant for recompose.

Three parts (A and B are ready to build; C needs a picker UX decision):

### A. Worktree-aware inline recompose _(caller-level; low risk)_

Today `recomposeBranch.ts` / `recomposeFromCommit.ts` resolve against the **primary** `repo.git` and pass `worktreePath: repoPath`, so a secondary-worktree branch fails `resolveRecomposeScope` (`getBranch()` ≠ requested branch → `not-checked-out`) and falls back.

**Fix — inject into both command callers, before `resolveRecomposeScope`:**

1. `const branch = await repo.git.branches.getBranch(branchName)` (already fetched).
2. `const worktree = await getBranchWorktree(this.container, branch)` — `src/git/utils/-webview/branch.utils.ts:266`. Returns the branch's worktree (**primary or secondary**); `undefined` for a bare ref.
3. If found: resolve against `this.container.git.getRepositoryService(worktree.uri.fsPath)` and set `target.worktreePath = worktree.path`.

**Everything downstream already works** (verified): `onShowing` switches the graph to the worktree repo via `getOrAddRepository(Uri.file(target.worktreePath), { opened: false })` (`graphWebview.ts:3247`); secondary WIP rows are synthesized from a pure git enumeration independent of "surfaced/opened" state (`getWipMetadataBySha`, `graphWebview.ts:8236`); the compose IPC resolves its service from the anchor's `repoPath` (`graphWebview.ts:1939`). No changes needed in `graphWebview.ts`, the resolver signature, or the compose engine.

- Injection points: `recomposeBranch.ts` between `:95` (remote-only guard) and `:102` (resolve); `recomposeFromCommit.ts` between `:90` and `:94`.
- Note: for a **primary**-worktree branch, `worktree.path === repo.path`, so the current code is already correct there — the gap is only secondary worktrees + bare refs.

### B. Create-worktree for bare refs _(caller-level; low-medium risk)_

When `getBranchWorktree` returns `undefined` (bare ref):

1. Show a **simple confirmation modal** ("Branch X isn't checked out — create a worktree to recompose it?"). _(User-confirmed: modal first.)_
2. `const worktree = await WorktreeActions.create(repoPath, undefined, getReferenceFromBranch(branch))` — `src/git/actions/worktree.ts:13`. Runs the interactive create wizard, returns the created `GitWorktree` or `undefined` if cancelled. Passing the existing branch as `ref` with `createBranch` unset checks it out. (Prior art: `src/commands/ghpr/openOrCreateWorktree.ts:115-133`, `src/views/viewCommands.ts:493`.)
3. If created → recompose inline anchored on `worktree.path` (its git service). If cancelled → stop (no composer).

- `getReferenceFromBranch`: `src/git/utils/-webview/reference.utils.ts:28`.
- Only the interactive wizard exists (no non-interactive create helper); the caller must handle `undefined` and re-dispatch after completion.

### C. Merge-range support _(engine change is small; picker UX is the real work)_

**Key finding:** the first-parent assumption is localized to essentially **one function** — `resolveGraphScope` (`src/webviews/plus/graph/compose/integration.ts:569-597`). Everything downstream is already range-endpoint (`base..head`) and merge-agnostic; everything upstream already _fetches and displays_ merges (just as an unlabeled flat list). The library flattens merge ranges (proven by the standalone).

Work items:

1. **Replace the first-parent walk** in `resolveGraphScope` (`:569-590`, the two `throw`s) with a `base..head` computation: `to = headSha`, `from = <oldest selected>`, `rewriteFromSha = parent(from)`. Reference implementation: `resolveOldestInRange` (`composerWebview.ts:1087-1097` = `getLog(base..head).at(-1)`). `scopeToComposeSource` (`:607-657`) is already endpoint-based — only its `from` source changes.
2. **Relax `resolveRecomposeScope`** (`recomposeScope.ts` — my Task 4 resolver has its own first-parent walk `coverContiguousFromHead:34-55`, thrown at `:151`). Same relaxation for the recompose command path.
3. **The real validity boundary is the library's `rewrite-range` safety, not first-parent** (`compose-tools/dist/git/safety-range.js`): every interior commit in `parent(from)..to` must have exactly one in-range child (`interior-fork`), and no branch/tag/detached-HEAD may point at an interior commit (`interior-ref`). So the library _accepts_ a merge inside a range in the common "feature merged into mainline, range starts at/after the fork" topology, and rejects interior-fork/interior-ref. **Surface these failures in the compose UI** (new error states — today they'd surface as a generic compose error).
4. **Latent bug to fix along the way:** `buildDefaultScope` (`detailsWorkflowController.ts:2155`) and the late re-derive (`detailsActions.ts:2452`) set the default `includeShas = <all unpushed shas>`. On a branch with an **unpushed merge**, that default set is not first-parent-contiguous → `resolveGraphScope` **throws on the default compose entry today** (before the user does anything). The §1 relaxation fixes this.
5. **Picker UX (the design decision).** `gl-commits-scope-pane` (`:44`, `:264-268`, `:351-358`) hard-models the scope as a contiguous **index slice** of a flat list with two drag handles — a merge DAG has no total order for that. `ScopeItem` has no parent list / merge flag. **v1 option:** let the picker keep showing the flattened log (merges already appear as unlabeled rows), rely on the library's interior-fork check to reject invalid slices, and surface the error. **Polish option (later):** label merge commits, and constrain/validate the slice against the interior-fork rule up front. This is the main open question for C.

---

## Verification / dev environment notes

- **Build:** `pnpm run build` (runs typecheck + oxlint via `check`; never chain `check` then `build`).
- **Unit tests:** `pnpm run build:tests` then `env -u DISPLAY pnpm exec vscode-test --grep "<title>"`, OR `DISPLAY=:0 npx vscode-test --run out/tests/.../<file>.test.js -g "<pattern>"`. **Gotcha:** in this SSH/WSL env, `DISPLAY=localhost:10.0` is a dead forwarded display that **hangs** vscode-test — use a real display (`:0`) or unset it so config auto-starts Xvfb. Relevant suites: `src/plus/coretools/compose/__tests__/recomposeScope.test.ts`, `src/webviews/apps/plus/graph/components/__tests__/detailsWorkflowController.test.ts` + `detailsActions.test.ts`.
- **Live-exercise (vscode-inspector MCP):** the inspector manages its own internal Xvfb, so the dead `DISPLAY` is a non-issue. Launch with `vscode_path` = `.vscode-test/vscode-linux-x64-1.127.0/code`, `extension_path` = the worktree, `workspace_path` = a crafted test repo, and enable Pro via `execute_command gitlens.plus.simulate.subscription [{state:'Paid',planId:'pro',dismissOnboarding:true}]`.
- **Test repo used this session:** `scratchpad/compose-test-repo` — `main` with 2 pushed + 3 unpushed commits, staged+unstaged WIP, and a second `other-branch`. For the follow-on, add: a **secondary worktree** (test part A), a **branch with no worktree** (part B), and a branch with an **unpushed merge** (part C).

## Key file map

| Concern                                      | File                                                                                                                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recompose commands (inject worktree logic)   | `src/commands/recomposeBranch.ts`, `recomposeFromCommit.ts`                                                                                                                                                |
| Host resolver (relax first-parent)           | `src/plus/coretools/compose/recomposeScope.ts`                                                                                                                                                             |
| Graph compose engine (the first-parent gate) | `src/webviews/plus/graph/compose/integration.ts` (`resolveGraphScope` :536-605, `scopeToComposeSource` :607-657)                                                                                           |
| Default scope (unpushed-merge bug)           | `src/webviews/apps/plus/graph/components/detailsWorkflowController.ts` (`buildDefaultScope`), `detailsActions.ts` (late re-derive, `buildWipScopeItems`)                                                   |
| Commit picker (merge-range UX)               | `src/webviews/apps/plus/graph/components/gl-commits-scope-pane.ts`                                                                                                                                         |
| Worktree helpers                             | `getBranchWorktree` (`src/git/utils/-webview/branch.utils.ts:266`), `WorktreeActions.create` (`src/git/actions/worktree.ts:13`), `getReferenceFromBranch` (`src/git/utils/-webview/reference.utils.ts:28`) |
| Compose IPC + secondary WIP                  | `graphWebview.ts` (`onShowing` :3247, `composeChanges` :1939, `getWipMetadataBySha` :8236)                                                                                                                 |
| Library constraints                          | `node_modules/@gitkraken/compose-tools/dist/` (`workflows/compose.d.ts:276`, `git/diff-collector.d.ts:55-81`, `git/safety-range.js`)                                                                       |
