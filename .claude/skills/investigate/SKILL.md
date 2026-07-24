---
name: investigate
description: Investigate bugs — single-issue deep root cause analysis or batch parallel investigation from a report or issue list
---

# /investigate - Bug Investigation

Perform structured root cause analysis of bugs. Operates in two modes: single-issue deep investigation or batch parallel investigation across multiple issues.

## Pair with `/live-exercise` when the trace alone won't close the case

This skill is the static-tracing layer: read code, form a hypothesis, point at a likely cause. **For many bugs that's enough — finish here.** But if the bug is reproducible in a running instance AND any of the following apply, **escalate to `/live-exercise` after the trace** to validate the theory, add temporary logging and observe it, or iterate fix → re-verify:

- **Visible UI behavior**: flaky rendering, intermittent visual glitches, hover/focus/animation issues, layout overflow, "user clicks X and sometimes Y"
- **Timing / event / race**: focus shifts, microtask vs task ordering, async chains, pointerdown→focusout→click sequences, debounced/throttled handlers
- **Cross-component state**: cause spans multiple modules, contexts, or shadow DOM boundaries — the trace keeps fanning out without converging
- **Theory needs empirical confirmation**: "I think the cause is X, but I'd have to read 8 more files to be sure" → faster to run the theory than to keep tracing
- **Iterative debug loop expected**: add logging → repro → read logs → adjust hypothesis → repro again. Single-shot static investigation can't do this efficiently
- **Bug surfaces only at runtime**: state-dependent, dataset-dependent, configuration-dependent — code looks correct but behaves wrong in the live instance

**Pattern**: trace as far as the code alone takes you, identify the candidate cause(s), then hand off to `/live-exercise` to confirm or refute live. Don't skip the trace — but don't keep tracing past the point where running it would be cheaper.

**Stay entirely here for**: pure-logic bugs, parser/algorithm correctness, build/config errors, well-isolated functions where the trace is short, or when no running instance is available.

---

## Usage

```
/investigate <symptom or issue reference>                         # Single deep investigation
/investigate <number> <number> [number...]                        # Batch parallel investigation
/investigate --from-report [path] [--verdict "..."] [--max 10]   # Batch from triage report
```

- Single issue number or symptom — Deep investigation with full code tracing (runs in current agent)
- Two or more issue numbers — Parallel investigation via subagents, produces report files
- `--from-report` — Reads a triage decisions JSON. If path omitted, uses most recent `*-DECISIONS.json` in `.work/triage/reports/` (excluding `*-INVESTIGATION-DECISIONS.json`).
- `--verdict` — Filter report to specific verdict(s). Defaults to `Valid - Needs Triage`. Comma-separated. Only applies with `--from-report`.
- `--max` — Maximum parallel investigations. Defaults to 10. Only applies to batch mode.

## Mode Selection

**Single mode** — invoked with one issue number or a symptom description. Performs a deep, thorough investigation in the current agent context. Best for focused debugging.

**Batch mode** — invoked with 2+ issue numbers or `--from-report`. Spawns parallel subagents, each performing an independent investigation. Produces report files. Best for processing a queue of issues.

---

## Single Mode Instructions

### 1. Understand the Symptom

- Restate the symptom to confirm understanding
- Identify: extension host or webview? Node.js or browser? Which feature area?
- Ask clarifying questions if ambiguous

### 1a. Relevance Assessment (for issues older than 1 year)

If the issue is older than 1 year, perform a quick relevance check before the full investigation:

1. Identify the feature area, code paths, UI elements, settings, or commands mentioned in the issue
2. Check if the referenced files still exist using `Glob` or `Grep`
3. If they exist, check `git log --since="<issue creation date>" -- <relevant files>` for significant changes
4. If files have been deleted or substantially rewritten, include a **Relevance Assessment** in the output:

```markdown
### Relevance Assessment

[One of:

- "Code path still exists — issue may still be relevant"
- "Code path no longer exists — [file(s)] deleted/removed since issue was filed"
- "Feature area significantly refactored — [summary of changes since issue creation]"
- "Unable to map issue to specific code paths — proceeding with investigation"]
```

If the code path no longer exists, note this prominently and consider whether the investigation should continue or if the issue should be recommended for closure.

### 2. Trace the Code Path

- Find the entry point (command, event handler, IPC message)
- Read every function in the call chain — do NOT assume behavior from names
- For decorated methods, understand how the decorator alters behavior (see Decorator Reference below)
- Read decorator source in `packages/utils/src/decorators/` if behavior is unclear

### 3. Form Hypotheses

- List at least 2 possible root causes
- For each, identify what evidence would confirm or refute it
- Gather evidence by reading code, checking error types, tracing data flow

### 4. Audit Impact

- Search for ALL call sites of functions you plan to modify
- Check both `src/env/node/` and `src/env/browser/` paths
- Check per-operation git providers: `packages/git/src/providers/` and `packages/git-cli/src/providers/`

### 5. Assess Source Attribution

Before presenting findings, assess where the diagnosis came from:

