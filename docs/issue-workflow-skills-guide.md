# Issue Workflow Skills — Usage Guide

How to use the issue workflow skills to triage, investigate, plan, and act on GitHub issues.

## Skills Overview

| Skill                 | Purpose                                        | Modifies GitHub? |
| --------------------- | ---------------------------------------------- | ---------------- |
| `/triage`             | First-pass review: categorize, filter, verdict | No               |
| `/investigate`        | Deep root cause analysis of a single bug       | No               |
| `/investigate-triage` | Batch investigation of bugs from triage report | No               |
| `/resolve`            | Recommend resolution: shortlist, backlog, etc. | No               |
| `/apply-actions`      | Apply recommendations to GitHub issues         | **Yes**          |

All analysis skills are read-only. Only `/apply-actions` modifies GitHub state, and it requires explicit confirmation before every action.

---

## Quick Reference

| I want to...                                       | Run this                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Triage one issue                                   | `/triage 5096`                                                                                         |
| Triage this week's new issues                      | `/triage recent`                                                                                       |
| Triage with a 14-day window                        | `/triage recent --since 14d`                                                                           |
| Audit old backlog issues                           | `/triage audit --older-than 365d`                                                                      |
| Investigate a specific bug                         | `/investigate #5096`                                                                                   |
| Batch-investigate bugs from a triage report        | `/investigate-triage`                                                                                  |
| Investigate specific issues without triaging first | `/investigate-triage 5096 5084`                                                                        |
| Get priority/milestone recommendations             | `/resolve 5096`                                                                                        |
| Get recommendations from triage results            | `/resolve --from-triage`                                                                               |
| Get recommendations enriched by investigation      | `/resolve --from-investigation`                                                                        |
| Apply recommended actions to GitHub                | `/apply-actions`                                                                                       |
| Dry-run to see what would be applied               | `/apply-actions --dry-run`                                                                             |
| Full pipeline: triage through apply                | `/triage recent` then `/investigate-triage` then `/resolve --from-investigation` then `/apply-actions` |

---

## Workflows by Outcome

### Outcome 1: Engineers spend less time figuring out what to work on

**Problem:** Engineers don't know which issues are highest priority, and issues lack enough context to start work.

**Workflow A — Prioritize recent issues:**

```
/triage recent --since 14d
/resolve --from-triage
```

1. `/triage recent` evaluates recent issues and produces a triage report with verdicts
2. `/resolve --from-triage` reads the triage decisions and produces a resolution report ranking issues by priority signals (reactions, severity, related issues, effort)

The resolution report's **Shortlist** section shows the highest-priority issues with rationale. The **Priority Signals** table for each issue gives engineers concrete data (e.g., "45 thumbs-up, 3 related issues, broken workflow").

**Workflow B — Prioritize with investigation context:**

```
/triage recent
/investigate-triage
/resolve --from-investigation
```

Adding `/investigate-triage` between triage and resolve provides root cause analysis, effort estimates, and fix approaches. The resolution report then has more accurate effort/risk data to drive recommendations.

**Workflow C — Quick prioritization of specific issues:**

```
/resolve 5096 5084 5070
```

Skip triage entirely. Directly evaluate specific issues for priority signals and produce recommendations. Useful when someone asks "which of these should we work on next?"

---

### Outcome 2: Engineers spend less time on low-value issue review

**Problem:** Engineers waste time reviewing issues with missing info, duplicates, spam, and out-of-scope requests.

**Workflow A — Weekly triage of incoming issues:**

```
/triage recent
/apply-actions
```

1. `/triage recent` evaluates all issues opened in the last 7 days. It produces:
   - **Spam/junk** identified and flagged
   - **Duplicates** linked to canonical issues
   - **Missing info** with draft comments requesting specifics (logs, repo setup, version)
   - **Miscategorized** issues flagged for relabeling (bug vs. enhancement)
   - **Out of scope** issues identified
