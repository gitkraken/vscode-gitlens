---
name: live-perf
description: Use when you want to measure and improve the performance of a feature in the running extension, hunt regressions, or perf-tune before shipping. Standalone for perf-tuning an existing feature; also invoked by /live-exercise Phase 7. Not for static code review without measurement.
---

# /live-perf — Live performance measurement and improvement

Exercise the feature to measure it, not to change it. Capture baselines. Evaluate measurements and audit GitLens conventions. Dispatch fix agents under three-tier discipline — never on speculation. Re-measure to confirm. Loop until no measured regressions and no convention violations remain.

**Measure-first or don't touch. Speculation goes to open-questions, never to agents.**

## When to use vs other skills

| Skill            | Purpose                                                      | Mode                |
| ---------------- | ------------------------------------------------------------ | ------------------- |
| `/live-inspect`  | Primitive MCP tool reference                                 | Primitive           |
| `/live-exercise` | Audit-and-fix loop (functional, intent, polish, improvement) | Live + iterative    |
| `/live-perf`     | **Performance measurement + improvement loop**               | **Live + measured** |
| `/review`        | Standards + completeness checklist                           | Static              |
| `/deep-review`   | Code-path correctness tracing                                | Static              |

Use `/live-perf`:

- **Standalone** when you want to perf-tune an existing feature without the full audit (render regressions, RPC chattiness, git-call storms, missing caching on hot paths)
- **Delegated from `/live-exercise` Phase 7** as part of the ship-gate convergence loop

Do not use `/live-perf`:

- For speculative optimization of code that isn't measured slow
- As a substitute for `/live-exercise` when functionality or intent are in question (fix those first; perf-tune what works)
- For static code review without any live measurement

## Prerequisites

- `vscode-inspector` MCP connected (auto-discovered via `.mcp.json`)
- Build currently passes (`pnpm run build:quick`)
- You can identify the **scope** (feature, lifecycle stage, user flow, diff, background op, or ad-hoc code path) — arbitrary "perf everything" invocations don't belong here

## Scope / Exercise / Baseline — derive from the invocation

Every invocation varies along three axes. Derive each from the user's request; ask when ambiguous. **The framework (three-tier discipline, convergence loop, exit) is invariant; only the axis values change.**

### Axis 1 — Scope (what to measure)

| Scope kind       | Examples                                                          |
| ---------------- | ----------------------------------------------------------------- |
| Feature          | Commit Graph scrolling, Home hydration, Timeline filters          |
| Lifecycle stage  | Extension activation, first-repo-open, post-authentication        |
| User flow        | Cold start → open repo → graph → click commit → inspect           |
| Diff-derived     | Changes on this branch (`git diff base...HEAD`), specific commits |
| Background op    | Auto-fetch, background indexer, status-bar refresh, watchers      |
| Ad-hoc code path | A specific method or entry point the user names                   |

### Axis 2 — Exercise strategy (how to drive it)

| Strategy              | When to pick                                                                           |
| --------------------- | -------------------------------------------------------------------------------------- |
| User-like interaction | Scope has visible UI affordances (default for features / flows)                        |
| Programmatic trigger  | No UI affordance, or need exact timing (`execute_command`, event dispatch, `evaluate`) |
| Ambient observation   | Background / cron-like operations — let it happen, observe over a time window          |
| Cold launch           | Lifecycle / activation scope — teardown + relaunch to force cold state                 |
| Stress variant        | Scale / contention concern — rapid repeat, concurrent actions, large-data inputs       |

### Axis 3 — Baseline strategy (what to compare against)

| Strategy            | When to pick                                                                  |
| ------------------- | ----------------------------------------------------------------------------- |
| Absolute threshold  | Known budget (hydration ≤150ms, ≤3 git calls/action). Default when available. |
| Prior baseline      | Regression hunt — compare to last captured `baseline.md` or to `main`         |
| Comparative branch  | Diff-derived scope — this branch vs base branch on same exercise              |
| Averaged runs (3–5) | Stochastic metrics (wall clock, render timing). Default for timing.           |
| Paired measurements | Scale questions — cold/warm, small/large-data, pre/post stress                |

### Default axis combinations

