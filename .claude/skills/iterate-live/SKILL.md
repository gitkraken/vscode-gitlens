---
name: iterate-live
description: Use whenever you're working on, verifying, sanity-checking, or ship-gating a feature or change set that has visible UI — keep a running instance in the loop. Static code review + tsc + git diff are NOT enough for UI work. Not for pure-logic diff review or goal-doc compliance checks.
---

# /iterate-live — Iterative live UI work loop

Keep a running instance of the extension in the loop for the whole session. Measure live state, not diffs. Fix in parallel, verify after rebuild. Once no new findings surface, run `/simplify` to clean drift, then re-verify. Stop only when a sweep AND a simplify pass both produce nothing new.

**This is the normal working rhythm for UI-bearing work — not a formal audit.**

## When to use vs other skills

| Skill           | Purpose                                        | Mode                 |
| --------------- | ---------------------------------------------- | -------------------- |
| `/review`       | Standards + completeness checklist             | Static               |
| `/deep-review`  | Correctness tracing end-to-end                 | Static               |
| `/ux-review`    | User flows against a goals doc                 | Static               |
| `/inspect-live` | Reference for `vscode-inspector` MCP tools     | Primitive            |
| `/iterate-live` | Live working rhythm with parallel fix dispatch | **Live + iterative** |

Use `/iterate-live` any time you touch UI — adding a panel, fixing a mode, refactoring a webview. Not as a one-off audit: as the default way to work.

## Prerequisites

- `vscode-inspector` MCP connected (auto-discovered via `.mcp.json`).
- Build currently passes (`pnpm run build:quick`).

## The loop

### 1. Scope & explore

1. Read goals/task docs the user points to.
2. Launch **one `Explore` subagent** to map the code under work. Don't self-read everything up front — read specific files only when you dig into an issue.
3. Note `[FUTURE]`/`TODO` markers — they're known-open, not new findings.

### 2. Live sweep

`launch` VS Code, then for **every** distinct mode/state/context the feature exposes:

1. Maximize real estate: close sidebar, aux bar, bottom panel. `resize_viewport` to 2400×1400+ so layout-at-width issues surface.
2. Navigate via `execute_command` or programmatic clicks. Shadow-DOM traversal is the hard part — use `evaluate_in_webview` to dispatch synthetic `MouseEvent`s with modifier keys when needed.
3. Capture evidence at each state:
   - `screenshot { target: "webview" }` — visual
   - `aria_snapshot` — structural + a11y
   - `inspect_dom { property: "shadowDOM" }` for Lit interiors (cap depth — full dumps can exceed 270k chars)
   - `evaluate_in_webview` for computed styles, bounding rects, `display`/`flex-direction`, `scrollHeight vs clientHeight`, attribute values on `commit-stats`/badges
   - `read_console { level: "error" }` — capture per state (errors can be load-order dependent)
   - `read_logs` — extension-host errors
4. **Measure, don't eyeball.** "Looks off" is not an issue. "AI input at y=1306 in a 1308px viewport" is.

### 3. Compile findings — two docs

Write `.tasks/<feature>-findings.md` with a status table at the top, severity sections below.

```markdown
# <Feature> — Findings

## Status

| ID    | Title                            | Status   | Notes                        |
| ----- | -------------------------------- | -------- | ---------------------------- |
| I1-C1 | Compose panel overflows viewport | ✅ fixed | `.compose-panel` set to flex |

## 🔴 Critical — broken layout / data / functionality

## 🟡 Warning — visible UX issue users will hit

## 🔵 Polish — a11y / consistency / console noise

### I1-C1 — <Title>

- **File**: `path/to/file.ts:L42`
- **Repro**: one-line user action + measurable observation
- **Root cause**: what's wrong in code
- **Fix**: concrete approach, OR "needs design decision (see Q<n>)"
```

