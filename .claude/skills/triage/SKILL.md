---
name: triage
description: Triage GitHub issues using an evidence pack — evaluates issues and produces a structured report with verdicts, confidence levels, and recommended actions
---

# /triage - Issue Triage Toolkit

Evaluate GitHub issues using a pre-assembled evidence pack and produce a structured triage report.

## Usage

```
/triage <number> [number...]           # Single issue(s)
/triage recent [--since 7d]            # Recent batch
/triage audit [--older-than 180d] [--batch-size 50] [--label bug]  # Historical batch
```

## Instructions

### Stage 0 — Prepare Evidence Pack

Run the CLI to ensure data is fresh. Forward all arguments after the command name.

**Single-issue mode:** When invoked with issue numbers, use the `single` command:

```bash
node --experimental-strip-types ./scripts/triage/triage.mts single <number> [number...]
```

**Batch modes:** Forward the command and arguments directly:

```bash
node --experimental-strip-types ./scripts/triage/triage.mts <recent|audit> [args]
```

The script prints the absolute path to the evidence pack JSON on stdout. Read that file.

Parse the pack JSON. It contains:

- `meta` — run metadata (workflow, query params, schema version)
- `teamMembers` — list of GitHub org member logins
- `issues` — array of enriched issues with computed evidence fields

### Stage 1 — Quick Pass (all issues)

For each issue in `pack.issues`, evaluate in order:

#### 1. Spam/junk check

Is the body empty, incoherent, or unrelated to GitLens?

**Critical rule**: Organization-level members (`isTeamMember: true`) can NEVER be marked spam. Team-member issues often have minimal descriptions and must not be flagged. For contributors (`authorAssociation: "CONTRIBUTOR"`) apply lenient standards. For outsiders (`authorAssociation: "NONE"`), apply standard spam criteria.

#### 2. Type and label correctness

Does `issue.type` match the actual nature of the report? Do the labels correctly categorize it? Note any relabeling needed. Use label descriptions from the evidence pack to understand what each label means.

#### 3. Already triaged check

Does the issue have a milestone, assignee, or triage-specific label indicating it has been processed? If so, classify as `Valid - Already Triaged`.

#### 4. Needs more info check

Is the issue a bug report lacking environment details (VS Code version, extension version, OS, reproduction steps)? Is it a feature request with no description of the desired behavior? Classify as `Request More Info` if evidence is insufficient to evaluate further.

#### 5. Duplicate candidate scoring

For each entry in `duplicateCandidates`:

- If the canonical issue is closed-fixed, escalate to Stage 2 for deeper analysis
- If the canonical issue is open, note as `Close - Duplicate` candidate pending Stage 2 confirmation
- Evaluate `similarityBasis` to judge how strong the duplicate signal is

### Stage 2 — Deep Pass (unresolved and high-value cases only)

Apply only to issues not yet resolved to a high-confidence verdict in Stage 1.

#### 6. Feature-exists check (feature requests)

Does the requested feature already exist in the extension? Check against CHANGELOG entries (`changelogEntry` field), known feature areas, or codebase evidence if needed. If the feature already exists, classify as `Close - Invalid` with a note about the existing feature.

#### 7. Bug-still-valid hypothesis (bug reports)

Is there evidence the behavior described still exists? Cross-reference with `changelogEntry`. If a changelog entry exists for this issue, it is strong evidence of a fix — but must be corroborated by at least one other source:

- Linked PR state (merged PR that addresses the fix)
- Maintainer timeline comment confirming the fix
- Investigation evidence from the codebase

Do NOT classify as `Close - Fixed` on changelog evidence alone.

#### 8. Fixed-status decision — Two-Source Rule

To classify an issue as `Close - Fixed`, you MUST have at least two independent evidence sources:

1. Changelog reference (`changelogEntry` is non-null)
2. Linked PR or commit (a merged PR in `linkedPrs`)
3. Maintainer timeline comment confirming the fix
4. Codebase investigation evidence

If only one source is present, downgrade to `Request More Info` or `Valid - Needs Triage`.

#### 9. Third-party cause classification

Is the issue caused by a VS Code API limitation, a platform OS issue, or a third-party extension conflict? Note this as evidence for `Close - Invalid` with an explicit reason.

#### 10. Stale evaluation (audit and single mode)

Does the issue meet ALL THREE stale criteria:

- (a) No activity for >= `staleInactivityDays` (365 days) — check `lastActivityAt`
- (b) The referenced feature/UI still exists or the fix was addressed elsewhere
- (c) No missing mandatory evidence that would block a reliable verdict

Only then classify as `Close - Stale`. Check `supersessionIndicators` for evidence of supersession.

**Codebase-level staleness signals:** If the issue references specific UI elements, settings, commands, or code paths, check whether they still exist in the codebase. If the referenced functionality has been removed, substantially redesigned, or renamed, that is strong evidence for staleness. Use `Grep` or `Glob` to quickly verify existence of referenced features.

#### 10a. Stale-but-needs-verification (audit and single mode)

Separate from `Close - Stale`, identify issues that are old and inactive but where the code path still exists and the issue may still be valid. Classify as `Request More Info` when ALL of:

- (a) No activity for a significant period (e.g., 6+ months) — check `lastActivityAt`
- (b) The reported GitLens version is significantly outdated
- (c) No upvotes or low engagement (`reactions.thumbsUp` is 0-1)
- (d) The code path still exists (not eligible for `Close - Stale`)

