---
name: live-exercise
description: Use whenever you're working on, verifying, ship-gating, or auditing a feature or change set with visible UI — keep a running instance in the loop and exercise it as a user would. Adaptive depth from tactical fix-loop to ship-gate audit. Not for pure-logic diff review.
---

# /live-exercise — Live functionality, intent, and quality loop

Operate the feature as a user would. Measure live state, not diffs. Apply the four lenses (functional, intent, polish, improvement) every sweep. Fix in parallel, verify after rebuild, re-sweep. At end-of-loop, optionally simplify code drift and optionally sweep performance. Stop only when sweep + simplify + perf all produce nothing new.

**This is the normal working rhythm for UI-bearing work — from tactical bug-fix iterations through ship-gate audits. Adaptive depth; no upfront prompt.**

## When to use vs other skills

| Skill            | Purpose                                    | Mode                 |
| ---------------- | ------------------------------------------ | -------------------- |
| `/review`        | Standards + completeness checklist         | Static               |
| `/deep-review`   | Correctness tracing end-to-end             | Static               |
| `/ux-review`     | User flows against a goals doc             | Static               |
| `/live-inspect`  | Reference for `vscode-inspector` MCP tools | Primitive            |
| `/live-exercise` | Live operation + audit + fix loop          | **Live + iterative** |

Use `/live-exercise` any time you touch UI — adding a panel, fixing a mode, refactoring a webview, ship-gating a feature. Not as a one-off audit; as the default way to work on UI.

## Prerequisites

- `vscode-inspector` MCP connected (auto-discovered via `.mcp.json`)
- Build currently passes (`pnpm run build:quick`)

## Lenses — applied every sweep

| Lens                                       | When applied                                                                                                                           | Blocking?      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **L1 — Functional walk-through**           | Always. Layout, console, pixel invariants + handler verification (exercise the action, verify the intended outcome actually happened). | Yes            |
| **L2 — Intent compliance (cold-read)**     | Always. Intent source order: `goals.md` → user-solicited → **inferred cold-read**.                                                     | Yes            |
| **L3 — UX heuristics polish**              | Always observe. Surface findings. Blocks exit only under ship-gate signal.                                                             | Conditional    |
| **L4 — Opportunistic improvement hunting** | On signal (user says "polish/audit/ship-gate/elevate") OR when L2 surfaces ambiguous-intent / can't-form-intent findings.              | When triggered |

### L1 — Functional walk-through

Question: **does every feature actually do what it says it does, end-to-end, as a user would use it?**

- Enumerate every entry point (command, menu item, button, keybinding, automatic trigger)
- Walk every primary path to completion
- Exercise every state transition (empty → populated, loading → error → recovered, collapsed → expanded, mode A → mode B)
- Verify each handler actually fires and produces the intended outcome — not just that the click registered

Evidence: `evaluate_in_webview` to confirm the action ran (command executed, state updated, event fired). Not "button clicked" — "button clicked AND the result is X." Plus the structural invariants — computed layout, console clean, pixel geometry.

### L2 — Intent compliance via cold-read

Question: **does the live behavior match what a user expects?**

Intent sources, in priority order:

1. **`goals.md`** — under `.work/dev/<id>/` or similar. Authoritative when present.
2. **User-solicited intent** — if the user has given 1–2 sentences of intent inline this session. Authoritative when provided.
3. **Inferred cold-read** — always applied, even when 1/2 are available. Approach the feature as a brand-new user with no context: read labels, icons, tooltips, position, naming, surrounding UI, convention matches. Form an expectation of what this thing should do.

**If it doesn't make sense to the model, it's unlikely to make sense to a user.** Cold-read failures are real discoverability findings.

#### Cold-read discipline

Every L2 finding powered by inference must state the inference chain explicitly, so the user can correct it:

> **Inferred intent**: "Share branch via Patch link" (from label "Share" + link icon + position in branch context menu + convention of adjacent Commit/Shelve actions).
>
> **Observed**: click opens a raw clipboard prompt with no patch formatting.
>
> **Divergence**: the inferred action is a curated share flow; the actual action is a generic copy.

Classification — every L2 finding is one of:

