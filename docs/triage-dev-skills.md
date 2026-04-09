# Issue Workflow Skills — Usage Guide

How to use the issue workflow skills to triage, investigate, prioritize, update GitHub issues, and take issues from triage through to implementation.

## Skills Overview

### Triage Pipeline — Evaluate and categorize issues

| Skill            | Purpose                                         | Modifies GitHub? |
| ---------------- | ----------------------------------------------- | ---------------- |
| `/triage`        | First-pass review: categorize, filter, verdict  | No               |
| `/investigate`   | Root cause analysis — single deep dive or batch | No               |
| `/prioritize`    | Recommend resolution: shortlist, backlog, etc.  | No               |
| `/update-issues` | Apply recommendations to GitHub issues          | **Yes**          |

### Dev Pipeline — Scope, plan, and review implementation

| Skill             | Purpose                                                 | Modifies code? |
| ----------------- | ------------------------------------------------------- | -------------- |
| `/dev-scope`      | Define what and why — bridge from triage to planning    | No             |
| `/deep-planning`  | Design technical approach — trade-offs and alternatives | No             |
| `/challenge-plan` | Stress-test the plan before implementation              | No             |
| `/deep-review`    | Post-implementation code review against goals           | No             |
| `/ux-review`      | Post-implementation UX review against goals             | No             |
| `/commit`         | Create well-formatted git commits                       | **Yes**        |

All analysis skills are read-only. Only `/update-issues` modifies GitHub state (with confirmation), and `/commit` modifies git state.

---

## Quick Reference

| I want to...                                       | Run this                                                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Triage one issue                                   | `/triage 5096`                                                                                                          |
| Triage this week's new issues                      | `/triage recent`                                                                                                        |
| Triage with a 14-day window                        | `/triage recent --since 14d`                                                                                            |
| Audit old backlog issues                           | `/triage audit --older-than 365d`                                                                                       |
| Investigate a specific bug                         | `/investigate #5096`                                                                                                    |
| Batch-investigate bugs from a triage report        | `/investigate --from-report`                                                                                            |
| Investigate specific issues without triaging first | `/investigate 5096 5084`                                                                                                |
| Get priority/milestone recommendations             | `/prioritize 5096`                                                                                                      |
| Get recommendations from a report                  | `/prioritize --from-report`                                                                                             |
| Update GitHub issues from a report                 | `/update-issues --from-report`                                                                                          |
| Dry-run to see what would be updated               | `/update-issues --from-report --dry-run`                                                                                |
| Full pipeline: triage through update               | `/triage recent` then `/investigate --from-report` then `/prioritize --from-report` then `/update-issues --from-report` |
| Scope an issue for development                     | `/dev-scope 5096`                                                                                                       |
| Scope a feature idea                               | `/dev-scope "add natural language search"`                                                                              |
| Plan implementation for a scoped issue             | `/deep-planning --scope .work/dev/5096/`                                                                                |
| Stress-test a plan before implementing             | `/challenge-plan --scope .work/dev/5096/`                                                                               |
| Review implementation against goals                | `/deep-review branch --scope .work/dev/5096/`                                                                           |
| Review UX against goals                            | `/ux-review branch --scope .work/dev/5096/`                                                                             |
| Run the full triage pipeline via script            | `pnpm workflow triage recent`                                                                                           |
| Run the full dev pipeline via script               | `pnpm workflow dev 5096`                                                                                                |
| Run a pipeline with second-opinion review          | `pnpm workflow triage recent --rubber-duck`                                                                             |

---

## Workflows by Outcome

### Outcome 1: Engineers spend less time figuring out what to work on

**Problem:** Engineers don't know which issues are highest priority, and issues lack enough context to start work.

**Workflow A — Prioritize recent issues:**

```
/triage recent --since 14d
/prioritize --from-report
```

1. `/triage recent` evaluates recent issues and produces a triage report with verdicts
2. `/prioritize --from-report` reads the triage decisions and produces a resolution report ranking issues by priority signals (reactions, severity, related issues, effort)

