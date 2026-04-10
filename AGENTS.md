# GitLens Development Guide

This workspace contains **GitLens** - a powerful VS Code extension that supercharges Git functionality. It provides blame annotations, commit history visualization, repository exploration, and many advanced Git workflows. The codebase supports both desktop VS Code (Node.js) and VS Code for Web (browser/webworker) environments.

## Working Style Expectations

1. **Accuracy over speed** — Read the actual code before proposing changes. Do not guess at method names, decorator behaviors, or class interfaces. Verify they exist first by searching the codebase.
2. **Simplicity over abstraction** — Prefer the simplest correct solution. Do not introduce new types, enums, marker interfaces, migration flags, or wrapper abstractions unless they serve multiple consumers. When the user simplifies your approach, adopt it immediately.
3. **Completeness over iteration** — Before presenting a multi-file change as complete, audit ALL affected locations: call sites, subclass overrides, both Node.js and browser code paths, and sub-providers.
4. **Fixing over disabling** — When asked to fix a feature, fix the root cause. Do not disable, remove, or work around it unless explicitly asked. "Fix" and "disable" are different instructions.
5. **Confirming over assuming** — When debugging, present your hypothesis with evidence before implementing. If a request is ambiguous, ask for clarification. Do not silently start editing on non-trivial changes without stating your approach.
6. **Purposeful changes** — Refactoring and renaming to improve clarity, maintainability, and codebase health are encouraged. Explain what you're changing and why. Do not make silent drive-by changes unrelated to the task at hand.
7. **Branch ownership** — The current branch owns ALL of its issues, not just those from your current task. Do not dismiss build errors, type errors, or test failures as "pre-existing" without verifying against the base branch (`git diff main --stat` or similar). If an issue exists on this branch but not on the base branch, it is the branch's responsibility regardless of when it was introduced. After completing your current task, address any remaining branch issues. If the scope of remaining issues is too large to handle, ask the user how to proceed.

## Issue Accountability During Work

### Branch vs. Repository Issues

- **Branch issues**: Errors that exist on the current branch but NOT on the base branch. These are the branch's responsibility regardless of which task or session introduced them.
- **Repository issues**: Errors that also exist on the base branch. These are truly pre-existing and can be noted but not prioritized.
- **When in doubt**: Run `git stash && pnpm run build && git stash pop` or `git diff main --name-only` to verify. Do NOT assume an issue is pre-existing — verify it.

### Workflow

1. **Focus first** — Complete your current task
2. **Then fix** — After your task is done, address any remaining build errors, type errors, or test failures on the branch
3. **Ask if too large** — If the remaining issues are extensive or unclear, inform the user and ask how to proceed rather than ignoring them

### Completion Criteria

A task is not complete until:

- The code compiles cleanly (`pnpm run build` or relevant build command succeeds)
- Related tests pass
- Any remaining branch issues have been either fixed or raised to the user

## Development Environment

- **Node.js** ≥ 22.12.0, **pnpm** ≥ 10.x (install via corepack: `corepack enable`), **Corepack** ≥ 0.31.0, **Git** ≥ 2.7.2
- GitLens supports **Node.js** (desktop) and **Web Worker** (browser/vscode.dev) environments — shared code with abstractions in `src/env/`
- Test both environments during development

### Performance Considerations

- Use lazy loading for heavy services
- Leverage caching layers (GitCache, PromiseCache, @memoize)
- Debounce expensive operations
- Consider webview refresh performance
- Monitor telemetry for performance regressions

## Development Commands

```bash
pnpm install              # Install dependencies
```

### Build & Development

```bash
pnpm run rebuild          # Complete rebuild from scratch
pnpm run build            # Full development build (everything including e2e and unit tests)
pnpm run build:quick      # Fast build (no linting)
pnpm run build:extension  # Build only the extension (no webviews)
pnpm run build:webviews   # Build only webviews
pnpm run bundle           # Production bundle
pnpm run bundle:e2e       # E2E tests production bundle (with DEBUG for account simulation)
```

### Watch Mode

```bash
pnpm run watch            # Watch mode for development (everything including e2e and unit tests)
pnpm run watch:quick      # Fast watch mode (no linting)
pnpm run watch:extension  # Watch extension only
pnpm run watch:tests      # Watch unit tests only
pnpm run watch:webviews   # Watch webviews only
```

### Testing

```bash
pnpm run test             # Run unit tests (VS Code extension tests)
pnpm run test:e2e         # Run Playwright E2E tests
```

> For detailed test running patterns, output interpretation, and debugging: see `docs/testing.md`

### Quality

