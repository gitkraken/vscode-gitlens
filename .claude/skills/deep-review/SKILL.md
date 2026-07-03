---
name: deep-review
description: Use to gate a change set before merge — delegates bug-hunting to the built-in code-review skill, then layers goals.md alignment, cross-platform/consumer completeness, and validation-gap analysis into a merge verdict. For standards/checklist compliance use /review.
---

# /deep-review - Merge Gate Review

Merge-gate review. The bug hunt (correctness, regressions, design, performance) is delegated to the built-in `code-review` skill, which adversarially verifies its findings. This skill layers what code-review doesn't cover — does the change deliver what was scoped, is it complete across all affected locations, is it adequately validated — and renders a merge verdict.

## Usage

```
/deep-review [target] [level] [--fix]
/deep-review branch --scope .work/dev/5096/
/deep-review branch max --fix --scope .work/dev/5096/
```

- **`--scope <path>`**: When provided, read `goals.md` from the given directory to understand the original intent, success criteria, and user experience requirements. Use this to evaluate whether the implementation actually delivers what was scoped — not just whether the code is correct in isolation.
- **`[level]`** (`low` | `medium` | `high` | `xhigh` | `max`): forwarded to the built-in `code-review` pass as its effort level. Default: `high`. If `ultra` is passed, do not launch it (user-triggered and billed) — tell the user to run `/code-review ultra` themselves, then re-run `/deep-review`, which will reuse those findings.
- **`--fix`**: forwarded to `code-review` — it applies its confirmed findings to the working tree after its review. Gate findings (goals/completeness/validation) are reported, never auto-applied.
- No argument: review staged changes (`git diff --cached`)
- `all`: all uncommitted changes
- `branch`: changes vs base branch (`git diff main...HEAD`)
- `pr`: current PR changes (`gh pr diff`)
- `commit:SHA`: specific commit

## Positioning

| Skill                    | Purpose                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `code-review` (built-in) | Finds correctness bugs + simplification/efficiency cleanups; adversarially verified        |
| `/review`                | GitLens standards compliance + impact completeness checklist                               |
| `/deep-review`           | Merge gate: goals alignment + completeness + validation + verdict (delegates the bug hunt) |

## Step 1 — Delegate the bug hunt

Invoke the built-in `code-review` skill (Skill tool, `skill: "code-review"`) on the target diff, forwarding the user's arguments: the effort level (default `high`) and `--fix` if provided.

- If the user already ran `/code-review` (or ultra) on this change set in this session, do NOT re-run it — use those findings.
- NEVER launch `ultra` yourself — it is user-triggered and billed. For large or high-risk change sets, suggest the user run `/code-review ultra` instead of the inline pass.
- `commit:SHA` targets don't map to code-review's diff model: review that commit's diff yourself with the same lenses (correctness, regressions, design, performance) and say you did. `--fix` doesn't apply to committed diffs — say so if it was passed.
- With `--fix`, code-review mutates the working tree — run Steps 2-4 on the POST-fix state, and list the applied fixes in the report.

Carry the confirmed findings into this review: a blocking code-review finding blocks the merge verdict here (unless `--fix` already resolved it — then note it as fixed).

## Step 2 — Goals alignment (when `--scope` given)

For each success criterion and UX requirement in `goals.md`, mark it **delivered / partial / missing** with evidence (file:line or traced behavior). A missing or partial success criterion is a finding — severity per user impact. Without `--scope`, state the inferred intent of the change in one sentence and evaluate against that.

## Step 3 — Completeness

Trace every modified/added/deleted symbol to ALL its consumers — read the modified files in full, not just the diff hunks:

- Import statements, call sites, subclass overrides, interface implementations
- Both environments: desktop/node AND browser/web paths per AGENTS.md
- Per-operation git providers: `packages/git/src/providers/`, `packages/git-cli/src/providers/`, host integrations (`src/plus/integrations/host/providers/`)
- Protocol/type changes: webview IPC pairs, serialization, telemetry, logging
- Decorator-wrapped methods: check AGENTS.md § Decorator System — `@gate()`, `@memoize()`, `@sequentialize()` alter runtime behavior significantly
- Adjacent features not accidentally broken

If a change touches shared abstractions, **audit all consumers**. If it alters async flows, explicitly inspect **cancellation, deduplication, sequencing, and stale-state behavior**. When you can't fully trace a path, document it in "Open questions" — don't silently skip it.

## Step 4 — Validation

- Assess whether build, typecheck, lint, and relevant tests adequately validate the change. Missing or weak validation is a finding, not a neutral detail. If tests are missing, name the **specific cases** that should exist.
- Run `pnpm run build` to confirm the change compiles, type-checks, and lints cleanly; report related failures as findings.

## Output Format

### Findings (ordered by severity)

| Field              | Values                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| **classification** | goals-alignment / completeness / validation / (carried from code-review: correctness / design / performance) |
| **severity**       | critical (blocks merge) / high (should fix before merge) / medium (fix soon) / low (note for later)          |
| **confidence**     | confirmed / likely / low-confidence                                                                          |
| **location**       | file:line or exact code path(s)                                                                              |

Then: **what is wrong**, **why it matters**, **the best fix** (not just a workaround).

### Required Sections

1. **Findings** — gate findings plus code-review's confirmed findings, rolled up and ordered by severity
2. **What is good** — well-implemented aspects worth calling out
3. **Open questions** — things that need validation or that you couldn't confirm
4. **Verdict** — one of:
   - **Safe to merge**
   - **Safe with follow-ups** (list them)
   - **Should be reworked before merge** (explain why)

If no issues found, say so explicitly, then list **residual risks** and **validation gaps**.