The resolution report's **Shortlist** section shows the highest-priority issues with rationale. The **Priority Signals** table for each issue gives engineers concrete data (e.g., "45 thumbs-up, 3 related issues, broken workflow").

**Workflow B — Prioritize with investigation context:**

```
/triage recent
/investigate --from-report
/prioritize --from-report
```

Adding `/investigate --from-report` between triage and prioritize provides root cause analysis, effort estimates, and fix approaches. The resolution report then has more accurate effort/risk data to drive recommendations.

**Workflow C — Quick prioritization of specific issues:**

```
/prioritize 5096 5084 5070
```

Skip triage entirely. Directly evaluate specific issues for priority signals and produce recommendations. Useful when someone asks "which of these should we work on next?"

---

### Outcome 2: Engineers spend less time on low-value issue review

**Problem:** Engineers waste time reviewing issues with missing info, duplicates, spam, and out-of-scope requests.

**Workflow A — Weekly triage of incoming issues:**

```
/triage recent
/update-issues --from-report
```

1. `/triage recent` evaluates all issues opened in the last 7 days. It produces:
   - **Spam/junk** identified and flagged
   - **Duplicates** linked to canonical issues
   - **Missing info** with draft comments requesting specifics (logs, repo setup, version)
   - **Miscategorized** issues flagged for relabeling (bug vs. enhancement)
   - **Out of scope** issues identified
2. `/update-issues --from-report` reads the triage decisions and presents a dry-run of all recommended label changes, comments, and closures. Approve to execute.

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
/investigate --from-report
```

1. `/triage recent` identifies issues needing investigation (`Valid - Needs Triage` verdict)
2. `/investigate --from-report` reads the triage decisions, spawns parallel investigation subagents for each qualifying bug, and produces:
   - Per-issue investigation reports with root cause, effort, and risk
   - A **Classification Matrix** bucketing issues by effort x risk
   - **Quick Wins** section (small effort, low/medium risk)
   - **Needs Planning** section (medium/large effort or high risk)

**Workflow C — Investigate specific issues directly:**

```
/investigate 5096 5084 5070
```

Skip triage — investigate specific issue numbers directly (batch mode with parallel subagents). Useful when you already know which issues need investigation.

**Workflow D — Apply investigation results:**

```
/investigate --from-report
/update-issues --from-report
```

After investigation, `/update-issues` can consume the investigation decisions JSON to label confirmed bugs as `triaged` and request more info for issues that can't be reproduced.

---

### Outcome 4: Leadership has clear signals for planning

**Problem:** PMs and EMs need priority signals, milestone recommendations, and aggregate views to inform roadmap decisions.

**Workflow A — Full pipeline for planning:**

```
/triage recent --since 30d
/investigate --from-report
/prioritize --from-report
```

The resolution report provides:

- **Summary table** with counts by recommendation (Shortlist: 5, Backlog: 12, Won't Fix: 3, Community Contribution: 2)
- **Per-issue priority signals** (reactions, related issues, severity, effort, age, activity)
- **Rationale** for each recommendation grounded in specific data
- **Machine-readable JSON** (`YYYY-MM-DD-RESOLUTIONS.json`) for downstream tooling

**Workflow B — Quick planning view for specific issues:**

```
/prioritize 5096 5084 5070 4999 4800
```

Evaluate a hand-picked set of issues and get priority recommendations. Useful for sprint planning when you have a candidate list.

**Workflow C — Planning signals without investigation:**

```
/triage recent
/prioritize --from-report
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
/update-issues --from-report
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
/investigate --from-report
/prioritize --from-report
/update-issues --from-report
```

The full pipeline on old issues. Investigation includes a **Relevance Assessment** for issues older than 1 year, checking whether the affected code paths still exist. The prioritize step provides milestone recommendations. Update-issues closes stale issues, requests verification on uncertain ones, and labels confirmed bugs.

**Workflow D — Spot-check specific old issues:**

```
/triage 1234 2345 3456
```

Triage a handful of specific old issues. Useful when a user asks about an old issue or when reviewing issues referenced in a PR.

**Staleness detection — two paths:**

| Condition                                                   | Triage verdict      | Update-issues behavior                                                                                     |
| ----------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Code refactored or removed since issue filed                | `Close - Stale`     | Close with explanatory comment                                                                             |
| Old version, no activity, low engagement, code still exists | `Request More Info` | Add `needs-more-info` label + comment asking to verify on current version (triggers auto-close automation) |

---

## Dev Pipeline — From Issue to Implementation

The dev pipeline takes an issue (or idea) from scoping through implementation review. It connects to the triage pipeline — triage identifies and prioritizes issues, then dev-scope picks them up for implementation.

### How the Pipelines Connect

```
TRIAGE PIPELINE                         DEV PIPELINE
───────────────────────────             ────────────────────────────
/triage (categorize issues)             /dev-scope (define what & why)
   ↓ DECISIONS.json                        ↓ goals.md