```bash
pnpm run lint             # Run ESLint with TypeScript rules
pnpm run lint:fix         # Auto-fix linting issues
pnpm run pretty           # Format code with Prettier
pnpm run pretty:check     # Check formatting
```

### Specialized Commands (typically not needed during normal development as they are part of build/watch)

```bash
pnpm run generate:contributions  # Generate package.json contributions from contributions.json
pnpm run extract:contributions   # Extract contributions from package.json to contributions.json
pnpm run generate:commandTypes   # Generate command types from contributions
pnpm run build:icons             # Build icon font from SVG sources
```

## Git & Repository Guidelines

For commit message format and workflow, use `/commit`. For CHANGELOG format and entry guidelines, use `/audit-commits`. For code reviewing, use `/review` or `/deep-review`. For debugging methodology and common misdiagnosis patterns, use `/investigate`.

### Branching Guidelines

- Feature branches from `main` or from another feature branch if stacking
- Prefix with an appropriate type: `feature/`, `bug/`, `debt/`
- Use descriptive names: `feature/search-natural-language`, `bug/graph-performance`
- If there is a related issue, reference it in the branch name: `feature/#1234-search-natural-language`

## High-Level Architecture

### Directory Structure

```
src/
├── extension.ts              # Extension entry point, activation logic
├── container.ts              # Service Locator - manages all services (singleton)
├── @types/                   # TypeScript type definitions
├── annotations/              # Editor decoration providers
├── autolinks/                # Auto-linking issues/PRs in commit messages & branch names
├── codelens/                 # Editor CodeLens providers
├── commands/                 # 100+ command implementations
│   ├── git/                  # Git-wizard sub-commands
│   └── *.ts                  # Individual command files
├── env/                             # Environment-specific implementations
│   ├── node/                        # Node.js (desktop) implementations
│   │   └── git/
│   │       ├── git.ts               # Git command execution
│   │       ├── localGitProvider.ts  # Local Git provider (child_process)
│   │       ├── vslsGitProvider.ts   # Local Live Share Git provider
│   │       └── sub-providers/       # Local sub-providers for specific Git operations
│   │           ├── branches.ts
│   │           ├── commits.ts
│   │           └── ... (15 total)
│   └── browser/              # Browser/webworker implementations
├── git/                      # Git abstraction layer
│   ├── gitProvider.ts        # Git provider interface
│   ├── gitProviderService.ts # Manages multiple Git providers
│   ├── models/               # Git model types (Branch, Commit, etc.)
│   ├── parsers/              # Output parsers for Git command results
│   ├── remotes/              # Remote provider and integration management
│   └── sub-providers/        # Shared sub-providers for specific Git operations
├── hovers/                   # Editor hover providers
├── plus/                     # Pro features (non-OSS, see LICENSE.plus)
│   ├── ai/                   # AI features (commit messages, explanations, changelogs)
│   ├── gk/                   # GitKraken-specific features (account, subscription, etc.)
│   └── integrations/         # Rich Git host & issue tracker integrations (GitHub, GitLab, Jira, etc.)
│       └── providers/
│           └── github/
│               ├── githubGitProvider.ts
│               └── sub-providers/  # 11 GitHub-specific sub-providers
├── quickpicks/               # Quick pick/input (quick menus) implementations
├── statusbar/                # Status bar item management
├── system/                   # Utility libraries
│   ├── utils/                # Utilities usable in both host and webviews
│   └── utils/-webview/       # Extension host-specific utilities
├── telemetry/                # Usage analytics and error reporting
├── terminal/                 # Terminal integration providers
├── trackers/                 # Tracks document state and blames
├── uris/                     # Deep link uri handling
├── views/                    # Tree view providers (sidebar views)
│   ├── commitsView.ts
│   ├── branchesView.ts
│   └── ...
├── vsls/                     # Live Share support
└── webviews/                 # Webview implementations
    ├── apps/                 # Webview UI apps (Lit only)
    │   ├── shared/           # Common UI components using Lit
    │   ├── commitDetails/
    │   ├── rebase/
    │   ├── settings/
    │   └── plus/             # Pro webview apps
    │       ├── home/
    │       ├── graph/
    │       ├── timeline/
    │       ├── patchDetails/
    │       └── composer/
    ├── protocol.ts           # IPC protocol for webview communication
    └── webviewController.ts  # Base controller for all webviews
tests/                        # E2E and Unit tests
walkthroughs/                 # Welcome and tips walkthroughs
```

> For detailed architecture (patterns, services, environment abstraction, webviews, build config): see `docs/architecture.md`

## Coding Standards & Style Rules

