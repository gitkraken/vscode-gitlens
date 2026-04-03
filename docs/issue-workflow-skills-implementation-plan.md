# Issue Workflow Skills — Implementation Plan

## Current State Assessment

### What Exists

| Component                                                           | Status | Coverage                                                                                            |
| ------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| **Triage skill** (`.claude/skills/triage/`)                         | Solid  | Stage 1 fully covered — evidence packs, two-stage eval, 9 verdict classes, batch (reactive + audit) |
| **Investigate skill** (`.claude/skills/investigate/`)               | Solid  | Stage 2 single-issue — structured root cause analysis with code tracing                             |
| **Investigate-triage skill** (`.claude/skills/investigate-triage/`) | Solid  | Bridges triage → investigation — parallel subagents from triage decisions                           |
| **Triage scripts** (`scripts/triage/`)                              | Solid  | Data fetching infra — GraphQL, caching, rate limiting, evidence pack assembly                       |

### Gaps vs Requirements

| Gap                                           | Requirement                                                   | Impact                                                             |
| --------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| No Resolution & Planning skill                | Stage 3: prioritize, recommend milestone, draft communication | Engineers/PMs lack actionable next steps after investigation       |
| No reaction data in evidence packs            | Priority signals need thumbs-up/reaction counts               | Can't score issue impact for resolution planning                   |
| No single-issue mode for triage/investigation | Each stage works on single issue or range                     | Can't triage one issue without building a full batch evidence pack |
| No apply-actions skill                        | Separate action to apply recommendations to GitHub            | All recommendations are read-only with no efficient way to act     |
| No codebase staleness detection               | Detect if affected code was refactored/removed                | Backlog relevance review can't check if code moved on              |
| No resolution-level batch summary             | Batch output with counts by recommendation category           | PMs lack aggregate planning view                                   |

---

## Architecture Decision: Extend vs. Rebuild

**Decision: Extend the existing system.**

The existing triage infrastructure is well-designed — evidence packs decouple data fetching from analysis, the script layer handles GraphQL complexity and caching, and the skill layer handles AI evaluation. The gaps are additive, not structural.

**Trade-offs considered:**

| Approach                                     | Pros                                                             | Cons                                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Extend existing                              | Reuses proven infra, smaller change surface, consistent patterns | Must work within existing data structures                                                             |
| Rebuild from scratch                         | Clean-slate design, no legacy constraints                        | Throws away working code, risk of re-introducing solved problems (rate limiting, caching, pagination) |
| Hybrid (new resolution stack, extend triage) | Each layer optimized independently                               | Two data fetching strategies to maintain                                                              |

The existing `EvidencePack` schema is extensible — adding `reactionGroups` to the GraphQL fragment and `reactions` to `EnrichedIssue` is a small, safe change.

---

## Implementation Plan

### Phase 1: Data Layer Enhancements

Enhance the existing `scripts/triage/` infrastructure to support all three stages.

#### 1.1 Add reaction data to evidence packs

**Files to modify:**

- `scripts/triage/fetch-issues.mts` — Add `reactionGroups` to the GraphQL `IssueFields` fragment
- `scripts/triage/types.mts` — Add `reactions` field to `EnrichedIssue`
- `scripts/triage/build-pack.mts` — Map reaction data during enrichment

**GraphQL fragment addition:**

```graphql
reactionGroups {
  content
  reactors(first: 0) { totalCount }
}
```

**Type addition:**

```typescript
export interface ReactionSummary {
	thumbsUp: number;
	thumbsDown: number;
	heart: number;
	hooray: number;
	confused: number;
	rocket: number;
	eyes: number;
	laugh: number;
	total: number;
}
```

**Why reactions matter:** They're the primary signal for "how many people care about this" — more reliable than comment count (which includes bot comments and "me too" noise). The `thumbsUp` count specifically correlates with user demand.

#### 1.2 Add single-issue evidence pack mode

**Files to modify:**

- `scripts/triage/triage.mts` — Add `single <number> [number...]` command
- `scripts/triage/fetch-issues.mts` — Add `fetchSingleIssues(numbers: number[])` function

**New CLI command:**

```bash
node --experimental-strip-types ./scripts/triage/triage.mts single 5096 5084 5070
```

**Implementation approach:** Use GraphQL aliases to fetch multiple specific issues in a single request:

