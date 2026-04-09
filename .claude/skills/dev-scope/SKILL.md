---
name: dev-scope
description: Scope a unit of work into a goals document — defines what and why, not how. Bridge between triage output and dev planning. Produces .work/dev/{identifier}/goals.md for /deep-planning to consume.
---

# /dev-scope - Scope Work into Goals

Take a unit of work and produce a goals document that anchors _why_ throughout the dev pipeline. Defines what needs to happen, what the user should experience, and what constraints matter — not how to build it.

This is the bridge between triage and dev. Investigation tells you what's broken and where. Goals tell you what the user should experience when it's fixed, what "done" looks like, and what constraints aren't about the code.

## Usage

```
/dev-scope <number>                    # Issue with or without investigation
/dev-scope <number> [number...]        # Multiple issues (one goals.md each)
/dev-scope "<description>"             # Idea or task with no issue
```

## Design Principle

**Detect the gap, recommend the step, don't absorb it.** When context is missing (e.g., a bug without an investigation report), tell the user what's missing and recommend the appropriate skill. Do not silently perform another skill's job.

---

## Instructions

### Stage 0 — Determine Input and Create Dev Folder

**Issue mode (one or more numbers):**

1. For each issue, fetch full context:

```bash
gh issue view <number> --repo gitkraken/vscode-gitlens --json number,title,body,comments,labels,state,author,createdAt,updatedAt,milestone,assignees
```

2. Determine if the issue is a bug or feature request from its labels, type, and content.

3. Create the dev folder: `.work/dev/<number>/`

**Description mode (quoted string, no issue number):**

1. Create a descriptive slug from the description (lowercase, hyphens, max 50 chars). Example: `"add natural language search"` becomes `add-natural-language-search`.

2. Create the dev folder: `.work/dev/<slug>/`

3. There is no issue to fetch — the description is the entire input. Skip to Stage 2.

### Stage 1 — Gather Existing Context

**For bugs — check for investigation report:**

Search for an investigation report that covers this issue:

```bash
ls -t .work/triage/reports/*INVESTIGATION-DECISIONS.json 2>/dev/null | head -5
```

If found, read the JSON and look for an entry where `issueNumber` matches. If a matching entry exists:

- Import: `rootCauseSummary`, `proposedFix`, `affectedFiles`, `estimatedEffort`, `riskLevel`, `confidence`, `sourceAttribution`
- Note the source file path for the goals doc's Source section
- Do NOT re-investigate — this work is already done

If no investigation report exists for this bug:

> **Stop and recommend.** Present this to the user:
>
> No investigation report found for #NNNN. This is a bug — running `/investigate NNNN` first will give `/dev-scope` root cause analysis, affected files, and fix direction to build on.
>
> Proceed without investigation, or run `/investigate` first?

Wait for the user's response. If they say proceed, continue with what's available from the issue alone. If they want investigation first, stop and let them run it.

**For features and explorations:**

No investigation lookup needed. Proceed directly to Stage 2.

### Stage 2 — Verify Claims Against Codebase

Treat every verifiable claim from the issue as a hypothesis. This applies to ALL issue types — bugs and features alike.

**What to verify:**

- UI elements mentioned (views, buttons, menus, status bar items) — do they exist? Are they named correctly?
- Settings or configuration options referenced — do they exist in `package.json` or `src/config.ts`?
- Commands referenced — do they exist in `contributions.json` or `src/constants.commands.ts`?
- Described behavior ("when I click X, Y happens") — does the code path support this?
- Error messages quoted — do they appear in the source?
- Version-specific claims ("this worked in v14") — check CHANGELOG or git history if practical

**How to verify:**

Use `Grep` and `Glob` for quick lookups. Read relevant source files when behavior claims need tracing. Do not launch full investigations — this is lightweight verification, not root cause analysis.

**Record results in three buckets:**

- **Confirmed** — claim checked out against current code
- **Disputed** — claim contradicts what the code shows (include what the code actually does)
- **Unverifiable** — can't confirm or deny from code alone (e.g., "intermittent", "sometimes", environment-specific)

