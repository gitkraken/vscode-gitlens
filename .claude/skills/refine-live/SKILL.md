---
name: refine-live
description: Use when a feature is structurally working but needs a comprehensive live audit-and-elevate pass — exercising handlers as a user, checking completeness against intent, applying UX heuristics, and hunting improvement opportunities, driven as a strong agentic fix/verify/simplify loop. Complementary to /iterate-live (structural focus) and /ux-review (static flow review). Not for pure layout/pixel work or static diff review.
---

# /refine-live — Live functionality, polish, and elevate loop

Walk every flow like a user, measure against goals and UX heuristics, hunt for improvement opportunities, and drive a strong agentic loop that fixes the clear wins and documents judgment calls. Take liberties when the right call is obvious. Run until sweep AND simplify produce nothing new.

**This is the audit-that-acts for a feature you want to elevate — not a drive-by polish, not a static report.**

## When to use vs other skills

| Skill           | Purpose                                             | Mode               |
| --------------- | --------------------------------------------------- | ------------------ |
| `/review`       | Standards + completeness checklist                  | Static             |
| `/deep-review`  | Correctness tracing end-to-end                      | Static             |
| `/ux-review`    | User flows against a goals doc                      | Static             |
| `/inspect-live` | Reference for `vscode-inspector` MCP tools          | Primitive          |
| `/iterate-live` | Structural working rhythm (layout, console, pixels) | Live + iterative   |
| `/refine-live`  | Functionality + completeness + polish + enhancement | **Live + agentic** |

**Pick `/refine-live` when:**

- A feature is structurally clean (or after `/iterate-live` has cleaned it) and you want to elevate it
- You need to verify handlers, flows, and interactions actually do what users expect — not just that elements render
- You want polish and improvement opportunities surfaced and addressed, not just bugs

**Pick `/iterate-live` instead when:** you're mid-flight on UI work and the question is "does this render right, is the console clean, are the invariants holding." Start there; come here after.

**Pick `/ux-review` instead when:** you want a static, report-only review against `goals.md` without running the extension or acting on findings.

## Prerequisites

- `vscode-inspector` MCP connected (auto-discovered via `.mcp.json`)
- Build currently passes (`pnpm run build:quick`)
- **Optional spec input**: a `goals.md` under `.work/dev/<id>/` or similar. If absent, **solicit 1–2 sentences of user-expectation intent inline** — do not silently default to heuristics only. Missing intent = missing completeness findings.

## The four evaluation lenses

Every sweep applies all four, in this order. Lens 1 is gating — broken functionality blocks everything else.

### Lens 1 — Functional walk-through

**Question**: Does every feature actually do what it says it does, end-to-end, as a user would use it?

- Enumerate every entry point (command, menu item, button, keybinding, automatic trigger)
- Walk every primary path to completion
- Exercise every state transition (empty → populated, loading → error → recovered, collapsed → expanded, mode A → mode B)
- Verify each handler actually fires and produces the intended outcome — not just that the click registered

Evidence: `evaluate_in_webview` to confirm the action ran (e.g. command executed, state updated, event fired). Not "button clicked" — "button clicked AND the result is X."

### Lens 2 — Intent compliance

**Question**: Does the live behavior match what a user expects, per goals or solicited intent?

- Walk the goals doc's UX section (or solicited intent) point by point against live behavior
- Flag missing implementations, incomplete flows, divergences from described behavior
- **Missing ≠ "future work" — it's a bug.** If goals.md describes it and the live extension doesn't do it, that's a finding.
- If goals are incomplete or contradict live behavior, flag that too (decision for the user, not a silent fill-in)

### Lens 3 — UX heuristics polish

**Question**: Does it feel right?

Apply the seven heuristics on the running UI (same set as `/ux-review`, but observed live):

- **Feedback & responsiveness** — loading/progress, success confirmation, failure visible where the user is looking, transitions smooth not jarring
- **Discoverability** — right surface, findable names, affordances look interactive, disabled elements explain why
- **Consistency** — patterns, terminology, icons, visual language match the rest of GitLens
- **Workflow integration** — flow preservation, reversibility, focus management, no unnecessary interruption
- **Information design** — hierarchy, density, progressive disclosure, helpful empty states
- **Accessibility** — keyboard parity, ARIA labels/roles/states, focus trapping for modals, theme compliance

Measure, don't eyeball — "feels cramped" is not a finding; "`.card` padding 4px vs repo convention 8–12px" is.

### Lens 4 — Opportunistic improvement hunting

**Question**: Could this be meaningfully better?