```graphql
query ($owner: String!, $repo: String!) {
	repository(owner: $owner, name: $repo) {
		i5096: issue(number: 5096) {
			...IssueFields
		}
		i5084: issue(number: 5084) {
			...IssueFields
		}
	}
}
```

This avoids one-request-per-issue overhead and stays within the GraphQL rate limit budget. Use conservative chunking (10 issues per GraphQL request) since the `IssueFields` fragment has nested pagination (comments, timeline, labels, assignees). Add error handling to retry with smaller chunks if a complexity limit is hit.

**Evidence pack output:** Same `EvidencePack` format with `workflow: 'single'` and a new `SingleQueryParams` type. Same enrichment pipeline (team members, labels, changelog, duplicate candidates). This means all downstream skills (triage, investigate-triage, resolve) consume the same pack format regardless of how issues were selected.

**`Workflow` type impact:** Adding `'single'` to the `Workflow` union type affects `RunMetadata.workflow` which the triage skill reads to gate behavior (e.g., stale evaluation is "audit mode only"). The triage skill must be updated to handle `workflow: 'single'` — single mode should run all Stage 2 steps including stale evaluation for old issues, since the user explicitly chose these issues for analysis.

#### 1.3 Related-issue counting (moved to resolve skill)

**No changes to evidence pack scripts.** The evidence pack's `duplicateCandidates` field already provides in-batch cross-references. Broader related-issue counting is deferred to the resolve skill (Phase 2), which performs `gh search issues` calls on-demand during resolution analysis.

**Rationale:** The evidence pack build pipeline (`buildPack()`) is a single-pass function that returns a complete pack. Adding Search API calls (rate-limited to 30/min) would slow pack building and couple triage data fetching to resolution concerns. Instead, the resolve skill fetches related-issue counts itself using issue titles as search keywords, only for the issues it's actually evaluating. This keeps pack building fast and avoids hitting the search rate limit during triage.

**Implementation in resolve skill:**

- For each issue being evaluated, run: `gh search issues --repo gitkraken/vscode-gitlens "<significant keywords from title>" --state open --json number --limit 20`
- Count results (excluding the issue itself) as `relatedIssueCount`
- Rate-budget: max 25 search calls per resolve invocation (leaves headroom within 30/min limit)
- Cache results in memory for the duration of the resolve run (no persistent cache needed)

---

### Phase 2: Resolution & Planning Skill

Create `.claude/skills/resolve/SKILL.md` — the Stage 3 skill.

#### 2.1 Skill design

**Usage:**

```
/resolve <issue-number> [issue-number...]
/resolve --from-triage [report-path]
/resolve --from-investigation [report-path]
```

**Three input modes:**

1. **Direct** — One or more issue numbers. Fetches evidence pack via `single` command, performs resolution analysis.
2. **From triage** — Reads a triage decisions JSON. Filters to issues with actionable verdicts (`Valid - Needs Triage`, `Valid - Already Triaged`, `Relabel - *`). Performs resolution analysis on each.
3. **From investigation** — Reads an investigation decisions JSON (see Phase 2.4 below). Uses investigation findings (root cause, effort, risk, confidence) as additional input to resolution analysis. Falls back to evidence pack data for issues not covered by investigation.

#### 2.2 Resolution analysis per issue

For each issue, the skill evaluates:

**Priority signals (gathered from evidence pack + investigation):**

| Signal                        | Source                                                                       | Weight rationale                                          |
| ----------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| Reaction count (thumbs-up)    | Evidence pack `reactions.thumbsUp`                                           | Direct measure of user demand                             |
| Related/duplicate issue count | Evidence pack `relatedIssueCount` + `duplicateCandidates`                    | Breadth of impact                                         |
| Severity                      | Inferred from issue content (data loss > crash > broken workflow > cosmetic) | Urgency                                                   |
| Estimated effort              | Investigation report or inferred from issue complexity                       | Cost side of cost-benefit                                 |
| Issue age                     | `createdAt` from evidence pack                                               | Older = more rotted, but also possibly less relevant      |
| Activity recency              | `lastActivityAt` from evidence pack                                          | Recent activity = still relevant                          |
| Comment count                 | Evidence pack `commentCount`                                                 | Discussion volume (noisy signal, but useful in aggregate) |