/investigate (root cause analysis)      /deep-planning (design approach)
   ↓ INVESTIGATION-DECISIONS.json          ↓ plan.md
/prioritize (rank & recommend)          /challenge-plan (stress-test plan)
   ↓ RESOLUTIONS.json                      ↓ challenge.md
/update-issues (apply to GitHub)        ── IMPLEMENTATION (you write code) ──
   ↓ ACTIONS.md                         /deep-review (code review)
[GitHub Updated]                           ↓ review.md
                                        /ux-review (UX review)
                                           ↓ ux-review.md
                                        /commit
```

The bridge between pipelines is `/dev-scope`. It reads investigation reports (if they exist) and imports root cause, effort, and risk data into the goals document — so `/deep-planning` doesn't re-investigate from scratch.

### Outcome 6: Engineers start implementation with clear scope and a validated plan

**Problem:** Engineers jump into coding without a clear definition of done, miss edge cases, and discover architectural issues mid-implementation.

**Workflow A — Full dev pipeline from a triaged issue:**

```
/dev-scope 5096
/deep-planning --scope .work/dev/5096/
/challenge-plan --scope .work/dev/5096/
```

1. `/dev-scope 5096` fetches the GitHub issue, verifies claims against the codebase, and produces `goals.md` — defining success criteria, UX flow, code landscape, and constraints. If an investigation report exists, it imports root cause and effort data.
2. `/deep-planning --scope .work/dev/5096/` reads `goals.md`, investigates the codebase for existing patterns and utilities, researches external approaches, and produces `plan.md` with 1-3 approaches and a recommended path.
3. `/challenge-plan --scope .work/dev/5096/` reads both `goals.md` and `plan.md`, verifies assumptions against code, runs a pre-mortem, and produces `challenge.md` with a verdict:
   - **Ready** — proceed to implementation
   - **Needs Revision** — plan has issues that should be addressed first
   - **Reconsider** — blocking issues found, needs human judgment

**Workflow B — Scope a feature idea (no issue):**

```
/dev-scope "add natural language search to the command palette"
/deep-planning --scope .work/dev/add-natural-language-search/
/challenge-plan --scope .work/dev/add-natural-language-search/
```

Same pipeline, but starting from a description instead of a GitHub issue number. The identifier becomes a slug used for the `.work/dev/` folder.

**Workflow C — Post-implementation review:**

```
/deep-review branch --scope .work/dev/5096/
/ux-review branch --scope .work/dev/5096/
/commit
```

After implementing the changes, run reviews against the goals document:

1. `/deep-review` traces code paths for correctness, verifying the implementation matches success criteria
2. `/ux-review` walks through user flows, checking discoverability, accessibility, and workflow continuity
3. `/commit` creates a well-formatted commit following GitLens conventions

**Workflow D — End-to-end from triage to implementation:**

```
/triage 5096
/investigate #5096
/dev-scope 5096
/deep-planning --scope .work/dev/5096/
/challenge-plan --scope .work/dev/5096/
── implement changes ──
/deep-review branch --scope .work/dev/5096/
/ux-review branch --scope .work/dev/5096/
/commit
```

The complete journey from raw issue to merged code.

---

### Dev Pipeline Artifacts

All dev artifacts are written to `.work/dev/{identifier}/` where identifier is an issue number or slug.

| File              | Producer          | Consumer                                                          |
| ----------------- | ----------------- | ----------------------------------------------------------------- |
| `goals.md`        | `/dev-scope`      | `/deep-planning`, `/challenge-plan`, `/deep-review`, `/ux-review` |
| `plan.md`         | `/deep-planning`  | `/challenge-plan`                                                 |
| `challenge.md`    | `/challenge-plan` | Human review, workflow script                                     |
| `challenge.rd.md` | Rubber duck       | Primary agent (for revision)                                      |
| `review.md`       | `/deep-review`    | Human review                                                      |
| `review.rd.md`    | Rubber duck       | Primary agent (for revision)                                      |
| `ux-review.md`    | `/ux-review`      | Human review                                                      |
| `ux-review.rd.md` | Rubber duck       | Primary agent (for revision)                                      |

---

## Workflow Orchestration Script

The `pnpm workflow` command automates running pipeline stages sequentially. It builds evidence packs, invokes AI agents for each stage, and optionally runs a rubber-duck second-opinion pass.

### Usage

```bash
# Triage pipeline
pnpm workflow triage recent                          # Triage last 7 days of issues
pnpm workflow triage recent --since 14d              # Custom lookback window
pnpm workflow triage audit --older-than 365d         # Audit old issues
pnpm workflow triage audit --older-than 180d --label bug  # Filtered audit
pnpm workflow triage single 5096 5084                # Triage specific issues

