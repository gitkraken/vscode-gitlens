# Commit Graph Update Pipeline

How the Commit Graph webview ships and applies incremental updates: what travels over IPC when
the repository changes, and how the layout engine avoids re-deriving lanes it has already placed.
For the Graph's general architecture see `docs/architecture.md`, and for its keyboard and focus
model `docs/graph-keyboard.md`. This doc covers the host→webview rows channel and the
`@gitkraken/commit-graph` engine (`packages/plus/commit-graph/src/engine/`).

## Why rows ship as deltas

A repository event (new commit, ref move, WIP save) forces the host to re-walk and re-process the
loaded window, but the output below the changed region is usually unchanged. Two independent
mechanisms keep the pipeline proportional to what changed rather than to the loaded window size:

- **Host → webview**: the host ships a splice (changed head + a pointer into rows the webview
  already holds + optional grown tail) instead of the full row array.
- **Webview engine**: `CommitGraphEngineSession` (`packages/plus/commit-graph/src/engine/session.ts`)
  classifies what changed and either skips the engine, resumes it, or reconciles a fresh run
  against the prior one so unchanged rows keep their prior object identity.

Both depend on the same underlying fact: the layout engine is a deterministic, order-dependent
forward scan, so identical row content above a point in the walk always produces identical layout
below it. The sections below trace each mechanism and the invariants that keep it true.

## Host-side rows ledger and splice

`src/webviews/plus/graph/graphRowsSplice.ts` is a pure module with no host or webview
dependencies. It maintains a **ledger** (`SentRowsLedger`) that mirrors, for each row the webview
currently holds: its sha, a fingerprint of its mutable projection, and its `contexts.flags` /
`contexts.reachabilityIndex` ints.

**What the fingerprint covers.** `fingerprintRow` hashes only fields that can change for a fixed
sha between two walks: `heads`/`remotes`/`tags` decorations, `contexts.row`/`contexts.refGroups`,
and — for `workdir`/`stash` rows only, via `isMutableRowKind` — `date`/`stats` as well. Everything
else (parents, author, message, kind) is immutable per sha, so sha equality already covers it.
`contexts.flags` and `contexts.reachabilityIndex` are deliberately **excluded** from the
fingerprint: both cascade to every ancestor on branch create/delete/checkout (unique-to-branch,
reachable-from-HEAD, ref-set membership), which would collapse reuse for exactly the events that
matter most under heavy repo activity. Instead they ship as a per-row patch (`null` = unchanged,
`-1` = now absent) alongside the splice, encoded/decoded by `buildRowsLedgerFromSplice` and applied
in place by the webview.

**Diffing.** `diffRowsAgainstLedger` walks the fresh rows and the ledger from the bottom up,
comparing sha + fingerprint, and stops at the first mismatch — the reusable run is necessarily
contiguous because row content depends only on the walk above it. It handles three alignment
cases: bottoms match directly; a **grown** bottom (the walk ran further than the ledger) is located
by scanning the fresh rows upward for the ledger's bottom sha; a **cut** bottom (a fixed-count
reload) is located by scanning the ledger upward for the fresh bottom sha. A reuse below `minReused`
(default 10) or below half the row count is rejected — not worth the bookkeeping — and the caller
ships full rows instead.

**On a mismatch.** The splice a host sends carries `expectedPriorRows`, `firstReusedSha`, and
`lastReusedSha` as guards. On the webview, `GraphStateProvider.applyRowsSplice`
(`src/webviews/apps/plus/graph/stateProvider.ts`) checks the currently-held row count and the sha
at both ends of the reused span before applying. If any guard fails, it logs and calls
`requestResync()`, which sends `GraphSyncResyncCommand` — the host responds by re-shipping a full
snapshot and the webview's `GraphRowsSyncReceiver` (`src/webviews/apps/plus/graph/graphRowsSyncReceiver.ts`)
rebases its generation/seq baseline. This should never fire in normal operation; it exists as a
recovery path for a diverged mirror (e.g. a dropped message).

