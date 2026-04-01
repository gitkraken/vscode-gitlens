# GitLens Architecture Reference

Detailed architecture documentation for the GitLens VS Code extension. For the directory structure overview, see `AGENTS.md`.

## Testing Structure

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
- **Claude Code / Augment / Terminal-based tools**: Use the terminal commands above. See `docs/testing.md` for detailed patterns
- Always run tests after making changes to verify correctness
- For E2E test failures, check `tests/e2e/test-results/` for screenshots and traces
- Parse test output looking for `FAIL`, `Error:`, `AssertionError:`, or failed `expect()` calls

## Core Architectural Patterns

### 1. Service Locator (Container)

- `src/container.ts` - Main dependency injection container using singleton pattern
- Manages 30+ services with lazy initialization
- All services registered in constructor and exposed as getters
- Handles lifecycle, configuration changes, and service coordination
- Example services: GitProviderService, SubscriptionService, TelemetryService, AIProviderService

### 2. Provider Pattern for Git Operations

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

### 3. Layered Architecture

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

### 4. Webview IPC Protocol

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

### 5. Caching Strategy

- Multiple caching layers for performance:
  - `GitCache`: Repository-level Git data caching
  - `PromiseCache`: In-flight request deduplication
  - `@memoize` decorator: Function result memoization
  - VS Code storage API: Persistent state across sessions

## Major Services & Components

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

## Environment Abstraction

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

## Pro Features (Plus)

Files in or under directories named "plus" fall under `LICENSE.plus` (non-OSS):

- **Commit Graph** - Visual commit history with advanced actions
- **Worktrees** - Multi-branch workflow support
- **Launchpad** - PR/issue management hub
- **Visual File History** - Timeline visualization
- **Cloud Patches** - Private code sharing
- **Code Suggest** - In-IDE code suggestions for PRs
- **AI Features** - Commit generation, explanations using various providers

Pro features integrate with GitKraken accounts and require authentication via SubscriptionService.

## Webview Development

- **Lit Elements** - Use for reactive UI components
- **Context providers** - For sharing state across components
- **Signal patterns** - For reactive state management
- **CSS custom properties** - For VS Code theming support
- Webview UI code in `src/webviews/apps/{webviewName}/`
- Use IPC protocol for communication: `postMessage()` → `onIpc()`
- Refresh webview without restarting extension during development

For accessibility requirements when creating or modifying webviews, see `docs/accessibility.md`.

### Common Webview Bugs to Avoid

- Double event handlers from Lit's `@event` syntax combined with `addEventListener`
- Stale state in signal-based components after rapid updates
- Missing `disconnectedCallback()` cleanup for event listeners and observers
- Popover/overlay components that don't handle Escape key or click-outside

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
