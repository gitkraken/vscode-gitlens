# GitLens Development Guide

This workspace contains **GitLens** - a powerful VS Code extension that supercharges Git functionality. It provides blame annotations, commit history visualization, repository exploration, and many advanced Git workflows. The codebase supports both desktop VS Code (Node.js) and VS Code for Web (browser/webworker) environments — shared code with abstractions in `src/env/`; test both during development.

## Working Style Expectations

1. **Accuracy over speed** — Do not guess at method names, decorator behaviors, or class interfaces. Verify they exist first by searching the codebase.
2. **Simplicity over abstraction** — Prefer the simplest correct solution; no new types, enums, or wrapper abstractions unless they serve multiple consumers.
3. **Fixing over disabling** — Fix the root cause. "Fix" and "disable" are different instructions. This includes tests: when one fails, find and fix the cause — do NOT simplify the test or change its intent to make it pass.
4. **Hypothesis before implementation** — When debugging, present your hypothesis with evidence before implementing against it. On any non-trivial change, state your approach before editing; if the request is ambiguous, ask rather than assume.
5. **Branch ownership** — The current branch owns ALL of its issues, not just those from your current task. An error that exists on this branch but not on the base branch is the branch's responsibility regardless of when it was introduced (verify with `git diff main --stat` or similar; issues that also exist on the base branch are truly pre-existing and can be noted, not prioritized). After completing your task, address remaining branch build/type/test failures — or if the scope is too large, ask the user how to proceed. A task is not complete until the code builds cleanly and related tests pass.

> For the rules these summarize plus the ones not listed here — complexity limits, the completeness checklist (call sites, subclass overrides, Node.js _and_ browser paths), fix vs. disable, scope of changes, and error handling: see `docs/coding-standards.md`

## Development Environment

- **Node.js** ≥ 22.12.0, **pnpm** ≥ 10.x (install via corepack: `corepack enable`), **Corepack** ≥ 0.31.0, **Git** ≥ 2.7.2

## Development Commands

```bash
pnpm install              # Install dependencies
pnpm run build            # Full development build (runs `check` itself — don't chain both)
pnpm run rebuild          # Complete rebuild from scratch
pnpm run bundle           # Production bundle
pnpm run test             # Run unit tests (VS Code extension tests)
pnpm run test:e2e         # Run Playwright E2E tests (production bundle via `bundle:e2e`)
pnpm run check            # Type-checking and lint rules
pnpm run check:fix        # Same, with auto-fix (prefer this)
pnpm run fmt              # Format code
```

Generation commands (`generate:contributions`, `generate:commandTypes`, `build:icons`, …) run automatically during build/watch — see Critical Rules.

> For test running patterns, output interpretation, and debugging: see `docs/testing.md`

## Git & Repository Guidelines

For commit message format and workflow, use `/commit`. For CHANGELOG format and entry guidelines, use `/audit-commits`. For code reviewing, use `/review` or `/deep-review`. For debugging methodology and common misdiagnosis patterns, use `/investigate`. Additional workflow skills live in `.claude/skills/`.

