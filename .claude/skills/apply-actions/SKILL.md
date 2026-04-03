---
name: apply-actions
description: Apply triage, investigation, or resolution recommendations to GitHub issues — adds labels, posts comments, sets milestones, and closes issues with safety checks
---

# /apply-actions - Apply Recommendations to GitHub

Read a triage, investigation, or resolution report and apply the recommended actions to GitHub. This is the only skill in the issue workflow that modifies GitHub state.

## Usage

```
/apply-actions [report-path] [--dry-run]
```

- `report-path` — Path to a decisions/resolutions JSON file. If omitted, use the most recent JSON report in `.triage/reports/`.
- `--dry-run` — Show what would be done without making changes. This is the DEFAULT behavior on first invocation — you must confirm before actions are applied.

## Instructions

### Stage 0 — Load Report

Read the JSON file and determine report type:

- Has `verdicts` array → **Triage decisions** (`DECISIONS-*.json`)
- Has `investigations` array → **Investigation decisions** (`*-INVESTIGATION-DECISIONS.json`)
- Has `resolutions` array → **Resolution decisions** (`RESOLUTIONS-*.json`)

### Stage 1 — Translate Recommendations to Actions

For each issue in the report, determine the GitHub actions to take:

**From triage decisions:**

| Verdict                   | Actions                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| Close - Fixed             | Close issue (reason: completed), add label `triaged`, remove label `triage`               |
| Close - Duplicate         | Close issue (reason: not planned), comment linking canonical issue, add label `duplicate` |
| Close - Invalid           | Close issue (reason: not planned), comment with explanation                               |
| Close - Stale             | Close issue (reason: not planned), comment explaining staleness                           |
| Request More Info         | Add label `needs-more-info`, comment requesting specific info                             |
| Relabel - Bug             | Change issue type/labels to bug                                                           |
| Relabel - Feature Request | Change issue type/labels to enhancement                                                   |
| Valid - Needs Triage      | No action (needs investigation first)                                                     |
| Valid - Already Triaged   | No action                                                                                 |

**From investigation decisions:**

| Result                      | Actions                                                                          |
| --------------------------- | -------------------------------------------------------------------------------- |
| Confirmed Bug               | Add label `triaged`, remove label `triage`                                       |
| Likely Fixed                | Add label `needs-more-info`, comment asking reporter to verify on latest version |
| Cannot Reproduce            | Add label `needs-more-info`, comment requesting updated repro steps              |
| Inconclusive / Insufficient | No action (needs human review)                                                   |

**From resolution decisions:**

| Recommendation         | Actions                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| shortlist              | Set milestone to "Shortlist", add label `triaged`, remove label `triage` |
| backlog                | Set milestone to "Backlog", add label `triaged`, remove label `triage`   |
| wont-fix               | Close issue (reason: not planned), comment with rationale                |
| community-contribution | Add label `needs-help`, comment inviting contribution                    |

### Stage 2 — Pre-flight State Check

**Critical:** Before applying ANY action, verify current issue state:

```bash
gh issue view <number> --repo gitkraken/vscode-gitlens --json state,labels,milestone
```

For each issue, check:

- **Already closed?** → Skip close actions, warn user
- **Labels already applied?** → Skip redundant label additions
- **Milestone already set?** → Skip if same milestone, warn if different
- **Report age** → If the report is older than 24 hours, warn that issue state may have changed

### Stage 3 — Present Dry Run

Before executing any actions, present a summary table:

```markdown
## Actions to Apply

| Issue | Action        | Details                             | Status                       |
| ----- | ------------- | ----------------------------------- | ---------------------------- |
| #1234 | Close         | Reason: not planned, Comment: "..." | Ready                        |
| #1234 | Add label     | `duplicate`                         | Ready                        |
| #2345 | Add label     | `needs-more-info`                   | Ready                        |
| #2345 | Comment       | "Could you provide..."              | Ready                        |
| #3456 | Set milestone | Backlog                             | Ready                        |
| #4567 | Close         | Reason: completed                   | ⚠️ Already closed — skipping |

### Summary

- Actions ready: N
- Skipped (already applied): N
- Warnings: N
```

**Ask for confirmation before proceeding.** The user may choose to:

- Apply all ready actions
- Apply selectively (specify issue numbers)
- Cancel

### Stage 4 — Execute Actions

Execute approved actions using `gh` CLI:

```bash
# Add label
gh issue edit <number> --repo gitkraken/vscode-gitlens --add-label "<label>"

# Remove label
gh issue edit <number> --repo gitkraken/vscode-gitlens --remove-label "<label>"

# Set milestone
gh issue edit <number> --repo gitkraken/vscode-gitlens --milestone "<milestone>"

# Post comment
gh issue comment <number> --repo gitkraken/vscode-gitlens --body "<message>"

# Close with reason and comment
gh issue close <number> --repo gitkraken/vscode-gitlens --reason "not planned" --comment "<message>"

# Close as completed
gh issue close <number> --repo gitkraken/vscode-gitlens --reason "completed" --comment "<message>"
```

**Execution order per issue:** Labels first, then milestone, then comment, then close (if applicable). This ensures the issue has correct metadata before closing.

**Error handling:** If a `gh` command fails, log the error and continue with remaining actions. Report all failures at the end.

### Stage 5 — Audit Log

Write an audit log to `.triage/reports/YYYY-MM-DD-ACTIONS.md`:

```markdown
# Actions Applied — YYYY-MM-DD

Source report: <path to source JSON>
Report type: triage | investigation | resolution
Applied at: <ISO timestamp>
Applied by: <git user>

## Actions Taken

| Issue | Action                        | Result                                  |
| ----- | ----------------------------- | --------------------------------------- |
| #1234 | Closed (not planned)          | ✓ Success                               |
| #1234 | Added label `duplicate`       | ✓ Success                               |
| #2345 | Added label `needs-more-info` | ✓ Success                               |
| #2345 | Posted comment                | ✓ Success                               |
| #3456 | Set milestone: Backlog        | ✗ Failed: milestone "Backlog" not found |

## Summary

- Successful: N
- Failed: N
- Skipped: N
```

## Safety Rules

1. **Dry-run first** — ALWAYS show the action plan and get confirmation before executing
2. **Pre-flight checks** — ALWAYS verify current issue state before acting
3. **Close confirmation** — Closing issues requires explicit user approval for EACH issue
4. **No label creation** — Only use existing labels. If a recommended label doesn't exist, warn and skip
5. **No force operations** — Never use `--force` or bypass safety checks
6. **Audit everything** — Every action taken must be logged

## Chaining

This skill consumes output from the other issue workflow skills:

```
/triage recent → /apply-actions                              (apply triage verdicts)
/triage recent → /investigate-triage → /apply-actions        (apply investigation results)
/triage recent → /investigate-triage → /resolve → /apply-actions  (apply resolution plan)
```