| Type                         | Severity                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Inferred ≠ observed**      | 🟡 Gap. Feature looks like it should do X, actually does Y.                                                            |
| **Inferred is ambiguous**    | 🟡 Gap. Surface doesn't telegraph what it does — a new user would be guessing.                                         |
| **Can't form intent at all** | 🔴 Critical. The model couldn't infer purpose from labels/icons/context. No user will either. Discoverability failure. |

### L3 — UX heuristics polish

Question: **does it feel right?**

Apply these heuristics on the running UI (the same set `/ux-review` uses, observed live):

- **Feedback & responsiveness** — loading/progress, success confirmation, failure visible where the user is looking, transitions smooth not jarring
- **Discoverability** — right surface, findable names, affordances look interactive, disabled elements explain why
- **Consistency** — patterns, terminology, icons, visual language match the rest of GitLens
- **Workflow integration** — flow preservation, reversibility, focus management, no unnecessary interruption
- **Information design** — hierarchy, density, progressive disclosure, helpful empty states
- **Accessibility** — keyboard parity, ARIA labels/roles/states, focus trapping for modals, theme compliance

Measure, don't eyeball — "feels cramped" is not a finding; "`.card` padding 4px vs repo convention 8–12px" is.

### L4 — Opportunistic improvement hunting

Question: **could this be meaningfully better?**

Triggered by:

- User says "audit," "polish," "ship-gate," "elevate" in the invocation
- L2 surfaced ambiguous-intent or can't-form-intent findings (fixing those requires proposing changes, which IS L4)
- A `goals.md` is present under `.work/dev/<id>/` (suggests scoped feature worth elevating)
- Multiple consecutive `/live-exercise` invocations on the same feature (user is circling — polish time)

Discipline:

- **Bias toward coherent upgrades that match existing patterns.** Small changes that fit intent → dispatch liberty-fix with `decisions.md` entry. Larger scope-expanding proposals → `open-questions.md`.
- **Not drive-by churn.** Every improvement must map to a UX heuristic gap, an ambiguous-intent fix, or the feature's stated intent — not just "shuffle things around."

## Adaptive depth — no upfront prompt

The skill never asks "what mode?" at start. Tactical by default (L1 + L2 active, L3 observed, L4 off). The lens table above lists L4 triggers; when any fire, comprehensive mode activates automatically. Phase 6 and 7 gate at end-of-loop (see "Convergence" below).

## The loop

### 1. Scope & spec

1. Read `goals.md` under the user's pointed `.work/dev/<id>/` (or wherever). If absent, ask the user:

   > "No `goals.md` found. In 1–2 sentences: what's the intended user experience for this feature? What problem does it solve, and what does success look like from the user's POV?"

   If the user declines to supply intent, proceed on cold-read inference alone (lens 2 still runs).

2. Launch **one `Explore` subagent** to map the feature's code surface. Don't self-read everything up front — read specific files only when you dig into an issue.
3. Note `[FUTURE]`/`TODO` markers — they're known-open, not new findings.

### 2. Live sweep (lens application)

`launch` VS Code, then for **every** distinct mode/state/context the feature exposes:

1. Maximize real estate: close sidebar/aux bar/bottom panel. `resize_viewport` to 2400×1400+ so layout-at-width issues surface.
2. Navigate via `execute_command` or programmatic clicks. Shadow-DOM traversal is the hard part — use `evaluate_in_webview` to dispatch synthetic `MouseEvent`s with modifier keys when needed.
3. Apply all active lenses per state:
   - **L1**: exercise interactions, verify handlers fired (`evaluate_in_webview` → command executed / state updated / event dispatched). Capture layout invariants.
   - **L2**: compare live behavior to goals/intent (or cold-read inference). State inference chains explicitly.
   - **L3**: `aria_snapshot`, computed styles for consistency, check empty/loading/error states explicitly.
   - **L4** (when active): actively look for coherent improvements.
   - **Always**: `read_console { level: "error" }` and `read_logs` per state — errors can be load-order / state-dependent.
4. **Measure, don't eyeball.** "Looks off" is not an issue. "AI input at y=1306 in a 1308px viewport" is. "The button does nothing" → verify via `evaluate_in_webview` that the handler fired and state updated.

