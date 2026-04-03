# Issue Workflow Skills — Requirements

## Purpose

Define a suite of Claude skills that help engineers, engineering managers, and technical product managers work through the ~876 open issues in the GitLens repository efficiently. The skills reduce manual effort across triage, investigation, and resolution planning — while providing clear, actionable signals for prioritization and planning.

## Desired Outcomes

1. **Engineers spend less time figuring out what to work on** — Issues surface with clear priority signals and enough context to start working immediately.
2. **Engineers spend less time on low-value issue review** — Duplicates, spam, incomplete reports, and out-of-scope requests are identified before engineers touch them.
3. **Engineers spend less time investigating bugs** — Codebase-level root cause analysis is performed automatically, producing structured reports engineers can act on.
4. **Leadership has clear signals for planning** — Issues carry priority recommendations, impact assessments, and effort estimates that inform milestone and roadmap decisions.
5. **Old issues stop rotting** — The backlog is systematically re-evaluated for relevance, and stale issues are surfaced or closed.

---

## Skill Stages

The workflow is a three-stage pipeline. Each stage can be used **standalone or composed together**, and each operates on **a single issue or a range of issues**.

### Stage 1: Triage

**Goal:** First-pass review of issues to filter noise, categorize, and determine if deeper investigation is needed.

**Inputs:** One or more GitHub issue numbers or a query/filter for a range of issues.

**Evaluation Criteria:**

| Check               | Details                                                                                                                                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sufficient info     | Validate against issue templates (`.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/feature_request.yml`). Bugs require: description with repro steps, GitLens version. Enhancements require: clear description of desired behavior. Most common gaps: missing logs, missing repo setup details. |
| Duplicate detection | Check for obvious duplicates against open AND closed issues (title/description similarity, same error messages, same steps). Subtle/same-root-cause duplicates are deferred to Investigation.                                                                                                                   |
| Spam                | Identify spam, off-topic, or bot-generated issues.                                                                                                                                                                                                                                                              |
| Categorization      | Determine correct type: bug or enhancement.                                                                                                                                                                                                                                                                     |
| Scope               | Determine if the issue is within the scope of GitLens as a product.                                                                                                                                                                                                                                             |
| Disposition         | If the issue passes all checks and doesn't need deeper analysis: mark as **triaged**. If the issue needs deeper analysis: mark as **needs investigation**.                                                                                                                                                      |

**Outputs per issue:**

- Verdict: triaged, needs investigation, needs more info, duplicate (with link to original), spam, out of scope
- Confidence level
- For `needs-more-info`: draft comment requesting the specific missing information (most commonly logs and/or repo setup details)
- For duplicates: link to the original issue

**Batch output (when run on a range):**

- Summary report: counts by verdict category (e.g., "12 need investigation, 8 need more info, 3 duplicates, 2 spam")
- Individual results per issue

### Stage 2: Investigation

**Goal:** Deep codebase-level analysis of bugs and ambiguous issues to determine root cause, confirm or refute the bug, and produce a structured report an engineer can act on.

**Inputs:** One or more GitHub issue numbers (typically those marked "needs investigation" from Triage, but can be invoked standalone).

**What it does:**

- Re-evaluates all triage criteria with deeper analysis (sufficient info, duplicate, spam, category, scope)
- For bugs: traces code paths using the issue description, logs, repro steps, and the actual codebase
- Confirms bug or determines not-a-bug
- Updates/clarifies replication steps if the original report is unclear
- Marks as **triaged** when investigation is complete

**Output format per issue:**

```markdown
## Investigation: [Symptom]

### Confidence Level

[High | Medium | Low] — [brief justification]

### Symptom

[What goes wrong]

### Source Attribution

[One of:

- "Independent analysis from code tracing"
- "Confirms reporter's diagnosis — the issue included [specific detail] which this investigation verified against current code"
- "Mixed — [explain what came from the issue vs. independent tracing]"]

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

**Batch output (when run on a range):**

- Summary report with counts by verdict (confirmed bug, not a bug, needs more info, etc.)
- Individual investigation reports per issue

### Stage 3: Resolution and Planning

**Goal:** Recommend what to do with triaged/investigated issues and provide the signals needed for prioritization and milestone planning.

**Inputs:** One or more GitHub issue numbers (typically those that have been triaged or investigated, but can be invoked standalone).

**Possible Recommendations:**

| Recommendation             | Criteria                                                                  | Action                                                             |
| -------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Won't fix**              | Out of scope or working as designed                                       | Draft comment explaining rationale                                 |
| **Community contribution** | Good feature, but too niche for the team to prioritize internally         | Draft comment inviting contribution with relevant context          |
| **Shortlist**              | High impact, should be done — iteration not yet determined                | Recommend milestone: shortlist; recommend adding to GitHub project |
| **Backlog**                | Should be done, but lower priority or insufficient impact-to-effort ratio | Recommend milestone: backlog                                       |
| **Specific iteration**     | When enough signal exists to slot into a known iteration                  | Recommend specific milestone                                       |

**Prioritization Signals (used to inform recommendation):**

- Number of duplicate/related issues (breadth of impact)
- Severity (data loss, crash, broken workflow, cosmetic)
- Estimated complexity from investigation (effort)
- Age of the issue (how long it has been open)
- Thumbs-up / reaction count on the issue
- Recency and volume of activity/comments

**Outputs per issue:**

- Recommendation (won't fix, community contribution, shortlist, backlog, specific iteration)
- Confidence level
- Prioritization signal summary (the key data points that drove the recommendation)
- Draft comment/message (when the verdict is clear-cut and communication is obvious)

**Batch output (when run on a range):**

- Summary report with counts by recommendation category
- Individual results per issue

---

## Backlog Decay / Relevance Review

**Goal:** Systematically re-evaluate old issues to determine if they are still relevant, and ensure they have progressed through the triage/investigation/resolution pipeline.

**This is not a separate skill** — it is a usage pattern of the three stages above, applied to old issues. However, it introduces additional staleness signals:

**Signals for direct close (stale — codebase has moved on):**

- The affected code has been significantly refactored or removed
- The feature area has been redesigned since the issue was filed

**Signals for `needs-more-info` label (triggers existing automation that auto-closes if no response):**

- No activity and no upvotes for X months
- The reported version is very old and cannot be reproduced on current version

---

## Interaction Model

### Read-only by default

All skills produce **recommendations and reports only**. They do not modify issues, apply labels, post comments, or change milestones.

### Optional apply action

A separate, explicit action can apply the recommended changes to GitHub (labels, comments, milestone assignment, project assignment, closing). This keeps humans in the loop while reducing the work to a single approval step.

### Manual invocation

All skills are triggered manually — no automatic execution on issue creation or updates.

### Composability

- Each stage works standalone (e.g., investigate a single issue without triaging it first)
- Stages can be chained (e.g., triage a batch, then investigate the ones marked "needs investigation")
- Each stage works on a single issue or a range of issues

---

## Audience

All three personas consume the same output format:

- **Engineers** — Use investigation reports (code paths, root cause, fix approach) to start work immediately
- **Engineering Managers** — Use priority signals and batch summaries for workload distribution
- **Technical Product Managers** — Use impact assessments, priority recommendations, and batch summaries for planning and roadmap decisions

---

## Key Reference Material

- Bug report template: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Feature request template: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Existing label: `needs-more-info` (triggers auto-close automation if no response)
- Existing label: `triage` (applied to new issues by templates)
- Repository: `gitkraken/vscode-gitlens`
- Current open issue count: ~876 (dating back to 2018)