**Recommendation logic:**

```
IF out-of-scope OR working-as-designed:
  → Won't Fix (draft explanatory comment)

IF good feature AND (low reaction count OR niche use case) AND effort > Small:
  → Community Contribution (draft invitation comment with context)

IF high reactions OR high severity OR many related issues:
  → Shortlist (recommend milestone: shortlist, add to GitHub project)

ELSE:
  → Backlog (recommend milestone: backlog)
```

The skill does NOT auto-decide — it presents the signals and recommendation with confidence level, and a human makes the final call.

#### 2.3 Output format

**Per-issue output:**

```markdown
### [#NNNN — Title](https://github.com/gitkraken/vscode-gitlens/issues/NNNN)

- **Recommendation**: Shortlist | Backlog | Won't Fix | Community Contribution
- **Confidence**: High | Medium | Low

#### Priority Signals

| Signal                | Value             | Assessment         |
| --------------------- | ----------------- | ------------------ |
| Reactions (thumbs-up) | 45                | High demand        |
| Related issues        | 3 open, 2 closed  | Recurring problem  |
| Severity              | Broken workflow   | High               |
| Estimated effort      | Medium (1-3 days) | From investigation |
| Age                   | 2.3 years         | Long-standing      |
| Last activity         | 3 months ago      | Moderately recent  |

#### Rationale

[2-3 sentences explaining why this recommendation, citing specific signals]

#### Draft Message (if applicable)

> [Draft comment for won't-fix or community-contribution verdicts]
```

**Batch summary output (when multiple issues):**

```markdown
# Resolution Report — YYYY-MM-DD

Issues evaluated: N

## Summary

| Recommendation         | Count | Issues                            |
| ---------------------- | ----- | --------------------------------- |
| Shortlist              | 5     | #1234, #2345, #3456, #4567, #5678 |
| Backlog                | 12    | ...                               |
| Won't Fix              | 3     | ...                               |
| Community Contribution | 2     | ...                               |

## Shortlist (recommended for near-term work)

[Per-issue details, ordered by priority score]

## Backlog

[Per-issue details, ordered by priority score]

## Won't Fix

[Per-issue details]

## Community Contribution

[Per-issue details]
```

**Machine-readable JSON:**

```json
{
	"reportId": "<uuid>",
	"generatedAt": "<ISO timestamp>",
	"resolutions": [
		{
			"issueNumber": 1234,
			"recommendation": "shortlist",
			"confidence": "High",
			"prioritySignals": {
				"reactionsThumbsUp": 45,
				"relatedIssueCount": 5,
				"severity": "broken-workflow",
				"estimatedEffort": "Medium",
				"ageInDays": 840,
				"lastActivityDaysAgo": 90
			},
			"rationale": "...",
			"draftMessage": null
		}
	]
}
```

**Output location:** `.triage/reports/RESOLUTION-REPORT-YYYY-MM-DD.md` and `.triage/reports/RESOLUTIONS-YYYY-MM-DD.json`

#### 2.4 Add JSON output to investigate-triage skill

**File to modify:** `.claude/skills/investigate-triage/SKILL.md`

**Problem:** The investigate-triage skill currently outputs only a markdown report. The resolve skill's `--from-investigation` mode needs structured data to consume investigation findings (effort, risk, confidence, result) without fragile markdown parsing.

**Addition:** After writing the markdown report, also write a machine-readable JSON file:

**File:** `.triage/reports/INVESTIGATION-DECISIONS-YYYY-MM-DD.json`

```json
{
	"reportId": "<uuid>",
	"sourceDecisionsFile": "<path to triage decisions that triggered this>",
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
			"recommendation": "Fix | Request Info | Close | Needs Planning"
		}
	]
}
```

This mirrors the triage decisions JSON pattern — markdown for humans, JSON for downstream skills.

---

### Phase 3: Apply Actions Skill

Create `.claude/skills/apply-actions/SKILL.md` — the action execution skill (renamed from `apply-triage` to reflect broader scope).

#### 3.1 Skill design

**Usage:**

```
/apply-actions [report-path] [--dry-run]
```

**Purpose:** Read a triage, investigation, or resolution report and apply the recommended actions to GitHub. This is the only skill that modifies GitHub state.

**Supported actions:**

