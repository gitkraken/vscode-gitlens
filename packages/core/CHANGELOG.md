# Change Log

All notable changes to `@gitkraken/core-gitlens` will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this project adheres to [Semantic Versioning](http://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-05-27

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

[unreleased]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.3.0...HEAD
[0.3.0]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.2.0...gitkraken:releases/core/v0.3.0
[0.2.0]: https://github.com/gitkraken/vscode-gitlens/compare/releases/core/v0.1.0...gitkraken:releases/core/v0.2.0
[0.1.0]: https://github.com/gitkraken/vscode-gitlens/releases/tag/releases/core/v0.1.0
