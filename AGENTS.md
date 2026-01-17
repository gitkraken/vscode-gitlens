# GitLens Development Guide

This workspace contains **GitLens** - a powerful VS Code extension that supercharges Git functionality. It provides blame annotations, commit history visualization, repository exploration, and many advanced Git workflows. The codebase supports both desktop VS Code (Node.js) and VS Code for Web (browser/webworker) environments.

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
pnpm run build            # Full development build
pnpm run build:quick      # Fast build (no linting)
pnpm run build:turbo      # Turbo build (no typechecking or linting)
pnpm run build:extension  # Build only the extension (no webviews)
pnpm run build:webviews   # Build only webviews
pnpm run build:tests      # Build unit tests (not part of the main build)
pnpm run bundle           # Production bundle
pnpm run bundle:e2e       # E2E tests (turbo) production bundle (with DEBUG for account simulation)
pnpm run bundle:turbo     # Turbo production bundle (no typechecking or linting)
```

### Watch Mode

```bash
pnpm run watch            # Watch mode for development
pnpm run watch:quick      # Fast watch mode (no linting)
pnpm run watch:turbo      # Turbo watch mode (no typechecking or linting)
pnpm run watch:extension  # Watch extension only
pnpm run watch:webviews   # Watch webviews only
pnpm run watch:tests      # Watch unit test files
```

### Testing

```bash
pnpm run test             # Run unit tests (VS Code extension tests)
pnpm run test:e2e         # Run Playwright E2E tests
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
- Unit tests are built separately: `pnpm run build:tests`

```bash
pnpm run test           # Run unit tests (VS Code extension tests)
pnpm run watch:tests    # Watch mode for tests
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

**Important**: If you have access to VS Code's `runTests` and `testFailures` tools, use them to run and debug E2E tests

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

- Use custom error types extending `Error`
- Log errors with context using `Logger.error()`
- Graceful degradation for network/API failures
- Validate external data with schema validators
- Provide user-friendly error messages

### Decorators

Common decorators used throughout the codebase:

- `@memoize()` - Cache function results
- `@debug()` - Add debug logging
- `@log()` - Add logging
- `@gate()` - Throttle concurrent calls
- `@command()` - Register VS Code commands

### Webview Development

- **Lit Elements** - Use for reactive UI components
- **Context providers** - For sharing state across components
- **Signal patterns** - For reactive state management
- **CSS custom properties** - For VS Code theming support
- Webview UI code in `src/webviews/apps/{webviewName}/`
- Use IPC protocol for communication: `postMessage()` → `onIpc()`
- Refresh webview without restarting extension during development

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

### Adding a New Command

1. Create command file in `src/commands/` (e.g., `myCommand.ts`)
2. Register command in `src/commands.ts`:
   ```typescript
   registerCommand(Commands.MyCommand, () => new MyCommand(container));
   ```
3. Add to `contributions.json` for package.json generation:
   ```json
   {
   	"command": "gitlens.myCommand",
   	"title": "My Command",
   	"category": "GitLens"
   }
   ```
4. Run `pnpm run generate:contributions` to update package.json
5. Run `pnpm run generate:commandTypes` to update command constants

### Adding a New Webview

1. Create webview provider in `src/webviews/` (e.g., `myWebviewProvider.ts`)
2. Create Lit app in appropriate location:
   - For Pro features: `src/webviews/apps/plus/my-webview/`
   - For community features: `src/webviews/apps/my-webview/`
   - Create `my-webview.ts` (main app component with Lit Elements)
   - Add HTML template
   - Add CSS styles
3. Register in `WebviewsController` (in `src/webviews/webviewsController.ts`)
4. Add protocol definitions for IPC in `src/webviews/protocol.ts`:
   ```typescript
   export interface MyWebviewShowingArgs { ... }
   ```
5. Add webpack entry point in `webpack.config.mjs`
6. Register webview in extension activation

### Adding a New Tree View

1. Create tree provider in `src/views/` (e.g., `myTreeView.ts`)
   - Extend `ViewBase` or `RepositoryFolderNode`
   - Implement `getChildren()` method
2. Define node types for the tree hierarchy
3. Add to `contributions.json`:
   ```json
   {
   	"id": "gitlens.views.myView",
   	"name": "My View",
   	"when": "..."
   }
   ```
4. Register in extension activation (`src/extension.ts`)
5. Run `pnpm run generate:contributions`

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

### Working with Icons (GL Icons Font)

1. Add SVG icons to `images/icons/` folder
2. Append entries to `images/icons/template/mapping.json`:
   ```json
   "icon-name": 1234
   ```
3. Run icon build commands:
   ```bash
   pnpm run icons:svgo        # Optimize SVGs
   pnpm run build:icons       # Generate font
   ```
4. Copy new `glicons.woff2?<uuid>` URL from `src/webviews/apps/shared/glicons.scss`
5. Search and replace old font URL with new one across the codebase

### Adding New AI Provider

1. Create new AI provider in `src/plus/ai/` extending base classes (e.g., `openAICompatibleProviderBase.ts`)
2. Add to `AIProviderService` registry in `src/plus/ai/aiProviderService.ts`
3. Handle authentication and rate limiting
4. Add provider constants to `src/constants.ai.ts`
5. Update configuration in `package.json` contributions

### Adding Git Provider Integration

1. Implement `GitProvider` interface (e.g., `gitLabGitProvider.ts`)
2. Register with `GitProviderService`
3. Handle provider-specific authentication
4. Add integration constants to `src/constants.integrations.ts`
5. Consider adding rich integration features (PRs, issues, avatars)

## Quick Lookup

Reference examples and critical rules for common tasks.

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