The `Request More Info` comment should ask the reporter to verify the issue still occurs on the current version and provide updated environment details. This triggers the `needs-more-info` label via `/apply-actions`, which activates existing automation that auto-closes if no response within a set timeframe.

### Safety Gate

Before assigning ANY verdict:

- Confirm all required evidence fields for that verdict class are satisfied
- If any required evidence is missing or confidence is `Low`, downgrade to `Request More Info` or `Valid - Needs Triage`
- If you cannot justify a verdict with available evidence, defer to human review by classifying as `Valid - Needs Triage` with a note of your impression
- Set `requiresHumanApproval: true` for ALL close recommendations (`Close - Fixed`, `Close - Duplicate`, `Close - Invalid`, `Close - Stale`)
- Never override the two-source rule for `Close - Fixed`
- Never classify a team member's issue as spam

### Evidence Requirements by Verdict

| Verdict                   | Required Evidence                                                                |
| ------------------------- | -------------------------------------------------------------------------------- |
| Close - Fixed             | 2+ of: changelog entry, merged linked PR, maintainer comment, code investigation |
| Close - Duplicate         | Identified canonical issue number + both issues describe same behavior           |
| Close - Invalid           | Clear evidence of third-party cause, spam, or misunderstanding                   |
| Close - Stale             | No activity for 365+ days + feature still exists or addressed elsewhere          |
| Request More Info         | Specific description of what information is missing                              |
| Relabel - Bug             | Evidence issue describes a defect, not a feature request                         |
| Relabel - Feature Request | Evidence issue describes desired new behavior, not a defect                      |
| Valid - Needs Triage      | Insufficient evidence for any other verdict                                      |
| Valid - Already Triaged   | Has milestone, assignee, or triage labels                                        |

### Output

Construct issue URLs as `https://github.com/<pack.meta.repo>/issues/<number>` and link every issue reference in both the markdown report and JSON output.

Produce two files in `.triage/reports/`:

#### 1. Markdown Report

For reactive mode: `TRIAGE-REPORT-YYYY-MM-DD.md`
For audit mode: `AUDIT-REPORT-YYYY-MM-DD-batch-N.md`
For single mode: `TRIAGE-REPORT-YYYY-MM-DD.md`

Use this structure:

```markdown
# [Triage / Audit] Report — YYYY-MM-DD [Batch N]

Run ID: <runId>
Generated: <timestamp>
Workflow: reactive | audit
Query: <query params summary>
Issues evaluated: N
Issues requiring human approval: N

---

## Issues to Close Now

> All items in this section require human review before action is taken.

### [#NNNN — Title](https://github.com/<owner>/<repo>/issues/NNNN)

- **Verdict**: Close - Fixed | Close - Duplicate | Close - Invalid | Close - Stale
- **Confidence**: High | Medium | Low
- **Type**: <issue type> | **Labels**: <label list>
- **Evidence**: <concise evidence summary>
- **Recommended action**: <specific action to take>
- **Requires human approval**: Yes

---

## Issues Needing a Maintainer Comment

### [#NNNN — Title](https://github.com/<owner>/<repo>/issues/NNNN)

- **Verdict**: Request More Info
- **Confidence**: High | Medium | Low
- **Evidence**: <what is known>
- **Recommended action**: <specific comment to post>

---

## Issues Needing Relabeling

### [#NNNN — Title](https://github.com/<owner>/<repo>/issues/NNNN)

- **Verdict**: Relabel - Bug | Relabel - Feature Request
- **Confidence**: High | Medium | Low
- **Evidence**: <why the current label is wrong>
- **Current type/labels**: <current>
- **Recommended labels**: <changes to make>

---

## Issues to Enter Investigation Queue

### [#NNNN — Title](https://github.com/<owner>/<repo>/issues/NNNN)

- **Verdict**: Valid - Needs Triage
- **Confidence**: Medium | Low
- **Evidence**: <what is known and what needs investigation>

---

## Issues Already Triaged (No Immediate Action)

- [#NNNN — Title](https://github.com/<owner>/<repo>/issues/NNNN) — <reason it's already triaged>

---

## Quality Metadata

- Low-confidence verdicts: N (X%)
- Human approval required: N
- Issues skipped (Stage 1 resolved): N
- Issues escalated to Stage 2: N
```

#### 2. Machine-Readable Decisions JSON

File: `DECISIONS-YYYY-MM-DD[-batch-N].json`

```json
{
	"reportId": "<uuid>",
	"runId": "<uuid from pack>",
	"schemaVersion": "1.0",
	"generatedAt": "<ISO timestamp>",
	"workflow": "reactive | audit | single",
	"verdicts": [
		{
			"issueNumber": 1234,
			"verdict": "<VerdictClass>",
			"confidence": "High | Medium | Low",
			"evidenceChecklistStatus": {
				"changelogReference": true,
				"linkedPrOrCommit": true,
				"maintainerTimelineComment": false,
				"investigationEvidence": false
			},
			"recommendedLabels": [],
			"recommendedActions": ["close"],
			"requiresHumanApproval": true,
			"evidenceSummary": "...",
			"canonicalDuplicateNumber": null,
			"canonicalDuplicateStatus": null
		}
	]
}
```

Generate a UUID for `reportId`. Use the `runId` from the evidence pack's `meta.runId`.

Write both files and confirm their paths to the user.

## Chaining

This skill can be used standalone or as part of the issue workflow pipeline:

```
/triage recent → /investigate-triage → /resolve --from-investigation → /apply-actions
/triage 5096   → /investigate-triage 5096 → /resolve 5096 → /apply-actions
```

Downstream skills consume the decisions JSON produced by this skill.