# Dev pipeline
pnpm workflow dev 5096                               # Scope → plan → challenge for issue
pnpm workflow dev "refactor-caching"                 # Scope → plan → challenge for idea
pnpm workflow dev 5096 --skip-to review              # Post-implementation reviews only
```

### Global Options

| Option                     | Description                                     |
| -------------------------- | ----------------------------------------------- |
| `--agent <claude\|auggie>` | Primary agent CLI (default: `claude`)           |
| `--model <model>`          | Model override for the primary agent            |
| `--rubber-duck`, `--rd`    | Enable second-opinion pass on evaluative stages |
| `--duck-model <model>`     | Override the auto-selected second-opinion model |
| `--skip-to <stage>`        | Resume pipeline from a specific stage           |
| `--dry-run`                | Show what would run without executing           |
| `--silent`                 | Suppress macOS notifications                    |

### Triage Pipeline Options

| Option                    | Description                                  |
| ------------------------- | -------------------------------------------- |
| `--since <duration>`      | Lookback window for `recent` (default: `7d`) |
| `--older-than <duration>` | Age threshold for `audit` (default: `180d`)  |
| `--batch-size <n>`        | Issues per batch for `audit` (default: `50`) |
| `--label <label>`         | Filter issues by label                       |

**Triage skip-to stages:** `triage`, `investigate`, `prioritize`

### Dev Pipeline Options

**Dev skip-to stages:** `scope`, `plan`, `challenge`, `review`, `ux-review`, `commit`

The dev pipeline has two phases separated by manual implementation:

1. **Pre-implementation** (`scope` → `plan` → `challenge`) — produces goals, plan, and challenge artifacts, then stops for you to implement
2. **Post-implementation** (`review` → `ux-review` → `commit`) — resumed with `--skip-to review` after you've written the code

### Rubber Duck (Second-Opinion) Mode

When `--rubber-duck` is enabled, evaluative stages get a second pass from a different AI model family. The system automatically pairs model families for diverse perspectives:

| Primary family | Duck model    |
| -------------- | ------------- |
| Claude         | Gemini        |
| Gemini         | Claude (Opus) |
| GPT            | Claude (Opus) |

You can override the duck model with `--duck-model <model>`. The script warns if the duck is the same family as the primary.

**Stages that support rubber duck:**

- **Triage pipeline:** `investigate`, `prioritize`
- **Dev pipeline:** `challenge`, `review`, `ux-review`

**How it works:**

1. Primary agent produces the artifact
2. Duck agent reads the artifact and provides 3-5 high-value concerns the primary may have missed
3. Primary agent revises the artifact incorporating the feedback
4. A "Second-Opinion Review" section is appended documenting what changed

Duck critique is saved alongside the artifact (e.g., `challenge.rd.md` next to `challenge.md`). Duck failure is non-blocking — if it fails, the original artifact is preserved.

### Pipeline Flow Control

The workflow script handles stage dependencies and stopping points:

**Triage pipeline** runs all stages sequentially, then prints the `/update-issues` command for manual execution (the script never applies changes to GitHub automatically).

**Dev pipeline** stops at two natural boundaries:

1. After challenge — if the verdict is "Reconsider" or "Needs Revision", the script stops and prints instructions for how to resume
2. After pre-implementation — the script stops and prints the `--skip-to review` command for after you've implemented

```bash
# Example: challenge returns "Needs Revision"
pnpm workflow dev 5096
# → Script stops with:
#   "The plan has issues that should be addressed."
#   "Review: .work/dev/5096/challenge.md"
#
# After revising the plan:
pnpm workflow dev 5096 --skip-to challenge    # Re-challenge
# or
pnpm workflow dev 5096 --skip-to review       # Skip to implementation reviews
```

### Examples

```bash
# Weekly triage with second opinion
pnpm workflow triage recent --rubber-duck