- Add/remove labels
- Post comments (from draft messages)
- Set milestone
- Close issue (with comment)
- Add to GitHub project

**Safety model:**

1. **Dry-run by default** — First invocation shows what would be done, asks for confirmation
2. **Batch confirmation** — For batch operations, show a summary table of all actions and get one confirmation
3. **Per-issue confirmation for destructive actions** — Closing issues requires individual confirmation
4. **Audit log** — Write applied actions to `.triage/reports/ACTIONS-YYYY-MM-DD.md`
5. **Pre-flight state check** — Before applying any action, fetch current issue state (`gh issue view --json state,labels,milestone`) and skip/warn if the issue has changed since the report was generated (e.g., already closed, labels already applied, milestone already set). This prevents stale-report conflicts.

#### 3.2 Implementation

The skill reads report files (decisions JSON, investigation decisions JSON, or resolutions JSON) and translates recommendations into `gh` CLI commands:

```bash
# Labels
gh issue edit <number> --repo gitkraken/vscode-gitlens --add-label "triaged" --remove-label "triage"

# Comment
gh issue comment <number> --repo gitkraken/vscode-gitlens --body "<message>"

# Milestone
gh issue edit <number> --repo gitkraken/vscode-gitlens --milestone "Backlog"

# Close
gh issue close <number> --repo gitkraken/vscode-gitlens --reason "not planned" --comment "<message>"

# Project (requires GraphQL)
gh api graphql -f query='mutation { addProjectV2ItemById(...) { ... } }'
```

**Report-type detection:** The skill reads the JSON file and determines the type from the schema:

- Has `verdicts` array → triage decisions
- Has `resolutions` array → resolution decisions
- Has investigation findings → investigation report (extract recommendations)

---

### Phase 4: Backlog Relevance Enhancement

Enhance existing skills to detect codebase-level staleness.

#### 4.1 Codebase staleness detection in investigate skill

**File to modify:** `.claude/skills/investigate/SKILL.md`

**Addition:** When investigating an old issue (> 1 year), add a relevance check step before the full investigation:

1. Identify the feature area / code paths mentioned in the issue
2. Check `git log --since="<issue creation date>" -- <relevant files>` for significant changes
3. If the relevant files have been deleted or substantially rewritten (> 70% changed lines), flag as "Code path no longer exists" or "Feature area significantly refactored"
4. Include this in the investigation output as a **Relevance Assessment** section

This is a lightweight check that leverages git history — no need for a separate script.

#### 4.2 Staleness signals in triage audit mode

**File to modify:** `.claude/skills/triage/SKILL.md`

**Enhancement to Stage 2, step 10 (Stale evaluation):** Add guidance for the AI to consider codebase-level signals when available. The triage skill already has supersession detection from comment text — this adds a note that if the issue references specific UI elements, settings, or commands that no longer exist in the codebase, that's evidence for staleness.

This doesn't require script changes — it's guidance for the AI evaluator to use its codebase access during triage of old issues.

---

### Phase 5: Composability & Single-Issue Flow

Make all three stages work seamlessly as standalone or chained operations on single issues or ranges.

#### 5.1 Update triage skill for single-issue mode

**File to modify:** `.claude/skills/triage/SKILL.md`

**New usage:**

```
/triage <number> [number...]           # Single issue(s)
/triage recent [--since 7d]            # Recent batch
/triage audit [--older-than 180d]      # Historical batch
```

When invoked with issue numbers, the skill runs `triage.mts single <numbers>` to build an evidence pack, then evaluates using the same two-stage process. The output format is the same — a triage report and decisions JSON — just with fewer issues.

#### 5.2 Update investigate-triage for flexible input

**File to modify:** `.claude/skills/investigate-triage/SKILL.md`

**Enhancement:** In addition to reading from a decisions JSON file, allow reading from the triage report directly by issue number:

```
/investigate-triage 5096 5084          # Investigate specific issues
/investigate-triage [report-path]      # From triage decisions (existing)
```

When given issue numbers directly, skip the decisions file filtering and go straight to fetching issue context + spawning investigation subagents.

#### 5.3 Chaining documentation

Add a section to each skill's SKILL.md showing how it chains with the others:

```
## Chaining

This skill can be used standalone or as part of the issue workflow:

/triage recent → /investigate-triage → /resolve --from-investigation
/triage 5096   → /investigate-triage 5096 → /resolve 5096
```