### 3. Compile findings

Write under `.tasks/<feature>-exercise/`:

**`findings.md`** — status table + severity sections.

```markdown
# <Feature> — Exercise Findings

## Status

| ID     | Lens | Title                                 | Status   | Notes                        |
| ------ | ---- | ------------------------------------- | -------- | ---------------------------- |
| I1-C1  | L1   | Compose panel overflows viewport      | ✅ fixed | `.compose-panel` set to flex |
| I1-G2  | L2   | Compose view missing drafts flow      | open     | goals §3.2                   |
| I1-P1  | L3   | No loading feedback on push           | open     | >1s silent                   |
| I1-E1  | L4   | Add "retry" on transient fetch errors | open     | see Q3                       |
| I1-PR1 | Perf | +180ms hydration on Home view         | open     | baseline 220ms → 400ms       |

## 🔴 Critical (L1 broken / L2 can't-form-intent)

## 🟡 Gap (L2 divergence/ambiguity)

## 🔵 Polish (L3)

## 🟣 Opportunity (L4)

## Perf (see Phase 7)

### I1-C1 — <Title>

- **Lens**: L1 — functional walk-through
- **File**: `path/to/file.ts:L42`
- **Repro**: one-line user action + measurable observation
- **Root cause**: what's wrong in code
- **Fix**: concrete approach, OR "needs design decision (see Q<n>)"
```

**ID scheme**: `I<iter>-<sev><n>` where sev ∈ {C (L1 critical), G (L2 gap), P (L3 polish), E (L4 enhancement), PR (perf regression), PC (perf convention), PS (perf speculation)}. Iteration number comes first so history stays legible.

**`open-questions.md`** — decisions the user must make:

```markdown
## Q1. <Topic>

Brief context (1–2 sentences).

**Option A** — … | **Option B** — … | **Option C** — …

**Recommendation**: A, because …
```

**`decisions.md`** — liberties taken (only created if any):

```markdown
## D1. Added loading indicator to push action

- **Finding**: I1-P1
- **Rationale**: GitLens convention is `gl-progress-spinner` on any action >500ms. Empty state had none.
- **Change**: `src/webviews/apps/plus/home/push.ts:L88` — added spinner, matches commit-view pattern.
- **Reversible?**: yes, one-line.
```

Rules:

- Every finding cites a file and a repro someone else can reproduce.
- Unambiguous bugs become IDs. Design questions become Q-numbers. Liberties become D-numbers.
- If in doubt, use `AskUserQuestion` before filing as a fix.
- `node_modules` issues get documented under "Third-party (won't fix)", not in the critical/warning pile.

### 4. Dispatch parallel fix agents

For the unambiguous findings AND liberties you've decided to take, **dispatch a swarm of background agents** — one per logical concern group. Do not hand-fix sequentially.

Grouping:

- Related files that must change together → one agent
- Independent concerns → separate agents
- Cap at **5–6 concurrent**; more and coordination breaks down

Each agent prompt MUST include:

- Exact file paths to change
- **Which lens** the finding is from (different lenses need different verification)
- Root cause (not just symptom)
- **Measurable user-flow success criteria** — e.g. "clicking Share from empty state shows toast AND dispatches `gl:share` event" (not just "button has handler attached")
- Verification command (usually `pnpm run build:quick`)
- Project conventions they'd otherwise miss (`.js` import extensions, no barrel files, no drive-by refactors, Title Case, no `--no-verify`)
- Explicit out-of-scope ("do NOT touch `rebase-entry.ts`")
- **Source-of-truth when relevant** (codicons from `@vscode/codicons`, shared components from `src/webviews/apps/shared/components/`)

Run agents with `run_in_background: true` and keep working. The harness notifies on completion.

#### Subagents will NOT follow `/live-exercise` on their own

Dispatched subagents may not have this skill in their discovery list, and even if they do they'll often skip it under time pressure. **The discipline is the main agent's responsibility — not the subagent's.** When a subagent's task involves UI verification, the main agent must spell out the live-verification steps explicitly in the prompt, not just refer to this skill.

Bad subagent prompt (will produce static-only verification):

> Verify the compare mode isn't broken. We're shipping soon.