# Triage with Auggie + Gemini as primary, Claude as duck
pnpm workflow triage recent --agent auggie --model gemini-3.1-pro-preview --rubber-duck

# Dry-run to see what the pipeline would do
pnpm workflow dev 5096 --dry-run

# Full dev pipeline with rubber duck
pnpm workflow dev 5096 --rubber-duck

# Resume post-implementation reviews with custom duck model
pnpm workflow dev 5096 --skip-to review --rubber-duck --duck-model gpt5.4
```

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

**Output:** `.work/triage/reports/YYYY-MM-DD-TRIAGE-REPORT.md` + `YYYY-MM-DD-DECISIONS.json`

### `/investigate`

| Input               | Example                                                                         |
| ------------------- | ------------------------------------------------------------------------------- |
| Symptom description | `/investigate blame annotations not showing`                                    |
| Single issue        | `/investigate #5096`                                                            |
| Multiple issues     | `/investigate 5096 5084` (batch mode with parallel subagents)                   |
| From report         | `/investigate --from-report` (uses most recent decisions JSON)                  |
| Specific report     | `/investigate --from-report .work/triage/reports/2026-04-01-DECISIONS.json`     |
| Filtered verdicts   | `/investigate --from-report --verdict "Valid - Needs Triage,Request More Info"` |
| Limited parallelism | `/investigate --from-report --max 5`                                            |

**Output (single):** Investigation report in conversation (not written to file)
**Output (batch):** `.work/triage/reports/YYYY-MM-DD-INVESTIGATION-REPORT.md` + `YYYY-MM-DD-INVESTIGATION-DECISIONS.json`

### `/prioritize`

| Input                | Example                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| Direct issue numbers | `/prioritize 5096 5084 5070`                                                  |
| From report          | `/prioritize --from-report` (uses most recent report JSON, auto-detects type) |
| Specific report      | `/prioritize --from-report .work/triage/reports/2026-04-01-DECISIONS.json`    |

**Output:** `.work/triage/reports/YYYY-MM-DD-RESOLUTION-REPORT.md` + `YYYY-MM-DD-RESOLUTIONS.json`

### `/update-issues`

| Input           | Example                                                                          |
| --------------- | -------------------------------------------------------------------------------- |
| From report     | `/update-issues --from-report` (uses most recent report JSON, auto-detects type) |
| Specific report | `/update-issues --from-report .work/triage/reports/2026-04-01-RESOLUTIONS.json`  |
| Dry-run only    | `/update-issues --from-report --dry-run`                                         |