---

## Implementation Order & Dependencies

```
Phase 1.1 (reactions)  ─┐
Phase 1.2 (single)     ─┤─→ Phase 2 (resolve skill + 2.4 investigation JSON) ─→ Phase 3 (apply skill)
                        │         │
Phase 4.1 (staleness)  ┘         │
Phase 4.2 (triage staleness)     │
Phase 5 (composability) ─────────┘
```

Note: Phase 1.3 (related-issue counting) was moved into the resolve skill (Phase 2) — no longer a separate data layer step.

**Recommended build order:**

1. Phase 1.1 + 1.2 (parallel — independent script changes)
2. Phase 5.1 (triage single-issue mode — depends on 1.2)
3. Phase 2.1-2.3 (resolve skill — depends on 1.1, 1.2)
4. Phase 2.4 (investigation JSON output — independent, can overlap with 2.1-2.3)
5. Phase 4 (staleness — independent, can overlap with Phase 2)
6. Phase 5.2 + 5.3 (composability — depends on Phase 2)
7. Phase 3 (apply skill — depends on Phase 2 for resolution JSON schema)

---

## Files Created/Modified Summary

### New Files

| File                                    | Purpose                               |
| --------------------------------------- | ------------------------------------- |
| `.claude/skills/resolve/SKILL.md`       | Resolution & Planning skill (Stage 3) |
| `.claude/skills/apply-actions/SKILL.md` | Action execution skill                |

### Modified Files

| File                                         | Change                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `scripts/triage/fetch-issues.mts`            | Add `reactionGroups` to GraphQL fragment; add `fetchSingleIssues()`             |
| `scripts/triage/types.mts`                   | Add `ReactionSummary`, `SingleQueryParams`; add `'single'` to `Workflow` union  |
| `scripts/triage/build-pack.mts`              | Map reactions during enrichment; handle single-issue mode                       |
| `scripts/triage/triage.mts`                  | Add `single` command                                                            |
| `scripts/triage/config.mts`                  | Add `singleIssueBatchLimit` config                                              |
| `.claude/skills/triage/SKILL.md`             | Add single-issue usage; handle `workflow: 'single'`; enhance staleness guidance |
| `.claude/skills/investigate/SKILL.md`        | Add relevance assessment step for old issues                                    |
| `.claude/skills/investigate-triage/SKILL.md` | Add JSON output; add direct issue number input; chaining docs                   |

---

## Risk Assessment

| Risk                                                     | Likelihood | Impact                         | Mitigation                                                            |
| -------------------------------------------------------- | ---------- | ------------------------------ | --------------------------------------------------------------------- |
| Search API rate limit (30/min) blocks batch resolution   | Medium     | Delays batch processing        | Budget search calls; use GraphQL where possible; add backoff          |
| Reaction data increases evidence pack size significantly | Low        | Slower pack loading            | Reactions are ~100 bytes per issue — negligible at 876 issues         |
| Single-issue GraphQL aliases hit complexity limit        | Low        | Can't fetch >10 issues at once | Chunk at 10 per request; retry with smaller chunks on error           |
| Resolution recommendations are too generic               | Medium     | Users don't trust the skill    | Ground every recommendation in specific signals; always show the data |
| Apply skill acts on stale report                         | Medium     | Redundant/conflicting actions  | Pre-flight state check before each action; skip if state changed      |
| Apply skill accidentally closes valid issues             | Medium     | User trust loss                | Dry-run default; per-issue confirmation for closes; audit log         |

---

## Success Criteria

1. **Single-issue flow works end-to-end:** `/triage 5096` → `/investigate-triage 5096` → `/resolve 5096` → `/apply-actions`
2. **Batch flow works end-to-end:** `/triage recent` → `/investigate-triage` → `/resolve --from-investigation` → `/apply-actions`
3. **Resolution recommendations are grounded:** Every recommendation cites specific priority signals with values
4. **Apply skill is safe:** Dry-run by default, confirmation required, audit logged
5. **Old issues get relevance checks:** Investigation of 2+ year old issues includes codebase staleness assessment
6. **All outputs follow existing conventions:** Reports in `.triage/reports/`, same markdown structure, machine-readable JSON alongside