- Actively propose enhancements beyond spec: better affordances, smoother transitions, clearer copy, contextual hints, obvious-but-missing features
- **Bias toward coherent upgrades that match existing patterns.** Small changes that fit the feature's intent → act on them (log in decisions.md). Larger scope-expanding proposals → open-questions.md.
- This is NOT drive-by churn. Every improvement must serve the feature's stated intent or fill a UX heuristic gap, not just "shuffle things around."

## Decision flow: take liberties vs document

The skill is agentic. It acts. But not everything is the skill's call.

| Situation                                                   | Action                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Clear bug (broken handler, dead-end flow, null error)       | **Dispatch fix agent.** No decision needed.                                                      |
| Clear polish win (aria label, feedback on action, copy fix) | **Dispatch fix agent.** Log in `decisions.md`.                                                   |
| Enhancement matching existing patterns, clear improvement   | **Dispatch fix agent.** Log in `decisions.md` with rationale.                                    |
| Multiple reasonable designs; depends on product intent      | **File in `open-questions.md`, keep looping.**                                                   |
| Scope-expanding enhancement (new feature, new surface)      | **File in `open-questions.md`, keep looping.**                                                   |
| Touches cross-feature convention (icon, term, pattern)      | **File in `open-questions.md`, keep looping.** Cross-feature changes are always the user's call. |

**Never pause the loop to ask** unless a decision blocks further sweep. Present accumulated open-questions at loop exit.

Liberties you take MUST be recorded in `decisions.md` — the user gets a full audit trail.

## The loop

### 1. Scope & spec

1. Read `goals.md` under the user's pointed `.work/dev/<id>/` (or wherever). If absent, ask the user:

   > "No `goals.md` found. In 1–2 sentences: what's the intended user experience for this feature? What problem does it solve, and what does success look like from the user's POV?"

2. Launch **one `Explore` subagent** to map the feature's code surface. Don't self-read everything up front — read specific files when digging into issues.
3. Note `[FUTURE]`/`TODO` markers — known-open, not new findings.

### 2. Live sweep (all four lenses)

`launch` VS Code. For **every** distinct mode/state/context the feature exposes:

1. Maximize real estate: close sidebar/aux bar/bottom panel, `resize_viewport` to 2400×1400+.
2. Navigate via `execute_command` or programmatic clicks. For shadow-DOM interactions use `evaluate_in_webview` with synthetic `MouseEvent`s.
3. For each state, apply all four lenses:
   - **Lens 1**: exercise interactions, verify handlers ran (`evaluate_in_webview` to check state changed / command fired / event dispatched). `screenshot { target: "webview" }` before/after.
   - **Lens 2**: compare live behavior to goals/intent point by point.
   - **Lens 3**: `aria_snapshot`, computed styles for consistency, check empty/loading/error states explicitly.
   - **Lens 4**: actively look for coherent improvements.
   - **Always**: `read_console { level: "error" }` and `read_logs` per state — errors can be load-order / state-dependent.
4. **Measure, don't eyeball.** "The button does nothing" → verify via `evaluate_in_webview` that the handler fired and state updated (or didn't). "The empty state looks sparse" → measure padding, check whether the copy references an action.

### 3. Compile findings — three docs

Write under `.tasks/<feature>-refine/`:

**`findings.md`** — status table + severity sections:

```markdown
# <Feature> — Refine Findings

## Status

| ID    | Lens | Title                                 | Status   | Notes                       |
| ----- | ---- | ------------------------------------- | -------- | --------------------------- |
| I1-C1 | L1   | Share button no-op in empty state     | ✅ fixed | handler wired to controller |
| I1-G2 | L2   | Compose view missing drafts flow      | open     | goals §3.2                  |
| I1-P1 | L3   | No loading feedback on push           | open     | >1s silent                  |
| I1-E1 | L4   | Add "retry" on transient fetch errors | open     | see Q3                      |

## 🔴 Critical (L1) — broken functionality / data / flow

## 🟡 Gap (L2) — missing or divergent vs intent

## 🔵 Polish (L3) — UX heuristic gaps

## 🟣 Opportunity (L4) — improvement proposals

### I1-C1 — <Title>

- **Lens**: L1 — functional walk-through
- **File**: `path/to/file.ts:L42`
- **Repro**: one-line user action + measurable observation (handler did/didn't fire, state did/didn't update)
- **Root cause**: what's wrong
- **Fix**: concrete approach, OR "needs design decision (see Q<n>)"
```

ID scheme: `I<iter>-<sev><n>` where sev ∈ {C, G, P, E} (Critical / Gap / Polish / Enhancement). Iteration comes first so history stays legible.

**`open-questions.md`** — decisions the user must make:

```markdown
## Q1. <Topic>

Brief context (1–2 sentences).

**Option A** — … | **Option B** — … | **Option C** — …

**Recommendation**: A, because …
```

**`decisions.md`** — liberties taken, with rationale:

