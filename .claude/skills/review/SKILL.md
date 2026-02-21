---
name: review
description: Code review against GitLens standards with optional impact completeness audit
---

# /review - Code Review & Impact Audit

Review code changes against GitLens coding standards and verify change completeness.

## Usage

```
/review [target]
```

- No argument: review staged changes (`git diff --cached`)
- `all`: all uncommitted changes
- `file:path`: specific file
- `pr`: current PR changes (`gh pr diff`)
- `impact`: impact completeness audit only (skip code review checklist)
- `full`: both code review + impact audit

## Part 1: Code Review Checklist

### TypeScript & Imports

- [ ] No `any` usage (exceptions only for external APIs)
- [ ] Explicit return types for public methods
- [ ] `.js` extension in all imports (ESM requirement)
- [ ] Import order: node built-ins → external → internal → relative
- [ ] `import type` for type-only imports
- [ ] No default exports
- [ ] Path aliases (`@env/`) for environment-specific code

### Naming

- [ ] Classes: PascalCase (no `I` prefix)
- [ ] Methods/Variables: camelCase
- [ ] Constants: camelCase (not SCREAMING_SNAKE_CASE)
- [ ] Files: camelCase.ts
- [ ] Private members: leading underscore allowed

### Error Handling

- [ ] Git errors use `ErrorClass.is(ex, 'reason')` pattern — not `instanceof` + `.message.includes()`
- [ ] Errors logged with context via `Logger.error()`
- [ ] No suppressed/ignored errors
- [ ] Graceful degradation for network/API failures

### Performance

- [ ] Appropriate caching (`@memoize()`, GitCache, PromiseCache)
- [ ] Debounce expensive operations
- [ ] Lazy loading for heavy services

### Webview (if applicable)

- [ ] Lit Elements for reactive UI
- [ ] VS Code theming via CSS custom properties (`--vscode-*`)
- [ ] Keyboard navigation and ARIA attributes
- [ ] `disconnectedCallback()` cleanup for listeners

### Scope & Simplicity

- [ ] No unnecessary new types/abstractions for single-use scenarios
- [ ] Changes scoped to the request — no unrelated drive-by changes
- [ ] Fix addresses root cause (feature not disabled instead of fixed)

### Telemetry & Security

- [ ] Appropriate telemetry events for user actions
- [ ] No sensitive data in logs/telemetry
- [ ] No command injection, XSS, or hardcoded secrets

### Documentation & Skills

- [ ] Check if changes affect patterns documented in `AGENTS.md` — update if so
- [ ] Check if any skills in `.claude/skills/` reference changed APIs, patterns, or file paths — update if so
- [ ] CHANGELOG entry needed for user-facing changes

## Part 2: Impact Completeness Audit

Run automatically for changes spanning 3+ files, or when `impact` / `full` is specified.

### 1. Identify Changed Symbols

From the diff, extract:

- Modified function signatures and type definitions
- Renamed or removed exports
- Changed error handling or decorator usage

### 2. Find All Consumers

For each modified symbol:

- Search all import statements referencing the modified file
- Search all call sites of modified functions
- Search all implementations/overrides in subclasses
- Check sub-providers:
  - `src/env/node/git/sub-providers/` (15 sub-providers)
  - `src/plus/integrations/providers/github/sub-providers/` (11 sub-providers)
  - `src/git/sub-providers/` (shared)

### 3. Platform Coverage

- [ ] Node.js code path (`src/env/node/`)
- [ ] Browser code path (`src/env/browser/`)
- [ ] Shared code (`src/git/`, `src/system/`)

### 4. Error & UI Impact

- [ ] New error cases handled at all catch sites
- [ ] Error types use `.is()` pattern correctly
- [ ] Webview IPC protocol changes reflected in both host and app
- [ ] Command changes reflected in `contributions.json`

## Instructions

### Code Review Flow

1. Get diff based on target
2. Read full files for context around each change
3. Analyze against Part 1 checklist
4. Categorize: **Critical** (must fix), **Warnings** (should fix), **Suggestions** (nice to have)
5. Include positive feedback for good patterns

### Impact Audit Flow

1. Extract changed symbols from diff
2. Find all consumers of each symbol
3. Check platform and UI coverage
4. Report results:

```markdown
### Consumers Checked

| Modified Symbol | Call Sites | All Updated?                    |
| --------------- | ---------- | ------------------------------- |
| functionA()     | 12         | Yes                             |
| TypeB           | 8          | 7/8 — MISSING: src/views/xyz.ts |

### Verdict

[COMPLETE / INCOMPLETE with remaining work]
```

### Verification

```bash
pnpm exec tsc --noEmit    # Type-check
pnpm run lint              # Lint check
```
