# Change Log

All notable changes to `@gitkraken/core-gitlens` will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this project adheres to [Semantic Versioning](http://semver.org/).

## [Unreleased]

### Changed

- **Breaking (git)** — `GitGraphRowHead.worktreeId` is removed; `worktree` now carries `isDefault` instead. Consumers asking "is this branch checked out somewhere other than here?" must test `worktree != null && !worktree.isDefault` rather than reading `worktreeId`. `GitGraphRowType` is renamed to `GitGraphRowKind`, and the row field carrying it from `type` to `kind`, adopting the commit-graph engine's own vocabulary — `'commit' | 'merge' | 'stash' | 'workdir'`, replacing `'commit-node' | 'merge-node' | 'stash-node' | 'work-dir-changes'` — and drops the never-produced `merge-conflict-node` and `unsupported-rebase-warning-node` members; `GitGraphRowContexts` drops eight slots no producer wrote (`ref`, `graph`, `avatar`, `message`, `author`, `date`, `sha`, `stats`) (git)
- **Breaking (git)** — `graphSessionSnapshotVersion` is now `7`; snapshots written by earlier versions are discarded on restore, because the persisted row shape changed with `worktree.isDefault`, again with the row-kind rename, and again when the per-ref `context` slots were removed (git)
- **Breaking (git)** — `GitGraphRowHead`, `GitGraphRowRemoteHead` and `GitGraphRowTag` drop their `context?: string | object` slot. The graph no longer ships a serialized webview-item context per ref per row; consumers that read those strings must build their own from the structured fields. An `id` marks a ref as identifiable and actionable — it does NOT promise complete enrichment, since the CLI settles branch/remote/worktree lookups independently and still stamps ids (git)
- **Breaking (git)** — graph rows now OMIT `heads`/`remotes`/`tags` when empty instead of shipping empty arrays; consumers must treat all three as optional (git)

### Added

- Adds structured branch and stash state to graph rows — `GitGraphRowHead.starred` and `GitGraphRowRemoteHead.starred`, `upstream.missing` and `upstream.state { ahead, behind }` on a head's upstream, and `GitGraphRow.stashNumber` (the `{n}` of `stash@{n}`). All optional and populated only by the CLI provider; absent means the producer did not compute it, not a negative value (git)
- Adds multiple simultaneous connections (multi-account) per provider integration — `ConfiguredIntegrationDescriptor` now carries a stable per-connection `id` (backend `tokenId`) plus `primary`, `type`, and `accountName`; `IntegrationService` gains `setPrimaryConnection`, `deleteConnection`, and `refreshConnections`; cloud sync fans out over every backend connection (primary + secondaries) and resolves account names with a backend → cache → provider-API precedence. Existing single-connection sessions keep working with zero secret migration ([#5430](https://github.com/gitkraken/vscode-gitlens/issues/5430)) (plus/integrations)
- Adds per-connection reads for multi-account integrations — issue/PR search and issue-tracker resource reads (`searchMyIssues`, `searchMyPullRequests`, `searchPullRequests`, `getIssuesForProject`, `getAccountForResource`, `getResourcesForUser`, `getProjectsForResources`) accept an optional `connectionId` that reads with that specific connection's token instead of the provider's primary (mirrors the `gk` CLI's `--connection`); omitting it preserves the existing primary behavior ([#5430](https://github.com/gitkraken/vscode-gitlens/issues/5430)) (plus/integrations)
- Adds a lightweight, token-scoped entry point `createTokenScopedGitHostIntegration` at `plus/integrations/lite.js` — fetches `RepositoryMetadata` and `DefaultBranch` for GitHub, GitLab, Bitbucket, and Azure DevOps from just an access token + a `fetch`, without constructing an `IntegrationServiceContext` or running any session/OAuth lifecycle (plus/integrations)
- Adds `getRepositoryMetadata` and `getDefaultBranch` to the Bitbucket and Azure DevOps API clients (plus/integrations)

### Changed

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
