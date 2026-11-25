---
name: release-bugs
description: Refresh the Release Bug Ledger — attribute each GitLens bug to the stable release (vX.Y.Z) that introduced it and write the results to the shared artifact page. Use when asked to refresh, update or rebuild the release bug report or ledger. Run weekly.
---

# /release-bugs - Release Bug Ledger refresh

Brings the shared **Release Bug Ledger** up to date. Each fixed bug is traced from its fix back to the commit that first shipped the defect, and then to the earliest stable release that contains that commit. Accuracy is the point of this ledger. A bug only goes under a release when independent traces agree; otherwise it goes in a non-release group. Never guess.

A refresh only touches issues that are new or changed since the last one. Settled bugs are never traced again.

- Page: https://claude.ai/artifact/9xd2cohhuUn8hvjx6d4BcF
- Writing requires Contributor (or higher) access to the page. Only the owner or an Editor can republish its layout from `page.html` in this folder. A refresh never republishes.
- Trace method: `trace-prompt.md` in this folder. Rules for what counts live there and in `scripts/issues/release-bugs-core.mts`. Don't restate or change them here.

Known limit: GitLens 4.x releases have no stable tags in the repo, so a defect that dates from 4.x resolves to v5.0.0 (e.g. #6185, which first shipped in 4.0.1). This is accepted because the ledger is for recent releases. The page says so; don't report it as a refresh error.

## Rules

- Never write to GitHub.
- GitHub reads are REST only (`gh api <path>`). Never use `gh issue`/`gh pr` or GraphQL. On any rate limit, stop, run `gh api rate_limit`, and report which limit was hit and when it resets.
- Write rows from the files the script produced (`file_path` entries, absolute paths). Never retype row data.
- Run locally, not as a cloud routine. Cloud sessions can only call repo-scoped GitHub endpoints, so the scan can't read the GitKraken member list (`/orgs/gitkraken/members`) and fails. Issue `author_association` can't replace it: most members hide their membership, so to an outside reader their issues look like a contributor's.
- Run from the repo root of the **primary** worktree. Each run uses its own folder: `RUN=.work/release-bugs/$(date -u +%Y%m%dT%H%M%SZ)`. `$RUN` below means that folder.

## Steps

### 1. Export the current state

- `ArtifactData list`: collection `issues`, `query.limit` 1000, `out_dir` `$RUN/state`. Page with `query.cursor`. The listing shows each document's `version`; keep it for step 6.
- `ArtifactData get`: collection `meta`, doc_id `state`, `out_dir` `$RUN/state`. Note its `version`. "Not found" is fine on the first run.
- `ArtifactData list`: collection `releases`, with no `out_dir`. Note which tags exist.

### 2. Scan

```bash
node --experimental-strip-types scripts/issues/release-bugs.mts scan --state $RUN/state --out $RUN/out
```

Stdout is a summary with `startedAt`, `stats`, `writes`, `needsReading` (untyped community issues to classify), `needsTrace` (fixed bugs to trace, with `fixCommits`, including earlier needs-review bugs whose fix has since landed) and `releases`. Row bodies are files in `$RUN/out/`.

### 3. Classify untyped community issues

For each `needsReading` item, read the issue and its comments (`gh api repos/gitkraken/vscode-gitlens/issues/<n>` and `/comments`). Decide whether it describes a defect in GitLens. Feature requests, questions, and problems in VS Code or Git themselves are `not-bug`. Then:

```bash
node --experimental-strip-types scripts/issues/release-bugs.mts resolve --issue <n> --kind bug|not-bug --out $RUN/out
```

It routes the issue: either a row ready to write, or a trace target. For a trace target it prints the `title`, `url` and `fixCommits` that step 4 needs.

### 4. Trace

For each bug to trace (from `needsTrace` and from step 3), dispatch **two** `general-purpose` agents in parallel, both with `model: opus`. Give each one `trace-prompt.md` with `{number}`, `{title}`, `{url}` and `{fixCommits}` filled in, and nothing else: no other tracer's answer, no expected release. Run at most 4 bugs (8 agents) at a time.

Save each answer's JSON block to `$RUN/traces/<n>-<a|b|c>.json`, exactly as returned. Then apply the agreement rules in code:

```bash
node --experimental-strip-types scripts/issues/release-bugs.mts settle --issue <n> --out $RUN/out --trace $RUN/traces/<n>-a.json --trace $RUN/traces/<n>-b.json
```

### 5. Decide

`settle` maps each trace to a release with every fix commit and its copies. It counts a bug against the earliest stable release that contains the defect without its fix. Then it decides:

- **The two traces agree:** it writes the settled draft, plus `releases/<tag>.json` for the introducing release, and prints `{ number, status, introducedIn }`.
- **They disagree:** it prints `{ "needsTieBreak": true }` and writes nothing. Dispatch one more independent trace, save it as `<n>-c.json`, and rerun `settle` with all three. A 2-of-3 majority settles; otherwise the bug becomes `needs-review`.
- **Any `low` confidence on the winning side:** `needs-review`.

Never edit a draft's attribution by hand.

### 6. Write

Use `ArtifactData batch`, at most 50 entries per call. Write every file in `$RUN/out/issues/` and every **settled** draft in `$RUN/out/drafts/` (one whose `status` is set; a draft still waiting on a tie-break isn't ready). Each entry is `{ "op": "set", "collection": "issues", "doc_id": "<n>", "file_path": "<abs path to the file>" }`, plus `if_version` when the row already exists.

- Releases: one `set` per file in `out/releases/` whose tag isn't already in the `releases` collection.
- Meta, last: add `"lastRefreshBy": "<git user.name>"` to `out/meta/state.json`, then `set` `meta/state` from it (with `if_version` from step 1; omit it on the first run).

Write `meta/state` only when every step-3 issue and every trace target has been written. Its `lastRefreshAt` is where the next scan starts, so an unfinished bug must stay inside the next window. If anything is left unresolved, skip the meta write and say so in the report.

If a pinned write fails because a document changed, someone else is refreshing. Stop and rerun from step 1.

### 7. Report

A few lines:

- rows written
- bugs traced: `#n → vX.Y.Z (introduced) | external | not-a-gitlens-bug | needs-review`, with the trace count
- how many need review, and why
- the page link
