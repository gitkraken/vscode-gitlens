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
/triage audit [--older-than 180d] [--batch-size 50] [--type bug]   # Historical batch
/triage <any mode> --skip-trust        # Skip reporter claim verification for team-member issues
```

## Instructions

### Stage 0 — Prepare Evidence Pack

Run the CLI to ensure data is fresh. Forward all arguments after the command name.

**Single-issue mode:** When invoked with issue numbers, use the `single` command:

```bash
node --experimental-strip-types ./scripts/issues/triage.mts single <number> [number...]
```

**Batch modes:** Forward the command and arguments directly:

```bash
node --experimental-strip-types ./scripts/issues/triage.mts <recent|audit> [args]
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

#### 5. Reporter claim verification

Verify reporter claims against the codebase before assigning any verdict above Low confidence. Skip this step for team-member issues when `--skip-trust` is passed.

**Identify testable claims** — scan the issue body for references to specific settings (`gitlens.*`), commands, UI elements, error messages, described behavior, or code paths. These are the reporter's assertions about what exists and what happened.

**Spot-check 1–3 claims** using `Grep` or `Glob`:

- Does the referenced setting exist in `package.json` or `src/config.ts`?
- Does the referenced command exist in `contributions.json`?
- Does the described UI element, view, or menu item exist?
- Does the error message appear in the codebase?
- Does the described code path or behavior match the implementation?

**Record each checked claim** as one of:

- **Confirmed** — the claim matches what's in the codebase
- **Disputed** — the claim contradicts what's in the codebase (e.g., setting doesn't exist, behavior works differently)
- **Unverifiable** — the claim can't be checked from code alone (e.g., "it crashes on my machine," timing-dependent behavior)

**Confidence gate**: If no claims can be verified (all unverifiable or no testable claims present), cap the verdict confidence at Low regardless of other evidence strength. Disputed claims should further lower confidence or shift the verdict toward `Request More Info` or `Close - Invalid` depending on severity.

#### 6. Duplicate candidate scoring

For each entry in `duplicateCandidates`:

- If the canonical issue is closed-fixed, escalate to Stage 2 for deeper analysis
- If the canonical issue is open, note as `Close - Duplicate` candidate pending Stage 2 confirmation
- Evaluate `similarityBasis` to judge how strong the duplicate signal is

### Stage 2 — Deep Pass (unresolved and high-value cases only)

Apply only to issues not yet resolved to a high-confidence verdict in Stage 1.

#### 7. Feature-exists check (feature requests)

Does the requested feature already exist in the extension? Check against CHANGELOG entries (`changelogEntry` field), known feature areas, or codebase evidence if needed. If the feature already exists, classify as `Close - Already Exists` with a note explaining the existing feature and how to access it.

#### 8. Bug-still-valid hypothesis (bug reports)

Is there evidence the behavior described still exists? Cross-reference with `changelogEntry`. If a changelog entry exists for this issue, it is strong evidence of a fix — but must be corroborated by at least one other source:

- Linked PR state (merged PR that addresses the fix)
- Maintainer timeline comment confirming the fix
- Investigation evidence from the codebase

Do NOT classify as `Close - Fixed` on changelog evidence alone.

#### 9. Fixed-status decision — Two-Source Rule

To classify an issue as `Close - Fixed`, you MUST have at least two independent evidence sources:

1. Changelog reference (`changelogEntry` is non-null)
2. Linked PR or commit (a merged PR in `linkedPrs`)
3. Maintainer timeline comment confirming the fix
4. Codebase investigation evidence

If only one source is present, downgrade to `Request More Info` or `Valid - Needs Triage`.

#### 10. Third-party cause classification

Is the issue caused by a VS Code API limitation, a platform OS issue, or a third-party extension conflict? Note this as evidence for `Close - Invalid` with an explicit reason.

#### 11. Stale evaluation (audit and single mode)

Does the issue meet ALL THREE stale criteria:

- (a) No activity for >= `staleInactivityDays` (365 days) — check `lastActivityAt`
- (b) The referenced feature/UI still exists or the fix was addressed elsewhere
- (c) No missing mandatory evidence that would block a reliable verdict

Only then classify as `Close - Stale`. Check `supersessionIndicators` for evidence of supersession.

**Codebase-level staleness signals:** If the issue references specific UI elements, settings, commands, or code paths, check whether they still exist in the codebase. If the referenced functionality has been removed, substantially redesigned, or renamed, that is strong evidence for staleness. Use `Grep` or `Glob` to quickly verify existence of referenced features.

#### 11a. Stale-but-needs-verification (audit and single mode)

Separate from `Close - Stale`, identify issues that are old and inactive but where the code path still exists and the issue may still be valid. Classify as `Request More Info` when ALL of:

- (a) No activity for a significant period (e.g., 6+ months) — check `lastActivityAt`
- (b) The reported GitLens version is significantly outdated
- (c) No upvotes or low engagement (`reactions.thumbsUp` is 0-1)
- (d) The code path still exists (not eligible for `Close - Stale`)

The `Request More Info` comment should ask the reporter to verify the issue still occurs on the current version and provide updated environment details. This triggers the `needs-more-info` label via `/update-issues`, which activates existing automation that auto-closes if no response within a set timeframe.

### Safety Gate

Before assigning ANY verdict:

- Confirm all required evidence fields for that verdict class are satisfied
- If any required evidence is missing or confidence is `Low`, downgrade to `Request More Info` or `Valid - Needs Triage`
- If you cannot justify a verdict with available evidence, defer to human review by classifying as `Valid - Needs Triage` with a note of your impression
- Set `requiresHumanApproval: true` for ALL close recommendations (`Close - Fixed`, `Close - Duplicate`, `Close - Not a Bug`, `Close - Already Exists`, `Close - Invalid`, `Close - Stale`)
- Never override the two-source rule for `Close - Fixed`
- Never classify a team member's issue as spam

### Evidence Requirements by Verdict

| Verdict                  | Required Evidence                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| Close - Fixed            | 2+ of: changelog entry, merged linked PR, maintainer comment, code investigation               |
| Close - Duplicate        | Identified canonical issue number + both issues describe same behavior                         |
| Close - Not a Bug        | Evidence the reported behavior is expected, user error, or environment-specific (not a defect) |
| Close - Already Exists   | Codebase or CHANGELOG evidence the requested feature already ships                             |
| Close - Invalid          | Clear evidence of third-party cause, spam, or misunderstanding                                 |
| Close - Stale            | No activity for 365+ days + feature still exists or addressed elsewhere                        |
| Request More Info        | Specific description of what information is missing                                            |
| Retype - Bug             | Evidence issue describes a defect, not a feature request                                       |
| Retype - Feature Request | Evidence issue describes desired new behavior, not a defect                                    |
| Valid - Needs Triage     | Insufficient evidence for any other verdict                                                    |
| Valid - Already Triaged  | Has milestone, assignee, or triage labels                                                      |

### Output

Construct issue URLs as `https://github.com/<pack.meta.repo>/issues/<number>` and link every issue reference in both the markdown report and JSON output.

Produce two files in `.work/triage/reports/`:

#### 1. Markdown Report

For reactive mode: `YYYY-MM-DD-TRIAGE-REPORT.md`
For audit mode: `YYYY-MM-DD-AUDIT-REPORT-batch-N.md`
For single mode: `YYYY-MM-DD-TRIAGE-REPORT.md`

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

- **Author**: @username (team) | @username
- **Verdict**: Close - Fixed | Close - Duplicate | Close - Not a Bug | Close - Already Exists | Close - Invalid | Close - Stale
- **Confidence**: High | Medium | Low
- **Type**: <issue type> | **Labels**: <label list>
- **Claims**: <checked claims with status: confirmed/disputed/unverifiable — omit if verification was skipped>
- **Evidence**: <concise evidence summary>
- **Recommended action**: <specific action to take>
- **Requires human approval**: Yes

---

## Issues Needing a Maintainer Comment

### [#NNNN — Title](https://github.com/<owner>/<repo>/issues/NNNN)

- **Author**: @username (team) | @username
- **Verdict**: Request More Info
- **Confidence**: High | Medium | Low
- **Claims**: <checked claims with status — omit if verification was skipped>
- **Evidence**: <what is known>
- **Recommended action**: <specific comment to post>

---

## Issues Needing Retyping

### [#NNNN — Title](https://github.com/<owner>/<repo>/issues/NNNN)

- **Author**: @username (team) | @username
- **Verdict**: Retype - Bug | Retype - Feature Request
- **Confidence**: High | Medium | Low
- **Claims**: <checked claims with status — omit if verification was skipped>
- **Evidence**: <why the current type is wrong>
- **Current type**: <current>
- **Recommended type**: <new type>

---

## Issues to Enter Investigation Queue

### [#NNNN — Title](https://github.com/<owner>/<repo>/issues/NNNN)

- **Author**: @username (team) | @username
- **Verdict**: Valid - Needs Triage
- **Confidence**: Medium | Low
- **Claims**: <checked claims with status — omit if verification was skipped>
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

File: `YYYY-MM-DD-DECISIONS[-batch-N].json`

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
			"claimsVerification": [
				{
					"claim": "setting gitlens.foo exists",
					"status": "confirmed | disputed | unverifiable",
					"detail": "optional — what was found or why it couldn't be checked"
				}
			],
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
/triage recent → /investigate --from-report → /prioritize --from-report → /update-issues
/triage 5096   → /investigate 5096          → /prioritize 5096          → /update-issues
```

Downstream skills consume the decisions JSON produced by this skill.
