---
name: prioritize
description: Prioritize triaged/investigated issues — recommends shortlist, backlog, won't fix, or community contribution with priority signals and draft communications
---

# /prioritize - Issue Prioritization & Resolution

Evaluate triaged or investigated issues and recommend resolution: shortlist, backlog, won't fix, or community contribution. Produces priority signal summaries and optional draft communications.

## Usage

```
/prioritize <number> [number...]
/prioritize --from-report [path]
```

- Issue numbers — Fetches evidence pack via `single` command, performs resolution analysis
- `--from-report` — Reads a report JSON file (auto-detects type: triage decisions, investigation decisions, or resolutions). If path omitted, uses the most recent report JSON in `.work/triage/reports/`.

## Instructions

### Stage 0 — Gather Data

**Direct mode (issue numbers):**

Run the CLI to build an evidence pack for the specified issues:

```bash
node --experimental-strip-types ./scripts/issues/triage.mts single <numbers...>
```

Read the evidence pack JSON printed to stdout.

**From-report mode (`--from-report`):**

Read the JSON file and auto-detect report type:

- Has `verdicts` array → **Triage decisions**. Filter to issues with actionable verdicts (`Valid - Needs Triage`, `Valid - Already Triaged`, `Retype - Bug`, `Retype - Feature Request`). Skip close or request-more-info verdicts — those are already resolved.
- Has `investigations` array → **Investigation decisions**. For each issue, combine investigation findings (effort, risk, root cause, confidence) with evidence pack data.

For each qualifying issue, you need the evidence pack data. If the corresponding evidence pack is available in `.work/triage/packs/`, read it. Otherwise, run the `single` command to fetch data for the issue numbers.

### Stage 1 — Gather Related Issue Counts

For each issue being evaluated, search for related issues:

```bash
gh search issues --repo gitkraken/vscode-gitlens "<significant keywords from title>" --state open --json number --limit 20
```

Extract 3-5 significant keywords from the issue title (skip common words like "the", "is", "not", "when", "with", "does", "after"). Count results excluding the issue itself.

**Rate budget:** Maximum 25 search calls per invocation. If evaluating more issues than that, prioritize issues with higher reaction counts or those from investigation reports.

### Stage 2 — Evaluate Each Issue

For each issue, assess these priority signals:

| Signal                | Source                                            | How to assess                                                        |
| --------------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| Reactions (thumbs-up) | Evidence pack `reactions.thumbsUp`                | 0-2: low, 3-10: moderate, 11+: high demand                           |
| Related issues        | Stage 1 search results + `duplicateCandidates`    | 0: isolated, 1-2: some impact, 3+: recurring                         |
| Severity              | Issue content analysis                            | Data loss > crash > broken workflow > degraded experience > cosmetic |
| Estimated effort      | Investigation report or inferred from description | Small (hours) / Medium (1-3 days) / Large (3+ days)                  |
| Issue age             | `createdAt`                                       | Calculate days since creation                                        |
| Activity recency      | `lastActivityAt`                                  | Days since last activity                                             |
| Comment count         | `commentCount`                                    | Volume of discussion                                                 |

### Stage 3 — Recommend Resolution

Apply this decision framework:

1. **Won't Fix** — Issue is out of scope for GitLens OR describes behavior that is working as designed. Requires clear evidence.

2. **Community Contribution** — Feature request that is a good idea but too niche for the team to prioritize. Signals: low reaction count, specific/narrow use case, effort > Small.

3. **Shortlist** — Should be done in the near term. Signals: high reactions (11+), high severity (data loss, crash, broken workflow), many related issues (3+), OR confirmed bug from investigation with Small/Medium effort.

4. **Backlog** — Should be done, but lower priority or insufficient impact-to-effort ratio. Default for valid issues that don't meet shortlist criteria.

The skill does NOT auto-decide. Present the signals, recommendation, and confidence level. A human makes the final call.

### Stage 4 — Draft Communications (when applicable)

