# GitLens Development Guide

This workspace contains **GitLens** - a powerful VS Code extension that supercharges Git functionality. It provides blame annotations, commit history visualization, repository exploration, and many advanced Git workflows. The codebase supports both desktop VS Code (Node.js) and VS Code for Web (browser/webworker) environments.

## Working Style Expectations

1. **Accuracy over speed** — Read the actual code before proposing changes. Do not guess at method names, decorator behaviors, or class interfaces. Verify they exist first by searching the codebase.
2. **Simplicity over abstraction** — Prefer the simplest correct solution. Do not introduce new types, enums, marker interfaces, migration flags, or wrapper abstractions unless they serve multiple consumers. When the user simplifies your approach, adopt it immediately.
3. **Completeness over iteration** — Before presenting a multi-file change as complete, audit ALL affected locations: call sites, subclass overrides, both Node.js and browser code paths, and sub-providers.
4. **Fixing over disabling** — When asked to fix a feature, fix the root cause. Do not disable, remove, or work around it unless explicitly asked. "Fix" and "disable" are different instructions.
5. **Confirming over assuming** — When debugging, present your hypothesis with evidence before implementing. If a request is ambiguous, ask for clarification. Do not silently start editing on non-trivial changes without stating your approach.
6. **Purposeful changes** — Refactoring and renaming to improve clarity, maintainability, and codebase health are encouraged. Explain what you're changing and why. Do not make silent drive-by changes unrelated to the task at hand.

## Development Environment

### Prerequisites

- **Node.js** ≥ 22.12.0
- **pnpm** ≥ 10.x (install via corepack: `corepack enable`)
- **Corepack** ≥ 0.31.0 (check with `corepack -v`)
- **Git** ≥ 2.7.2

### VS Code Setup

- Install recommended extensions (see `.vscode/extensions.json`)
- Use provided launch configurations:
  - **"Watch & Run"** - Debug desktop extension
  - **"Watch & Run (web)"** - Debug browser extension
- Use VS Code tasks:
  - `Ctrl+Shift+B` to start watch task
  - `Ctrl+Shift+P` → "Tasks: Run Task" → select task
- **Debug** - F5 to launch Extension Development Host
- **Test** - Use VS Code's built-in test runner

### Multi-target Support

GitLens supports multiple environments:

- **Node.js** - Traditional VS Code extension (desktop)
- **Web Worker** - Browser/web VS Code compatibility (vscode.dev)
- Shared code with environment abstractions in `src/env/`
- Test both environments during development

### Performance Considerations

- Use lazy loading for heavy services
- Leverage caching layers (GitCache, PromiseCache, @memoize)
- Debounce expensive operations
- Consider webview refresh performance
- Monitor telemetry for performance regressions

---

This architecture enables GitLens to provide powerful Git tooling while maintaining clean separation of concerns, extensibility for new features, and support for multiple runtime environments.

## Development Commands

### Setup

```bash
pnpm install              # Install dependencies (requires Node >= 22.12.0, pnpm >= 10.x)
```

### Build & Development

```bash
pnpm run rebuild          # Complete rebuild from scratch
pnpm run build            # Full development build (everything including e2e and unit tests)
pnpm run build:quick      # Fast build (no linting)
pnpm run build:turbo      # Turbo build (no typechecking or linting)
pnpm run build:extension  # Build only the extension (no webviews)
pnpm run build:webviews   # Build only webviews
pnpm run bundle           # Production bundle
pnpm run bundle:e2e       # E2E tests (turbo) production bundle (with DEBUG for account simulation)
pnpm run bundle:turbo     # Turbo production bundle (no typechecking or linting)
```

### Watch Mode

```bash
pnpm run watch            # Watch mode for development (everything including e2e and unit tests)
pnpm run watch:quick      # Fast watch mode (no linting)
pnpm run watch:turbo      # Turbo watch mode (no typechecking or linting)
pnpm run watch:extension  # Watch extension only
pnpm run watch:tests      # Watch unit tests only
pnpm run watch:webviews   # Watch webviews only
```