Skill artifacts (goals, plans, reviews, live-exercise findings) all live under a single gitignored `.work/` root in the **primary** worktree — never in the feature worktree you happen to be sitting in, since `.work/` is not shared between worktrees. See [Output Files](docs/triage-dev-skills.md#output-files) for the layout.

### Branching Guidelines

- Feature branches from `main` or from another feature branch if stacking
- Prefix with an appropriate type: `feature/`, `bug/`, `debt/`
- Use descriptive names: `feature/search-natural-language`, `bug/graph-performance`
- If there is a related issue, reference it in the branch name: `feature/#1234-search-natural-language`

## High-Level Architecture

### Directory Structure

Most of the layout is self-describing — browse `packages/`, `src/`, and `tests/`. What the folder names do _not_ tell you:

- **`packages/` (`@gitlens/*`) vs `src/`** — `packages/git` holds the git domain (models, parsers, per-operation providers) and `packages/git-cli` runs the CLI; `src/git` is the orchestration layer over them (`gitProviderService.ts`, actions, formatters). `packages/utils` is the only utility layer webviews may import; `src/system` is host-only, and `src/system/-webview/` is extension-host-specific.
- **`src/env/node/` vs `src/env/browser/`** — the same feature must work in desktop VS Code and VS Code for Web. Shared code imports through the `@env/` alias, which resolves per build target. Changing one path means checking the other.
- **`src/plus/` and `packages/plus/` are non-OSS** — licensed separately, see `LICENSE.plus`.
- **`src/container.ts`** — the service locator; nearly every service is reached through it.
- **`src/commands/git/`** — sub-commands of the git wizard, not standalone commands.
- **`src/trackers/`** — tracks document state and blame, not git refs.
- **`src/vsls/`** — VS Live Share support. **`src/uris/`** — deep-link URI handling.
- **`custom-elements.json`** — generated web component metadata; never hand-edit.

> For detailed architecture (patterns, services, environment abstraction, webviews, IPC, caching, build config): see `docs/architecture.md`

## Coding Standards & Style Rules

Not caught by any linter — get these right by hand:

- **Strict TypeScript** — no `any` usage (exceptions only for external APIs)
- **Explicit return types** for public methods; **prefer `type` over `interface`** for unions
- **No default exports**; use `import type` for type-only imports
- **No barrel files** — no `index.ts` or re-export-only modules. When splitting a file, delete the original and update consumers to import from where things actually live; do NOT leave a re-exporting shim.
- **No inline `import('./x.js').Type`** — add a top-of-file `import type { … }` and reference the type by name. Lint permits the inline form (`disallowTypeAnnotations: false`), so this one is on you: it ducks the import-order rule and hides the dependency.
- **Naming**: Classes PascalCase (no `I` prefix), methods/variables camelCase, constants camelCase (**not** SCREAMING_SNAKE_CASE), files camelCase.ts
- **Import order**: node built-ins → external → internal → relative
- **Folders**: Models under `models/`, shared utilities in `packages/utils/`, host-specific in `src/system/-webview/`, webview apps under `src/webviews/apps/`

### Custom Lint Rules

The repo enforces its own rules from `scripts/eslint-rules/`. Write conforming code up front rather than relying on `pnpm run check:fix` — these show up in diffs and reviews:

| Rule                               | Enforces                                                                                                                                                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `require-block-body`               | Block bodies for `if`/`while`/`for`/`for-in`/`for-of`. A single-line `if` is allowed ONLY when its body is control flow — `return`, `break`, `continue`, `throw`, `yield`. Loops always need braces. `else if` branches are checked independently. |
| `require-js-extension`             | An explicit `.js` extension on local (`@env/` and relative) imports                                                                                                                                                                                |
| `one-var`                          | One variable per declaration statement                                                                                                                                                                                                             |
| `newline-after-control-flow`       | A blank line after a control flow statement                                                                                                                                                                                                        |
| `no-instanceof-cancellation-error` | `isCancellationError()` instead of `instanceof CancellationError`                                                                                                                                                                                  |
| `scoped-logger-usage`              | Correct `getScopedLogger()` usage — see the decorator note below                                                                                                                                                                                   |
| `no-scss-in-css-template`          | No SCSS syntax inside `css` tagged templates                                                                                                                                                                                                       |
| `no-src-imports`                   | No import specifiers starting with `src/`                                                                                                                                                                                                          |
| `no-self-package-imports`          | Same-package imports use a relative path, not the workspace package name                                                                                                                                                                           |
| `valid-package-imports`            | `@gitlens/*` imports name a subpath the target package's `exports` exposes                                                                                                                                                                         |

> For webview styling — prefix conventions, the `1rem = 10px` base, the `--gl-*` design tokens, and the elevation (z-index + shadow) system: see `docs/webview-styling.md`
>
> For webview accessibility requirements: see `docs/accessibility.md`
>
> For webview architecture — the two communication layers (legacy IPC vs Supertalk RPC + signals), which surface uses which, state ownership, resources, persistence, and lifecycle: see `docs/webview-architecture.md`
>
> For the Commit Graph keyboard architecture — focus scopes, the Esc overlay stack, the chord vocabulary, and how to add a binding: see `docs/graph-keyboard.md`

### Decorator System

The codebase uses method decorators (defined in `packages/utils/src/decorators/`; `@command` and a `@gate` wrapper live in `src/system/`) that significantly alter runtime behavior:

| Decorator                           | Purpose                                              | Key Gotcha                                                                 |
| ----------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `@info()` / `@debug()` / `@trace()` | Logging with scope tracking                          | `getScopedLogger()` must be called BEFORE any `await` (browser limitation) |
| `@gate()`                           | Deduplicates concurrent calls (returns same promise) | 5-min timeout; most common cause of method hangs                           |
| `@memoize()`                        | Caches return value permanently on instance          | Caches rejected Promises too; use `invalidateMemoized()` to clear          |
| `@sequentialize()`                  | Queues calls to execute one at a time                | Different from `@gate()` — queues instead of deduplicating                 |
| `@debounce()`                       | Debounces method calls per-instance                  |                                                                            |
| `@command()`                        | Registers VS Code command class                      | Class decorator, not method decorator                                      |

Stacking executes bottom-up (outermost runs first). When debugging: check `@gate()` first for hangs, `@memoize()` for stale data, logging decorators last.

For detailed decorator behavior and investigation methodology, use `/investigate`.

## Quick Lookup

### Canonical Examples

When implementing something new, look at these files first:

| Task                            | Example File                                    |
| ------------------------------- | ----------------------------------------------- |
| Simple command                  | `src/commands/copyCurrentBranch.ts`             |
| Complex command (multi-command) | `src/commands/gitWizard.ts`                     |
| IPC protocol                    | `src/webviews/rebase/protocol.ts`               |
| Webview provider                | `src/webviews/rebase/rebaseWebviewProvider.ts`  |
| Webview app (Lit)               | `src/webviews/apps/rebase/`                     |
| Unit test                       | `packages/utils/src/__tests__/iterable.test.ts` |
| E2E test                        | `tests/e2e/specs/smoke.test.ts`                 |
| E2E page object                 | `tests/e2e/pageObjects/gitLensPage.ts`          |

### Critical Rules

**contributions.json** (only applies to `contributes/commands`, `contributes/menus`, `contributes/submenus`, `contributes/keybindings`, and `contributes/views`)

- Never edit these sections in `package.json` directly — edit `contributions.json` instead
- Run `pnpm run generate:contributions` after editing (or let the watcher handle it)
- Run `pnpm run generate:commandTypes` after adding commands (or let the watcher handle it)

**Webview communication** — two layers coexist: legacy IPC (`IpcCommand` / `IpcRequest` / `IpcNotification`) and Supertalk RPC + signals. Check which one your surface uses before adding a channel — see `docs/webview-architecture.md`
