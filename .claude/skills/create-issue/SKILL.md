---
name: create-issue
description: Create GitHub issues from uncommitted changes or commits
---

# /create-issue - Create GitHub Issue

Analyze changes and create GitHub issues with CHANGELOG entries.

## Usage

```
/create-issue [source]
```

- `source`: "uncommitted", a commit SHA, or a range like "abc123..def456"

## Workflow

1. **Collect diff**: uncommitted (`git diff`), single commit (`git show <sha>`), or range (`git diff <range>`)
2. **Classify**: bugfix / feature / refactor / docs / tests
3. **Check duplicates**: `gh search issues --repo gitkraken/vscode-gitlens "<keywords>"`
4. **Create issue**: generate title + body, **confirm with user first**
5. **Update CHANGELOG**: add entry to `[Unreleased]`, **confirm with user first**

## Duplicate Detection

Score matches 0-1:

- Title similarity (>75% token overlap): +0.5
- Body keyword overlap: +0.3
- Same component: +0.15

Thresholds: >= 0.7 likely duplicate, 0.45-0.69 possibly related, < 0.45 ignore.

## Issue Title

- Describe the _problem/need_ from user's perspective, not the solution
- Be specific with context ("when switching repositories", "in large repos")
- Concise, no trailing punctuation

## Issue Body

| Section    | Content               |
| ---------- | --------------------- |
| Summary    | One-line description  |
| Impact     | Who/what benefits     |
| Validation | Steps to verify       |
| Risk       | Potential regressions |

```bash
gh issue create --title "<title>" --body "<body>" --assignee @me --label "<labels>"
```

## Labels

- Fetch existing: `gh label list --limit 100`
- ONLY use existing labels
- Confirm with user before applying

## CHANGELOG Entry

Format per `/changelog` skill. Map: Feature→Added, Enhancement→Changed, Bugfix→Fixed, Removal→Removed.

## Safety

1. NEVER include code snippets, diffs, or implementation details in issues
2. NEVER include credentials or secrets
3. NEVER create labels without user confirmation
4. **NEVER auto-create issues or edit CHANGELOG without user confirmation**
