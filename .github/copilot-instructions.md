# GitLens Copilot Instructions

This workspace contains **GitLens** - a VS Code extension that supercharges Git functionality. Below are key development guidelines and architecture insights.

## Core Commands

### Build & Development

- `pnpm run build` - Full development build
- `pnpm run build:quick` - Fast build without linting
- `pnpm run watch` - Watch mode for development
- `pnpm run watch:quick` - Fast watch mode without linting
- `pnpm run bundle` - Production bundle

### Testing & Quality

- `pnpm run test` - Run unit tests with vscode-test
- `pnpm run test:e2e` - End-to-end tests with Playwright
- `pnpm run lint` - ESLint with TypeScript rules
- `pnpm run lint:fix` - Auto-fix linting issues
- `pnpm run pretty` - Format with Prettier

### Specialized Commands

- `pnpm run build:tests` - Build test files with esbuild
- `pnpm run generate:contributions` - Generate package.json contributions from contributions.json
- `pnpm run generate:commandTypes` - Generate command types from contributions
- `pnpm run web` - Run extension in web environment for testing

## High-Level Architecture

### Core Container System

- **Container** (`src/container.ts`) - Main dependency injection container, singleton pattern
- All services registered in constructor and exposed as getters
- Handles lifecycle, configuration changes, and service coordination

### Major Services & Providers

- **GitProviderService** - Core Git operations and repository management
- **SubscriptionService** - GitLens Pro subscription and account management
- **IntegrationService** - GitHub/GitLab/etc integrations
- **AIProviderService** - AI features (commit messages, explanations)
- **WebviewsController** - Manages all webview panels (Graph, Home, etc)
- **AutolinksProvider** - Auto-linking issues/PRs in commit messages
- **TelemetryService** - Usage analytics and error reporting

### VS Code Contributions

- Commands, Menus, Submenus, Keybindings, and Views are defined in `contributions.json`
- Contributions are generated from `contributions.json` into `package.json` via `pnpm run generate:contributions`
- Contributions can also be extracted from `package.json` into `contributions.json` via `pnpm run extract:contributions`

### Webview Architecture

- **Shared Components** (`src/webviews/apps/shared/`) - Common UI components using Lit
- **Host-Guest Communication** - IPC between extension and webviews
- **State Management** - Context providers with Lit reactive patterns
- Major webviews: Home, Commit Graph, Timeline, Launchpad, Settings

### Git Integration

- **GitProviderService** - Abstracts Git operations across different providers
- **Repository Models** - Strongly typed Git entities (Branch, Commit, Tag, etc)
- **DocumentTracker** - Tracks file changes and editor state
- **FileAnnotationController** - Blame, heatmap, and change annotations

### Plus Features (Pro)

- **Subscription gating** - Feature access control via SubscriptionService
- **Cloud integrations** - GitHub/GitLab APIs for PRs, issues
- **Worktrees** - Multi-branch workflow support
- **AI features** - Commit generation, explanations using various providers

## Coding Standards & Style Rules

### TypeScript Configuration

- Strict TypeScript with `strictTypeChecked` ESLint config
- No `any` usage (exceptions for external APIs)
- Explicit return types for public methods
- Prefer `type` over `interface` for unions

### Import Organization

- Use path aliases: `@env/` for environment-specific code
- Import order: node built-ins → external → internal → relative
- No default exports (ESLint enforced)
- Consistent type imports with `import type`

### Naming Conventions

- **Classes**: PascalCase (no `I` prefix for interfaces)
- **Methods/Variables**: camelCase
- **Constants**: camelCase for module-level constants
- **Private members**: Leading underscore allowed
- **Files**: camelCase.ts, camelCase.utils.ts for related utilities
- **Folders**
  - Models under a `models/` sub-folder
  - Utilities under a `utils/` sub-folder if they can be used in both the extension host and webviews, or `utils/-webview/` sub-folder for extension host-specific utilities
  - Webview apps under `webviews/apps/`

### Code Structure

- **Single responsibility** - Each service has focused purpose
- **Dependency injection** - Services injected via Container
- **Event-driven** - EventEmitter pattern for service communication
- **Disposable pattern** - Proper cleanup with VS Code Disposable interface

### Error Handling

- Use custom error types extending Error
- Log errors with context using Logger.error()
- Graceful degradation for network/API failures
- Validate external data with schema validators

### Webview Specific

- **Lit Elements** - Use for reactive UI components
- **Context providers** - For sharing state across components
- **Signal patterns** - For reactive state management
- **CSS custom properties** - For theming support

### Environment Abstractions

- **Platform detection** - Use `@env/platform` abstractions
- **Node vs Browser** - Environment-specific implementations in `src/env/`
- **WebWorker support** - Browser extension compatibility

## Repository Guidelines

### Commit Messages

- Use a future-oriented manner, third-person singular present tense (e.g., 'Fixes', 'Updates', 'Improves', 'Adds', 'Removes')
- Reference issues with `#123` syntax for auto-linking
- Keep first line under 72 characters

### Branch Workflow

- Feature branches from `main`
- Prefix with feature type: `feature/`, `bug/`, `debt/`
- Use descriptive names: `feature/search-natural-language`

### Code Reviews

- Check TypeScript compilation and tests pass
- Verify no new ESLint violations
- Test webview changes in both themes
- Validate Plus features with subscription states

## Key Extension Points

### Adding New Commands

1. Define in `src/commands/` directory
2. Register in `src/commands.ts`
3. Add to `contributions.json` for package.json generation
4. Update command types with `pnpm run generate:commandTypes`

### New Webviews

1. Create provider in `src/webviews/`
2. Add Lit app in `src/webviews/apps/`
3. Register in WebviewsController
4. Add protocol definitions for IPC

### Git Provider Extensions

- Implement GitProvider interface
- Register with GitProviderService
- Handle provider-specific authentication

### AI Provider Integration

- Implement AIProvider interface
- Add to AIProviderService registry
- Handle authentication and rate limiting

## Development Environment

### Prerequisites

- **Node.js** ≥ 22.12.0
- **pnpm** ≥ 10.x (via corepack)
- **Git** ≥ 2.7.2

### VS Code Tasks

- **Build** - `Ctrl+Shift+P` → "Tasks: Run Task" → "watch"
- **Test** - Use VS Code's built-in test runner
- **Debug** - F5 to launch Extension Development Host

### Multi-target Support

- **Node.js** - Traditional VS Code extension
- **Web Worker** - Browser/web VS Code compatibility
- Shared code with environment abstractions

This architecture enables GitLens to provide powerful Git tooling while maintaining clean separation of concerns and extensibility for new features.