Good subagent prompt:

> Verify compare mode by: (1) launch `mcp__vscode-inspector__launch`; (2) show the graph, click one commit, Ctrl+click another; (3) `read_console { level: "error" }`; (4) inspect that `gl-details-multicommit-panel` renders with non-empty `commitFrom`/`commitTo`; (5) evaluate handler fired via `window.__lastCompareEvent`; (6) report console errors and any rendering failures. Do NOT ship based on `tsc` alone.

### 5. Verify & loop

When agents complete:

1. `pnpm run build:quick`. Fix any breakage before proceeding.
2. **Always `git diff` after agents finish.** Don't trust summaries — agents have "completed successfully" while silently removing working code.
3. **Teardown + relaunch VS Code.** Extension-host and webview state is sticky across reloads (Shoelace icon cache, Lit registrations, extension singletons).
4. Re-measure each fix. Evidence, not screenshots.
5. Re-sweep all active lenses. Watch for:
   - Regressions (agent B undid agent A's fix)
   - L1 items now pass but L3 items the fix introduced
   - Second-order effects (a handler fix exposed a missing loading state)
6. Update the findings doc — ✅ the resolved items, add new `I2-*` entries.
7. **Loop to step 4** if there are new unambiguous fixes.

### 6 & 7 — End-of-loop gates: Simplify, then Performance

Phases 6 and 7 share the same gating: **explicit signal** ("done/ship-gate/polish/audit") → run automatically; **no signal** → prompt once, default N. Once opted in for the session, the phase remains part of the convergence loop — no re-prompts on subsequent passes. Either phase producing changes loops back to Phase 5 (re-sweep all active lenses); simplification can introduce regressions (removed "redundant" state that was actually load-bearing, collapsed templates that rendered differently in different contexts), so the re-sweep is non-negotiable.

**6. Simplify** — invokes `/simplify` (3 parallel review agents: reuse, quality, efficiency). After it runs: `pnpm run build:quick` + `git diff` + loop back to Phase 5.

**7. Performance** — invokes `/live-perf` after Phase 6 converges. `/live-perf` owns scope, measurement discipline, and the three-tier classification (see `/live-perf`). Perf findings use `P`-prefix IDs (`PR` regression, `PC` convention, `PS` speculation) and can live in the same `findings.md` or delegated out.

## Convergence — full exit criterion

Exit only when **all three** of the following hold, in sequence:

1. A fresh Phase 5 sweep produces nothing new
2. A fresh Phase 6 simplify (if opted in) produces nothing to simplify
3. A fresh Phase 7 perf sweep (if opted in) produces nothing measured / no convention violations

If any phase produces changes, loop back to Phase 5. Don't exit because the current iteration produced a few fixes.

Additional exit conditions:

- All non-third-party 🔴/🟡/🔵/🟣/Perf items are ✅ or deferred
- User has reviewed `open-questions.md` and `decisions.md` (if present)
- Remaining items are open questions awaiting user input, or user explicitly accepts outstanding items

## Pitfalls

| Pitfall                         | What happens                                                                                            | Mitigation                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Eyeballing the flow             | "Feels fine" becomes evidence; real handler bugs slip through                                           | `evaluate_in_webview` to verify state/command/event fired, not just clicked               |
| Skipping L2 when no goals.md    | Completeness findings silently missed                                                                   | Cold-read always applies; solicit intent if absent; state inference chains explicitly     |
| Polish dominating bugs          | Iteration focuses on spacing while L1 handlers are broken                                               | L1 is gating. Don't move deeper until L1 is clean                                         |
| Drive-by improvement churn (L4) | Agent proposes changes that don't serve intent                                                          | Every improvement must map to a heuristic gap, an L2 ambiguity, or stated intent          |
| Liberty overreach               | Agent changes a cross-feature convention (icon, term, pattern) without asking                           | Cross-feature changes → `open-questions.md` always                                        |
| Missing `decisions.md`          | User has no audit trail of liberties; trust erodes                                                      | Every dispatched liberty goes in `decisions.md`                                           |
| Speculative perf optimization   | Agent "optimizes" something that was never slow                                                         | Measured-tier requires baseline + post-measurement. Speculation → open-questions only     |
| Perf rewrite when caching fits  | Agent rewrites an inner loop when a missing `@memoize` would solve it                                   | Prefer caching / memoization / debouncing over rewrites; convention-tier handles most     |
| Over-eager fix agent            | Prompt says "remove empty div" → agent deletes functional buttons inside                                | Prompt MUST state template location and expected rendering outcome, not only CSS selector |
| Load-order bug                  | Side-effect module runs too late; the thing it registers fires after consumers already used the default | Register at every webview entry, or in the most-transitively-imported shared wrapper      |
| Per-realm registration          | One webview ≠ all webviews                                                                              | Plan for N registrations, not 1                                                           |
| Stale instance state            | Iteration N sees cached state from N−1                                                                  | **Always** teardown + relaunch between iterations                                         |
| Silent agent regression         | Agent "succeeds" but reverted working code                                                              | Always `git diff` after agents; don't trust their summaries                               |
| Mimic vs reuse                  | Agent "fixes" icon-fetch by inlining third-party icons instead of using ours                            | Specify source-of-truth in the prompt                                                     |
| Shadow DOM aria clipping        | `aria_snapshot` reports empty buttons that actually have labels                                         | Use `evaluate_in_webview` to read `aria-label` on the inner button directly               |
| Guess-fixing                    | "Probably the padding — let me bump it"                                                                 | Measure first. No measurement → no fix                                                    |

## Red flags — pause the loop

- You're about to answer a "does this actually work for a user?" question without having exercised a handler end-to-end
- You're about to apply L3/L4 before L1 is fully clean
- You haven't teardown + relaunched between iterations
- You're about to fix something without a measurable repro
- An agent's summary says "done" but you haven't diffed the actual changes
- You're on iteration 4+ and the same issue keeps resurfacing — stop; a design decision is likely required, ask the user
- You feel the urge to hand-fix "just this one" instead of dispatching an agent
- You're taking a liberty on a cross-feature convention without asking
- No `goals.md` exists AND you haven't run the cold-read discipline
- You're about to dispatch a perf fix without a baseline measurement

## Tripwires for "skipping live lens application"

Any of these phrases appearing in your reasoning = you're about to ship without live verification. Stop and launch the instance.

- "I have enough confidence"
- "Code paths trace cleanly"
- "Types check / tsc passed / no TypeScript errors"
- "`git diff` looks fine"
- "It should work based on the code"
- "No obvious issues in the code"
- "L1 passed, skip L2–L4"
- "Polish is subjective, move on"
- "There's no goals.md so I'll guess at intent"
- "This could probably be faster" (dispatch bait)
- "Ship it" / "LGTM" / "looks good from here"

These are correct outputs AFTER applying lenses live, not substitutes for it.

## Rationalizations to resist

| Excuse                                                              | Reality                                                                                                                                                                 |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "I have enough confidence from reading the code"                    | Reading code catches logic bugs. It misses layout overflow, mode-switching state bugs, console errors, runtime z-index, every pixel-accurate issue. Launch the instance |
| "tsc passed, types trace cleanly, `git diff` is small — ship it"    | Types and diffs are blind to UI. They're necessary, not sufficient                                                                                                      |
| "L3/L4 are subjective — skip"                                       | Subjective lenses are exactly what this skill exists to apply deliberately. Skipping them defeats the point                                                             |
| "No goals.md, so heuristics alone are fine"                         | Cold-read still applies and catches discoverability failures heuristics don't. State the inference chain                                                                |
| "We're shipping in 30 min, skip the live check this once"           | 30 seconds of live inspection catches what 30 min of static analysis cannot                                                                                             |
| "It's one small issue, no need for an agent"                        | Single fixes still benefit from the dispatch pattern — you keep doing live inspection while the agent works, and the diff surfaces regressions                          |
| "Improvement opportunity obviously right, no need for decisions.md" | Clear wins are exactly what `decisions.md` is for — the audit trail is the whole point of "taking liberties"                                                            |
| "We just did a sweep, skip iteration 2"                             | Iteration 2 catches regressions iteration 1 couldn't see                                                                                                                |
| "Teardown takes 10s each time — skip it"                            | Cached state in the old instance is the single most common source of false-positive/false-negative findings                                                             |
| "The build passed, ship it"                                         | Build passing ≠ fix verified. Measure                                                                                                                                   |
| "This could probably be faster"                                     | Speculation. No measurement → open-questions, never dispatch                                                                                                            |
| "Missed `@memoize` — I'll file it and move on"                      | Convention-tier dispatches on audit alone. Fix it; log in `decisions.md`                                                                                                |
| "Sweep + simplify converged, good enough"                           | Three-way convergence: sweep + simplify + perf all stable. If perf wasn't run, prompt for it before declaring done                                                      |

## Before declaring "live-exercise complete"

You MUST have:

1. **Launched the extension live** (not just `pnpm run build:quick`)
2. **Exercised each changed mode/state at least once** — click, multi-select, toggle, whatever produces the surface
3. **Verified L1 handlers actually fired** — not just that buttons registered clicks
4. **Applied L2 cold-read** — stated inference chains explicitly for any intent-sourced finding
5. **Read the console for errors** — `read_console { level: "error" }` once per mode
6. **Written `decisions.md` for every liberty taken**
7. **Surfaced `open-questions.md` to the user**
8. **Completed three-way convergence** — sweep + simplify (if opted in) + perf (if opted in) all produce nothing new in sequence

Missing any of those = UI readiness is unverified. "Code paths look clean" is not evidence.

## Exercising Pro-gated features

Features gated by subscription (Commit Graph beyond local repos, Launchpad, Worktrees, Cloud Patches, Composer, all AI features, Drafts, Workspaces, etc.) won't unlock without a Paid/Trial session. Use the **subscription simulator** documented in `/live-inspect` (section: "Exercising Pro-gated features"). Pass `dismissOnboarding: true` on the start call to pre-dismiss every GitLens onboarding overlay — they intercept clicks during automation. State (subscription + onboarding flags) is restored when you call with `state: null`.

```
execute_command { command: "gitlens.plus.simulate.subscription", args: [{ "state": "Paid", "planId": "pro", "dismissOnboarding": true }] }
```

Other states for boundary-case sweeps: `"Community"` (paywall UX), `"TrialExpired"` / `"TrialReactivationEligible"` (trial-end UX), `"VerificationRequired"` (email-verify gate), or `"Paid"` with `planId: "advanced" | "teams" | "enterprise"` for plan-tier differences. See `/live-inspect` for the full reference.

## Exercising AI features

Real AI provider calls are non-deterministic and can't be asserted against. Use the **AI simulator** documented in `/live-inspect` (section: "Exercising AI features") — it's Pro-gated, so the subscription simulator above is a prerequisite.

Loop-specific notes:

- **Per finding**: inject content with a unique assertion sentinel before triggering the feature; assert against it in the rendered surface. **Clear between findings** (`{ op: "clear" }`) — leftover injects leak between scenarios.
- **Negative-path findings (error/cancel/slow/invalid UX)**: switch the global `mode` instead of injecting per call.
- **Phase 4 dispatch**: subagents don't auto-load `/live-inspect`. When dispatching a fix agent that touches an AI surface, embed the inject command, the content to inject, and the assertion target directly in the agent's prompt.

## Output artifacts

- `.tasks/<feature>-exercise/findings.md` — severity + status table + detailed entries across lenses + perf
- `.tasks/<feature>-exercise/open-questions.md` — design decisions needing user input
- `.tasks/<feature>-exercise/decisions.md` — liberties taken, with rationale (only if any)
- Clean working tree with targeted commits (or staged changes) across many files
- Clean live console (only third-party noise)

## Related skills

**REQUIRED BACKGROUND:**

- `/live-inspect` — primitive MCP tool reference, used throughout
- `/simplify` — 3-agent parallel code cleanup; invoked from Phase 6
- `/live-perf` — perf measurement + improvement; invoked from Phase 7

**Interactive counterpart:**

- `/live-pair` — user-driven pair-programming. Use when iteration is exploratory/creative; delegates back here on structural bugs.

**Static counterparts:**

- `/ux-review` — static L2/L3 counterpart
- `/deep-review` — static L1 correctness counterpart
- `/review` — standards + completeness diff review