| If the user says…        | Scope                 | Exercise                | Baseline                       |
| ------------------------ | --------------------- | ----------------------- | ------------------------------ |
| "startup time"           | activation lifecycle  | cold launch             | absolute + averaged            |
| "feature X"              | feature               | user-like               | absolute + averaged            |
| "this branch"            | diff-derived features | user-like per feature   | comparative vs base branch     |
| "background fetch"       | background op         | ambient observation     | absolute (CPU/IO budget)       |
| "large repo / N commits" | feature + data shape  | user-like on large repo | paired small-vs-large          |
| "why is X slow"          | user-named flow       | programmatic or user    | absolute + per-stage breakdown |

### If ambiguous

Ask the user one question:

> "What's the scope — a specific feature, a lifecycle stage (activation/startup), a cross-feature user flow, the diff on this branch, or a background operation?"

Then infer exercise + baseline from the scope choice and the defaults above.

## Measurement categories — what you measure (independent of scope)

Regardless of scope, every measurement pass covers these four categories. Skip only when clearly not applicable (document why if skipped).

### 1. Render / webview perf

What to measure:

- Initial render + hydration time per webview (from `launch` / refresh to Lit `updateComplete`)
- Re-render frequency during state transitions (Lit component `updated()` counts)
- Layout thrash / forced reflows (Performance API `layout-shift`, long tasks)
- Animation / transition smoothness (composited vs main-thread, frame drops)

Tools: `evaluate_in_webview` with `performance.now()`, `PerformanceObserver`, `performance.getEntriesByType("measure")`, `document.querySelector('...').updateComplete` for Lit.

### 2. RPC / data transfer

What to measure:

- Notifications fired per user action (count by type)
- Payload size per notification (large arrays flagged)
- N+1 patterns (request loops instead of batched fetches)
- Round-trip count per flow

Tools: instrument the RPC layer via `evaluate_in_webview` to wrap `rpcController`/`rpcClient` under `src/webviews/apps/shared/rpc/`. `read_logs` for `RpcHost`/`RpcLogger` traffic in `src/system/rpc/logger.ts`. For extension host side, `read_logs` with pattern matching on the notification names.

### 3. Hot-path code audit

What to audit (code-level, not measured):

- Uncached repeated operations (multiple awaits to the same getter / provider method)
- Missing `@memoize` on pure, frequently-called getters
- Missing `GitCache` / `PromiseCache` usage on git-derived data
- Serialized `await`s where `Promise.all` fits
- Missing debounce / throttle on frequent events (scroll, resize, input, mousemove)

Audit the code under scope — a feature's source, the diff of a branch, the activation path, etc. Use Read and Grep.

### 4. Git calls

What to measure / audit (git cost is spawn-heavy, not execution-heavy):

- Redundant git commands across components (the same `git log`/`git status` fired multiple times for one user action)
- Unbatched parsing (one piece of info per command instead of parsing multiple from a single output)
- Missing cache use on repeat callers (same git result re-fetched)
- Git-triggered refresh storms (one external change triggering N refreshes)

Tools: `read_logs` with pattern matching on `git ` command logs (GitLens logs git calls with debug logging). Code audit for patterns in `src/env/node/git/sub-providers/`. `evaluate` on the extension host to count command invocations over a user-action window.

## Three-tier discipline

Every finding is classified into one of three tiers. **The tier determines whether agents dispatch and under what rules.**

| Tier            | Rule                                                                                                        | Action                                                                                                   | ID prefix |
| --------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------- |
| **Measured**    | Quantified regression vs baseline OR a measurable hot path above threshold                                  | **Dispatch fix agent.** Post-measurement required to confirm improvement.                                | `PR`      |
| **Conventions** | Violation of a GitLens convention (missed cache/memoize on hot getter, serialized awaits, missing debounce) | **Dispatch liberty-fix agent.** Log entry in `decisions.md`. No baseline needed — convention IS the bug. | `PC`      |
| **Speculation** | "This could probably be faster" — no measurement, no established convention                                 | **File in `open-questions.md`. Do NOT touch.**                                                           | `PS`      |

Rules:

- **Measure-first for Measured-tier.** Capture baseline BEFORE touching anything. Capture post-fix measurement AFTER. If post-fix doesn't improve vs baseline, revert and re-investigate — don't ship "fixes" that aren't fixes.
- **Convention-tier can dispatch on audit alone.** Missing `@memoize` on a repeated pure getter IS a bug — you don't need to measure the savings to justify the fix.
- **Speculation NEVER dispatches.** If you can't measure it and it's not a convention violation, it's an open question for the user.

## The loop

### 1. Derive scope / exercise / baseline

Pick an axis value for each of Scope, Exercise, and Baseline — from the user's invocation, the `/live-exercise` handoff, or the default combinations table above. If any axis is ambiguous, ask the user the single scope question above and infer the rest from defaults.

- When invoked from `/live-exercise` Phase 7: scope is whatever live-exercise was run against; exercise defaults to user-like; baseline defaults to absolute + averaged.
- When invoked standalone: derive from the user's request. "Startup," "feature X," "this branch," "background," "large repo" all map cleanly via the defaults table.
- Read `goals.md` if present for stated perf requirements (thresholds, budgets). These become Axis-3 targets.

Record the chosen axes at the top of `baseline.md` so the intent is auditable.

### 2. Baseline — drive the exercise (do not change code)

`launch` VS Code if not already running. For the chosen Exercise strategy:

1. Enable relevant logging / instrumentation (git debug log, RPC logger, PerformanceObserver).
2. **Drive the exercise according to Axis 2**:
   - User-like: click/scroll/type through the flow, repeat per baseline strategy
   - Programmatic: `execute_command`, event dispatch, or `evaluate` — repeat per baseline strategy
   - Ambient: leave VS Code running, observe over a time window (e.g., 2–5 minutes), don't drive it
   - Cold launch: teardown + relaunch for each run (startup mode needs cold state every time)
   - Stress: rapid repeat, concurrent, or large-data variant per the baseline's paired-measurement need
3. Capture measurements for each category that applies:
   - **Render**: `evaluate_in_webview` with `performance.measure`, `updateComplete` timing
   - **RPC**: log-parsed notification counts + payload sizes
   - **Git**: `read_logs` with git command pattern, counted over the exercise window
   - **Hot-path**: N/A (audit only, not measured)
4. Record baseline numbers in `.tasks/<feature>-perf/baseline.md`:

   ```markdown
   # <Feature> — Perf Baseline

   Recorded: <ISO date>

   ## Render

   - Home webview hydration: 220ms (avg 5 runs)
   - Repeat render on branch switch: 85ms

   ## RPC

   - Notifications per branch switch: 12
   - `DidChangeRepositoriesNotification` payload: 48KB

   ## Git

   - Commands per branch switch: 7 (3x `git log`, 2x `git status`, 2x `git rev-parse`)
   ```

### 3. Evaluate — measurements + conventions audit

Compare measurements against:

- Thresholds (general guidance: webview hydration <150ms; webview refresh <100ms; >3 git calls for a single user action is suspicious; >5 notifications/action is suspicious)
- Prior baseline if one exists (`.tasks/<feature>-perf/baseline.md` from a previous run, or git history)
- Stated requirements in `goals.md`

Separately, audit the code (Read + Grep) for convention violations in the scope categories above.

### 4. Compile findings

Write `.tasks/<feature>-perf/findings.md`:

```markdown
# <Feature> — Perf Findings

## Status

| ID     | Tier        | Category | Title                                     | Status | Baseline → Target |
| ------ | ----------- | -------- | ----------------------------------------- | ------ | ----------------- |
| I1-PR1 | Measured    | Render   | Home hydration 220ms (threshold 150ms)    | open   | 220 → <150        |
| I1-PC1 | Convention  | Hot-path | Missing @memoize on GitProvider.getBranch | open   | —                 |
| I1-PS1 | Speculation | Git      | Could batch log+status into one spawn     | see Q1 | —                 |

## 🔴 Measured (PR)

### I1-PR1 — Home hydration exceeds threshold

- **Baseline**: 220ms avg over 5 runs (fresh launch → `gl-home-app.updateComplete`)
- **Target**: <150ms
- **Hypothesis**: RPC warmup serialized; Lit templates heavy
- **Fix direction**: check if Home state can be prefetched / cached; audit Lit template for unused imports

## 🟡 Convention (PC)

### I1-PC1 — Missing @memoize on getBranch

- **File**: `src/env/node/git/sub-providers/branches.ts:L88`
- **Convention**: pure getter called in render paths → must be @memoize'd
- **Evidence**: grep shows 7 call sites, 3 in render paths
- **Fix**: add `@memoize()` decorator

## ⚪ Speculation (PS)

### I1-PS1 — Could batch log+status into one spawn

- Moved to `open-questions.md` Q1
```