The rows channel itself is a sequenced `{generation, seq}` stream (`GraphSyncPublisher` on the
host, `GraphRowsSyncReceiver` on the webview) layered under the splice: a seq gap or an
unrecognized generation also triggers `requestResync()`, independent of the splice guards above.

## `reachabilitySeed`: why index stability makes the delta possible

`packages/git-cli/src/providers/graph.ts` builds a `GraphReachabilityTable` while walking: each
row's set of reachable refs is interned into a shared dictionary via
`createReachabilityTableBuilder` (`packages/git/src/utils/reachability.utils.ts`), and the row
carries only the resulting `contexts.reachabilityIndex` — an integer — not the ref set itself.

Table indices are **append-only**: once a ref-set combination is interned at index N, it keeps that
index for the life of the builder. `getGraph` passes the **prior generation's table** as
`reachabilitySeed` on a same-repo rebuild (`packages/git-cli/src/providers/graph.ts`, `getGraph`
passing `reachabilitySeed: prior.reachability` at the session level). A fresh walk that re-interns
the same ref-set combinations gets back the _same_ indices the prior walk assigned, because the
seeded builder's dictionary already contains them.

This is the causal link the rest of the pipeline depends on: a row's fingerprint deliberately
excludes `reachabilityIndex` (it's shipped as a patch, not diffed), but the row's _identity and
position_ in the ledger diff still depend on everything else lining up — and a retained row's
reachability metadata staying numerically valid across a rebuild is what lets the splice patch it
in place instead of forcing a full resend. Without a stable table id, every rebuild would mint new
indices for identical ref sets, and the "unchanged content" the fingerprint proves would be
undermined by reachability data that silently went stale. `reachableRefKey` folds in whether the
ref is `current` (checked out) specifically so a seeded dictionary can't hand back a stale
"currently checked out" marker after a checkout changes which ref that is.

## The engine reconciles rather than fully recomputing

`packages/plus/commit-graph/src/engine/session.ts` exports `CommitGraphEngineSession`, the
webview-side owner of the engine lifecycle (constructed once in
`src/webviews/apps/plus/graph/graph-wrapper/gl-lit-graph.ts` and driven via `.update()` on every
row change). It classifies the incoming row set against what it currently holds via
`classifyRowsDelta` (`engine/delta.ts`), which compares only `sha`/`parents`/`kind`/`date` — the
fields that feed layout — and returns one of:

- `initial` — no prior rows.
- `append` — the prior rows are an unchanged topology prefix; new rows follow (older history
  paging in).
- `payload` — same topology row-for-row; only refs/message/author/stats may differ.
- `replace` — anything else (prefix changed, reordered, truncated).

**`payload`** skips the engine entirely — layout and edges are provably unchanged when topology is
identical — except the session still re-derives `commits` (payload rebuild) and re-validates the
trunk segment tip against the current HEAD, since HEAD is payload-derived and could otherwise pick
a different segment.

**`append`** calls `processGraphRows(commits, { resume: this._resume })`
(`engine/process.ts`). The resume path is scoped to the case actually byte-identical to a full
recompute: no pinned lanes, no synthetic (scope) edges, and the resume token's last row must match
the incoming array's row at the same index (guards against a changed prefix). It calls
`appendColumnsAndSegments` (`engine/layout.ts`) to continue the layout state machine over only the
new rows, then `computeEdges` with `resumePrev` to continue the edge carry from the prior last row.

**`replace`** runs a full `computeColumnsAndSegments` pass (layout is a forward state machine —
there's no cheaper way to get segments and unloaded-column reservations exactly right), but when
prior rows exist it also passes a `reconcile` option: `{ priorRows, priorIndexOfSha }`. Inside
`processGraphRows`, `alignRowsSuffixByLayout` (`engine/reconcile.ts`) aligns the fresh **layout**
output (columns assigned, edges not yet computed) against the prior run's rows by content
(`sha`/`kind`/`date`/`column`/`parents` — everything but edges), walking bottom-up from an anchor
(handles both a cut bottom via `priorIndexOfSha` and a grown bottom via a bounded upward scan).
`computeEdges` then runs the expensive edge pass only until the _carry_ it's building converges
with the carry that produced the aligned prior row's edges (`carriedEdgesEqual`, which tolerates
`ending` edges differing since those are consumed and never propagate) — from that point on, it
adopts the prior row objects (edges included) wholesale rather than recomputing them. The reused
span is reported back as `result.reconciled` (`{ reused, priorStart, nextStart }`).

Reused rows keep the **prior object identity**, which is what lets every identity-keyed consumer
downstream (`CommitGraphEngineSession.rebuildIndexesAndAnchors`, the render/collapse layer) splice
its own state instead of rebuilding: content equality is provable only row-by-row, but identity
equality is one `===`. `engine/reconcile.ts` also exports a lower-level `reconcileRowsSuffix` that
performs the align-and-swap in one pass post-hoc; it's used directly by the lane-collapse tests
and is documented as the semantic twin of `alignRowsSuffixByLayout`, but the production path goes
through the layout-then-splice split above so the edge pass itself can stop early rather than
compute-then-discard.

## Layout reproducibility invariants (`engine/layout.ts`)

Reconciliation only fires because the layout pass is a **pure, deterministic forward scan**:
processing the same row content in the same order (newest-to-oldest, i.e. top-down) always
produces the same column assignments, because all of the pass's state (`columnsUsed`,
`reserverInfoBySha`, `columnsToFreeWhenFound`, `segmentByColumn`) is built fresh per run
(`createState`) and mutated only by the rows already processed. There is no state carried between
independent full runs — a full run's `LayoutState` is discarded once `computeColumnsAndSegments`
returns (aside from the opaque `GraphLayoutSnapshot` used explicitly for `append`/resume). Two
invariants a future contributor must preserve for that determinism — and hence reconciliation — to
keep holding:

1. **First-parent lane preference inherits top-down.** `pickParentColumn` gives a row's first
   parent its child's own column (`parentIndex === 0 ? childColumn : claimNextColumn(state)`). Rows
   are processed newest-first, so by the time an older row is reached, its column was already
   reserved by its child — the whole first-parent chain rides one lane without re-deriving it row
   by row. This is what keeps a chain's lane assignment as a pure function of what's above it.

2. **New lane claims always take the lowest free column.** `claimNextColumn` scans upward from
   `pinnedColumnCount` (the reserved pinned-lane count) for the first column not in `columnsUsed`.
   Note this is the _opposite_ of "park displaced lanes above the preferred range" — an earlier
   iteration of this engine did exactly that (see `engine/__tests__/splice.test.ts`, the
   "successive sibling updates" test, whose comment records a regression where "a claim parked past
   the deepest lane instead of taking the lowest free one" spuriously grew the lane space run over
   run). The shipped behavior takes the lowest free column unconditionally; there is no
   cross-run "preferred column" state or `preferredColumnFloor` concept in the current engine —
   determinism instead follows directly from invariant 1 plus the fact that each full run starts
   `columnsUsed` empty and rebuilds it solely from the rows it processes. A reservation conflict
   (a first parent's already-reserved column differs from its actual claimant) is resolved locally
   by `assignColumnForRow`'s conflict branch — either the parent's reservation moves to the new
   row's column, or the new row's column is scheduled to free when the parent is reached — and
   never by scanning for a "park" slot outside the normal claim path.

A change to either invariant doesn't just shift a lane visually — it breaks the premise
`alignRowsSuffixByLayout` relies on (identical prefix ⇒ identical suffix layout), so reconciliation
silently stops firing and every `replace` degrades to a full recompute plus zero row reuse. Nothing
in the type system catches this; the engine's equivalence tests
(`engine/__tests__/splice.test.ts`, `engine/__tests__/reconcile.test.ts`) are what would catch a
regression here.

## Known limitation: conflict-replace column leak at the paging boundary

In `assignColumnForRow` (`packages/plus/commit-graph/src/engine/layout.ts`, the `Conflict:` branch
starting around line 322), when a row's first parent already has a reservation on a different
column, the layout can **replace** that reservation onto the row's own (lower) column and schedule
the old column to free once the parent's row is actually reached
(`state.columnsToFreeWhenFound.set(parentSha, pendingFrees)`). The free only happens inside
`assignColumnForRow`'s own `toFree` block, which runs when the walk reaches a row whose sha matches
the pending-free key. If that parent sits **outside the currently-loaded window** — i.e. it never
pages in during this run — the walk never reaches it, so the old column is never released; it stays
held in `columnsUsed` for the rest of the pass.

The practical effect: the already-emitted first-parent edge on the old (now-orphaned) column
dangles toward the unloaded ancestor, so two lanes can appear to converge on the same
not-yet-loaded commit — visually benign — but the held-but-unused column also means a later page-in
that finally loads the parent can shift an unrelated lane by one column, because the column space
below it was one wider than it needed to be while the reservation sat unresolved.

This is a direct port of GKC's `getColumns` allocator behavior and is deliberately not fixed: a
correct fix would need to know, at the point the conflict is resolved, whether the parent will ever
load in this window — information that isn't available until the pass ends. Freeing eagerly would
risk a different column colliding while the parent might still page in later. The trigger is narrow
(conflict-replace, plus the parent landing exactly off-window, plus another head sitting right at
the boundary), so it's tracked as a known, accepted allocator quirk rather than reworked.

## Adornments resolve lazily, per visible row

`packages/plus/commit-graph/src/engine/adornments.ts` defines the engine's sole extension seam:
`RowAdornmentProvider.provideRowAdornment(row)` is a **pull-based** per-row call — the doc comment
is explicit that it's "called only for rows that actually render (the visible window)" and must
stay O(1) against provider-held state. `resolveAdornment(row, context)` renders the actual content
and is called when a row becomes active; results are cached per sha by the renderer (unless a
provider opts into `dynamic: true`, which forces re-resolution on every render). Providers signal
invalidation explicitly via a `RowAdornmentInvalidateEvent` (`all` re-runs both `provideAdornments`
and `resolveAdornment`; `content` re-runs only `resolveAdornment`) rather than the engine batch
walking every loaded row on every change. This is what keeps adornment cost proportional to the
visible window instead of the full loaded row count.

## Summary

| Layer                        | Mechanism                            | File                                                                                                     |
| ---------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Host → webview transport     | Ledger diff → splice payload         | `src/webviews/plus/graph/graphRowsSplice.ts`                                                             |
| Host → webview sequencing    | `{generation, seq}` stream + resync  | `src/webviews/plus/graph/graphSyncPublisher.ts`, `src/webviews/apps/plus/graph/graphRowsSyncReceiver.ts` |
| Webview splice application   | Guarded reconstruction + patch apply | `src/webviews/apps/plus/graph/stateProvider.ts` (`applyRowsSplice`)                                      |
| Reachability index stability | Seeded, append-only interning        | `packages/git/src/utils/reachability.utils.ts`, `packages/git-cli/src/providers/graph.ts`                |
| Change classification        | Topology-only comparison             | `packages/plus/commit-graph/src/engine/delta.ts`                                                         |
| Session orchestration        | Skip / resume / reconcile            | `packages/plus/commit-graph/src/engine/session.ts`                                                       |
| Layout                       | Deterministic forward scan           | `packages/plus/commit-graph/src/engine/layout.ts`                                                        |
| Suffix alignment + splice    | Content-then-identity swap           | `packages/plus/commit-graph/src/engine/reconcile.ts`                                                     |
| Edge carry convergence       | Splice adoption in the edge pass     | `packages/plus/commit-graph/src/engine/edges.ts`                                                         |
| Adornments                   | Lazy per-visible-row resolution      | `packages/plus/commit-graph/src/engine/adornments.ts`                                                    |
