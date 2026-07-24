# GitLens Development Guide

This workspace contains **GitLens** - a powerful VS Code extension that supercharges Git functionality. It provides blame annotations, commit history visualization, repository exploration, and many advanced Git workflows. The codebase supports both desktop VS Code (Node.js) and VS Code for Web (browser/webworker) environments — shared code with abstractions in `src/env/`; test both during development.

## Working Style Expectations

1. **Accuracy over speed** — Read the actual code before proposing changes. Do not guess at method names, decorator behaviors, or class interfaces. Verify they exist first by searching the codebase.
2. **Simplicity over abstraction** — Prefer the simplest correct solution; no new types, enums, or wrapper abstractions unless they serve multiple consumers.
3. **Completeness over iteration** — Audit ALL affected locations (call sites, subclass overrides, both Node.js and browser code paths) before presenting a change as complete.
4. **Fixing over disabling** — Fix the root cause. "Fix" and "disable" are different instructions.
5. **Confirming over assuming** — When debugging, present your hypothesis with evidence before implementing. If a request is ambiguous, ask for clarification. Do not silently start editing on non-trivial changes without stating your approach.
6. **Purposeful changes** — Refactoring for clarity and codebase health is encouraged; explain what and why. No silent drive-by changes unrelated to the task.
7. **Branch ownership** — The current branch owns ALL of its issues, not just those from your current task. An error that exists on this branch but not on the base branch is the branch's responsibility regardless of when it was introduced (verify with `git diff main --stat` or similar; issues that also exist on the base branch are truly pre-existing and can be noted, not prioritized). After completing your task, address remaining branch build/type/test failures — or if the scope is too large, ask the user how to proceed. A task is not complete until the code builds cleanly and related tests pass.

> For the detailed rules behind #2/#3/#4/#6 (complexity, completeness checklist, fix vs. disable, scope of changes): see `docs/coding-standards.md`

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

### Branching Guidelines

- Feature branches from `main` or from another feature branch if stacking
- Prefix with an appropriate type: `feature/`, `bug/`, `debt/`
- Use descriptive names: `feature/search-natural-language`, `bug/graph-performance`
- If there is a related issue, reference it in the branch name: `feature/#1234-search-natural-language`

## High-Level Architecture

### Directory Structure

```
packages/                     # Shared workspace packages (@gitlens/*)
├── core/                     # Core primitives shared across packages
├── git/                      # Git domain: models, parsers, per-operation providers (branches, commits, ...)
├── git-cli/                  # Git CLI execution (exec/) and CLI output parsers
├── ipc/                      # IPC primitives
├── plus/                     # Pro packages: ai/, agents/, integrations/, git-github/
└── utils/                    # Shared utilities & decorators (usable in host and webviews)
src/
├── extension.ts              # Extension entry point, activation logic
├── container.ts              # Service Locator - manages all services (singleton)
├── agents/                   # AI agent service & providers
├── annotations/              # Editor decoration providers
├── api/                      # Public extension API
├── autolinks/                # Auto-linking issues/PRs in commit messages & branch names
├── codelens/                 # Editor CodeLens providers
├── commands/                 # 100+ command implementations (git/ = git-wizard sub-commands)
├── env/                      # Environment-specific implementations (node/ desktop, browser/ web)
├── featureFlags/             # Feature flag service
├── git/                      # Git orchestration layer (gitProviderService.ts, actions, formatters)
├── hovers/                   # Editor hover providers
├── onboarding/               # Onboarding, walkthrough state, usage tracking
├── plus/                     # Pro features (non-OSS, see LICENSE.plus): ai/, gk/, integrations/, launchpad/, ...
├── quickpicks/               # Quick pick/input (quick menus) implementations
├── statusbar/                # Status bar item management
├── system/                   # Host utilities; -webview/ = extension-host-specific
├── telemetry/                # Usage analytics and error reporting
├── terminal/                 # Terminal integration providers
├── trackers/                 # Tracks document state and blames
├── treemap/                  # Treemap visualization service
├── uris/                     # Deep link uri handling
├── views/                    # Tree view providers (sidebar views)
├── virtual/                  # Virtual file system & content providers
├── vsls/                     # Live Share support
└── webviews/                 # Webview controllers + IPC (protocol.ts, webviewsController.ts)
    └── apps/                 # Webview UI apps (Lit): shared/, rebase/, settings/, plus/{graph,home,timeline,...}
tests/                        # E2E and Unit tests
walkthroughs/                 # Welcome and tips walkthroughs
custom-elements.json          # Custom Elements Manifest - generated web component metadata
```

> For detailed architecture (patterns, services, environment abstraction, webviews, IPC, caching, build config): see `docs/architecture.md`

## Coding Standards & Style Rules

- **Strict TypeScript** — no `any` usage (exceptions only for external APIs)
- **Explicit return types** for public methods; **prefer `type` over `interface`** for unions
- **Use path aliases**: `@env/` for environment-specific code
- **Import order**: node built-ins → external → internal → relative
- **No default exports** use `import type` for type-only imports
- **Always use `.js` extension** in imports (ESM requirement)
- **Naming**: Classes PascalCase (no `I` prefix), methods/variables camelCase, constants camelCase (not SCREAMING_SNAKE_CASE), files camelCase.ts
- **Folders**: Models under `models/`, shared utilities in `packages/utils/`, host-specific in `src/system/-webview/`, webview apps under `src/webviews/apps/`

> For error handling patterns, implementation quality rules, and completeness checklist: see `docs/coding-standards.md`
>
> For webview styling — prefix conventions, the `1rem = 10px` base, the `--gl-*` design tokens, and the elevation (z-index + shadow) system: see `docs/webview-styling.md`
>
> For webview accessibility requirements: see `docs/accessibility.md`

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

**IPC** — see `docs/architecture.md` for the webview IPC protocol (`IpcCommand` / `IpcRequest` / `IpcNotification`)

**Testing**

- When debugging test failures, DON'T simplify NOR change the intent of the tests just to get them to pass. Instead, INVESTIGATE and UNDERSTAND the root cause of the failure and address that directly, or raise an issue to the user if you can't resolve it.
