# Change Log

All notable changes to `@gitkraken/core-gitlens` will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this project adheres to [Semantic Versioning](http://semver.org/).

## [Unreleased]

### Added

- Adds multiple simultaneous connections (multi-account) per provider integration — `ConfiguredIntegrationDescriptor` now carries a stable per-connection `id` (backend `tokenId`) plus `primary`, `type`, and `accountName`; `IntegrationService` gains `setPrimaryConnection`, `deleteConnection`, and `refreshConnections`; cloud sync fans out over every backend connection (primary + secondaries) and resolves account names with a backend → cache → provider-API precedence. Existing single-connection sessions keep working with zero secret migration ([#5430](https://github.com/gitkraken/vscode-gitlens/issues/5430)) (plus/integrations)
- Adds per-connection reads for multi-account integrations — issue/PR search and issue-tracker resource reads (`searchMyIssues`, `searchMyPullRequests`, `searchPullRequests`, `getIssuesForProject`, `getAccountForResource`, `getResourcesForUser`, `getProjectsForResources`) accept an optional `connectionId` that reads with that specific connection's token instead of the provider's primary (mirrors the `gk` CLI's `--connection`); omitting it preserves the existing primary behavior ([#5430](https://github.com/gitkraken/vscode-gitlens/issues/5430)) (plus/integrations)
- Adds a lightweight, token-scoped entry point `createTokenScopedGitHostIntegration` at `plus/integrations/lite.js` — fetches `RepositoryMetadata` and `DefaultBranch` for GitHub, GitLab, Bitbucket, and Azure DevOps from just an access token + a `fetch`, without constructing an `IntegrationServiceContext` or running any session/OAuth lifecycle (plus/integrations)
- Adds `getRepositoryMetadata` and `getDefaultBranch` to the Bitbucket and Azure DevOps API clients (plus/integrations)
- Adds a neutral pagination + warning result model to the public API — `ProviderResult`, `ProviderPagedResult`, `ProviderSweepResult`, `ProviderBroadenResult`, `ProviderPageInfo`, `ProviderWarning`, and the repository-resolution types (`RepositoryResolution`, `RepositoryIdentity`, `ResolveRepositoryResult`) — carrying no `@gitkraken/provider-apis` types so consumers depend only on `@gitkraken/core-gitlens`. Git-host read cores now recover thrown errors into a result wrapper (`getMyIssuesForReposResult`/`getMyPullRequestsForReposResult`/`getOrganizationsForUserResult`/`getRepositoriesForOrgResult`) so callers can surface per-provider warnings instead of silently getting `undefined` ([#5438](https://github.com/gitkraken/vscode-gitlens/issues/5438)) (plus/integrations)
- Adds generic discovery + page-oriented reads on `IntegrationService` — `listOrgs`, `listProjects`, `listRepos`, `listPullRequestsPage`, and `listIssuesPage` return the neutral paginated/warning wrapper, translate a 1-based `page` to the provider's opaque cursor (surfacing a raw `cursor` only for cursor-only hosts), and capture per-provider read failures as `ProviderWarning`s instead of throwing ([#5438](https://github.com/gitkraken/vscode-gitlens/issues/5438)) (plus/integrations)
- Adds `IntegrationService.sweepPullRequests` (all-pages drain across providers, with `truncated`/`fetchFailed` signals) plus a `sweepClosedPullRequests` convenience (closed + merged), and `broadenIssues` (per-org issue fan-out that isolates a failing org into a warning and reports `broadenedProviderIds` + `fanOutCount`); adds an `includeAllAssignees` option that broadens issue reads past assigned-to-me and a `forceSync` option that forces a session refresh before a primary-connection read ([#5438](https://github.com/gitkraken/vscode-gitlens/issues/5438)) (plus/integrations)
- Adds `IntegrationService.resolveRepository`, which resolves a remote URL to its provider repository identity across every git host (`getRepoInfo` is now implemented for GitHub/GitHub Enterprise/GitLab self-hosted/Bitbucket Cloud, alongside the existing GitLab/Bitbucket Server/Azure); it returns a neutral resolution status (`resolved`/`not-found`/`error`/`no-connection`/`unsupported`) and never throws ([#5438](https://github.com/gitkraken/vscode-gitlens/issues/5438)) (plus/integrations)
- Adds Trello as a real issue integration — a `TrelloIntegration` (boards as resources/projects, board issues mapped to the shared issue shape), the Trello provider-API client wiring, cloud auth via the shared provider (the app key from the token exchange is carried on the session), the `gl-provider-trello` glyph, and Trello in the supported cloud-integration descriptors/lists ([#5438](https://github.com/gitkraken/vscode-gitlens/issues/5438)) (plus/integrations)

### Fixed

- Fixes GitLab self-hosted repo-scoped reads (issues and pull requests) 404ing &mdash; `getSelfManagedApiBaseUrl` was producing a URL with a redundant `/api` segment, which then caused the provider SDK to double-append its own path; it now correctly strips these segments so the final request URL is correct ([#5526](https://github.com/gitkraken/vscode-gitlens/issues/5526)) (plus/integrations)

### Changed

- Normalizes the pull-request and repository item types on the ProviderBackend surface so consumers no longer depend on `@gitkraken/provider-apis` types (matching how issues already surface `IssueShape`): `IntegrationService.listPullRequestsPage`/`sweepPullRequests`/`sweepClosedPullRequests` now return the GitLens-owned `PullRequestShape` and `listRepos` returns the new GitLens-owned `ProviderRepositoryShape`; the raw provider-apis PR/repo/account/issue types are no longer re-exported from the `@gitlens/integrations` facade ([#5533](https://github.com/gitkraken/vscode-gitlens/issues/5533)) (plus/integrations)
- Decouples the `GitLabApi`, `BitbucketApi`, and `AzureDevOpsApi` clients from `IntegrationServiceContext`, taking a narrow `ProviderApiConfig` instead (mirroring `GitHubApiConfig`); the manager wires them via new `createGitLabApi`/`createBitbucketApi`/`createAzureDevOpsApi` factories (plus/integrations)

## [0.4.0] - 2026-06-30

### Added

- Adds the `@gitlens/integrations` package to the bundle under `plus/integrations/*` — rich Git host & issue-tracker integration primitives (GitHub, GitLab, Bitbucket, Bitbucket Server, Azure) plus `authentication`, `models`, `providers`, and `utils` subpaths (plus/integrations)

## [0.3.1] - 2026-06-19

### Fixed

- Fixes `push`, `fetch`, `pull`, `reset`, `checkout`, and `restore` resolving as success when the git command actually failed with output matching a `GitWarnings` pattern (e.g. a non-fast-forward `tipBehind` push rejection, an unreachable remote, or an invalid ref/revision) — the rejection was swallowed by the default handler and the typed-error mapping was unreachable; these now reject with the correct error (`PushError`/`FetchError`/`PullError`/`ResetError`/`CheckoutError`) (git-cli)

## [0.3.0] - 2026-05-27

### Added

- Adds the `@gitlens/ipc` package to the bundle under `ipc/*` — shared IPC service consolidating CLI and agent IPC (ipc)
- Adds the `@gitlens/agents` package to the bundle under `plus/agents/*` (plus/agents)

## [0.2.0] - 2026-05-01

### Added

- Adds sub-provider methods: `commit`, `getParsedDiff`, `createStash`, `stageAll`, `unstageAll`, `validateRepo`; SHA + index-restore on `applyStash`; `untracked` option on existence and diff queries (git, plus/git-github)
- Adds a `'lastFetched'` change type, `onCurrentBranchAgentActivity`, `BranchMetadata.agentLastActivityAt`, and `branch.<name>.gk-agent-last-activity` config (git)
- Adds `LruMap`, `compareByVersion`/`compareByVersionDescending`, and a `quiet` option on `exec` (utils)
- Adds `AbortSignal` cancellation in the git-cli command queue and signing-error handling — `classifySigningError`, `SigningError`, `hooks.commits.onSigningFailed`, `source?` — on `commit`/`merge`/`pull`/`rebase`/`revert`/`cherryPick` (git, git-cli)

### Changed

- `merge`/`rebase`/`cherryPick`/`revert` return structured results with affected files; diff queries parse `--numstat` + `--summary` via `parseDiffNumStatAndSummary` (git)
- Improves caching: tiered TTLs (~5 min SHAs / ~60 s refs), lazy stash parent-timestamp cache, tiered branch-overview cache, parallel merge-base / contributor fetches, soft-invalidation + aggregate `AbortSignal` in `PromiseCache` (git, git-cli, utils, plus/git-github)
- Coalesces working-tree change events on `Repository`; expands graph reachability to local + remote branches + tags (git)
- Tightens filtering: stash reachability via git's branch metadata, untracked excluded from non-HEAD diffs, merge-base skipped when local matches upstream SHA (git-cli)

### Fixed

- Fixes corrupted output in async `Formatter` calls (utils)

## [0.1.0]

### Added

- Initial release. Bundles `@gitlens/utils`, `@gitlens/git`, `@gitlens/git-cli`, `@gitlens/ai`, and `@gitlens/git-github` into a single core npm package with subpath exports.

[unreleased]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.4.0...HEAD
[0.4.0]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.3.1...gitkraken:releases/core/v0.4.0
[0.3.1]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.3.0...gitkraken:releases/core/v0.3.1
[0.3.0]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.2.0...gitkraken:releases/core/v0.3.0
[0.2.0]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.1.0...gitkraken:releases/core/v0.2.0
[0.1.0]: https://github.com/gitkraken/vscode-gitlens/releases/tag/releases/core/v0.1.0