Write `.tasks/<feature>-perf/open-questions.md` for speculation items:

```markdown
## Q1. Batch log + status for branch switch?

Currently 2 git spawns per branch switch. Could batch via combined `git log --name-status` parsing.

**Pros**: saves ~30ms/switch (~estimated, not measured)
**Cons**: touches parser layer, risk of parser bugs, speculative savings

**Recommendation**: file for later unless branch-switch latency is user-visible bad
```

### 5. Dispatch fix agents (Measured + Conventions only)

For each Measured finding AND each Convention finding:

- Group related fixes (e.g. all @memoize additions in one file → one agent)
- Cap at 5–6 concurrent
- Each agent prompt MUST include:
  - Exact file paths + line numbers
  - Tier (Measured or Convention)
  - **For Measured**: the baseline number AND the target. Agent must verify improvement via live re-measurement, not assumption.
  - **For Convention**: the convention being violated + the canonical pattern to apply
  - Verification command (`pnpm run build:quick`)
  - Project conventions (`.js` imports, no barrel files, no drive-by refactors, no `--no-verify`)
  - Explicit out-of-scope

**Never dispatch for Speculation.** Those are the user's call via open-questions.md.

#### Subagents must re-measure, not assume

When dispatching a Measured-tier fix, the agent prompt MUST tell the subagent to re-exercise the feature and re-capture the measurement after the fix. Example:

> Fix the Home hydration baseline of 220ms by [approach]. After the fix, rebuild with `pnpm run build:quick`, relaunch VS Code via the vscode-inspector MCP, re-exercise fresh-launch → Home → `updateComplete` 5 times, capture the new average. Report the baseline → post-fix numbers. If post-fix >= baseline, revert and report.

### 6. Verify & loop

When agents complete:

1. `pnpm run build:quick`. Fix any breakage.
2. **`git diff`** after every agent — trust nothing blindly.
3. **Teardown + relaunch VS Code.** Fresh state is critical for re-measurement.
4. Re-exercise the feature and re-capture measurements for everything the agents touched.
5. Update `findings.md`:
   - If post-fix measurement improved past target → ✅ Measured
   - If post-fix didn't improve → keep open, re-investigate (don't ship a "fix" that isn't)
   - If post-fix regressed another metric → new finding in next iteration
6. If convention fixes landed → re-audit to confirm the pattern is now consistent.
7. **Loop to step 2** if any findings remain or new ones surfaced.

### 7. Exit

Exit when:

- All Measured findings have verified improvement OR have been reclassified (moved to open-questions with rationale)
- All Convention findings are fixed
- Speculation items are filed in open-questions for user review
- A fresh baseline re-capture shows no new regressions

When invoked from `/live-exercise` Phase 7: upon exit, return control to live-exercise. If this pass produced changes, live-exercise loops back to its Phase 5. Speculation items surface to the user alongside live-exercise's `open-questions.md`.

## Pitfalls