2. `/apply-actions` reads the triage decisions and presents a dry-run of all recommended label changes, comments, and closures. Approve to execute.

**Workflow B — Triage a specific issue someone reported:**

```
/triage 5096
```

Quick single-issue triage. Checks for sufficient info, duplicates, correct categorization, and scope. Returns a verdict with confidence level.

**Workflow C — Triage with label filter:**

```
/triage audit --older-than 180d --label bug
```

Focus triage on a specific category of backlog issues.

---

### Outcome 3: Engineers spend less time investigating bugs

**Problem:** Bug investigation is time-consuming — requires reading the issue, tracing code, forming hypotheses, and writing up findings.

**Workflow A — Investigate a single bug:**

```
/investigate #5096
```

Produces a structured investigation report with: symptom, code path trace, root cause hypothesis (with confidence), alternative causes considered, proposed fix, and impact assessment (files to modify, call sites, platform paths). For old issues (> 1 year), includes a relevance assessment checking if the code path still exists.

**Workflow B — Batch investigation from triage:**

```
/triage recent
/investigate-triage
```

1. `/triage recent` identifies issues needing investigation (`Valid - Needs Triage` verdict)
2. `/investigate-triage` reads the triage decisions, spawns parallel investigation subagents for each qualifying bug, and produces:
   - Per-issue investigation reports with root cause, effort, and risk
   - A **Classification Matrix** bucketing issues by effort x risk
   - **Quick Wins** section (small effort, low/medium risk)
   - **Needs Planning** section (medium/large effort or high risk)

**Workflow C — Investigate specific issues directly:**

```
/investigate-triage 5096 5084 5070
```

Skip triage — investigate specific issue numbers directly. Useful when you already know which issues need investigation.

**Workflow D — Apply investigation results:**

```
/investigate-triage
/apply-actions
```

After investigation, `/apply-actions` can consume the investigation decisions JSON to label confirmed bugs as `triaged` and request more info for issues that can't be reproduced.

---

### Outcome 4: Leadership has clear signals for planning

**Problem:** PMs and EMs need priority signals, milestone recommendations, and aggregate views to inform roadmap decisions.

**Workflow A — Full pipeline for planning:**

```
/triage recent --since 30d
/investigate-triage
/resolve --from-investigation
```

The resolution report provides:

- **Summary table** with counts by recommendation (Shortlist: 5, Backlog: 12, Won't Fix: 3, Community Contribution: 2)
- **Per-issue priority signals** (reactions, related issues, severity, effort, age, activity)
- **Rationale** for each recommendation grounded in specific data
- **Machine-readable JSON** (`YYYY-MM-DD-RESOLUTIONS.json`) for downstream tooling

**Workflow B — Quick planning view for specific issues:**

```
/resolve 5096 5084 5070 4999 4800
```

Evaluate a hand-picked set of issues and get priority recommendations. Useful for sprint planning when you have a candidate list.

**Workflow C — Planning signals without investigation:**

```
/triage recent
/resolve --from-triage
```

Faster than the full pipeline — skips investigation. Effort estimates are inferred from issue descriptions rather than codebase analysis. Good enough for initial planning; run investigation later for shortlisted items.

**What leadership gets from each report:**

| Report               | Key signals for leadership                                             |
| -------------------- | ---------------------------------------------------------------------- |
| Triage report        | Issue volume, quality (spam/duplicate %), investigation queue size     |
| Investigation report | Classification matrix, quick wins list, needs-planning list            |
| Resolution report    | Shortlist/backlog split, priority signals per issue, aggregate summary |

---

### Outcome 5: Reduce the rotting of old issues

**Problem:** 876 open issues dating back to 2018. Many are stale, outdated, or already fixed.

**Workflow A — Systematic backlog audit (batch processing):**

```
/triage audit --older-than 365d --batch-size 50
/apply-actions
```

Run in batches. The triage skill in audit mode:

- Checks for **stale issues** (365+ days inactive, feature still exists or superseded)
- Checks for **codebase-level staleness** (referenced UI/settings/commands no longer exist)
- Identifies **issues needing verification** (old version, no activity, low engagement → `Request More Info` which triggers auto-close automation if no response)
- Detects **already fixed** issues using the Two-Source Rule (changelog + merged PR)

Repeat with `--batch 2`, `--batch 3`, etc. to work through the full backlog.

**Workflow B — Targeted audit of a specific age range:**

```
/triage audit --older-than 180d --label enhancement
```

Focus on enhancement requests older than 6 months. These often accumulate as "nice to have" items that never get prioritized.

**Workflow C — Re-evaluate old issues with investigation:**

```
/triage audit --older-than 365d
/investigate-triage
/resolve --from-investigation
/apply-actions
```

The full pipeline on old issues. Investigation includes a **Relevance Assessment** for issues older than 1 year, checking whether the affected code paths still exist. The resolve step provides milestone recommendations. Apply-actions closes stale issues, requests verification on uncertain ones, and labels confirmed bugs.

**Workflow D — Spot-check specific old issues:**

```
/triage 1234 2345 3456
```

Triage a handful of specific old issues. Useful when a user asks about an old issue or when reviewing issues referenced in a PR.

**Staleness detection — two paths:**

| Condition                                                   | Triage verdict      | Apply-actions behavior                                                                                     |
| ----------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Code refactored or removed since issue filed                | `Close - Stale`     | Close with explanatory comment                                                                             |
| Old version, no activity, low engagement, code still exists | `Request More Info` | Add `needs-more-info` label + comment asking to verify on current version (triggers auto-close automation) |

---

## Composability Reference

Every skill works standalone or chained. Here are all supported input modes:

### `/triage`

| Input            | Example                                           |
| ---------------- | ------------------------------------------------- |
| Single issue     | `/triage 5096`                                    |
| Multiple issues  | `/triage 5096 5084 5070`                          |
| Recent batch     | `/triage recent --since 7d`                       |
| Historical batch | `/triage audit --older-than 180d --batch-size 50` |
| Filtered batch   | `/triage audit --older-than 180d --label bug`     |

**Output:** `.triage/reports/YYYY-MM-DD-TRIAGE-REPORT.md` + `YYYY-MM-DD-DECISIONS.json`

### `/investigate`

| Input               | Example                                      |
| ------------------- | -------------------------------------------- |
| Symptom description | `/investigate blame annotations not showing` |
| Issue reference     | `/investigate #5096`                         |

**Output:** Investigation report in conversation (not written to file)

### `/investigate-triage`

| Input                | Example                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| From triage report   | `/investigate-triage` (uses most recent decisions JSON)                  |
| Specific report      | `/investigate-triage .triage/reports/2026-04-01-DECISIONS.json`          |
| Direct issue numbers | `/investigate-triage 5096 5084`                                          |
| Filtered verdicts    | `/investigate-triage --verdict "Valid - Needs Triage,Request More Info"` |
| Limited parallelism  | `/investigate-triage --max 5`                                            |

**Output:** `.triage/reports/YYYY-MM-DD-INVESTIGATION-REPORT.md` + `YYYY-MM-DD-INVESTIGATION-DECISIONS.json`

### `/resolve`

| Input                 | Example                                                            |
| --------------------- | ------------------------------------------------------------------ |
| Direct issue numbers  | `/resolve 5096 5084 5070`                                          |
| From triage decisions | `/resolve --from-triage`                                           |
| From specific triage  | `/resolve --from-triage .triage/reports/2026-04-01-DECISIONS.json` |
| From investigation    | `/resolve --from-investigation`                                    |

**Output:** `.triage/reports/YYYY-MM-DD-RESOLUTION-REPORT.md` + `YYYY-MM-DD-RESOLUTIONS.json`

### `/apply-actions`

| Input              | Example                                                      |
| ------------------ | ------------------------------------------------------------ |
| Most recent report | `/apply-actions`                                             |
| Specific report    | `/apply-actions .triage/reports/2026-04-01-RESOLUTIONS.json` |
| Dry-run only       | `/apply-actions --dry-run`                                   |

**Consumes:** Any of the three JSON report types (triage decisions, investigation decisions, resolution decisions)

**Output:** Dry-run table → user confirmation → execution → `.triage/reports/YYYY-MM-DD-ACTIONS.md` audit log

---

## Pipeline Chains

### Minimal: Triage + Apply

```
/triage recent → /apply-actions
```

Triage issues, then apply labels/comments/closures. Good for weekly inbox processing.

### Standard: Triage + Investigate + Apply

```
/triage recent → /investigate-triage → /apply-actions
```

Triage, then investigate bugs, then apply results. Good when you need to understand root causes before acting.

### Full: Triage + Investigate + Resolve + Apply

```
/triage recent → /investigate-triage → /resolve --from-investigation → /apply-actions
```

Triage, investigate, get planning recommendations, then apply. Good for milestone/sprint planning.

### Shortcut: Resolve + Apply

```
/resolve 5096 5084 → /apply-actions
```

Skip triage and investigation. Get recommendations and apply. Good for ad-hoc prioritization of known issues.

---

## Output Files

All reports are written to `.triage/reports/`. Each analysis skill produces both a human-readable markdown report and a machine-readable JSON file.

| File pattern                     | Producer              | Consumer                                                          |
| -------------------------------- | --------------------- | ----------------------------------------------------------------- |
| `TRIAGE-REPORT-*.md`             | `/triage`             | Humans                                                            |
| `DECISIONS-*.json`               | `/triage`             | `/investigate-triage`, `/resolve --from-triage`, `/apply-actions` |
| `*-INVESTIGATION-REPORT.md`      | `/investigate-triage` | Humans                                                            |
| `*-INVESTIGATION-DECISIONS.json` | `/investigate-triage` | `/resolve --from-investigation`, `/apply-actions`                 |
| `RESOLUTION-REPORT-*.md`         | `/resolve`            | Humans                                                            |
| `RESOLUTIONS-*.json`             | `/resolve`            | `/apply-actions`                                                  |
| `*-ACTIONS.md`                   | `/apply-actions`      | Humans (audit trail)                                              |

---

## Safety Model

1. **Analysis is read-only** — `/triage`, `/investigate`, `/investigate-triage`, and `/resolve` never modify GitHub issues
2. **Apply requires confirmation** — `/apply-actions` always shows a dry-run first and requires explicit approval
3. **Pre-flight checks** — `/apply-actions` verifies current issue state before each action, skipping stale or redundant changes
4. **Close confirmation** — Closing issues requires per-issue approval
5. **Audit trail** — Every applied action is logged to `.triage/reports/*-ACTIONS.md`
6. **Human-in-the-loop** — All close recommendations require human approval (`requiresHumanApproval: true`)

---

## Limitations and Notes

- **Single-issue duplicate detection is limited.** When triaging a single issue (`/triage 5096`), duplicate detection only cross-references against other issues in the same evidence pack. For a single issue, there's nothing to cross-reference. Use `/resolve` which searches the full repo for related issues, or use batch triage (`/triage recent`) for better duplicate detection.
- **Specific iteration milestones require human judgment.** The `/resolve` skill recommends "Shortlist" or "Backlog" milestones but does not assign issues to specific iterations/sprints. Deciding which sprint an issue belongs to requires team context that the skills don't have. Use the priority signals from `/resolve` to inform that decision.
- **Rate limits constrain batch sizes.** `/resolve` uses GitHub's Search API (30 requests/min) for related-issue counting. Batches of 25+ issues will approach the rate limit. The skill budgets accordingly but large batches may take longer.
- **Investigation cost scales with issue count.** `/investigate-triage` spawns a parallel subagent per issue. Each performs a full codebase investigation. Use `--max` to control parallelism.