**Consumes:** Any of the three JSON report types (triage decisions, investigation decisions, resolutions)

**Output:** Dry-run table → user confirmation → execution → `.work/triage/reports/YYYY-MM-DD-ACTIONS.md` audit log

### `/dev-scope`

| Input           | Example                                         |
| --------------- | ----------------------------------------------- |
| Single issue    | `/dev-scope 5096`                               |
| Multiple issues | `/dev-scope 5096 5084` (separate goals.md each) |
| Feature idea    | `/dev-scope "add natural language search"`      |

**Output:** `.work/dev/{identifier}/goals.md`

### `/deep-planning`

| Input       | Example                                  |
| ----------- | ---------------------------------------- |
| Scoped      | `/deep-planning --scope .work/dev/5096/` |
| Interactive | `/deep-planning <task description>`      |

**Output:** `.work/dev/{identifier}/plan.md`

### `/challenge-plan`

| Input       | Example                                   |
| ----------- | ----------------------------------------- |
| Scoped      | `/challenge-plan --scope .work/dev/5096/` |
| Interactive | `/challenge-plan <proposed plan>`         |

**Output:** `.work/dev/{identifier}/challenge.md`

**Verdicts:** `Ready` (proceed), `Needs Revision` (fix plan first), `Reconsider` (blocking — needs human judgment)

### `/deep-review`

| Input  | Example                                       |
| ------ | --------------------------------------------- |
| Scoped | `/deep-review branch --scope .work/dev/5096/` |

**Output:** `.work/dev/{identifier}/review.md`

### `/ux-review`

| Input  | Example                                     |
| ------ | ------------------------------------------- |
| Scoped | `/ux-review branch --scope .work/dev/5096/` |

**Output:** `.work/dev/{identifier}/ux-review.md`

---

## Pipeline Chains

### Minimal: Triage + Update

```
/triage recent → /update-issues --from-report
```

Triage issues, then apply labels/comments/closures. Good for weekly inbox processing.

### Standard: Triage + Investigate + Update

```
/triage recent → /investigate --from-report → /update-issues --from-report
```

Triage, then investigate bugs, then apply results. Good when you need to understand root causes before acting.

### Full: Triage + Investigate + Prioritize + Update

```
/triage recent → /investigate --from-report → /prioritize --from-report → /update-issues --from-report
```

Triage, investigate, get planning recommendations, then apply. Good for milestone/sprint planning.

### Shortcut: Prioritize + Update

```
/prioritize 5096 5084 → /update-issues --from-report
```

Skip triage and investigation. Get recommendations and apply. Good for ad-hoc prioritization of known issues.

### Dev: Scope + Plan + Challenge

```
/dev-scope 5096 → /deep-planning --scope .work/dev/5096/ → /challenge-plan --scope .work/dev/5096/
```

Scope an issue, design the approach, and stress-test it. The standard pre-implementation workflow.

### Dev: Post-Implementation Reviews

```
/deep-review branch --scope .work/dev/5096/ → /ux-review branch --scope .work/dev/5096/ → /commit
```

After implementing, review code and UX against the goals document.

### Cross-Pipeline: Triage to Dev

```
/triage 5096 → /investigate #5096 → /dev-scope 5096 → /deep-planning --scope .work/dev/5096/
```

Full journey from raw issue to implementation plan. `/dev-scope` imports investigation findings into `goals.md`.

---

## Output Files

### Triage pipeline

All triage reports are written to `.work/triage/reports/`. Each analysis skill produces both a human-readable markdown report and a machine-readable JSON file.

