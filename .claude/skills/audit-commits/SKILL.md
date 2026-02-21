---
name: audit-commits
description: Audit commits for issues and CHANGELOG entries
---

# /audit-commits - Audit Commits

Compare HEAD against a tag, identify user-facing commits, ensure they have linked issues and CHANGELOG entries.

## Usage

```
/audit-commits [tag]
```

No tag: suggest the most recent (`git tag --sort=-creatordate | head -10`).

## Workflow

1. **Fetch commits**: `git log --format="%h %s" <tag>..HEAD`
2. **Analyze each** (oldest first):
   - Get diff: `git show <sha> --stat` and `git show <sha>`
   - Classify: bugfix / feature / refactor / docs / tests / chore
   - Assess impact: High / Medium / Low / None
   - Check for linked issue (`#<num>` in message)
3. **Group related commits** (e.g., feature + immediate follow-up fix)
4. **Check each user-facing commit** against `[Unreleased]` in CHANGELOG.md
5. **Present summary**, confirm before creating issues or editing CHANGELOG

## Impact Assessment

| Impact | Criteria                                           |
| ------ | -------------------------------------------------- |
| High   | New feature, breaking change, significant bugfix   |
| Medium | Enhancement, minor bugfix, performance improvement |
| Low    | Edge case fix, minor polish                        |
| None   | Refactor, internal cleanup, tests, docs-only       |

User-facing (High/Medium/Low) require issue + CHANGELOG. None = skip.

## Issue Creation

Same workflow as `/create-issue`: duplicate detection, user confirmation, no auto-creation.

After creating: `gh issue comment <num> --body "Closed by <commit_sha>"`

## Progress Display

```
Auditing commits: <tag>..HEAD

Summary:
- Total commits: 25
- User-facing: 12 (missing issue: 3, missing CHANGELOG: 5)
- Not user-facing: 13 (skipped)
```

Then ask: "Process these commits? (create issues / update CHANGELOG / both / skip)"

## Safety

1. NEVER include code snippets or implementation details in issues
2. NEVER create labels without user confirmation
3. **NEVER auto-create issues or edit CHANGELOG without user confirmation**
