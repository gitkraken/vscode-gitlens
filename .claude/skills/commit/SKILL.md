---
name: commit
description: Create well-formatted git commits following GitLens conventions
---

# /commit - Create Git Commit

Create a well-formatted git commit following GitLens conventions.

## Usage

```
/commit [message]
```

## Commit Message Format

- Third-person singular present tense: **Adds**, **Fixes**, **Improves**, **Updates**, **Removes**, **Refactors**
- First line under 72 characters
- Reference issues with `#123` syntax

Examples:

```
Adds support for custom autolinks for Jira - fixes #1234
Fixes graph not rendering when switching repositories
Improves performance of commit signature detection
Refactors git provider initialization
```

## Workflow

1. **Check status**: `git status` (never use `-uall`)
2. **Review changes**: `git diff --cached` and `git diff`
3. **Stage files** — specific files, not `git add -A`
4. **Generate message** if none provided — analyze changes, determine type, draft message, confirm with user
5. **Commit** using HEREDOC format with Co-Authored-By trailer
6. **Verify**: `git status` and `git log -1`

## Pre-commit Hook Failures

1. Do NOT use `--amend` (the failed commit never happened — amend would modify the previous commit)
2. Fix the reported issues
3. Re-stage fixed files
4. Create a NEW commit

## Safety

- Never use `--force` or `--no-verify`
- Never amend unless explicitly requested
- Verify no sensitive files are staged (.env, credentials)