Draft a comment only when the verdict is clear-cut:

- **Won't Fix**: Explain why (out of scope or working as designed), thank the reporter, suggest alternatives if applicable
- **Community Contribution**: Explain the feature is welcome as a contribution, provide relevant context about the codebase area (file paths, approach hints), link to contribution guidelines

Do NOT draft comments for shortlist or backlog — those are internal planning decisions.

### Output

Produce two files in `.work/triage/reports/`:

#### 1. Markdown Report

File: `YYYY-MM-DD-RESOLUTION-REPORT.md`

**Single issue:**

```markdown
# Resolution Report — YYYY-MM-DD

Issues evaluated: 1

---

### [#NNNN — Title](https://github.com/gitkraken/vscode-gitlens/issues/NNNN)

- **Author**: @username (team) | @username
- **Recommendation**: Shortlist | Backlog | Won't Fix | Community Contribution
- **Confidence**: High | Medium | Low

#### Priority Signals

| Signal                | Value                  | Assessment                          |
| --------------------- | ---------------------- | ----------------------------------- |
| Reactions (thumbs-up) | N                      | Low / Moderate / High demand        |
| Related issues        | N open, N closed       | Isolated / Some impact / Recurring  |
| Severity              | [level]                | [assessment]                        |
| Estimated effort      | Small / Medium / Large | [source: investigation or inferred] |
| Age                   | N days                 | [assessment]                        |
| Last activity         | N days ago             | [assessment]                        |

#### Rationale

[2-3 sentences explaining why this recommendation, citing specific signals]

#### Draft Message (if applicable)

> [Draft comment for won't-fix or community-contribution verdicts]
```

**Batch (multiple issues):**

```markdown
# Resolution Report — YYYY-MM-DD

Issues evaluated: N
Source: [direct | triage decisions | investigation decisions]

## Summary

| Recommendation         | Count | Issues       |
| ---------------------- | ----- | ------------ |
| Shortlist              | N     | #NNNN, #NNNN |
| Backlog                | N     | #NNNN, #NNNN |
| Won't Fix              | N     | #NNNN        |
| Community Contribution | N     | #NNNN        |

## Shortlist (recommended for near-term work)

[Per-issue details, ordered by priority — highest reactions + severity first]

## Backlog

[Per-issue details, ordered by priority]

## Won't Fix

[Per-issue details]

## Community Contribution

[Per-issue details]
```

#### 2. Machine-Readable JSON

File: `YYYY-MM-DD-RESOLUTIONS.json`

```json
{
  "reportId": "<uuid>",
  "generatedAt": "<ISO timestamp>",
  "source": "direct | triage | investigation",
  "sourceFile": "<path to source file if from-triage or from-investigation>",
  "resolutions": [
    {
      "issueNumber": 1234,
      "issueTitle": "...",
      "recommendation": "shortlist | backlog | wont-fix | community-contribution",
      "confidence": "High | Medium | Low",
      "prioritySignals": {
        "reactionsThumbsUp": 45,
        "relatedIssueCount": 5,
        "severity": "broken-workflow | crash | data-loss | degraded-experience | cosmetic",
        "estimatedEffort": "Small | Medium | Large | Unknown",
        "ageInDays": 840,
        "lastActivityDaysAgo": 90,
        "commentCount": 12
      },
      "rationale": "...",
      "draftMessage": "..." | null,
      "recommendedMilestone": "Shortlist | Backlog" | null,
      "recommendedLabels": []
    }
  ]
}
```

Generate a UUID for `reportId`. Write both files and confirm their paths to the user.

## Chaining

This skill can be used standalone or as part of the issue workflow pipeline:

```
/triage recent → /investigate --from-report → /prioritize --from-report → /update-issues
/triage 5096   → /investigate 5096          → /prioritize 5096          → /update-issues
/prioritize 5096 5084 5070                    (standalone, direct mode)
```

Downstream: `/update-issues` can consume the resolutions JSON to apply recommendations to GitHub.
