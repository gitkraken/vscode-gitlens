---
name: deep-review
description: Use when reviewing a change set before merge, when tracing code paths for correctness, or when a thorough merge-blocking review is needed rather than a surface-level checklist
---

# /deep-review - Deep Skeptical Code Review

Root-cause, merge-blocking review that traces every modified code path end-to-end. Not a surface-level diff review.

**Use `/review` for checklist compliance. Use `/deep-review` for deep analysis before merge.**

## Usage

```
/deep-review [target]
```

- No argument: review staged changes (`git diff --cached`)
- `all`: all uncommitted changes
- `branch`: changes vs base branch (`git diff main...HEAD`)
- `pr`: current PR changes (`gh pr diff`)
- `commit:SHA`: specific commit

## When to Use /deep-review vs /review

| Skill          | Purpose                                    | Focus                                                                     |
| -------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| `/review`      | Standards compliance + completeness audit  | Does the code follow conventions? Were all locations updated?             |
| `/deep-review` | Correctness + regression + design analysis | Is the code _right_? Will it _break_ things? Is this the _best_ approach? |

Use both together for critical changes: `/review` catches standards violations, `/deep-review` catches logical and architectural issues.

## How to Review

Starting with the changed code, **trace every modified code path end-to-end**.

### Tracing Methodology

1. **Read all modified files** in full (not just the diff hunks — understand surrounding context)
2. **For each modified/deleted/added symbol** (function, type, class, export):
   - Search for all import statements referencing the modified file
   - Search for all call sites of modified functions
   - Search for all subclass overrides or interface implementations
3. **For decorator-wrapped methods**: check AGENTS.md's Decorator System table — `@gate()`, `@memoize()`, `@sequentialize()` alter runtime behavior significantly
4. **For environment-dependent code**: check both desktop/node and browser/web paths per AGENTS.md
5. **When you can't fully trace a path** (external dependency, unclear behavior): document it in "Open questions", don't silently skip it

### 1. Correctness and Regression Risk

- Is the behavior correct? Does it actually solve the intended problem?
- What edge cases, failure modes, race conditions, stale-state issues, or decorator-related issues could break?
- What regressions could this introduce in nearby flows, not just the directly changed code?
- **Distinguish clearly** between confirmed issues, likely risks, and low-confidence concerns.

### 2. Implementation Quality

- Is this the simplest correct implementation?
- Is this implemented in the best practical way for this codebase, or should it be rethought even if that causes follow-on changes elsewhere?
- Call out unnecessary complexity, weak abstractions, hidden coupling, or places where the implementation does not match existing architectural patterns.

### 3. Performance

- Is the change efficient in both common and worst-case paths?
- Look for: unnecessary recomputation, duplicate async work, excessive object allocation, missed caching opportunities, incorrect memoization, blocking operations, excessive async serialization, over-refreshing UI/webviews, avoidable Git/API calls.
- Note whether the performance characteristics are acceptable even if not ideal.

### 4. Completeness

- Did the author update all affected locations?
- Look for: missed call sites, subclass/provider overrides, environment-specific implementations, protocol/types changes, tests, telemetry, logging, user-visible behavior.
- Verify adjacent features were not accidentally broken.

### 5. Validation

- Assess whether build, typecheck, lint, and relevant tests adequately validate the change.
- Treat missing or weak validation as a review concern, not a neutral detail.
- If tests are missing, name the **specific cases** that should exist.

## Review Rules

- If a change touches shared abstractions, **audit all consumers**.
- If a change alters async flows, explicitly inspect **cancellation, deduplication, sequencing, and stale-state behavior**.
- If you are not confident, **say so explicitly** rather than inferring.
- Assume the author may have fixed the symptom but not the root cause.
- Do not treat missing tests or missing validation as neutral.

## Output Format

### Findings (ordered by severity)

For each finding include:

| Field              | Values                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| **classification** | correctness / regression risk / design / performance / completeness / validation                    |
| **severity**       | critical (blocks merge) / high (should fix before merge) / medium (fix soon) / low (note for later) |
| **confidence**     | confirmed / likely / low-confidence                                                                 |
| **location**       | file:line or exact code path(s)                                                                     |

Then: **what is wrong**, **why it matters**, **the best fix** (not just a workaround).

### Example Finding

> **classification**: correctness | **severity**: high | **confidence**: likely
> **location**: `src/git/cache.ts:45` → `GitProviderService.getRepository()`
>
> **Issue**: `getOrCreateCache()` returns a stale cache reference after repository disposal. The `@memoize()` decorator caches the first result permanently, but the cache is invalidated on `dispose()` without clearing the memoized value.
>
> **Impact**: Subsequent calls after repo close/reopen return the disposed cache, causing silent data staleness.
>
> **Fix**: Call `invalidateMemoized(this, 'getOrCreateCache')` in the `dispose()` method, or switch from `@memoize()` to a manual lazy pattern that respects disposal.

### Required Sections

1. **Findings** — ordered by severity, using the format above
2. **What is good** — well-implemented aspects worth calling out
3. **Open questions** — things that need validation or that you couldn't confirm
4. **Verdict** — one of:
   - **Safe to merge**
   - **Safe with follow-ups** (list them)
   - **Should be reworked before merge** (explain why)

If no issues found, say so explicitly, then list **residual risks** and **validation gaps**.

## Verification

Run these after the review to confirm the change compiles, type-checks, and lints cleanly. Report failures as findings if they relate to the reviewed changes.

```bash
pnpm run build
```