- **Strict TypeScript** with `strictTypeChecked` ESLint config — no `any` usage (exceptions only for external APIs)
- **Explicit return types** for public methods; **prefer `type` over `interface`** for unions
- **Use path aliases**: `@env/` for environment-specific code
- **Import order**: node built-ins → external → internal → relative
- **No default exports** (ESLint enforced); use `import type` for type-only imports
- **Always use `.js` extension** in imports (ESM requirement)
- **Naming**: Classes PascalCase (no `I` prefix), methods/variables camelCase, constants camelCase (not SCREAMING_SNAKE_CASE), files camelCase.ts
- **Folders**: Models under `models/`, utilities under `utils/` (both host + webview), host-specific in `utils/-webview/`, webview apps under `webviews/apps/`

> For error handling patterns, implementation quality rules, and completeness checklist: see `docs/coding-standards.md`
>
> For webview accessibility requirements: see `docs/accessibility.md`

### Decorator System

The codebase uses method decorators (`src/system/decorators/`) that significantly alter runtime behavior:

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

Reference examples and critical rules for common tasks.

### Available Skills

Skills provide detailed, step-by-step workflows for common tasks. Invoke with `/{skill-name}`.

| Skill              | Purpose                                                    |
| ------------------ | ---------------------------------------------------------- |
| `/investigate`     | Structured bug investigation with root cause analysis      |
| `/analyze`         | Deep design/implementation analysis, devil's advocate      |
| `/review`          | Code review against standards + impact completeness audit  |
| `/commit`          | Git commit with GitLens conventions                        |
| `/create-issue`    | Create GitHub issues from code changes                     |
| `/audit-commits`   | Audit commit range for issues and CHANGELOG entries        |
| `/add-command`     | Scaffold a new VS Code command                             |
| `/add-webview`     | Scaffold a new webview with IPC, Lit app, registration     |
| `/add-test`        | Generate unit or E2E test files                            |
| `/add-icon`        | Add icon to GL Icons font                                  |
| `/add-ai-provider` | Add a new AI provider integration                          |
| `/inspect-live`    | Launch VS Code with GitLens via Playwright inspect UI/logs |

### Canonical Examples

When implementing something new, look at these files first:

| Task                            | Example File                                   |
| ------------------------------- | ---------------------------------------------- |
| Simple command                  | `src/commands/copyCurrentBranch.ts`            |
| Complex command (multi-command) | `src/commands/gitWizard.ts`                    |
| IPC protocol                    | `src/webviews/rebase/protocol.ts`              |
| Webview provider                | `src/webviews/rebase/rebaseWebviewProvider.ts` |
| Webview app (Lit)               | `src/webviews/apps/rebase/`                    |
| Unit test                       | `src/system/__tests__/iterable.test.ts`        |
| E2E test                        | `tests/e2e/specs/smoke.test.ts`                |
| E2E page object                 | `tests/e2e/pageObjects/gitLensPage.ts`         |

### Critical Rules

**contributions.json** (only applies to `contributes/commands`, `contributes/menus`, `contributes/submenus`, `contributes/keybindings`, and `contributes/views`)

- Never edit these sections in `package.json` directly — edit `contributions.json` instead
- Run `pnpm run generate:contributions` after editing (or let the watcher handle it)
- Run `pnpm run generate:commandTypes` after adding commands (or let the watcher handle it)

**Localization (`package.nls.json`)**

All user-facing strings in `package.json` `contributes` use `%key%` references resolved from `package.nls.json` (English). The localization approach differs depending on what you're editing:

- **Commands, submenus, views** (managed by `contributions.json`):
  - Use **literal English strings** in `contributions.json` (e.g., `"label": "Add Co-authors..."`)
  - Do NOT use `%key%` references in `contributions.json` — the generation script handles the conversion automatically
  - The script writes `%key%` references to `package.json` and English values to `package.nls.json`
- **Configuration, colors, walkthroughs, viewsContainers, customEditors** (directly in `package.json`):
  - Use `%key%` references in `package.json` (e.g., `"markdownDescription": "%config.myFeature.markdownDescription%"`)
  - Add the English text to `package.nls.json` with the matching key
- **Adding a new language**: Copy `package.nls.json` to `package.nls.<locale>.json` and translate the values. No other files need changes.

**Imports**

- Always use `.js` extension in imports (ESM requirement)
- Use named exports only (no `default` exports)

**IPC**

- `IpcCommand` = fire-and-forget (no response)
- `IpcRequest` = expects a response (use `await`)
- `IpcNotification` = extension → webview state updates

**Testing**

- When debugging test failures, DON'T simplify NOR change the intent of the tests just to get them to pass. Instead, INVESTIGATE and UNDERSTAND the root cause of the failure and address that directly, or raise an issue to the user if you can't resolve it.
