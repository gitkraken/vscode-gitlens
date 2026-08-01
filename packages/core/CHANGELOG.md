# Change Log

All notable changes to `@gitkraken/core-gitlens` will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this project adheres to [Semantic Versioning](http://semver.org/).

## [Unreleased]

## [0.5.101] - 2026-08-02

### Added

- Adds structured detail to the warnings raised from provider collection metadata — requires `@gitkraken/provider-apis` 0.55.0. A GitHub search that hits the 1,000-result cap now warns with the figures it was given (`Search (repository acme/web) matched 1393 results, but the provider exposes at most 1000`) instead of the fixed `Some results were omitted; the read is incomplete`, and the SDK's other two omission kinds (`recovery-budget`, `pagination-incomplete`) each get their own message, scoped to the repository/project the SDK attributes them to. An omission never sets `fetchFailed`: the request succeeded, so retrying returns the same truncated set — only a structured failure means the read broke. Note 0.55.0 also RECOVERS past the cap (it partitions an over-limit multi-repo search by repository, then bisects `updated:` windows), so the common over-cap read now returns complete and raises no warning at all (plus/integrations)

### Changed

- Collapses repeated collection omissions per kind and scope, keeping the highest reported total, mirroring the SDK's own dedupe. GitHub recomputes its match total on every request, so a repository drained over several pages reports the same cap with a drifting count; without this the consumer got a near-identical warning per page that message-level dedupe could not collapse (plus/integrations)
- Truncation is now derived from one predicate, `isIncompleteCollection`, shared by the facade assessment and `getPagedResult`. Both computed it independently before, so a single metadata object could be reported as truncated by one and complete by the other (plus/integrations)

### Fixed

- Fixes a GitHub pull-request search dropping the pages it had already collected when a later page came back empty — the drain returned `[]` instead of the accumulated results (plus/git-github)
- Fixes `GitHubPullRequestLite.body` being typed as non-nullable when GitHub's schema returns `null` for it; the mapped `PullRequest.body` now degrades to `undefined` rather than carrying a `null` typed as `string` (plus/git-github)
- Fixes Trello's project-scoped issue read dropping the SDK collection metadata it had already computed, so a partial Trello search reached the facade with its truncation signal but no structured detail (plus/integrations)

## [0.5.100] - 2026-07-31

### Changed

- **Breaking (git)** — `GitGraphRowHead.worktreeId` is removed; `worktree` now carries `isDefault` instead. Consumers asking "is this branch checked out somewhere other than here?" must test `worktree != null && !worktree.isDefault` rather than reading `worktreeId`. `GitGraphRowType` is renamed to `GitGraphRowKind`, and the row field carrying it from `type` to `kind`, adopting the commit-graph engine's own vocabulary — `'commit' | 'merge' | 'stash' | 'workdir'`, replacing `'commit-node' | 'merge-node' | 'stash-node' | 'work-dir-changes'` — and drops the never-produced `merge-conflict-node` and `unsupported-rebase-warning-node` members; `GitGraphRowContexts` drops eight slots no producer wrote (`ref`, `graph`, `avatar`, `message`, `author`, `date`, `sha`, `stats`) (git)
- **Breaking (git)** — `graphSessionSnapshotVersion` is now `7`; snapshots written by earlier versions are discarded on restore, because the persisted row shape changed with `worktree.isDefault`, again with the row-kind rename, and again when the per-ref `context` slots were removed (git)
- **Breaking (git)** — `GitGraphRowHead`, `GitGraphRowRemoteHead` and `GitGraphRowTag` drop their `context?: string | object` slot. The graph no longer ships a serialized webview-item context per ref per row; consumers that read those strings must build their own from the structured fields. An `id` marks a ref as identifiable and actionable — it does NOT promise complete enrichment, since the CLI settles branch/remote/worktree lookups independently and still stamps ids (git)
- **Breaking (git)** — graph rows now OMIT `heads`/`remotes`/`tags` when empty instead of shipping empty arrays; consumers must treat all three as optional (git)

### Added

- Adds structured branch and stash state to graph rows — `GitGraphRowHead.starred` and `GitGraphRowRemoteHead.starred`, `upstream.missing` and `upstream.state { ahead, behind }` on a head's upstream, and `GitGraphRow.stashNumber` (the `{n}` of `stash@{n}`). All optional and populated only by the CLI provider; absent means the producer did not compute it, not a negative value (git)
- Adds an account-wide issue read for GitLab and exposes `includeAllAssignees` on the account-wide seam &amp;mdash; `GitHostIntegration.searchMyIssuesWithTruncationResult`/`IntegrationService.listIssuesPage` now serve GitLab (previously reported as unsupported, since GitLab's issue reads were repo-scoped only) via a new `getIssuesForCurrentUser` REST read (`GET /issues`, open issues only), and honor an `includeAllAssignees` toggle across GitHub (`assignee:@me` → `assignee:*`), GitLab (`scope=all`, no assignee), and Azure DevOps (a single unfiltered per-project drain); requires `@gitkraken/provider-apis` 0.53.0 ([#5535](https://github.com/gitkraken/vscode-gitlens/issues/5535)) (plus/integrations)
- Adds multiple simultaneous connections (multi-account) per provider integration — `ConfiguredIntegrationDescriptor` now carries a stable per-connection `id` (backend `tokenId`) plus `primary`, `type`, and `accountName`; `IntegrationService` gains `setPrimaryConnection`, `deleteConnection`, and `refreshConnections`; cloud sync fans out over every backend connection (primary + secondaries) and resolves account names with a backend → cache → provider-API precedence. Existing single-connection sessions keep working with zero secret migration ([#5430](https://github.com/gitkraken/vscode-gitlens/issues/5430)) (plus/integrations)
- Adds per-connection reads for multi-account integrations — issue/PR search and issue-tracker resource reads (`searchMyIssues`, `searchMyPullRequests`, `searchPullRequests`, `getIssuesForProject`, `getAccountForResource`, `getResourcesForUser`, `getProjectsForResources`) accept an optional `connectionId` that reads with that specific connection's token instead of the provider's primary (mirrors the `gk` CLI's `--connection`); omitting it preserves the existing primary behavior ([#5430](https://github.com/gitkraken/vscode-gitlens/issues/5430)) (plus/integrations)
- Adds a lightweight, token-scoped entry point `createTokenScopedGitHostIntegration` at `plus/integrations/lite.js` — fetches `RepositoryMetadata` and `DefaultBranch` for GitHub, GitLab, Bitbucket, and Azure DevOps from just an access token + a `fetch`, without constructing an `IntegrationServiceContext` or running any session/OAuth lifecycle (plus/integrations)
- Adds `getRepositoryMetadata` and `getDefaultBranch` to the Bitbucket and Azure DevOps API clients (plus/integrations)
- Adds a neutral pagination + warning result model to the public API — `ProviderResult`, `ProviderPagedResult`, `ProviderSweepResult`, `ProviderBroadenResult`, `ProviderPageInfo`, `ProviderWarning`, and the repository-resolution types (`RepositoryResolution`, `RepositoryIdentity`, `ResolveRepositoryResult`) — carrying no `@gitkraken/provider-apis` types so consumers depend only on `@gitkraken/core-gitlens`. Git-host read cores now recover thrown errors into a result wrapper (`getMyIssuesForReposResult`/`getMyPullRequestsForReposResult`/`getOrganizationsForUserResult`/`getRepositoriesForOrgResult`) so callers can surface per-provider warnings instead of silently getting `undefined` ([#5438](https://github.com/gitkraken/vscode-gitlens/issues/5438)) (plus/integrations)
- Adds generic discovery + page-oriented reads on `IntegrationService` — `listOrgs`, `listProjects`, `listRepos`, `listPullRequestsPage`, and `listIssuesPage` return the neutral paginated/warning wrapper, translate a 1-based `page` to the provider's opaque cursor (surfacing a raw `cursor` only for cursor-only hosts), and capture per-provider read failures as `ProviderWarning`s instead of throwing ([#5438](https://github.com/gitkraken/vscode-gitlens/issues/5438)) (plus/integrations)
- Adds `IntegrationService.sweepPullRequests` (all-pages drain across providers, with `truncated`/`fetchFailed` signals) plus a `sweepClosedPullRequests` convenience (closed + merged), and `broadenIssues` (per-org issue fan-out that isolates a failing org into a warning and reports `broadenedProviderIds` + `fanOutCount`); adds an `includeAllAssignees` option that broadens issue reads past assigned-to-me and a `forceSync` option that forces a session refresh before a primary-connection read ([#5438](https://github.com/gitkraken/vscode-gitlens/issues/5438)) (plus/integrations)
- Adds per-provider `targets` to pull-request sweeps so multi-provider reads can select each provider's `connectionId` independently and supply a fallback `domain` for self-managed hosts backed by external/manual authentication; paged pull-request reads accept the same self-managed domain fallback (plus/integrations)
- Adds `IntegrationService.resolveRepository`, which resolves a remote URL to its provider repository identity across every git host (`getRepoInfo` is now implemented for GitHub/GitHub Enterprise/GitLab self-hosted/Bitbucket Cloud, alongside the existing GitLab/Bitbucket Server/Azure); it returns a neutral resolution status (`resolved`/`not-found`/`unauthorized`/`unsupported-provider`/`invalid-remote-url`/`host-mismatch`/`undetermined`) and never throws ([#5438](https://github.com/gitkraken/vscode-gitlens/issues/5438)) (plus/integrations)
- Adds Trello as a real issue integration — a `TrelloIntegration` (boards as resources/projects, board issues mapped to the shared issue shape), the Trello provider-API client wiring, cloud auth via the shared provider (the app key from the token exchange is carried on the session), the `gl-provider-trello` glyph, and Trello in the supported cloud-integration descriptors/lists ([#5438](https://github.com/gitkraken/vscode-gitlens/issues/5438)) (plus/integrations)

### Fixed

- Fixes aggregate GitHub pull-request sweeps timing out on large closed histories by using the lightweight list
  shape (while retaining body and branch refs), and replaces upstream HTML error pages with bounded,
  status-bearing provider warnings (plus/integrations, plus/git-github)
- Adds `incompleteProviderIds` to provider sweep results so consumers can distinguish a wholly failed provider
  from a provider whose returned slice has a mid-read gap or truncation (plus/integrations)
- Fixes account-wide pull-request relationship filtering so every supported provider returns the exact requested
  OR union, with per-target sweep overrides and resumable composite cursors where needed; filtered Bitbucket Data
  Center reads now fail closed if the current account cannot be identified (plus/integrations)
- Fixes provider issue mapping violating its public string-id contract when an upstream issue number is numeric,
  which could crash consumers while broadening issue lists (plus/integrations)
- Fixes incomplete provider reads being reported inconsistently across hosts: GitLab relationship fan-out now
  preserves successful slices when another slice fails, Azure issue deduplication is scoped by organization and
  project, self-managed broaden cursors include the provider domain, page-only repository reads advance opaque
  cursors, and SDK truncation/error metadata survives normalization (plus/integrations)
- Fixes the provider fetch adapter discarding non-success response bodies, which prevented throttled `403`
  responses and partial collection failures from retaining their structured warning kind; issue mapping now also
  preserves repository identity and provider issue type consistently across both public mappers (plus/integrations)
- Fixes bundled source maps pointing at nonexistent `dist/src/*` paths when emitted files were nested more than
  one directory deep; the bundle now rewrites every source depth to the shipped `src/*` tree and fails if a target
  source is absent (core)
- Fixes `resolveRepository` reporting every Azure DevOps Server remote as unsupported even though
  `provider-apis` supports project-scoped repository lookup with a self-managed `baseUrl`; server resolution
  now uses the same Azure route as cloud and preserves the configured host/protocol (plus/integrations)
- Fixes public integration connection management hiding an authoritative refresh failure and accepting a
  `connectionId` owned by another provider for primary/delete mutations; foreground refresh now rejects while
  preserving the last known configuration, and mutations validate provider ownership before reaching the token
  backend (plus/integrations)
- Fixes provider model serialization dropping public fields across IPC/deep-link boundaries: pull requests now
  preserve `number` and `authoredByMe`, and issues preserve `issueType` (git)
- Fixes Bitbucket Data Center reporting issue reads differently from every other host without an issue tracker &mdash; it left `GitHostIntegration.supportsIssues` at its default `true` while registering no issue client, so `listIssuesPage` surfaced the SDK-internal `does not support function: getIssuesForReposFn` as an opaque `kind: 'other'` warning (instead of the `Issues are not supported by …` warning Bitbucket Cloud gives for the same missing capability) and `broadenIssues` drained every repository of an org before failing that way. Both now report the capability as unsupported up front, matching the provider metadata, which already declared no issue filters for it (plus/integrations)
- Fixes `ProviderBroadenOrg` being unreachable for consumers &mdash; `broadenIssues`' `orgs` argument had no nameable type on the public facade (`manager.js` is not a published subpath), forcing a consumer to re-declare the shape and drift from it; it is now re-exported from `plus/integrations/index.js` alongside the other option types (plus/integrations)
- Fixes the ProviderBackend abstraction dropping provider-native pull request/issue fields needed by Kepler (`number`, `authoredByMe`, issue type, repository, and labels), and fixes account-wide numbered-page reads so they advance opaque cursors without losing warnings or collection metadata from earlier pages (git, plus/integrations)
- Fixes `IntegrationService.resolveRepository` misclassifying a nonexistent GitHub/GitLab repository as a generic `error` instead of `not-found` &mdash; those providers' `getRepo` clients are GraphQL, so a missing repo returns HTTP 200 with a null node and the SDK throws an error with no `response.status` (a `GraphQLErrors` for GitHub, a bare `Error` for GitLab) that `ProvidersApi.handleProviderError`'s status-based mapping never recognized. `ProvidersApi.getRepo` now detects the SDK's not-found shapes (GitHub's `NOT_FOUND`-typed GraphQL error, GitLab's `Repository … not found` message) and rethrows them as `RequestNotFoundError` so the resolution reports `not-found` ([#5559](https://github.com/gitkraken/vscode-gitlens/issues/5559)) (plus/integrations)
- Fixes a single failed `ProvidersApi` load permanently disabling every provider-API read &mdash; `IntegrationService` cached the rejected promise, so one failure (a module-resolution error, a transient construction failure) turned all subsequent reads into instant empty results with warnings until the service was recreated; the failed attempt is now discarded so the next caller retries (plus/integrations)
- Fixes `providerOnConnect` rejections escaping as process-level unhandled rejections &mdash; the post-connect hook is fired detached in a microtask with no caller left to catch it, so any provider hiccup during a connection refresh surfaced as an unhandled rejection in the host; it is now caught and logged as a warning (plus/integrations)
- Fixes GitLab self-hosted repo-scoped reads (issues and pull requests) 404ing &mdash; `getSelfManagedApiBaseUrl` was producing a URL with a redundant `/api` segment, which then caused the provider SDK to double-append its own path; it now correctly strips these segments so the final request URL is correct ([#5526](https://github.com/gitkraken/vscode-gitlens/issues/5526)) (plus/integrations)

### Changed

- Adds a consumer-specific `IntegrationManagerContext` whose cache is optional, exports the shared domain
  normalizer from the integrations facade, and removes internal authentication/configuration services from
  the custom-auth hook contract; expands the consumer guide with the exact warning and self-managed Azure
  semantics (plus/integrations, core)
- Separates repo-scoped and account-wide pull-request filter capabilities: repo-scoped filters remain provider
  query constraints, while account-wide filters describe exact independently selectable relationship unions;
  Bitbucket's expensive reviewer expansion remains available through `includeReviewRequested`, and the
  integration consumer guide and parity record now ship in the package tarball under `docs/`
  (plus/integrations, core)
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

[unreleased]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.5.101...HEAD
[0.5.101]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.5.100...gitkraken:releases/core/v0.5.101
[0.5.100]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.5.0...gitkraken:releases/core/v0.5.100
[0.4.0]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.3.1...gitkraken:releases/core/v0.4.0
[0.3.1]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.3.0...gitkraken:releases/core/v0.3.1
[0.3.0]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.2.0...gitkraken:releases/core/v0.3.0
[0.2.0]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.1.0...gitkraken:releases/core/v0.2.0
[0.1.0]: https://github.com/gitkraken/vscode-gitlens/releases/tag/releases/core/v0.1.0