### Testing

```bash
pnpm run test             # Run unit tests (VS Code extension tests)
pnpm run test:e2e         # Run Playwright E2E tests
```

#### Running Tests (for AI Assistants without VS Code API access)

If you don't have access to VS Code's built-in `runTests` tool (e.g., Claude Code, Augment, or terminal-based AI tools), use the following commands and patterns:

**Unit Tests**

```bash
# Run all unit tests
pnpm run test

# Run specific test file(s) - use glob patterns
pnpm run test -- --grep "pattern"

# Run tests in a specific directory
pnpm run test -- "src/git/__tests__/**/*.test.ts"
```

**E2E Tests (Playwright)**

```bash
# Run all E2E tests
pnpm run test:e2e

# Run specific test file
pnpm run test:e2e -- tests/e2e/specs/quickWizard.test.ts

# Run tests matching a pattern
pnpm run test:e2e -- --grep "wizard"

# Run in headed mode (useful for debugging)
pnpm run test:e2e -- --headed

# Run with specific project (Electron desktop)
pnpm run test:e2e -- --project=electron
```

**Interpreting Test Output**

- ✓ or PASS = test passed
- ✗ or FAIL = test failed (look for error message and stack trace)
- Look for `Error:`, `AssertionError:`, or `expect(` lines for failure details
- E2E tests show screenshots on failure in `tests/e2e/test-results/`

**Before Running Tests**

1. Ensure the extension is built: `pnpm run build` or have `pnpm run watch` running
2. For E2E tests, ensure `pnpm run bundle:e2e` has been run (or use watch mode)

**Debugging Test Failures**

```bash
# Get verbose output
pnpm run test:e2e -- --reporter=list

# Run single test with full trace
pnpm run test:e2e -- --trace on --grep "test name"

# Check for TypeScript errors first
pnpm run lint
```

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

## Git & Repository Requirements/Guidelines

### Committing

- Be sure to follow the commit message guidelines below
- Before committing, check if the changes are user-facing and should be added to the CHANGELOG.md, if so, follow the CHANGELOG management guidelines below

#### Commit Message Guidelines

- Use future-oriented manner, third-person singular present tense
- Examples: **"Fixes"**, **"Updates"**, **"Improves"**, **"Adds"**, **"Removes"**
- Reference issues with `#123` syntax for auto-linking
- Keep first line under 72 characters
- Example: `Adds support for custom autolinks for Jira - fixes #1234`

### Branching Guidelines

- Feature branches from `main` or from another feature branch if stacking
- Prefix with an appropriate type: `feature/`, `bug/`, `debt/`
- Use descriptive names: `feature/search-natural-language`, `bug/graph-performance`
- If there is a related issue, reference it in the branch name: `feature/#1234-search-natural-language`

### CHANGELOG Management