| Pitfall                             | What happens                                                                      | Mitigation                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Speculative optimization            | Agent "optimizes" something that was never slow; may introduce bugs, zero benefit | Speculation tier never dispatches. File in open-questions                         |
| Measuring once                      | Noise-driven conclusions; "improvement" is just variance                          | 3–5 runs per measurement; report average + spread                                 |
| No baseline before fix              | No way to confirm fix actually helped                                             | Capture baseline BEFORE dispatching anything; required for Measured tier          |
| Trusting agent-reported improvement | Agent says "now takes 80ms" based on static reasoning, didn't re-measure          | Prompt MUST require re-measurement; verify via `git diff` + local re-exercise     |
| Stale state across measurements     | Cached data from prior run makes the "post-fix" measurement meaningless           | **Always** teardown + relaunch between runs; wipe extension storage if needed     |
| Rewriting when caching fits         | Agent rewrites an inner loop when adding `@memoize` would have solved it          | Convention tier first; prefer caching / memoization / debouncing over rewrites    |
| Threshold confusion                 | Agent "fixes" something above threshold that's actually not user-perceptible      | Thresholds are heuristics, not gospel. Above-threshold + user-observable = real   |
| Perf regression from polish         | A UX polish fix (added spinner, added debounce delay) actually adds latency       | Re-measure affected flows after any changeset, not just the perf-specific changes |
| Git call frequency noise            | git calls vary by repo state; count across multiple runs and repos                | Measure on a warm repo state + a fresh repo state; report both                    |
| Convention without context          | Agent adds `@memoize` to a getter that mutates state (breaks correctness)         | Convention-tier agent must verify the method is actually pure                     |

## Red flags — pause the loop

- You're about to dispatch a fix without a captured baseline
- Agent reported "improvement" but `git diff` shows only rewrites, no measurement logic
- You haven't teardown + relaunched between baseline and post-fix measurement
- Post-fix measurement is within noise (<10%) of baseline; you're "winning" on variance
- A speculation item has been sitting open for 3+ iterations — escalate to user, don't quietly dispatch
- You're about to apply a convention fix to code that isn't actually on a hot path

## Tripwires for "skipping measurement"

Any of these in your reasoning = stop and measure first.

- "This is obviously faster"
- "Standard optimization pattern"
- "Everyone caches this kind of thing"
- "Looks like a hot path"
- "Won't hurt to add @memoize"
- "Agent said it improved"

Measured-tier requires a number. Convention-tier requires a pattern match. Neither allows "obvious."

## Rationalizations to resist

| Excuse                                      | Reality                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| "Speculative optimization is often right"   | Sometimes. Can't tell which without measuring. File for later; don't churn on hunches                   |
| "Adding a cache never hurts"                | Caches can cause staleness bugs. Every `@memoize` is a decision about identity + invalidation           |
| "One measurement is enough"                 | Variance is real. 3–5 runs; report spread                                                               |
| "The agent re-measured, trust the number"   | Re-check via `git diff` that re-measurement logic ran; don't trust self-reports                         |
| "Skip teardown, it's faster"                | Cached state ruins baselines. 10s of teardown saves hours of chasing phantom regressions                |
| "Convention fix is obvious, skip the audit" | Auditing surfaces adjacent convention violations. A second fix in the same PR is free once you're there |
| "This is probably slow"                     | Speculation tier. Open-questions, not agent                                                             |

## Before declaring "live-perf complete"

You MUST have:

1. **Captured a documented baseline** for every metric you're acting on
2. **Dispatched only Measured + Convention findings** — speculation stays in open-questions
3. **Verified post-fix measurements** via re-exercise + re-capture (not agent self-report)
4. **`git diff`'d every agent's work** — no silent regressions
5. **Teardown + relaunched** between baseline and post-fix measurements
6. **Surfaced `open-questions.md`** to the user for speculation items
7. If invoked from `/live-exercise`: **returned control** after exit, with changes (if any) triggering the parent's loop

## Output artifacts

- `.tasks/<feature>-perf/baseline.md` — captured measurement baselines (per iteration)
- `.tasks/<feature>-perf/findings.md` — tier-classified findings with baseline → post-fix numbers
- `.tasks/<feature>-perf/open-questions.md` — speculation items for user review
- Clean working tree with targeted commits / staged changes
- Post-fix measurements documenting the actual improvement (not just "LGTM")

## Related skills

**REQUIRED BACKGROUND:**

- `/live-inspect` — primitive MCP tool reference (`evaluate_in_webview`, `read_logs`, `evaluate`, `read_console`)

**Related:**

- `/live-exercise` — invokes this skill from Phase 7; use it first for functional/intent issues
- `/live-pair` — interactive counterpart; delegates here on "this feels slow" signals
- `/simplify` — code-quality cleanup after perf fixes
- `/deep-review` — static correctness tracing; catches perf bugs that don't surface under current load
