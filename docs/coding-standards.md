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

- `src/errors.ts` — General extension errors (Access, Account, Provider, Request); re-exports the shared Auth and Request client errors from `packages/git/src/errors.ts`
- `packages/git/src/errors.ts` — 20+ Git operation errors (Push, Pull, Merge, Branch, Checkout, Stash, Worktree, etc.)
- `packages/utils/src/env/node/exec.ts` — Shell execution errors (RunError)
- `packages/utils/src/cancellation.ts` — `CancellationError` and `isCancellationError()`

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

**`CancellationError`**: Special case — carries a symbol brand instead of relying on `instanceof`, so it is recognized across bundles. Used by `@gate()` timeout, user cancellation, and operation abort. Check with `isCancellationError(ex)`.

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
- [ ] New user-facing strings go through `l10n.t()` and the catalog is regenerated
- [ ] No existing behavior broken (especially adjacent features)
- [ ] Edge cases considered: empty/null/undefined inputs, concurrent calls, error states

### Localization

GitLens follows VS Code's display language. Every string a user can read is a translatable message, so:

- Wrap it in `l10n.t()` at the point where it is defined, as one complete sentence with `{0}`/`{name}` placeholders for data. Do not assemble text from fragments, pluralize with an English suffix, or translate a computed label at the consumer.
- Keep Git syntax, refs, paths, SHAs, command ids, settings keys and product names as placeholders or outside the message.
- Show errors through `getPresentableErrorMessage(ex)`; `GitCommandError.message` is deliberately English for logs and telemetry.
- In Lit, interpolate translated text as a value; for rich content use `localizedContent` with placeholders holding the templates. Never render a translation through `unsafeHTML`.
- Regenerate the catalog (`pnpm run generate:l10n`) after any message change; `pnpm run check:l10n` guards it in CI.

See `docs/localization.md` for the authoring rules and `l10n/README.md` for translating.

### Comments

A comment is a claim nothing checks. It outlives the code it describes, and a reader — an agent especially — takes it as fact instead of reading the code, then builds on the wrong assumption. So the default is no comment.

**Reading.** Never learn what code does from its comments. Read the code; treat a comment as an unverified hint, and verify it before relying on it or repeating it in a spec, plan or review. Prose in `docs/` is a claim too.

**Sort a comment by what it is about, not by whether it is true:**

- **This repo's code** — what it does, how it works, who calls it, why it changed. Never write it, and delete it when you touch it. If true it is redundant; if false it is harmful.
- **What not to do here, the world outside the repo, or work not done** — allowed, under one of the four tags below.

**Writing.** Every comment you add carries a tag and is short: one line, two at most, saying only what the reader must not miss. No preamble, no backstory, no full sentences where a phrase does. An owner or issue may follow the tag, as existing ones do: `TODO@name`, `TODO(#123):`.

| Tag     | Says                                                                                   | Rules                                                                                                                                                                                                                                                |
| ------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HACK:` | Don't copy this — a workaround or known-bad pattern                                    | Name what it works around.                                                                                                                                                                                                                           |
| `KEEP:` | Don't simplify or "clean up" this                                                      | State the constraint to preserve at this spot (`// KEEP: must not trigger a second RPC here`), never how other code behaves. First try to enforce it with a test, a type, an assertion or a lint rule; comment only when none of those can carry it. |
| `SEE:`  | A fact about git, VS Code, a browser, an OS or a provider API that the repo can't show | Carry the source: a link, or the command and version that showed it. Never write one from memory.                                                                                                                                                    |
| `TODO:` | A gap this change leaves open                                                          | Say what is missing and why it isn't done now, with the issue link if one exists. Never use it to defer work the task covers, unless the user said to leave that work out for now. Name every `TODO:` you add in your summary.                       |

Everything else goes elsewhere. What the code does belongs in names and structure — rename or extract instead of explaining. Why a change was made belongs in the commit message. A comment you delete is not moved into `docs/`.

Never write: a restatement of the code, a description of a symbol whose name and signature already say it, section dividers, the history of a change ("previously", "used to", "no longer"), review or task references, or `file.ts:123` pointers.

A hook (`.claude/hooks/comment-guard.mjs`) reports an added comment that has no tag or runs past two lines, right after the edit. It can't judge whether a tagged comment deserves its tag — that stays with you and `/review`.

**Removing.** In the functions and blocks you edit, delete every comment about this repo's code — including ones you didn't write — and call the removal out in your summary. Keep it to the code you are changing; don't sweep the rest of the file or the repo. An existing warning or outside fact stays: add its tag and tighten it, and delete it only when it is shown false or the code it guards is gone. A `TODO:` is either done or left; delete it only when the work is done or its code is gone. When you change behavior, grep for comments that assert the old behavior and delete them.

**Not covered — these are read by tools, leave them working:**

- Lint and compiler directives (`oxlint-disable`, `@ts-expect-error`, `stylelint-disable`, `/// <reference>`). A disable carries its reason.
- Bundler annotations (`/* webpackChunkName */`, `/* @__PURE__ */`)
- Doc tags that feed generated output or the type checker: the custom-elements tags (`@tag`, `@fires`, `@slot`, `@cssprop`, `@csspart`) with their descriptions, which `cem analyze` writes into `custom-elements.json`, `@deprecated`, `@internal`, and JSDoc types in `.js`/`.mjs` files
- Doc comments on the exported API of the published `@gitkraken/*` packages — consumers outside this repo can't read the source. State the contract, not the implementation.
- License headers
- The `comment` field of an `l10n.t()` message, which is a note to translators

### Fix vs. Disable

- "Fix" means make the feature work correctly — do NOT disable or remove it
- "Fix" means address the root cause — do NOT add a workaround that hides symptoms
- If the correct fix is complex, explain the complexity and propose options — do NOT silently simplify by removing functionality