**ID scheme**: monotonic per iteration — `I1-C1`, `I1-W2`, `I2-C1` (iteration 2's first critical), and so on. Pick any prefix for severity; the only rule is iteration number comes first so history stays legible.

Write `.tasks/<feature>-open-questions.md` for decisions the user must make:

```markdown
## Q1. <Topic>

Brief context (1-2 sentences).

**Option A** — … | **Option B** — … | **Option C** — …

**Recommendation**: A, because …
```

Rules:

- Every finding cites a file and a repro someone else can reproduce.
- Unambiguous bugs become IDs. Design questions become Q-numbers.
- If in doubt, use `AskUserQuestion` before filing as a fix.
- `node_modules` issues get documented under "Third-party (won't fix)", not in the critical/warning pile.

### 4. Dispatch parallel fix agents

For the unambiguous findings, **dispatch a swarm of background agents** — one per logical concern group. Do not hand-fix sequentially.

Grouping:

- Related files that must change together → one agent
- Independent concerns → separate agents
- Cap at **5–6 concurrent**; more and coordination breaks down

Each agent prompt MUST include:

- Exact file paths to change
- Root cause (not just symptom)
- Measurable success criteria ("`.compose-panel` computed `display: flex`")
- Verification command (usually `pnpm run build:quick`)
- Project conventions they'd otherwise miss (`.js` import extensions, no barrel files, no drive-by refactors, Title Case, no `--no-verify`)
- Explicit out-of-scope ("do NOT touch `rebase-entry.ts`")
- **Source-of-truth when relevant** ("use codicons from `@vscode/codicons`, NOT Bootstrap icons")

Run agents with `run_in_background: true` and keep working. The harness notifies on completion.

#### Subagents will NOT follow `/iterate-live` on their own

Dispatched subagents may not have this skill in their discovery list, and even if they do they'll often skip it under time pressure. **The discipline is the main agent's responsibility — not the subagent's.** When a subagent's task involves UI verification, the main agent must spell out the live-verification steps explicitly in the prompt, not just refer to this skill.

Bad subagent prompt (will produce static-only verification):

> Verify the compare mode isn't broken. We're shipping soon.

Good subagent prompt:

> Verify compare mode by: (1) launch `mcp__vscode-inspector__launch`; (2) show the graph, click one commit, Ctrl+click another; (3) `read_console { level: "error" }`; (4) inspect that `gl-graph-compare-panel` renders with non-empty `commitFrom`/`commitTo`; (5) report console errors and any rendering failures. Do NOT ship based on `tsc` alone.

### 5. Verify & loop

When agents complete:

1. `pnpm run build:quick`. Fix any breakage before proceeding.
2. **Always `git diff` after agents finish.** Don't trust summaries — agents have "completed successfully" while silently removing working code.
3. **Teardown + relaunch VS Code.** Extension-host and webview state is sticky across reloads (Shoelace icon cache, Lit registrations, extension singletons).
4. Re-measure each fix. Evidence, not screenshots.
5. Sweep the surfaces again. Watch for:
   - Regressions (agent B undid agent A's fix)
   - Issues missed in iteration 1
   - Second-order effects (a fix exposed something previously hidden)
6. Update the findings doc — ✅ the resolved items, add new `I2-*` entries.
7. **Loop to step 4** if there are new unambiguous fixes.

### 6. Simplify pass — then re-verify

Once an iteration produces no new findings, the work isn't done — parallel fix agents accumulate drift: duplicated helpers, near-identical templates, inline logic that shadows existing utilities, bloat from defensive additions that turned out unnecessary. A simplify pass cleans this up before declaring the feature complete.

1. Run `/simplify` — it dispatches 3 parallel review agents (reuse, quality, efficiency) and applies the fixes. See that skill for details.
2. `pnpm run build:quick` after simplify is done. Fix breakage.
3. **`git diff`** after simplify — same rule as Phase 4; trust nothing blindly.
4. **Loop back to Phase 5** — teardown + relaunch, re-measure, re-sweep. Simplification can introduce regressions (removed a "redundant" state that was actually load-bearing; collapsed two templates that rendered in different contexts).
5. If Phase 5 produces new findings → dispatch fix agents (Phase 4) → verify (Phase 5) → simplify again (Phase 6) → …

**The full exit criterion**: an iteration of Phase 5 produces nothing new AND a subsequent Phase 6 simplify finds nothing to simplify. If either produces changes, you're not done — loop.

## When to stop iterating

Exit the combined loop when, and only when:

- All non-third-party `🔴/🟡/🔵` items are ✅
- A fresh Phase 5 sweep produced nothing new
- A fresh Phase 6 `/simplify` pass produced nothing to simplify
- Remaining items are open questions awaiting user input
- User explicitly accepts outstanding items

Don't exit just because the current iteration produced a few fixes. Exit when **both** a sweep AND a simplify pass produce _nothing new_ in sequence.

## Pitfalls

| Pitfall                  | What happens                                                                                            | Mitigation                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Over-eager fix agent     | Prompt says "remove empty div" → agent deletes functional buttons inside                                | Prompt MUST state template location and expected rendering outcome, not only CSS selector |
| Load-order bug           | Side-effect module runs too late; the thing it registers fires after consumers already used the default | Register at every webview entry, or in the most-transitively-imported shared wrapper      |
| Per-realm registration   | One webview ≠ all webviews                                                                              | Plan for N registrations, not 1                                                           |
| Stale instance state     | Iteration N sees cached state from N−1                                                                  | **Always** teardown + relaunch between iterations                                         |
| Silent agent regression  | Agent "succeeds" but reverted working code                                                              | Always `git diff` after agents; don't trust their summaries                               |
| Mimic vs reuse           | Agent "fixes" icon-fetch by inlining third-party icons instead of using ours                            | Specify source-of-truth in the prompt                                                     |
| Shadow DOM aria clipping | `aria_snapshot` reports empty buttons that actually have labels                                         | Use `evaluate_in_webview` to read `aria-label` on the inner button directly               |
| Guess-fixing             | "Probably the padding — let me bump it"                                                                 | Measure first. No measurement → no fix                                                    |

## Red flags — pause the loop

- **You're about to answer a "does this work / is this ready to ship?" question without having launched a live instance.** Static analysis on UI work is blind to layout, runtime state, and console errors. Launch the instance first, always.
- You haven't teardown + relaunched between iterations
- You're about to fix something without a measurable repro
- An agent's summary says "done" but you haven't diffed the actual changes
- You're on iteration 4+ and the same issue keeps resurfacing — stop; a design decision is likely required, ask the user
- You feel the urge to hand-fix "just this one" instead of dispatching an agent — check if it's really one: usually 2–3 related fixes cluster

## Tripwires for "skipping live inspection"

Any of these phrases appearing in your reasoning = you're about to ship without live verification. Stop and launch the instance.

- "I have enough confidence"
- "Code paths trace cleanly"
- "Types check / tsc passed / no TypeScript errors"
- "`git diff` looks fine"
- "It should work based on the code"
- "No obvious issues in the code"
- "Ship it" / "LGTM" / "looks good from here"

These are correct outputs AFTER live verification, not substitutes for it.

## Rationalizations to resist

| Excuse                                                              | Reality                                                                                                                                                                 |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "I have enough confidence from reading the code"                    | Reading code catches logic bugs. It misses layout overflow, mode-switching state bugs, console errors, runtime z-index, every pixel-accurate issue. Launch the instance |
| "tsc passed, types trace cleanly, `git diff` is small — ship it"    | Types and diffs are blind to UI. They're necessary, not sufficient                                                                                                      |
| "We're shipping in 30 min, skip the live check this once"           | 30 seconds of live inspection catches what 30 min of static analysis cannot. Skipping the live check is how shipped UI regressions happen                               |
| "It's one small issue, no need for an agent"                        | Single fixes still benefit from the dispatch pattern — you keep doing live inspection while the agent works, and the diff surfaces regressions                          |
| "We just did a sweep, skip iteration 2"                             | Iteration 2 catches regressions iteration 1 couldn't see — it's not redundant                                                                                           |
| "The first sweep found most issues; additional passes are wasteful" | Stop when an iteration finds nothing new, not when you _feel_ done                                                                                                      |
| "Teardown takes 10s each time — skip it"                            | Cached state in the old instance is the single most common source of false-positive/false-negative findings                                                             |
| "The build passed, ship it"                                         | Build passing ≠ fix verified. Measure                                                                                                                                   |

## Before declaring "ready to ship"

You MUST have:

1. **Launched the extension live** (not just `pnpm run build:quick`)
2. **Exercised each changed mode/state at least once** — click, multi-select, toggle, whatever produces the surface
3. **Read the console for errors** — `read_console { level: "error" }` once per mode
4. **Measured at least one structural invariant per fix** — e.g. `.compose-panel` computed `display: flex`, `commit-stats` attrs populated, divider color matches a theme token

Missing any of those = UI readiness is unverified. "Code paths look clean" is not evidence.

## Output artifacts

- `.tasks/<feature>-findings.md` — severity + status table + detailed entries
- `.tasks/<feature>-open-questions.md` — design decisions needing user input
- Clean working tree with targeted commits (or staged changes) across many files
- Clean live console (only third-party noise)

## Related skills

- `/inspect-live` — primitive tool reference for `vscode-inspector` MCP
- `/simplify` — 3-agent parallel code cleanup (reuse / quality / efficiency); invoked from Phase 6
- `/deep-review` — static correctness tracing before merge
- `/ux-review` — user-flow compliance against a goals doc
- `/review` — standards + completeness diff review

**REQUIRED BACKGROUND:** `/inspect-live` (you'll use its tools throughout) and `/simplify` (Phase 6 of the loop).