```markdown
## D1. Added loading indicator to push action

- **Finding**: I1-P1
- **Rationale**: GitLens convention is `gl-progress-spinner` on any action >500ms. Empty state had none.
- **Change**: `src/webviews/apps/plus/home/push.ts:L88` — added spinner, matches commit-view pattern.
- **Reversible?**: yes, one-line.
```

Rules:

- Every finding cites a file AND a verifiable repro
- Unambiguous items become IDs (`C`/`G`/`P`/`E`)
- Judgment items become Q-numbers
- Liberties become D-numbers (user reviews at the end)
- `node_modules` issues documented under "Third-party (won't fix)"

### 4. Dispatch parallel fix agents

For unambiguous findings AND liberties you've decided to take, dispatch background agents — one per logical concern group. No hand-fixing.

Grouping:

- Related files that must change together → one agent
- Independent concerns → separate agents
- Cap at **5–6 concurrent**

Each agent prompt MUST include:

- Exact file paths to change
- **Which lens** the finding is from (different lenses need different verification)
- Root cause (not just symptom)
- **Measurable user-flow success criteria** — e.g. "clicking Share from empty state shows toast AND dispatches `gl:share` event" (not just "button has handler attached")
- Verification command (usually `pnpm run build:quick`)
- Project conventions (`.js` imports, no barrel files, no drive-by refactors, Title Case for labels, no `--no-verify`)
- Explicit out-of-scope
- **Source-of-truth when relevant** (codicons from `@vscode/codicons`, GitLens UI components from `src/webviews/apps/shared/components/`)

Run with `run_in_background: true`. Harness notifies on completion.

**Subagents will NOT follow `/refine-live` on their own.** Dispatched subagents may skip this skill under time pressure. The discipline is the main agent's responsibility — spell out live-verification steps explicitly in the prompt, not just "follow /refine-live."

### 5. Verify & loop

When agents complete:

1. `pnpm run build:quick`. Fix any breakage.
2. **Always `git diff` after agents finish.** Do not trust summaries.
3. **Teardown + relaunch VS Code.** Extension-host and webview state is sticky.
4. Re-run all four lenses. Evidence, not screenshots alone.
5. Watch for:
   - Regressions (agent B undid agent A)
   - Lens 1 items that now pass but Lens 3 items the fix introduced
   - Second-order effects (handler fix exposed a missing loading state)
6. Update `findings.md` — ✅ resolved, add `I2-*` entries as needed.
7. **Loop to step 4** if new unambiguous items exist.

### 6. Simplify pass — then re-verify

Once an iteration produces no new findings, the work isn't done. Parallel fix agents accumulate drift: duplicated helpers, near-identical templates, bloat.

1. Run `/simplify` (3 parallel review agents: reuse, quality, efficiency).
2. `pnpm run build:quick`. Fix breakage.
3. **`git diff`** after simplify — same rule; trust nothing blindly.
4. **Loop back to Phase 5** — teardown + relaunch, re-measure, re-sweep all four lenses. Simplification can introduce regressions.
5. If Phase 5 produces new findings → dispatch → verify → simplify → …

**Full exit criterion**: a Phase 5 sweep AND a Phase 6 simplify both produce nothing new, in sequence. If either produces changes, loop.

## When to stop iterating

Exit the combined loop when, and only when:

- All non-third-party 🔴/🟡/🔵/🟣 items are ✅ or deferred to `open-questions.md`
- A fresh Phase 5 sweep produced nothing new
- A fresh Phase 6 `/simplify` pass produced nothing to simplify
- User has reviewed `open-questions.md` and `decisions.md`

Do not exit because the current iteration produced a few fixes. Exit when **both** a sweep AND a simplify produce _nothing new_ in sequence.

## Pitfalls

| Pitfall                          | What happens                                                         | Mitigation                                                                  |
| -------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Eyeballing the flow              | "Feels fine" becomes evidence; real handler bugs slip through        | `evaluate_in_webview` to verify state/command/event fired, not just clicked |
| Skipping Lens 2 when no goals.md | Completeness findings silently missed                                | Solicit 1–2 sentences of intent from user before sweep                      |
| Polish dominating bugs           | Iteration focuses on spacing while Lens 1 handlers are broken        | Lens 1 is gating. Don't move to Lens 3/4 until Lens 1 is clean              |
| Drive-by improvement churn       | Lens 4 proposes changes that don't serve intent                      | Every improvement must map to a heuristic gap or stated intent              |
| Liberty overreach                | Agent changes a cross-feature convention (icon, term) without asking | Cross-feature changes → `open-questions.md` always                          |
| Missing `decisions.md`           | User has no audit trail of liberties; trust erodes                   | Every dispatched enhancement goes in decisions.md                           |
| Silent agent regression          | Agent "succeeds" but reverted working code                           | `git diff` after every agent completion                                     |
| Stale instance state             | Iteration N sees cached state from N−1 (handler bug appears "fixed") | **Always** teardown + relaunch between iterations                           |
| Guess-fixing                     | "Probably the handler isn't bound — let me bump it"                  | Measure first. No measurement → no fix                                      |
| Lens skip under time pressure    | "We're shipping — skip Lens 3/4 this once"                           | The whole point of this skill is subjective lenses matter. Apply them       |