Uses [Keep a Changelog](http://keepachangelog.com/) format under `[Unreleased]`.

#### Section Mapping

| Change Type | Section    |
| ----------- | ---------- |
| Feature     | Added      |
| Enhancement | Changed    |
| Performance | Changed    |
| Bugfix      | Fixed      |
| Deprecation | Deprecated |
| Removal     | Removed    |

#### Entry Format

```markdown
- [Verb] [description] ([#issue](url))
```

**Guidelines:**

- Start with: "Adds", "Improves", "Changes", "Fixes", "Removes"
- Use underscores for UI elements: `_Commit Graph_`, `_Home_ view`
- Include issue reference if available
- Be user-centric (what user sees, not code changes)

**Example:**

```markdown
- Fixes an issue where the _Home_ view would not update when switching repositories ([#4717](https://github.com/gitkraken/vscode-gitlens/issues/4717))
```

#### Detection

Check `[Unreleased]` section for:

- Issue number reference (if commit has linked issue)
- Keywords from commit message
- Feature/component names

## Code Reviewing Guidelines

As an expert software developer with deep expert-level knowledge of TypeScript, JavaScript, VS Code extension development, web/web components, node.js, HTML, CSS, design systems, UX design, accessibility, and writing highly performant, maintainable, and readable code — please carefully and thoroughly review all changes for:

- Correctness
- Matching user expectations
- High performance, including proper caching and deferring of work
- Well-factored, structured, and named
- No more complex than necessary
- Webview changes are responsive, accessible, and work with VS Code theming
- Proper error handling and logging
- Comprehensive telemetry and usage reporting
- Follows best practices

### Code Reviewing Checklist

- Ensure TypeScript compilation and tests pass
- Verify that there are no new lint violations
- Review commit messages for clarity and adherence to guidelines
- Ensure CHANGELOG entries are added for user-facing changes

## Debugging & Investigation Methodology

When diagnosing bugs or unexpected behavior, follow this structured process. Do NOT guess at root causes — gather evidence first.

### Step 1: Understand the Symptom

- Read the exact error message, stack trace, or behavioral description
- Identify WHICH component is failing (extension host vs webview, Node.js vs browser)
- Determine if the issue is a regression (was it working before?)

### Step 2: Trace the Code Path

- Start from the symptom and trace BACKWARDS through the call chain
- Read the ACTUAL implementation of every function in the chain, including decorators
- Do NOT assume what a function does based on its name alone
- For decorated methods: understand that `@gate()`, `@debug()`, `@memoize()`, and `@sequentialize()` wrap the method and alter its behavior (see Decorator System section below)

### Step 3: Verify Your Hypothesis Before Implementing

- Form at least 2 possible root causes
- For each hypothesis, identify what evidence would confirm or refute it
- For non-trivial or ambiguous issues, state your diagnosis explicitly and wait for confirmation before making changes

### Step 4: Audit All Affected Locations

Before implementing a fix:

- Search for ALL call sites of the function being modified
- Search for ALL overrides of the method (in subclasses, sub-providers)
- Check both Node.js AND browser code paths (`src/env/node/` and `src/env/browser/`)
- Check both LocalGitProvider AND GitHubGitProvider sub-providers if modifying git operations
- For error handling changes, check all catch blocks that handle the error type

### Common Misdiagnosis Patterns to Avoid

1. **Blaming logging decorators for hangs**: When a method hangs, the issue is almost never in `@info()`/`@debug()`/`@trace()`. Check `@gate()` (promise never resolving) or the actual async operation first.
2. **Confusing `@gate()` and `@sequentialize()`**: `@gate()` returns the SAME promise to concurrent callers. `@sequentialize()` QUEUES calls. These solve different problems.
3. **Wrong error type handling**: Use the error's `.is()` static method with reason discriminator: `PushError.is(ex, 'noUpstream')`, not `instanceof` + `ex.message.includes(...)`.
4. **Platform-specific bugs**: Something working in Node.js may fail in browser (and vice versa). Always check the `@env/` abstraction layer.
5. **Scope/context bugs**: `getScopedLogger()` returns stale scope after `await` in browser. Capture the scope before the first `await`.
6. **Suppressing errors instead of fixing them**: Do NOT silence errors by catching and ignoring them. Fix the root cause or propagate them properly (e.g., use `errors: throw` so catch blocks handle them).

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

### Testing Structure

**Unit Tests**

- Tests co-located with source files in `__tests__/` directories
- Pattern: `src/path/to/__tests__/file.test.ts`
- VS Code extension tests use `@vscode/test-cli`
- Unit tests are built as part of the main build, but can be built directly: `pnpm run build:tests`

```bash
pnpm run test              # Run unit tests (VS Code extension tests)
pnpm run build:tests       # Build unit tests
pnpm run watch:tests       # Watch mode (includes unit tests)
```

**End-to-End (E2E) Tests**

- E2E tests use Playwright in `tests/e2e/`
  - Fixture setup and utilities in `tests/e2e/fixtures/`
  - Page objects in `tests/e2e/pageObjects/`
  - Test specs in `tests/e2e/specs/`
- E2E tests are built as part of the main build, but can be built directly: `pnpm run bundle:e2e`

```bash
pnpm run test:e2e       # Run E2E tests
pnpm run bundle:e2e     # Build E2E tests (production with DEBUG for account simulation)
pnpm run watch          # Watch mode (includes E2E tests)
```

**AI Assistant Testing Guidelines**

- **GitHub Copilot (VS Code)**: Has access to `runTests` and `testFailures` tools - use these for integrated test running and debugging
- **Claude Code / Augment / Terminal-based tools**: Use the terminal commands above. See "Running Tests (for AI Assistants without VS Code API access)" in the Development Commands section for detailed patterns
- Always run tests after making changes to verify correctness
- For E2E test failures, check `tests/e2e/test-results/` for screenshots and traces
- Parse test output looking for `FAIL`, `Error:`, `AssertionError:`, or failed `expect()` calls

### Core Architectural Patterns

**1. Service Locator (Container)**

- `src/container.ts` - Main dependency injection container using singleton pattern
- Manages 30+ services with lazy initialization
- All services registered in constructor and exposed as getters
- Handles lifecycle, configuration changes, and service coordination
- Example services: GitProviderService, SubscriptionService, TelemetryService, AIProviderService

**2. Provider Pattern for Git Operations**

- `GitProviderService` manages multiple Git providers (local, remote, GitHub, etc.)
- Allows environment-specific implementations:
  - **LocalGitProvider** (`src/env/node/git/localGitProvider.ts`): Executes Git via `child_process` for Node.js
  - **GitHubGitProvider** (`src/plus/integrations/providers/github/githubGitProvider.ts`): Uses GitHub API for browser
- Each provider implements the `GitProvider` interface
  - Both providers use a shared set of sub-providers (in `src/git/sub-providers/`) for specific Git operations
  - LocalGitProvider uses 15 specialized sub-providers (in `src/env/node/git/sub-providers/`):
    - `branches`, `commits`, `config`, `contributors`, `diff`, `graph`, `patch`, `refs`, `remotes`, `revision`, `staging`, `stash`, `status`, `tags`, `worktrees`
  - GitHubGitProvider uses 11 specialized sub-providers (in `src/plus/integrations/providers/github/sub-providers/`):
    - `branches`, `commits`, `config`, `contributors`, `diff`, `graph`, `refs`, `remotes`, `revision`, `status`, `tags`

**3. Layered Architecture**

```
VS Code Extension API
    ↓
Commands (100+ command handlers in src/commands/)
    ↓
Controllers (Webviews, Views, Annotations, CodeLens)
    ↓
Services (Git, Telemetry, Storage, Integrations, AI, Subscription)
    ↓
Git Providers (LocalGitProvider, GitHubGitProvider, etc.)
    ↓
Git Execution (Node: child_process | Browser: APIs (GitHub))
```

**4. Webview IPC Protocol**

- Webviews use typed message-passing with three message types:
  - **Commands**: Fire-and-forget actions (no response)
  - **Requests**: Request/response pairs with Promise-based handling
  - **Notifications**: Extension → Webview state updates
- Protocol defined in `src/webviews/protocol.ts`
- **Host-Guest Communication**: IPC between extension host and webviews
- Webviews built with **Lit Elements only** for reactive UI components
- **State Management**: Context providers with Lit reactive patterns and signals
- **Major webviews**:
  - **Community**: Commit Details, Rebase, Settings
  - **Pro** (`apps/plus/`): Home (includes Launchpad), Commit Graph, Timeline, Patch Details, Commit Composer
- Webviews bundled separately from extension (separate webpack config)

**5. Caching Strategy**

- Multiple caching layers for performance:
  - `GitCache`: Repository-level Git data caching
  - `PromiseCache`: In-flight request deduplication
  - `@memoize` decorator: Function result memoization
  - VS Code storage API: Persistent state across sessions

### Major Services & Components

**Core Services** (accessed via Container)

- **GitProviderService** - Core Git operations and repository management
- **SubscriptionService** - GitLens Pro subscription and account management
- **IntegrationService** - GitHub/GitLab/Bitbucket/Azure DevOps integrations
- **AIProviderService** - AI features (commit messages, explanations, changelogs)
- **TelemetryService** - Usage analytics and error reporting
- **WebviewsController** - Manages all webview panels (Graph, Home, Settings, etc.)
- **AutolinksProvider** - Auto-linking issues/PRs in commit messages
- **DocumentTracker** - Tracks file changes and editor state
- **FileAnnotationController** - Blame, heatmap, and change annotations

**VS Code Contributions**

- Commands, Menus, Submenus, Keybindings, and Views defined in `contributions.json`
- Generate package.json: `pnpm run generate:contributions`
- Extract from package.json: `pnpm run extract:contributions`
- All other VS Code contributions are defined in `package.json` (activation events, settings, etc.)

**Extension Activation** (`src/extension.ts`)

- Activates on `onStartupFinished`, file system events, or specific webview opens
- Creates the `Container` singleton
- Registers all commands, views, providers, and decorations

**Commands** (`src/commands/`)

- 100+ commands registered in `package.json` (generated from `contributions.json`)
- Command IDs auto-generated in `src/constants.commands.generated.ts`
- Commands grouped by functionality (git operations, views, webviews, etc.)

**Views** (`src/views/`)

- Tree views: Commits, Branches, Remotes, Stashes, Tags, Worktrees, Contributors, Repositories
- Each view has a tree data provider implementing VS Code's `TreeDataProvider`
- Nodes are hierarchical (repository → branch → commit → file)

### Environment Abstraction

The extension supports both Node.js (desktop) and browser (web) environments:

**Node.js Environment** (`src/env/node/`)

- Uses `child_process` to execute Git commands via `Git.execute()`
- Direct file system access
- Full Git command support
- Commands parsed by specialized parsers in `src/git/parsers/`

**Browser Environment** (`src/env/browser/`)

- Uses GitHub API for Git operations
- Virtual file system via VS Code's File System API
- Limited to supported Git hosting providers
- WebWorker support for browser extension compatibility

**Build Configuration**

- Separate entry points: `main` (Node.js) and `browser` (webworker)
- Webpack configs in `webpack.config.mjs`:
  1. `extension:node` - Extension code for Node.js
  2. `extension:webworker` - Extension code for browser
  3. `webviews:common` - Shared webview code
  4. `webviews` - Individual webview apps
  5. `images` - Icon/image processing
- Platform detection via `@env/platform` abstractions

**Output Structure**

```
dist/
├── gitlens.js              # Main extension bundle (Node.js)
├── browser/
│   └── gitlens.js          # Extension bundle for browser
└── webviews/
    ├── *.js                # Individual webview apps
    └── media/              # Webview assets
```

### Pro Features (Plus)

Files in or under directories named "plus" fall under `LICENSE.plus` (non-OSS):

- **Commit Graph** - Visual commit history with advanced actions
- **Worktrees** - Multi-branch workflow support
- **Launchpad** - PR/issue management hub
- **Visual File History** - Timeline visualization
- **Cloud Patches** - Private code sharing
- **Code Suggest** - In-IDE code suggestions for PRs
- **AI Features** - Commit generation, explanations using various providers

Pro features integrate with GitKraken accounts and require authentication via SubscriptionService.

## Coding Standards & Style Rules

### TypeScript Configuration

- **Strict TypeScript** with `strictTypeChecked` ESLint config
- **No `any` usage** (exceptions only for external APIs)
- **Explicit return types** for public methods
- **Prefer `type` over `interface`** for unions
- Multiple tsconfig files for different targets (node, browser, test)

### Import Organization

- **Use path aliases**: `@env/` for environment-specific code
- **Import order**: node built-ins → external → internal → relative
- **No default exports** (ESLint enforced)
- **Consistent type imports** with `import type` for type-only imports

Example:

```typescript
import type { Disposable } from 'vscode';
import { EventEmitter } from 'vscode';
import type { Container } from './container';
import { configuration } from './system/configuration';
```

### Naming Conventions

- **Classes**: PascalCase (no `I` prefix for interfaces)
- **Methods/Variables**: camelCase
- **Constants**: camelCase for module-level constants (not SCREAMING_SNAKE_CASE)
- **Private members**: Leading underscore allowed (e.g., `_cache`)
- **Files**: camelCase.ts (e.g., `gitProvider.ts`, `branchProvider.utils.ts`)
- **Folders**:
  - Models under a `models/` sub-folder
  - Utilities under a `utils/` sub-folder (usable in both host and webviews)
  - Extension host-specific utilities in `utils/-webview/` sub-folder
  - Webview apps under `webviews/apps/`

### Code Structure Principles

- **Single responsibility** - Each service has focused purpose
- **Dependency injection** - Services injected via Container
- **Event-driven** - EventEmitter pattern for service communication
- **Disposable pattern** - Proper cleanup with VS Code Disposable interface
- **Immutability** - Prefer immutable operations where possible

### Error Handling

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

### Webview Development

- **Lit Elements** - Use for reactive UI components
- **Context providers** - For sharing state across components
- **Signal patterns** - For reactive state management
- **CSS custom properties** - For VS Code theming support
- Webview UI code in `src/webviews/apps/{webviewName}/`
- Use IPC protocol for communication: `postMessage()` → `onIpc()`
- Refresh webview without restarting extension during development

#### Accessibility Requirements

When creating or modifying Lit web components:

- **Focus management**: Ensure keyboard navigation works. Tab order must be logical. Custom interactive elements need `tabindex="0"` and keyboard event handlers (Enter/Space for activation).
- **Focus traps**: Modal/overlay components must trap focus inside when open and restore focus on close. Use a tested focus-trap utility rather than implementing from scratch.
- **ARIA attributes**: Interactive elements must have appropriate `role` and `aria-*` attributes. Custom widgets need `aria-expanded`, `aria-selected`, `aria-disabled` as appropriate.
- **Tooltips**: Must appear on both hover AND keyboard focus. Must be dismissible with Escape.
- **Visual indicators**: Focus outlines must be visible. Do NOT use `outline: none` without providing an alternative visible indicator. Avoid double outlines from both `:focus` and `:focus-visible`.
- **Color contrast**: Use VS Code theme CSS custom properties (`--vscode-*`). Do not hardcode colors.

#### Common Webview Bugs to Avoid

- Double event handlers from Lit's `@event` syntax combined with `addEventListener`
- Stale state in signal-based components after rapid updates
- Missing `disconnectedCallback()` cleanup for event listeners and observers
- Popover/overlay components that don't handle Escape key or click-outside

### Implementation Quality Rules

#### Minimize Complexity

- Prefer the SIMPLEST solution that correctly solves the problem
- Do NOT introduce new types, enums, or abstractions unless they serve multiple consumers
- Do NOT add migration flags, compatibility layers, or marker types for single-use scenarios
- If a solution requires more than 2-3 new types/interfaces, reconsider the approach

#### Scope of Changes

- Refactoring and renaming to improve clarity, maintainability, and codebase health are welcome — just explain what and why
- Do NOT make silent, unrelated drive-by changes alongside a bug fix or feature
- If you notice something nearby that could be improved, go ahead — but call it out so the user knows

#### Completeness Checklist

Before considering a multi-file change complete:

- [ ] All call sites of modified functions reviewed
- [ ] All subclass overrides of modified methods updated
- [ ] Both Node.js (`src/env/node/`) and browser (`src/env/browser/`) code paths work
- [ ] Error handling covers the new code path
- [ ] No existing behavior broken (especially adjacent features)
- [ ] Edge cases considered: empty/null/undefined inputs, concurrent calls, error states

#### Fix vs. Disable

- "Fix" means make the feature work correctly — do NOT disable or remove it
- "Fix" means address the root cause — do NOT add a workaround that hides symptoms
- If the correct fix is complex, explain the complexity and propose options — do NOT silently simplify by removing functionality

## Important Patterns and Conventions

### Configuration Management

- All settings defined in `package.json` contributions
- Configuration typed in `src/config.ts`
- Access via `Container.instance.config` or `configuration.get()`
- Settings are strongly typed with intellisense support

### Constants Organization

- **Command IDs**: `src/constants.commands.ts` (manual) + `constants.commands.generated.ts` (auto-generated)
- **Context keys**: `src/constants.context.ts`
- **Telemetry events**: `src/constants.telemetry.ts`
- **View IDs**: `src/constants.views.ts`
- **AI providers**: `src/constants.ai.ts`
- **Storage keys**: `src/constants.storage.ts`

### Git Command Execution

- All Git commands go through `Git.execute()` in `src/env/node/git/git.ts`
- Commands are parsed and formatted consistently
- Output is parsed by specialized parsers in `src/git/parsers/`
- Results cached in GitCache for performance

### Repository Models

Strongly typed Git entities throughout the codebase (located in `src/git/models/`):

- **Core models**: `GitBranch`, `GitCommit`, `GitTag`, `GitRemote`, `GitWorktree`
- **Specialized models**: `GitStashCommit` (extends `GitCommit`), `GitStash`, `GitContributor`, `GitFile`, `GitDiff`
- Models provide rich methods and computed properties
- Immutable by convention

## Common Development Tasks

### Modifying Git Operations

1. Find the relevant Git provider:
   - Shared Git provider interface: `src/git/gitProvider.ts`
   - Shared sub-operations: `src/git/sub-providers/`
   - For Local (Node.js): `src/env/node/git/localGitProvider.ts`
   - For Local sub-operations: `src/env/node/git/sub-providers/`
   - For GitHub (browser): `src/plus/integrations/providers/github/githubGitProvider.ts`
   - For GitHub sub-operations: `src/plus/integrations/providers/github/sub-providers/`
2. Update provider method with new logic
3. Update Git command execution in `src/env/node/git/git.ts` if needed (for LocalGitProvider)
4. Update parsers in `src/git/parsers/` if output format changes
5. Update models in `src/git/models/` if data structure changes
6. Consider caching implications (update `GitCache` if needed)
7. Add tests in `__tests__/` directory

## Quick Lookup

Reference examples and critical rules for common tasks.

### Available Skills

Skills provide detailed, step-by-step workflows for common tasks. Invoke with `/{skill-name}`.

| Skill              | Purpose                                                   |
| ------------------ | --------------------------------------------------------- |
| `/investigate`     | Structured bug investigation with root cause analysis     |
| `/analyze`         | Deep design/implementation analysis, devil's advocate     |
| `/review`          | Code review against standards + impact completeness audit |
| `/commit`          | Git commit with GitLens conventions                       |
| `/create-issue`    | Create GitHub issues from code changes                    |
| `/audit-commits`   | Audit commit range for issues and CHANGELOG entries       |
| `/add-command`     | Scaffold a new VS Code command                            |
| `/add-webview`     | Scaffold a new webview with IPC, Lit app, registration    |
| `/add-test`        | Generate unit or E2E test files                           |
| `/add-icon`        | Add icon to GL Icons font                                 |
| `/add-ai-provider` | Add a new AI provider integration                         |

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

**Imports**

- Always use `.js` extension in imports (ESM requirement)
- Use named exports only (no `default` exports)

**IPC**

- `IpcCommand` = fire-and-forget (no response)
- `IpcRequest` = expects a response (use `await`)
- `IpcNotification` = extension → webview state updates

**Testing**

- When debugging test failures, DON'T simplify NOR change the intent of the tests just to get them to pass. Instead, INVESTIGATE and UNDERSTAND the root cause of the failure and address that directly, or raise an issue to the user if you can't resolve it.