- **Independent analysis** — Root cause was determined primarily by tracing code paths, reading implementations, and forming hypotheses from code evidence. The issue description described symptoms but did not point to the cause.
- **Confirmed reporter's diagnosis** — The issue already contained detailed code references, file paths, or a proposed root cause. The investigation verified these claims against the current code but did not independently discover the cause.

Be honest about this. Both are valuable — confirming a reporter's analysis is useful — but the reader should know what the investigation actually contributed.

### 6. Present Findings

```markdown
## Investigation: [Symptom]

### Symptom

[What goes wrong]

### Source Attribution

[One of: "Independent analysis from code tracing" | "Confirms reporter's diagnosis — the issue included [specific detail: code references / file paths / root cause hypothesis] which this investigation verified against current code" | "Mixed — [explain what came from the issue vs. independent tracing]"]

### Code Path

[Entry point] -> [Function 1] -> [Function 2 (@gate)] -> [Function 3]

### Root Cause

[Cause with file:line evidence]

### Alternative Causes Considered

1. [Alternative] — ruled out because [evidence]

### Proposed Fix

[Minimal change to address root cause]

### Impact

- Files to modify: [list]
- Call sites checked: [count]
- Platform paths verified: Node.js [yes/no], Browser [yes/no]
```

### 7. Get Confirmation

Present findings and proposed fix. Wait for user confirmation before implementing.

---

## Batch Mode Instructions

### Stage 0 — Load and Filter Issues

**Direct mode (2+ issue numbers):**

Use the provided issue numbers directly. Proceed to Stage 1.

**From-report mode (`--from-report`):**

1. Read the decisions JSON file specified (or find the most recent `*-DECISIONS.json` in `.work/triage/reports/`, excluding `*-INVESTIGATION-DECISIONS.json`)
2. Filter verdicts to only those matching the `--verdict` filter AND where the issue is a bug (check `recommendedLabels` or the corresponding markdown report for type info)
3. If no matching issues are found, report that and stop
4. If more issues match than `--max`, take the first N and note how many were skipped

### Stage 1 — Fetch Issue Context

For each qualifying issue, use the GitHub CLI to fetch the full issue body and comments:

```bash
gh issue view <number> --repo <repo> --json title,body,comments,labels,state,author,createdAt,updatedAt
```

The repo slug comes from the decisions JSON's corresponding evidence pack, or default to `gitkraken/vscode-gitlens`.

### Stage 2 — Spawn Investigation Subagents

For each issue, spawn a subagent (using the Agent tool) with:

- `subagent_type`: general-purpose
- A prompt that includes:
  1. The issue number, title, body, and comments (formatted for readability)
  2. The labels and any existing evidence summary from the triage verdict
  3. Instructions to follow the single-mode investigation methodology:
     - Understand the symptom from the issue description
     - Trace the relevant code path in the codebase
     - Form at least 2 hypotheses
     - Gather evidence by reading code
     - Assess source attribution: was the root cause found independently via code tracing, or was it confirming analysis already present in the issue?
     - Estimate effort (Small/Medium/Large) and risk (Low/Medium/High) based on the scope of the fix
     - Present findings in the investigation format
  4. A critical instruction: **If there is not enough information in the issue to form a meaningful hypothesis, or if the investigation yields only low-confidence results, state that clearly and do not force a conclusion.** It is perfectly acceptable to report "insufficient information to investigate" or "investigation inconclusive".
  5. The subagent should write its findings to stdout (not to files) — you will collect the results

Run subagents in parallel where possible. Each subagent operates independently.

### Stage 3 — Collect and Report

Gather all subagent results and produce report files:

**File**: `.work/triage/reports/YYYY-MM-DD-INVESTIGATION-REPORT.md`

```markdown
# Investigation Report — YYYY-MM-DD

Source: <decisions file path or "direct">
Issues investigated: N
Issues with findings: N
Issues inconclusive: N

---

## Findings

### [#NNNN — Title](https://github.com/<owner>/<repo>/issues/NNNN)

- **Author**: @username (team) | @username
- **Triage verdict**: <original verdict from triage, or "N/A" for direct mode>
- **Investigation result**: Confirmed Bug | Likely Fixed | Cannot Reproduce from Description | Inconclusive | Insufficient Information
- **Confidence**: High | Medium | Low
- **Source attribution**: Independent analysis | Confirms reporter's diagnosis | Mixed
- **Estimated effort**: Small (hours) | Medium (1-3 days) | Large (3+ days) | Unknown
- **Risk level**: Low | Medium | High | Unknown

#### Symptom

<restated from issue>

#### Code Path

<entry point> -> <function chain with file:line references>

#### Root Cause Analysis

<findings or "insufficient information to determine">

#### Alternative Causes Considered

1. <alternative> — ruled out because <evidence>

#### Recommendation

<what to do next — fix approach, request specific info from reporter, close, etc.>

---

## Inconclusive Issues

Issues where investigation could not reach a meaningful conclusion:

- [#NNNN — Title](https://github.com/<owner>/<repo>/issues/NNNN) — <reason: insufficient repro info | vague description | external dependency | etc.>

---

## Classification Matrix

Buckets confirmed/likely bugs by estimated effort and risk to aid prioritization:

| Issue | Effort | Risk | Summary                       |
| ----- | ------ | ---- | ----------------------------- |
| #NNNN | Small  | Low  | <one-line description of fix> |
| #NNNN | Medium | High | <one-line description of fix> |

**Effort guide**: Small = isolated change, hours of work; Medium = multiple files/systems, 1-3 days; Large = architectural or cross-cutting, 3+ days.
**Risk guide**: Low = safe, localized change; Medium = touches shared code or has edge cases; High = could regress other features or affects critical paths.

### Quick Wins (Small effort, Low/Medium risk)

- #NNNN — <title>

### Needs Planning (Medium/Large effort or High risk)

- #NNNN — <title> — <why it needs planning>

---

## Summary

- **Confirmed bugs**: N (list issue numbers)
- **Likely already fixed**: N (list issue numbers)
- **Inconclusive**: N (list issue numbers)
- **Skipped (over max)**: N
```