## Red flags — pause the loop

- You're about to answer "does this actually work for a user?" without having exercised a handler end-to-end
- You're about to apply Lens 3/4 before Lens 1 is fully clean
- You're taking a liberty on a cross-feature convention
- You haven't written a `decisions.md` entry for a change you dispatched
- An agent's summary says "done" but you haven't diffed
- You're on iteration 4+ and the same gap keeps resurfacing — a design decision is required, ask the user
- No `goals.md` exists AND you haven't solicited intent from the user

## Tripwires for "skipping live lens application"

Any of these phrases in your reasoning = you're about to declare done without applying all four lenses. Stop.

- "Lens 1 passed, skip 2–4"
- "I already did `/iterate-live`, nothing left"
- "The code paths look clean"
- "It feels slick enough"
- "Polish is subjective, move on"
- "There's no goals.md so I'll guess at intent"
- "Tests pass, ship it"

These are correct outputs AFTER applying all four lenses live, not substitutes for doing so.

## Rationalizations to resist

| Excuse                                                              | Reality                                                                                                                           |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| "Lens 3/4 are subjective — skip"                                    | Subjective lenses are exactly what this skill exists to apply deliberately. Skipping them defeats the point                       |
| "`/iterate-live` already ran, we're done"                           | `/iterate-live` measures structure. It does not exercise handlers, verify intent compliance, or hunt improvements. Different lens |
| "No goals.md, so heuristics alone are fine"                         | Heuristics don't catch missing features. Solicit intent                                                                           |
| "Small polish fix, hand-fix it"                                     | Dispatch pattern catches regressions via `git diff`. Hand-fix trusts nothing                                                      |
| "Lens 1 is passing, let me focus on Lens 4"                         | If Lens 1 was truly exercised end-to-end, Lens 4 is cheap. Usually "Lens 1 passing" means you ran it shallowly. Re-apply          |
| "Improvement opportunity obviously right, no need for decisions.md" | Clear wins are exactly what decisions.md is for — the audit trail is the whole point of "taking liberties"                        |
| "Teardown takes 10s, skip it"                                       | Cached state in the old instance is the single biggest cause of false-positive/false-negative findings                            |
| "Sweep + simplify converged, good enough"                           | Good. Exit criterion met. This one's fine — just confirm `decisions.md` and `open-questions.md` are surfaced to the user          |

## Before declaring "refine-live complete"

You MUST have:

1. **Launched the extension live** and exercised every mode at least once
2. **Verified Lens 1 on every entry point** — handlers actually ran, not just clicked
3. **Applied Lens 2 against goals/intent** — every point walked, divergences noted
4. **Applied Lens 3 heuristics** — at least one measurable invariant per heuristic where relevant
5. **Applied Lens 4 improvement hunting** — documented at least one reviewed opportunity (even if declined)
6. **Read the console for errors** per state (`read_console { level: "error" }`)
7. **Written `decisions.md` for every liberty taken**
8. **Surfaced `open-questions.md` to the user**
9. **Cleared a Phase 5 sweep AND a Phase 6 simplify with no new findings**

Missing any of those = work is not complete. "Code paths look clean" / "ran iterate-live" / "tests pass" are not substitutes.

## Output artifacts

- `.tasks/<feature>-refine/findings.md` — severity + status table + detailed entries across all four lenses
- `.tasks/<feature>-refine/open-questions.md` — design decisions needing user input
- `.tasks/<feature>-refine/decisions.md` — liberties taken, with rationale (audit trail)
- Clean working tree with targeted commits (or staged changes) across many files
- Clean live console (only third-party noise)

## Related skills

**REQUIRED BACKGROUND:**

- `/inspect-live` — primitive MCP tool reference; used throughout
- `/iterate-live` — sibling live skill; this skill borrows its loop structure and dispatch discipline. Read it if you haven't.
- `/simplify` — 3-agent parallel code cleanup; invoked in Phase 6

**Related lenses:**

- `/ux-review` — static counterpart to Lens 2; useful for pre-merge review without running the extension
- `/deep-review` — static counterpart to Lens 1 correctness; complements this skill's live handler verification
- `/review` — standards + completeness diff review
