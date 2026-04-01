# GitLens Coding Standards Reference

Detailed coding standards for the GitLens codebase. For TypeScript configuration, import organization, and naming conventions, see `AGENTS.md`.

## Code Structure Principles

- **Single responsibility** - Each service has focused purpose
- **Dependency injection** - Services injected via Container
- **Event-driven** - EventEmitter pattern for service communication
- **Disposable pattern** - Proper cleanup with VS Code Disposable interface
- **Immutability** - Prefer immutable operations where possible

## Error Handling

The codebase uses a discriminated error type pattern with static `.is()` type guards.

**Error files:**

- `src/errors.ts` — General extension errors (Auth, Cancellation, Provider, Request)
- `src/git/errors.ts` — 20+ Git operation errors (Push, Pull, Merge, Branch, Checkout, Stash, Worktree, etc.)
- `src/env/node/git/shell.errors.ts` — Shell execution errors (RunError)

**Static `.is()` type guard pattern:**
Every custom error class has a static `is()` method with optional reason filtering:

```typescript
// Check if error is a PushError of any kind
if (PushError.is(ex)) { ... }

// Check if error is specifically a PushError with 'noUpstream' reason
if (PushError.is(ex, 'noUpstream')) { ... }
```

This is the PREFERRED pattern. Do NOT use:

- `instanceof` alone (misses reason discrimination)
- `ex.message.includes(...)` (fragile, breaks on message changes)
- `ex.constructor.name` (breaks with minification)

**Error wrapping pattern:**
Errors commonly wrap an `original` error and carry typed `details` with a `reason` discriminator:

```typescript
throw new PushError({ reason: 'rejected', branch: 'main', remote: 'origin' }, originalGitError);
```

**`CancellationError`**: Special case — extends VS Code's `CancellationError`. Used by `@gate()` timeout, user cancellation, and operation abort. Check with `isCancellationError(ex)`.

**General rules:**

- Log errors with context using `Logger.error()`
- Graceful degradation for network/API failures
- Do NOT suppress or ignore errors — fix the root cause or propagate them properly

## Implementation Quality Rules

### Minimize Complexity

- Prefer the SIMPLEST solution that correctly solves the problem
- Do NOT introduce new types, enums, or abstractions unless they serve multiple consumers
- Do NOT add migration flags, compatibility layers, or marker types for single-use scenarios
- If a solution requires more than 2-3 new types/interfaces, reconsider the approach

### Scope of Changes

- Refactoring and renaming to improve clarity, maintainability, and codebase health are welcome — just explain what and why
- Do NOT make silent, unrelated drive-by changes alongside a bug fix or feature
- If you notice something nearby that could be improved, go ahead — but call it out so the user knows

### Completeness Checklist

Before considering a multi-file change complete:

- [ ] All call sites of modified functions reviewed
- [ ] All subclass overrides of modified methods updated
- [ ] Both Node.js (`src/env/node/`) and browser (`src/env/browser/`) code paths work
- [ ] Error handling covers the new code path
- [ ] No existing behavior broken (especially adjacent features)
- [ ] Edge cases considered: empty/null/undefined inputs, concurrent calls, error states

### Fix vs. Disable

- "Fix" means make the feature work correctly — do NOT disable or remove it
- "Fix" means address the root cause — do NOT add a workaround that hides symptoms
- If the correct fix is complex, explain the complexity and propose options — do NOT silently simplify by removing functionality
