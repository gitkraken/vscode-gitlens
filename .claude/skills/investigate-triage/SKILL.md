---
name: investigate-triage
description: Spawn parallel investigations for bug issues from a triage report — reads a triage report, fetches issue details, and runs /investigate subagents for each qualifying bug
---

# /investigate-triage - Batch Bug Investigation from Triage Report

Read a triage report and spawn parallel `/investigate` subagents for bug issues that need deeper analysis.

## Usage

```
/investigate-triage [report-path] [--verdict "Valid - Needs Triage"] [--max 10]
```

- `report-path` — Path to a triage decisions JSON file (e.g., `.triage/reports/DECISIONS-2026-03-18.json`). If omitted, use the most recent `DECISIONS-*.json` in `.triage/reports/`.
- `--verdict` — Which verdict(s) to investigate. Defaults to `Valid - Needs Triage`. Can be comma-separated (e.g., `"Valid - Needs Triage,Request More Info"`).
- `--max` — Maximum number of issues to investigate in parallel. Defaults to 10.

## Instructions

### Stage 0 — Load and Filter Issues

1. Read the decisions JSON file specified (or find the most recent one)
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
  3. Instructions to follow the `/investigate` methodology:
     - Understand the symptom from the issue description
     - Trace the relevant code path in the codebase
     - Form at least 2 hypotheses
     - Gather evidence by reading code
     - Present findings in the investigation format
  4. A critical instruction: **If there is not enough information in the issue to form a meaningful hypothesis, or if the investigation yields only low-confidence results, state that clearly and do not force a conclusion.** It is perfectly acceptable to report "insufficient information to investigate" or "investigation inconclusive".
  5. The subagent should write its findings to stdout (not to files) — you will collect the results

Run subagents in parallel where possible. Each subagent operates independently.

### Stage 3 — Collect and Report

Gather all subagent results and produce a report file:

**File**: `.triage/reports/INVESTIGATION-REPORT-YYYY-MM-DD.md`

```markdown
# Investigation Report — YYYY-MM-DD

Source: <decisions file path>
Issues investigated: N
Issues with findings: N
Issues inconclusive: N

---

## Findings

### [#NNNN — Title](https://github.com/<owner>/<repo>/issues/NNNN)

- **Triage verdict**: <original verdict from triage>
- **Investigation result**: Confirmed Bug | Likely Fixed | Cannot Reproduce from Description | Inconclusive | Insufficient Information
- **Confidence**: High | Medium | Low

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

## Summary

- **Confirmed bugs**: N (list issue numbers)
- **Likely already fixed**: N (list issue numbers)
- **Inconclusive**: N (list issue numbers)
- **Skipped (over max)**: N
```

Write the file and report its path to the user.

## Important Notes

- This skill is intentionally expensive — each subagent performs a full code investigation. The user has opted in to this cost.
- Do NOT skip the investigation for an issue just because it seems complex. Let the subagent try and report what it finds.
- DO skip issues that are clearly feature requests mislabeled as bugs — note these in the report.
- Subagent failures (timeouts, errors) should be noted in the report, not silently dropped.
- If a subagent finds that a bug has already been fixed (e.g., the code path no longer has the described behavior), report that as "Likely Fixed" — this is valuable triage signal.