Write the markdown file and report its path to the user.

#### Machine-Readable JSON

Also produce a machine-readable companion file: `.work/triage/reports/YYYY-MM-DD-INVESTIGATION-DECISIONS.json`

```json
{
	"reportId": "<uuid>",
	"sourceDecisionsFile": "<path to triage decisions that triggered this, or null for direct mode>",
	"generatedAt": "<ISO timestamp>",
	"investigations": [
		{
			"issueNumber": 1234,
			"result": "Confirmed Bug | Likely Fixed | Cannot Reproduce | Inconclusive | Insufficient Information",
			"confidence": "High | Medium | Low",
			"sourceAttribution": "Independent | Confirms Reporter | Mixed",
			"estimatedEffort": "Small | Medium | Large | Unknown",
			"riskLevel": "Low | Medium | High | Unknown",
			"rootCauseSummary": "...",
			"proposedFix": "...",
			"affectedFiles": ["src/path/to/file.ts"],
			"blockedBy": null | "vscode" | "git" | "cli" | "language-server" | "other",
			"blockedDetail": "...",
			"recommendation": "Fix | Request Info | Close | Needs Planning | Blocked"
		}
	]
}
```

Generate a UUID for `reportId`. Write both files and confirm their paths to the user.

---

## Important Notes

- Batch mode is intentionally expensive — each subagent performs a full code investigation. The user has opted in to this cost.
- Do NOT skip the investigation for an issue just because it seems complex. Let the subagent try and report what it finds.
- DO skip issues that are clearly feature requests mislabeled as bugs — note these in the report.
- Subagent failures (timeouts, errors) should be noted in the report, not silently dropped.
- If a subagent finds that a bug has already been fixed (e.g., the code path no longer has the described behavior), report that as "Likely Fixed" — this is valuable triage signal.

## Anti-Patterns

- Do NOT start implementing before completing the investigation
- Do NOT blame logging decorators for hangs — check `@gate()` first
- Do NOT propose disabling/removing a feature when asked to fix it
- Do NOT suppress errors — fix the root cause or propagate properly

### Common Misdiagnosis Patterns to Avoid

1. **Blaming logging decorators for hangs**: When a method hangs, the issue is almost never in `@info()`/`@debug()`/`@trace()`. Check `@gate()` (promise never resolving) or the actual async operation first.
2. **Confusing `@gate()` and `@sequentialize()`**: `@gate()` returns the SAME promise to concurrent callers. `@sequentialize()` QUEUES calls. These solve different problems.
3. **Wrong error type handling**: Use the error's `.is()` static method with reason discriminator: `PushError.is(ex, 'noUpstream')`, not `instanceof` + `ex.message.includes(...)`.
4. **Platform-specific bugs**: Something working in Node.js may fail in browser (and vice versa). Always check the `@env/` abstraction layer.
5. **Scope/context bugs**: `getScopedLogger()` returns stale scope after `await` in browser. Capture the scope before the first `await`.
6. **Suppressing errors instead of fixing them**: Do NOT silence errors by catching and ignoring them. Fix the root cause or propagate them properly (e.g., use `errors: throw` so catch blocks handle them).

## Chaining

This skill can be used standalone or as part of the issue workflow pipeline:

```
/triage recent → /investigate --from-report → /prioritize --from-report → /update-issues
/triage 5096   → /investigate 5096          → /prioritize 5096          → /update-issues
/investigate 5096 5084                        (standalone batch)
/investigate #5096                            (standalone single)
```

Upstream: `--from-report` consumes triage decisions JSON from `/triage`.
Downstream: `/prioritize --from-report` consumes the investigation decisions JSON. `/update-issues` can also consume it directly.

## Decorator Reference

See `AGENTS.md` § Decorator System for the behavior table, gotchas, and stacking order. Read the decorator source in `packages/utils/src/decorators/` when behavior is unclear — options like gate grouping keys/deadlock detection, memoize version-keyed invalidation, and sequentialize queue keys often matter during investigation.

**Debugging priority:**

1. `@gate()` — hangs, timeouts, deadlocks (check for circular waits: a nested gated call waiting on the outer gate)
2. `@memoize()` — stale data, cached rejections (no TTL; rejected Promises stay cached)
3. Logging decorators — rarely the cause