If the issue has no verifiable claims (pure feature request described abstractly), note "No verifiable claims — feature request described in abstract terms" and move on.

### Stage 3 — Map User Experience

This is the layer that investigation reports don't cover and that `/deep-planning` will lose if nobody writes it down.

**For bugs:**

- **Trigger**: What does the user do that causes the bug? (action, context, preconditions)
- **Current experience**: What does the user actually see/experience? (the broken state)
- **Expected experience**: What should happen instead? (the fixed state, from the user's perspective)
- **Workarounds**: Are there any? What's the cost of using them?
- **Workflow context**: What was the user doing before this, and what are they trying to do after?

**For features:**

- **Trigger**: What initiates this feature? (command, UI interaction, automatic detection)
- **Expected flow**: Step-by-step from the user's perspective — what they see, what they do, what happens
- **Edge cases**: What happens when things go wrong, inputs are unexpected, or the feature can't complete?
- **Discoverability**: How does the user learn this feature exists?
- **Workflow context**: What was the user doing before this, and what do they do after?

**For ideas/explorations:**

- Map what you can. If the UX is undefined, say so — that's useful signal for `/deep-planning`.

### Stage 4 — Map Code Landscape

Identify the code areas this work will touch. This is not a plan — it's a map so `/deep-planning` knows where to look.

- **Entry points**: Commands, event handlers, IPC messages, or activation paths relevant to this work
- **Affected paths**: Code paths that will be modified or impacted — both Node.js and browser where applicable
- **Patterns to follow**: Existing patterns in the codebase this work should align with (find a similar feature and reference it)
- **Risk areas**: Shared code, cross-environment paths (`src/env/node/` vs `src/env/browser/`), decorator-wrapped methods, high-traffic code paths

For bugs with investigation reports, the affected files are already known — verify they're still accurate and add any patterns or risk areas the investigation didn't cover.

For features, use `Grep` and `Glob` to find analogous features and map the relevant code areas. Reference specific files and functions.

### Stage 5 — Define Success Criteria

Write specific, testable conditions that define "done." These should cover both technical and UX dimensions.

**Good success criteria:**

- "The Commit Graph renders branch labels for all local branches, not just the current branch"
- "Clicking a blame annotation opens the commit details panel within 200ms"
- "The feature works in both desktop and web (vscode.dev) environments"

**Bad success criteria:**

- "The bug is fixed" (not testable)
- "Performance is improved" (not specific)
- "The feature works correctly" (circular)

### Stage 6 — Identify Constraints

Note things that must not break, performance requirements, environment considerations, and any scope boundaries.

Common constraint categories:

- **Behavioral**: Existing features that must continue working
- **Performance**: Operations that must stay within time/memory budgets
- **Environmental**: Must work in Node.js, browser, or both
- **Compatibility**: VS Code version requirements, API limitations
- **Scope**: What is explicitly out of scope for this unit of work

### Stage 7 — Assess Scoping Confidence

Before writing the goals doc, assess confidence across three dimensions:

- **Claims**: Tally confirmed, disputed, and unverifiable counts from Stage 2. This is mechanical — just count the buckets.
- **Code landscape**: How confident are you that the entry points, affected paths, and risk areas are complete? Rate High (clear, well-mapped area), Medium (found the main paths but the area is complex — may be missing some), or Low (couldn't confidently identify the relevant code). Include a brief reason if not High.
- **UX completeness**: Is the user experience section fully mapped, partially mapped, or minimal? Rate Complete (all fields filled with specifics), Partial (some fields are inferred or vague), or Minimal (UX is largely undefined — common for explorations). Note what's missing if not Complete.
- **Overall**: The lowest of code landscape and UX completeness drives this. If claims have more disputed/unverifiable than confirmed, that also pulls it down.

This gives `/deep-planning` actionable signal — "code landscape is Low confidence, verify entry points before committing to an approach."

### Stage 8 — Produce Goals Document

Write the goals document to `.work/dev/{identifier}/goals.md`.

---

## Output Format

```markdown
# Goals: #{issue} — {title}

(or for ideas without an issue:)

# Goals: {descriptive title}

## Source

- Issue: {GitHub URL or "none"}
- Type: Bug | Feature | Exploration
- Investigation: {path to investigation report entry or "none"}

## Summary

{2-3 sentence distillation of what needs to happen and why. Lead with the user impact, not the technical problem.}

## Verified Claims

{For each verified claim: what was checked and what the code confirmed.
If no verifiable claims: "No verifiable claims — [reason]."}

## Disputed / Unverifiable Claims

{Claims that didn't check out or couldn't be verified. Include what the code actually shows for disputed claims. Critical for /deep-planning — these are landmines.
If none: "All verifiable claims confirmed."}

## Success Criteria

{Specific, testable conditions — both technical and UX.}

## User Experience

- **Trigger**: {what the user does to initiate this}
- **Expected flow**: {step-by-step from the user's perspective}
- **Edge cases**: {what happens when things go wrong, from the user's POV}
- **Workflow context**: {what the user was doing before and what they do after}

(For bugs, also include:)

- **Current experience**: {the broken state}
- **Workarounds**: {if any, and their cost}

## Code Landscape

- **Entry points**: {files and functions}
- **Affected paths**: {code paths that will be modified or impacted}
- **Patterns to follow**: {existing patterns this should align with — reference specific files}
- **Risk areas**: {shared code, cross-environment paths, decorator-wrapped methods}

## Constraints

{Things that must not break, performance requirements, environment considerations, scope boundaries.}

## Investigation Import

(Only present when an investigation report was found. Omit entirely otherwise.)

- **Root cause**: {from investigation}
- **Proposed fix direction**: {from investigation}
- **Affected files**: {from investigation}
- **Effort estimate**: {from investigation}
- **Risk level**: {from investigation}
- **Confidence**: {from investigation}

## Scoping Confidence

- **Claims**: N confirmed, N disputed, N unverifiable
- **Code landscape**: High | Medium | Low — {why, if not High}
- **UX completeness**: Complete | Partial | Minimal — {what's missing}
- **Overall**: High | Medium | Low
```

---

## Multiple Issues

When invoked with multiple issue numbers, process each independently. Produce one `goals.md` per issue in separate dev folders. Present a summary at the end:

```
Scoped N issues:
- .work/dev/5096/goals.md — #5096: Commit graph branch labels missing
- .work/dev/5084/goals.md — #5084: Blame annotations slow on large files
```

---

## Chaining

This skill bridges the triage and dev pipelines:

```
Triage pipeline                          Dev pipeline
━━━━━━━━━━━━━━━                          ━━━━━━━━━━━━
/triage → /investigate → /prioritize →   /dev-scope → /deep-planning → /challenge-plan → [implement]
```

Upstream: Consumes investigation reports from `/investigate` (optional, auto-detected).
Downstream: `/deep-planning` consumes the `goals.md` produced by this skill.

```
/dev-scope 5096                          # Bug — looks for investigation report
/dev-scope 5096 5084                     # Multiple issues — one goals.md each
/dev-scope "natural language search"     # Idea — no issue, full extraction
```

## Anti-Patterns

- **Re-investigating bugs** — If `/investigate` already ran, import its findings. Don't redo the work.
- **Skipping claim verification** — Reporter claims are hypotheses, not facts. Always verify what you can.
- **Technical-only success criteria** — Every goals doc needs UX-level success criteria, not just code-level.
- **Absorbing other skills' jobs** — Don't silently run `/investigate` or start planning _how_. Stay in the _what_ and _why_.
- **Empty UX section** — If you can't map the user experience, say what's unknown. An explicit gap is better than a missing section.
- **Skipping code landscape for features** — Features need code mapping too. Find analogous features and reference them.