| File pattern                     | Producer         | Consumer                                                                                  |
| -------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `*-TRIAGE-REPORT.md`             | `/triage`        | Humans                                                                                    |
| `*-DECISIONS.json`               | `/triage`        | `/investigate --from-report`, `/prioritize --from-report`, `/update-issues --from-report` |
| `*-INVESTIGATION-REPORT.md`      | `/investigate`   | Humans                                                                                    |
| `*-INVESTIGATION-DECISIONS.json` | `/investigate`   | `/prioritize --from-report`, `/update-issues --from-report`                               |
| `*-RESOLUTION-REPORT.md`         | `/prioritize`    | Humans                                                                                    |
| `*-RESOLUTIONS.json`             | `/prioritize`    | `/update-issues --from-report`                                                            |
| `*-ACTIONS.md`                   | `/update-issues` | Humans (audit trail)                                                                      |

### Dev pipeline

All dev artifacts are written to `.work/dev/{identifier}/` where identifier is an issue number or slug.

| File              | Producer          | Consumer                                                          |
| ----------------- | ----------------- | ----------------------------------------------------------------- |
| `goals.md`        | `/dev-scope`      | `/deep-planning`, `/challenge-plan`, `/deep-review`, `/ux-review` |
| `plan.md`         | `/deep-planning`  | `/challenge-plan`                                                 |
| `challenge.md`    | `/challenge-plan` | Human review, workflow script verdict detection                   |
| `challenge.rd.md` | Rubber duck       | Primary agent (revision pass)                                     |
| `review.md`       | `/deep-review`    | Human review                                                      |
| `review.rd.md`    | Rubber duck       | Primary agent (revision pass)                                     |
| `ux-review.md`    | `/ux-review`      | Human review                                                      |
| `ux-review.rd.md` | Rubber duck       | Primary agent (revision pass)                                     |

---

## Safety Model

1. **Analysis is read-only** — `/triage`, `/investigate`, `/prioritize`, `/dev-scope`, `/deep-planning`, `/challenge-plan`, `/deep-review`, and `/ux-review` never modify GitHub issues or code
2. **Update requires confirmation** — `/update-issues` always shows a dry-run first and requires explicit approval
3. **Pre-flight checks** — `/update-issues` verifies current issue state before each action, skipping stale or redundant changes
4. **Close confirmation** — Closing issues requires per-issue approval
5. **Audit trail** — Every applied action is logged to `.work/triage/reports/*-ACTIONS.md`
6. **Human-in-the-loop** — All close recommendations require human approval (`requiresHumanApproval: true`)
7. **Challenge gate** — The workflow script stops if `/challenge-plan` returns "Reconsider" or "Needs Revision", preventing implementation on a flawed plan
8. **Implementation boundary** — The workflow script never implements code automatically; it stops after the challenge stage and waits for manual `--skip-to review`

---

## Limitations and Notes

- **Single-issue duplicate detection is limited.** When triaging a single issue (`/triage 5096`), duplicate detection only cross-references against other issues in the same evidence pack. For a single issue, there's nothing to cross-reference. Use `/prioritize` which searches the full repo for related issues, or use batch triage (`/triage recent`) for better duplicate detection.
- **Specific iteration milestones require human judgment.** The `/prioritize` skill recommends "Shortlist" or "Backlog" milestones but does not assign issues to specific iterations/sprints. Deciding which sprint an issue belongs to requires team context that the skills don't have. Use the priority signals from `/prioritize` to inform that decision.
- **Rate limits constrain batch sizes.** `/prioritize` uses GitHub's Search API (30 requests/min) for related-issue counting. Batches of 25+ issues will approach the rate limit. The skill budgets accordingly but large batches may take longer.
- **Investigation cost scales with issue count.** `/investigate` in batch mode spawns a parallel subagent per issue. Each performs a full codebase investigation. Use `--max` to control parallelism.
- **Dev pipeline requires manual implementation.** The workflow script runs pre-implementation stages (scope, plan, challenge) then stops. You write the code. Then resume with `--skip-to review` for post-implementation reviews.
- **Challenge verdicts are advisory.** The workflow script stops on "Reconsider" and "Needs Revision" verdicts, but you can override with `--skip-to review` if you've addressed the concerns outside the script.
- **Rubber duck is non-blocking.** If the second-opinion agent fails (network error, model unavailable), the original artifact is preserved and the pipeline continues.
