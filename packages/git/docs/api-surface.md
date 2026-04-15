# @gitlens/git — API Surface

## Overview

`@gitlens/git` is a standalone Git operations library extracted from GitLens. It runs in plain Node.js with no VS Code dependency. The package uses wildcard exports (no barrel `index.ts`) — every source file is individually importable.

## Quick Start

### Using the service (recommended for multi-repo setups)

```typescript
import { GitService } from '@gitlens/git/service.js';
import { CliGitProvider } from '@gitlens/git-cli/cliGitProvider.js';
import { findGitPath } from '@gitlens/git-cli/exec/locator.js';

const service = GitService.createSingleton();

const provider = new CliGitProvider({
	context: {
		fs: { readFile: ..., stat: ..., readDirectory: ... },
	},
	locator: () => findGitPath(null),
	gitOptions: { gitTimeout: 30000 },
});

// Register provider with routing predicate
service.register(provider, path => true);

// Get repo-scoped facade (created lazily, repoPath auto-injected on all sub-provider calls)
const repo = service.forRepo('/path/to/repo')!;
const branches = await repo.branches.getBranches();
const status = await repo.status.getStatus();

service.dispose();
```

### Using a provider directly (single-repo)

```typescript
import { CliGitProvider } from '@gitlens/git-cli/cliGitProvider.js';
import { findGitPath } from '@gitlens/git-cli/exec/locator.js';

const provider = new CliGitProvider({
	context: {
		fs: { readFile: ..., stat: ..., readDirectory: ... },
	},
	locator: () => findGitPath(null),
	gitOptions: { gitTimeout: 30000 },
});

const branches = await provider.branches.getBranches('/path/to/repo');
const status = await provider.status.getStatus('/path/to/repo');
provider.dispose();
```

> **Note**: `CliGitProviderOptions.context` is `GitServiceContext`. The `fs` field is required; all other context fields are optional.

---

## Entry Points

### Service Layer

| Export                            | Module                 | Purpose                                                   |
| --------------------------------- | ---------------------- | --------------------------------------------------------- |
| `GitService`                      | `service.js`           | Library entry point — provider routing + repo proxy cache |
| `ProvidersChangeEvent`            | `service.js`           | Event payload for provider add/remove                     |
| `ValidateRepoResult`              | `service.js`           | Return shape of `GitService.validateRepo`                 |
| `RepositoryService`               | `repositoryService.js` | Repo-scoped sub-provider facade (repoPath auto-injected)  |
| `SubProviderForRepo<T>`           | `repositoryService.js` | Type utility — removes repoPath from methods              |
| `createSubProviderProxyForRepo()` | `repositoryService.js` | Creates repo-scoped wrapper                               |

`GitService` key members:

- `static createSingleton(watchingProvider?): GitService`
- `register(provider, canHandle): UnifiedDisposable`
- `forRepo(repoUri): RepositoryService | undefined`
- `closeRepo(repoUri): void`
- `validateRepo(pathOrUri): Promise<ValidateRepoResult>` — pre-repo discovery: routes a candidate path to a provider and resolves repo identity (repoPath, gitDir, commonGitDir, superprojectPath) or reports unsafe/invalid. Delegates to `GitConfigSubProvider.getRepositoryInfo` under the hood. For a simple yes/no check, use `(await validateRepo(path)).valid`.
- `getProvider(repoPath): { provider, path } | undefined`
- `getProviders(): Iterable<GitProvider>`
- `hasProviders: boolean`
- `etag: number` — monotonic counter for structural changes
- `watchService: RepositoryWatchService | undefined`
- Events: `onDidChangeProviders`
- `dispose(): void`

`RepositoryService` key members:

- `path: string` — normalized repo root path
- `provider: GitProviderDescriptor`
- `getAbsoluteUri(relativePath): Uri`
- `etagWorkingTree: number | undefined` — filesystem change counter
- All sub-providers with repoPath auto-injected (see Provider Interface)

### `@gitlens/git-cli` — CLI Provider & Git Binary Locator

| Export                        | Module              |
| ----------------------------- | ------------------- |
| `CliGitProvider`              | `cliGitProvider.js` |
| `CliGitProviderOptions`       | `cliGitProvider.js` |
| `CliGitProviderInternal`      | `cliGitProvider.js` |
| `findGitPath(paths, search?)` | `exec/locator.js`   |
| `GitLocation`                 | `exec/locator.js`   |
| `UnableToFindGitError`        | `exec/locator.js`   |
| `InvalidGitConfigError`       | `exec/locator.js`   |
| `Git`                         | `exec/git.js`       |
| `GitOptions`                  | `exec/git.js`       |
| `GitHooks`                    | `exec/git.js`       |
| `GitQueue`                    | `exec/gitQueue.js`  |

`CliGitProviderOptions`:

```typescript
interface CliGitProviderOptions {
	context: GitServiceContext; // required
	locator: () => Promise<GitLocation>; // required — resolves git binary
	gitOptions?: GitOptions; // timeout, trust, queue config, hooks, etc.
	git?: Git; // pre-built Git executor (used instead of creating from locator/options)
	cache?: Cache; // reuse existing cache instance
}
```

### Context & Events

| Export                  | Module       |
| ----------------------- | ------------ |
| `GitServiceContext`     | `context.js` |
| `GitServiceConfig`      | `context.js` |
| `GitServiceHooks`       | `context.js` |
| `RemoteProviderContext` | `context.js` |
| `RemotesProvider`       | `context.js` |
| `WorkspaceProvider`     | `context.js` |
| `SearchQueryProvider`   | `context.js` |
| `FileSystemProvider`    | `context.js` |
| `FileStat`              | `context.js` |
| `FileType`              | `context.js` |
| `GitConflictCommand`    | `context.js` |

`GitServiceContext` fields:

- **`fs: FileSystemProvider`** — **required** (`readFile`, `stat`, `readDirectory`)
- `config?: GitServiceConfig` — default values for sub-provider options
- `hooks?: GitServiceHooks` — outbound hooks (`cache.onReset`, `repository.onChanged`, `commits.onSigned`, etc.)
- `remotes?: RemotesProvider` — host-side remote capabilities (`getCustomProviders?`, `getRepositoryInfo?`, `sort?`)
- `searchQuery?: SearchQueryProvider` — `preprocessQuery?` for NLP → structured search
- `workspace?: WorkspaceProvider` — `getFolder`, `isTrusted`, `onDidChangeTrust`, `getWorktreeDefaultUri?`

### Provider Types

| Export                              | Module                  |
| ----------------------------------- | ----------------------- |
| `GitProviderDescriptor`             | `providers/types.js`    |
| `GitProviderId`                     | `providers/types.js`    |
| `DiffRange`                         | `providers/types.js`    |
| `RevisionUri`                       | `providers/types.js`    |
| `ResolvedRevision`                  | `providers/revision.js` |
| `LeftRightCommitCountResult`        | `providers/commits.js`  |
| `SearchCommitsResult`               | `providers/commits.js`  |
| `GitLogOptions`                     | `providers/commits.js`  |
| `GitLogForPathOptions`              | `providers/commits.js`  |
| `GitLogShasOptions`                 | `providers/commits.js`  |
| `GitSearchCommitsOptions`           | `providers/commits.js`  |
| `IncomingActivityOptions`           | `providers/commits.js`  |
| `NextComparisonUrisResult`          | `providers/diff.js`     |
| `PreviousComparisonUrisResult`      | `providers/diff.js`     |
| `PreviousRangeComparisonUrisResult` | `providers/diff.js`     |
| `BranchContributionsOverview`       | `providers/branches.js` |
| `GitBranchMergedStatus`             | `providers/branches.js` |
| `GitConfigKeys`                     | `providers/config.js`   |
| `GkConfigKeys`                      | `providers/config.js`   |
| `GitConfigType`                     | `providers/config.js`   |
| `GitWorkingChangesState`            | `providers/status.js`   |
| `DisposableTemporaryGitIndex`       | `providers/staging.js`  |

---

## Provider Interface

| Export                  | Module                                                          |
| ----------------------- | --------------------------------------------------------------- |
| `GitProvider`           | `providers/provider.js`                                         |
| `GitProviderDescriptor` | `providers/provider.js` (re-exported from `providers/types.js`) |

`GitProvider` groups all sub-providers. Core (required) vs optional:

```
Required:  branches  commits  config  contributors  diff  graph
           refs  remotes  revision  status  tags

Optional:  blame  ops  patch  pausedOps
           staging  stash  worktrees
```

Also on `GitProvider`:

- `descriptor: GitProviderDescriptor` (`id: 'git' | 'github' | 'vsls'`, `name`, `virtual`)
- URI helpers: `getAbsoluteUri()`, `getRelativePath()`
- Optional repo methods: `excludeIgnoredUris?`, `getIgnoreFilter?`, `getIgnoredUrisFilter?`, `getLastFetchedTimestamp?`

---

## Sub-Provider Interfaces

Each sub-provider interface is defined in its own file under `providers/`:

| Interface                        | Module                          | Also Exports               |
| -------------------------------- | ------------------------------- | -------------------------- |
| `GitBlameSubProvider`            | `providers/blame.js`            | `GitBlameOptions`          |
| `GitBranchesSubProvider`         | `providers/branches.js`         | `MergeDetectionConfidence` |
| `GitCommitsSubProvider`          | `providers/commits.js`          | `GitCommitReachability`    |
| `GitConfigSubProvider`           | `providers/config.js`           |                            |
| `GitContributorsSubProvider`     | `providers/contributors.js`     | `GitContributorsResult`    |
| `GitDiffSubProvider`             | `providers/diff.js`             |                            |
| `GitGraphSubProvider`            | `providers/graph.js`            |                            |
| `GitOperationsSubProvider`       | `providers/operations.js`       | `GitOperationResult`       |
| `GitPatchSubProvider`            | `providers/patch.js`            |                            |
| `GitPausedOperationsSubProvider` | `providers/pausedOperations.js` |                            |
| `GitRefsSubProvider`             | `providers/refs.js`             |                            |
| `GitRemotesSubProvider`          | `providers/remotes.js`          |                            |
| `GitRevisionSubProvider`         | `providers/revision.js`         |                            |
| `GitStagingSubProvider`          | `providers/staging.js`          |                            |
| `GitStashSubProvider`            | `providers/stash.js`            | `StashApplyResult`         |
| `GitStatusSubProvider`           | `providers/status.js`           |                            |
| `GitTagsSubProvider`             | `providers/tags.js`             |                            |
| `GitWorktreesSubProvider`        | `providers/worktrees.js`        |                            |

### GitBranchesSubProvider

| Method                                                                               | Returns                                    |
| ------------------------------------------------------------------------------------ | ------------------------------------------ |
| `getBranch(repoPath, name?, cancellation?)`                                          | `GitBranch \| undefined`                   |
| `getBranches(repoPath, options?, cancellation?)`                                     | `PagedResult<GitBranch>`                   |
| `getBranchContributionsOverview(repoPath, ref, options?, cancellation?)`             | `BranchContributionsOverview \| undefined` |
| `getBranchesWithCommits(repoPath, shas, branch?, options?, cancellation?)`           | `string[]`                                 |
| `getDefaultBranchName(repoPath, remote?, cancellation?)`                             | `string \| undefined`                      |
| `createBranch?(repoPath, name, ref, options?)`                                       | `void`                                     |
| `deleteLocalBranch?(repoPath, names, options?)`                                      | `void`                                     |
| `deleteRemoteBranch?(repoPath, names, remote)`                                       | `void`                                     |
| `getBranchMergedStatus?(repoPath, branch, into, cancellation?)`                      | `GitBranchMergedStatus`                    |
| `getCurrentBranchReference?(repoPath, cancellation?)` _(internal)_                   | `GitBranchReference \| undefined`          |
| `getLocalBranchByUpstream?(repoPath, remoteBranchName, cancellation?)`               | `GitBranch \| undefined`                   |
| `getPotentialApplyConflicts?(repoPath, targetBranch, shas, options?, cancellation?)` | `ConflictDetectionResult`                  |
| `getPotentialMergeConflicts?(repoPath, branch, targetBranch, cancellation?)`         | `ConflictDetectionResult`                  |
| `getBaseBranchName?(repoPath, ref, cancellation?)`                                   | `string \| undefined`                      |
| `getStoredMergeTargetBranchName?(repoPath, ref)`                                     | `string \| undefined`                      |
| `getStoredDetectedMergeTargetBranchName?(repoPath, ref)`                             | `string \| undefined`                      |
| `getStoredUserMergeTargetBranchName?(repoPath, ref)`                                 | `string \| undefined`                      |
| `onCurrentBranchAccessed?(repoPath)`                                                 | `void`                                     |
| `onCurrentBranchModified?(repoPath)`                                                 | `void`                                     |
| `onCurrentBranchAgentActivity?(repoPath)`                                            | `void`                                     |
| `renameBranch?(repoPath, oldName, newName)`                                          | `void`                                     |
| `setUpstreamBranch?(repoPath, name, upstream)`                                       | `void`                                     |
| `setBranchDisposition?(repoPath, branchName, disposition)`                           | `void`                                     |
| `storeBaseBranchName?(repoPath, ref, base)`                                          | `void`                                     |
| `storeMergeTargetBranchName?(repoPath, ref, target)`                                 | `void`                                     |
| `storeUserMergeTargetBranchName?(repoPath, ref, target)`                             | `void`                                     |

### GitCommitsSubProvider

| Method                                                                             | Returns                                   |
| ---------------------------------------------------------------------------------- | ----------------------------------------- |
| `getCommit(repoPath, rev, cancellation?)`                                          | `GitCommit \| undefined`                  |
| `getCommitCount(repoPath, rev, cancellation?)`                                     | `number \| undefined`                     |
| `getCommitFiles(repoPath, rev, cancellation?)`                                     | `GitFileChange[]`                         |
| `getCommitForFile(repoPath, pathOrUri, rev?, options?, cancellation?)`             | `GitCommit \| undefined`                  |
| `getLeftRightCommitCount(repoPath, range, options?, cancellation?)`                | `LeftRightCommitCountResult \| undefined` |
| `getLog(repoPath, rev?, options?, cancellation?)`                                  | `GitLog \| undefined`                     |
| `getLogForPath(repoPath, pathOrUri, rev?, options?, cancellation?)`                | `GitLog \| undefined`                     |
| `getLogShas(repoPath, rev?, options?, cancellation?)`                              | `Iterable<string>`                        |
| `getOldestUnpushedShaForPath(repoPath, pathOrUri, cancellation?)`                  | `string \| undefined`                     |
| `isAncestorOf(repoPath, rev1, rev2, cancellation?)`                                | `boolean`                                 |
| `hasCommitBeenPushed(repoPath, rev, cancellation?)`                                | `boolean`                                 |
| `searchCommits(repoPath, search, options?, cancellation?)`                         | `SearchCommitsResult`                     |
| `getIncomingActivity?(repoPath, options?, cancellation?)`                          | `GitReflog \| undefined`                  |
| `getInitialCommitSha?(repoPath, cancellation?)`                                    | `string \| undefined`                     |
| `createUnreachableCommitFromTree?(repoPath, tree, parent, message, cancellation?)` | `string`                                  |
| `getCommitReachability?(repoPath, rev, cancellation?)`                             | `GitCommitReachability \| undefined`      |
| `getCommitSignature?(repoPath, sha)`                                               | `CommitSignature \| undefined`            |
| `isCommitSigned?(repoPath, sha)`                                                   | `boolean`                                 |

### GitConfigSubProvider

| Method                                          | Returns                |
| ----------------------------------------------- | ---------------------- |
| `getCurrentUser(repoPath)`                      | `GitUser \| undefined` |
| `getConfig?(repoPath, key, options?)`           | `string \| undefined`  |
| `getConfigRegex?(repoPath, pattern, options?)`  | `Map<string, string>`  |
| `setConfig?(repoPath, key, value, options?)`    | `void`                 |
| `getGitDir?(repoPath)`                          | `GitDir \| undefined`  |
| `getDefaultWorktreePath?(repoPath)`             | `string \| undefined`  |
| `getRepositoryInfo?(cwd)`                       | `Promise<...>`         |
| `getGkConfig?(repoPath, key, options?)`         | `string \| undefined`  |
| `getGkConfigRegex?(repoPath, pattern)`          | `Map<string, string>`  |
| `setGkConfig?(repoPath, key, value)`            | `void`                 |
| `getSigningConfig?(repoPath)`                   | `SigningConfig`        |
| `getSigningConfigFlags?(config)`                | `string[]`             |
| `setSigningConfig?(repoPath, config, options?)` | `void`                 |
| `validateSigningSetup?(repoPath)`               | `ValidationResult`     |

### GitContributorsSubProvider

| Method                                                               | Returns                             |
| -------------------------------------------------------------------- | ----------------------------------- |
| `getContributors(repoPath, rev?, options?, cancellation?, timeout?)` | `GitContributorsResult`             |
| `getContributorsLite(repoPath, rev?, options?, cancellation?)`       | `GitContributor[]`                  |
| `getContributorsStats(repoPath, options?, cancellation?, timeout?)`  | `GitContributorsStats \| undefined` |

### GitDiffSubProvider

| Method                                                                                          | Returns                                          |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `getChangedFilesCount(repoPath, to?, from?, options?, cancellation?)`                           | `GitDiffShortStat \| undefined`                  |
| `getDiff?(repoPath, to, from?, options?, cancellation?)`                                        | `GitDiff \| undefined`                           |
| `getDiffFiles?(repoPath, contents, cancellation?)`                                              | `GitDiffFiles \| undefined`                      |
| `getDiffStatus(repoPath, ref1OrRange, ref2?, options?)`                                         | `GitFile[] \| undefined`                         |
| `getParsedDiff?(repoPath, to, from?, options?, cancellation?)`                                  | `ParsedGitDiff \| undefined`                     |
| `getDiffTool?(repoPath?)`                                                                       | `string \| undefined`                            |
| `getNextComparisonUris(repoPath, pathOrUri, rev, skip?, options?, cancellation?)`               | `NextComparisonUrisResult \| undefined`          |
| `getPreviousComparisonUris(repoPath, pathOrUri, rev, skip?, unsaved?, options?, cancellation?)` | `PreviousComparisonUrisResult \| undefined`      |
| `getPreviousComparisonUrisForRange(repoPath, pathOrUri, rev, range, options?, cancellation?)`   | `PreviousRangeComparisonUrisResult \| undefined` |
| `openDiffTool?(repoPath, pathOrUri, options?)`                                                  | `void`                                           |
| `openDirectoryCompare?(repoPath, ref1, ref2?, tool?)`                                           | `void`                                           |
| `getDiffForFile?(repoPath, path, ref1, ref2?, options?)`                                        | `ParsedGitDiffHunks \| undefined`                |
| `getDiffForFileContents?(repoPath, path, ref, contents, options?)`                              | `ParsedGitDiffHunks \| undefined`                |

`getParsedDiff` returns the fully parsed multi-file shape (each `ParsedGitDiffFile` has status + hunks). For rendering-friendly line ordering, split each `hunk.content` on newlines and read the `+`/`-`/` ` prefix on each line.

### GitGraphSubProvider

| Method                                                                            | Returns                                                  |
| --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `getGraph(repoPath, rev, options?, cancellation?)`                                | `GitGraph`                                               |
| `searchGraph(repoPath, search, options?, cancellation?)`                          | `AsyncGenerator<GitGraphSearchProgress, GitGraphSearch>` |
| `continueSearchGraph(repoPath, cursor, existingResults, options?, cancellation?)` | `AsyncGenerator<GitGraphSearchProgress, GitGraphSearch>` |

### GitOperationsSubProvider

| Method                                 | Returns              |
| -------------------------------------- | -------------------- |
| `checkout(repoPath, ref, options?)`    | `void`               |
| `cherryPick(repoPath, revs, options?)` | `GitOperationResult` |
| `commit(repoPath, message, options?)`  | `void`               |
| `fetch(repoPath, options?)`            | `void`               |
| `merge(repoPath, ref, options?)`       | `GitOperationResult` |
| `pull(repoPath, options?)`             | `void`               |
| `push(repoPath, options?)`             | `void`               |
| `rebase(repoPath, upstream, options?)` | `GitOperationResult` |
| `reset(repoPath, rev, options?)`       | `void`               |
| `revert(repoPath, refs, options?)`     | `GitOperationResult` |

`GitOperationResult` (exported from `providers/operations.js`): `{ readonly conflicted: boolean; readonly conflicts?: GitConflictFile[] }`. Merge/rebase/cherry-pick/revert now return this shape — conflicts are returned (not thrown); hard failures (aborted, uncommittedChanges, alreadyInProgress, etc.) still throw.

> Note: `clone` is on `GitProvider` directly (not on this sub-provider) — see Provider Interface above.

### GitPausedOperationsSubProvider

| Method                                              | Returns                                 |
| --------------------------------------------------- | --------------------------------------- |
| `getPausedOperationStatus(repoPath, cancellation?)` | `GitPausedOperationStatus \| undefined` |
| `abortPausedOperation(repoPath, options?)`          | `void`                                  |
| `continuePausedOperation(repoPath, options?)`       | `void`                                  |

### GitPatchSubProvider

| Method                                                                      | Returns                  |
| --------------------------------------------------------------------------- | ------------------------ |
| `apply(repoPath, patch, options?)`                                          | `void`                   |
| `applyUnreachableCommitForPatch(repoPath, rev, options?)`                   | `void`                   |
| `createUnreachableCommitForPatch(repoPath, base, message, patch, options?)` | `GitCommit \| undefined` |
| `createUnreachableCommitsFromPatches(repoPath, base, patches, options?)`    | `string[]`               |
| `createEmptyInitialCommit(repoPath)`                                        | `string`                 |
| `validatePatch(repoPath, contents)`                                         | `boolean`                |

### GitRefsSubProvider

| Method                                                           | Returns                     |
| ---------------------------------------------------------------- | --------------------------- |
| `checkIfCouldBeValidBranchOrTagName(repoPath, ref)`              | `boolean`                   |
| `getMergeBase(repoPath, ref1, ref2, options?, cancellation?)`    | `string \| undefined`       |
| `getReference(repoPath, ref, cancellation?)`                     | `GitReference \| undefined` |
| `getSymbolicReferenceName?(repoPath, ref, cancellation?)`        | `string \| undefined`       |
| `hasBranchOrTag(repoPath, options?, cancellation?)`              | `boolean`                   |
| `isValidReference(repoPath, ref, pathOrUri?, cancellation?)`     | `boolean`                   |
| `validateReference(repoPath, ref, relativePath?, cancellation?)` | `string \| undefined`       |
| `updateReference(repoPath, ref, newRef, cancellation?)`          | `void`                      |

### GitRemotesSubProvider

| Method                                                       | Returns                                  |
| ------------------------------------------------------------ | ---------------------------------------- |
| `getRemote(repoPath, name, cancellation?)`                   | `GitRemote \| undefined`                 |
| `getRemotes(repoPath, options?, cancellation?)`              | `GitRemote[]`                            |
| `getDefaultRemote(repoPath, cancellation?)`                  | `GitRemote \| undefined`                 |
| `getRemotesWithProviders(repoPath, options?, cancellation?)` | `GitRemote<RemoteProvider>[]`            |
| `getBestRemoteWithProvider(repoPath, cancellation?)`         | `GitRemote<RemoteProvider> \| undefined` |
| `getBestRemotesWithProviders(repoPath, cancellation?)`       | `GitRemote<RemoteProvider>[]`            |
| `addRemote?(repoPath, name, url, options?)`                  | `void`                                   |
| `addRemoteWithResult?(repoPath, name, url, options?)`        | `GitRemote \| undefined`                 |
| `pruneRemote?(repoPath, name)`                               | `void`                                   |
| `removeRemote?(repoPath, name)`                              | `void`                                   |
| `setRemoteAsDefault(repoPath, name, value?)`                 | `void`                                   |

### GitRevisionSubProvider

| Method                                         | Returns                     |
| ---------------------------------------------- | --------------------------- |
| `getRevisionContent(repoPath, path, rev)`      | `Uint8Array \| undefined`   |
| `getTrackedFiles(repoPath)`                    | `string[]`                  |
| `getTreeEntryForRevision(repoPath, path, rev)` | `GitTreeEntry \| undefined` |
| `getTreeForRevision(repoPath, rev)`            | `GitTreeEntry[]`            |
| `resolveRevision(repoPath, ref, pathOrUri?)`   | `ResolvedRevision`          |
| `exists?(repoPath, path, revOrOptions?)`       | `boolean`                   |
| `getSubmoduleHead?(repoPath, submodulePath)`   | `string \| undefined`       |

### GitStagingSubProvider

| Method                                                       | Returns                       |
| ------------------------------------------------------------ | ----------------------------- |
| `createTemporaryIndex(repoPath, from: 'empty' \| 'current')` | `DisposableTemporaryGitIndex` |
| `createTemporaryIndex(repoPath, from: 'ref', ref)`           | `DisposableTemporaryGitIndex` |
| `stageFile(repoPath, pathOrUri)`                             | `void`                        |
| `stageFiles(repoPath, pathsOrUris, options?)`                | `void`                        |
| `stageDirectory(repoPath, directoryOrUri)`                   | `void`                        |
| `unstageFile(repoPath, pathOrUri)`                           | `void`                        |
| `unstageFiles(repoPath, pathsOrUris)`                        | `void`                        |
| `unstageDirectory(repoPath, directoryOrUri)`                 | `void`                        |

### GitStashSubProvider

| Method                                                        | Returns                 |
| ------------------------------------------------------------- | ----------------------- |
| `applyStash(repoPath, stashNameOrSha, options?)`              | `StashApplyResult`      |
| `createStash(repoPath, message?)`                             | `string \| undefined`   |
| `getStash(repoPath, options?, cancellation?)`                 | `GitStash \| undefined` |
| `getStashCommitFiles(repoPath, ref, options?, cancellation?)` | `GitFileChange[]`       |
| `deleteStash(repoPath, stashName, sha?)`                      | `void`                  |
| `renameStash(repoPath, stashName, sha, message, stashOnRef?)` | `void`                  |
| `saveStash(repoPath, message?, pathsOrUris?, options?)`       | `void`                  |
| `saveSnapshot(repoPath, message?)`                            | `void`                  |

`applyStash` accepts `stash@{N}` or a raw SHA (e.g. from `createStash`). Options: `deleteAfter` (pop instead of apply — requires `stash@{N}`; git rejects pop-by-SHA), `index` (restore the index state).

`StashApplyResult` (exported from `providers/stash.js`): `{ readonly conflicted: boolean }`

### GitStatusSubProvider

| Method                                                            | Returns                        |
| ----------------------------------------------------------------- | ------------------------------ |
| `getStatus(repoPath, cancellation?)`                              | `GitStatus \| undefined`       |
| `getStatusForFile?(repoPath, pathOrUri, options?, cancellation?)` | `GitStatusFile \| undefined`   |
| `getStatusForPath?(repoPath, pathOrUri, options?, cancellation?)` | `GitStatusFile[] \| undefined` |
| `hasWorkingChanges(repoPath, options?, cancellation?)`            | `boolean`                      |
| `getWorkingChangesState(repoPath, cancellation?)`                 | `GitWorkingChangesState`       |
| `hasConflictingFiles(repoPath, cancellation?)`                    | `boolean`                      |
| `getConflictingFiles(repoPath, cancellation?)`                    | `GitConflictFile[]`            |
| `getUntrackedFiles(repoPath, cancellation?)`                      | `GitFile[]`                    |

### GitTagsSubProvider

| Method                                                      | Returns               |
| ----------------------------------------------------------- | --------------------- |
| `getTag(repoPath, name, cancellation?)`                     | `GitTag \| undefined` |
| `getTags(repoPath, options?, cancellation?)`                | `PagedResult<GitTag>` |
| `getTagsWithCommit(repoPath, sha, options?, cancellation?)` | `string[]`            |
| `createTag?(repoPath, name, sha, message?)`                 | `void`                |
| `deleteTag?(repoPath, name)`                                | `void`                |

### GitWorktreesSubProvider

| Method                                               | Returns                    |
| ---------------------------------------------------- | -------------------------- |
| `getWorktree(repoPath, predicate, cancellation?)`    | `GitWorktree \| undefined` |
| `getWorktrees(repoPath, cancellation?)`              | `GitWorktree[]`            |
| `getWorktreesDefaultUri(repoPath)`                   | `Uri \| undefined`         |
| `createWorktree(repoPath, path, options?)`           | `void`                     |
| `createWorktreeWithResult(repoPath, path, options?)` | `GitWorktree \| undefined` |
| `deleteWorktree(repoPath, path, options?)`           | `void`                     |

### GitBlameSubProvider

| Method                                                                   | Returns                            |
| ------------------------------------------------------------------------ | ---------------------------------- |
| `getBlame(repoPath, path, rev?, contents?, options?)`                    | `GitBlame \| undefined`            |
| `getBlameForLine(repoPath, path, editorLine, rev?, contents?, options?)` | `GitBlameLine \| undefined`        |
| `getBlameForRange(repoPath, path, range, rev?, contents?, options?)`     | `GitBlame \| undefined`            |
| `getProgressiveBlame?(repoPath, path, rev?, contents?, options?)`        | `ProgressiveGitBlame \| undefined` |

### Utilities (`utils/blame.utils.js`)

| Function                      | Returns                 |
| ----------------------------- | ----------------------- |
| `getBlameRange(blame, range)` | `GitBlame \| undefined` |

---

## Models

All in `models/`:

| Module                     | Key Exports                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `author.js`                | `CommitAuthor`, `UnidentifiedAuthor`, `Account`                                                                                                      |
| `autolink.js`              | `AutolinkType`, `AutolinkReferenceType`, `AutolinkReference`, `Autolink`                                                                             |
| `blame.js`                 | `GitBlame`, `GitBlameAuthor`, `GitBlameLine`                                                                                                         |
| `branch.js`                | `GitBranch`, `BranchDisposition`, `BranchMetadata`                                                                                                   |
| `commit.js`                | `GitCommit`, `GitStashCommit`, `GitCommitIdentityShape`, `GitCommitShape`                                                                            |
| `contributor.js`           | `GitContributor`, `GitContributorsStats`                                                                                                             |
| `defaultBranch.js`         | `DefaultBranch`                                                                                                                                      |
| `diff.js`                  | `GitDiff`, `GitDiffFiles`, `GitDiffShortStat`, `GitDiffFilter`, `GitLineDiff`, `ParsedGitDiffHunks`                                                  |
| `file.js`                  | `GitFile`, `GitFileWithCommit`                                                                                                                       |
| `fileChange.js`            | `GitFileChangeShape`, `GitFileChange`                                                                                                                |
| `fileStatus.js`            | `GitFileStatus`, `GitFileConflictStatus`, `GitFileIndexStatus`, `GitFileWorkingTreeStatus`                                                           |
| `graph.js`                 | `GitGraph`, `GitGraphRowType`, graph row types                                                                                                       |
| `issue.js`                 | `Issue`, `IssueShape`                                                                                                                                |
| `issueOrPullRequest.js`    | `IssueOrPullRequest`, `IssueOrPullRequestType`, `IssueOrPullRequestState`                                                                            |
| `lineRange.js`             | `LineRange`                                                                                                                                          |
| `log.js`                   | `GitLog`                                                                                                                                             |
| `mergeConflicts.js`        | `ConflictDetectionResult`, `MergeConflicts`, `MergeConflictFile`                                                                                     |
| `patch.js`                 | `PatchRevisionRange`, `GitPatch`                                                                                                                     |
| `pausedOperationStatus.js` | `GitPausedOperationStatus`, `GitPausedOperation`                                                                                                     |
| `pullRequest.js`           | `PullRequest`, `PullRequestShape`, `PullRequestState`                                                                                                |
| `rebase.js`                | `RebaseTodoAction`, `RebaseTodoEntry`, `ParsedRebaseTodo`, `UpdateRefInfo`                                                                           |
| `reference.js`             | `GitBranchReference`, `GitRevisionReference`, `GitStashReference`                                                                                    |
| `reflog.js`                | `GitReflog`, `GitReflogRecord`                                                                                                                       |
| `remote.js`                | `GitRemote`, `GitRemoteType`                                                                                                                         |
| `remoteProvider.js`        | `RemoteProvider` (abstract), `RemoteProviderId`, `RemoteProviderSupportedFeatures`                                                                   |
| `remoteResource.js`        | `RemoteResourceType`                                                                                                                                 |
| `repository.js`            | `RepositoryChange`, `Repository`, `GitDir`                                                                                                           |
| `repositoryChangeEvent.js` | `RepositoryChangeEvent`                                                                                                                              |
| `repositoryIdentities.js`  | `GkProviderId`, `GkRepositoryId`, `RepositoryIdentityDescriptor`                                                                                     |
| `repositoryMetadata.js`    | `RepositoryMetadata`                                                                                                                                 |
| `resourceDescriptor.js`    | `ResourceDescriptor`, `RepositoryDescriptor`                                                                                                         |
| `revision.js`              | `GitRevisionRange`, `GitRevisionRangeNotation`, `deletedOrMissing`, `uncommitted*` sentinels                                                         |
| `graphSearch.js`           | `GitGraphSearch`, `GitGraphSearchProgress`, `GitGraphSearchResults`, `GitGraphSearchCursor`, `GitGraphSearchResultData`, `GitGraphSearchCursorState` |
| `search.js`                | `SearchQuery`, `SearchOperators`, `ParsedSearchQuery`, `SearchQueryFilters`, `SearchQueryGitCommand`, `SearchQueryGitHubCommand`                     |
| `shortlog.js`              | `GitShortLog`                                                                                                                                        |
| `signature.js`             | `CommitSignature`, `SigningConfig`, `ValidationResult`                                                                                               |
| `staging.js`               | `GitConflictFile`, `GitIndexFile`                                                                                                                    |
| `stash.js`                 | `GitStash`                                                                                                                                           |
| `status.js`                | `GitStatus`                                                                                                                                          |
| `statusFile.js`            | `GitStatusFile`                                                                                                                                      |
| `tag.js`                   | `GitTag`                                                                                                                                             |
| `tree.js`                  | `GitTreeEntry`, `GitTreeType`                                                                                                                        |
| `user.js`                  | `GitUser`                                                                                                                                            |
| `worktree.js`              | `GitWorktree`                                                                                                                                        |

---

## Errors

All in `errors.js`. Each error class extends `GitCommandError<Details>` with a typed `reason` discriminant:

| Error Class                    | Reasons                                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ApplyPatchCommitError`        | `appliedWithConflicts`, `applyFailed`, `checkoutFailed`, `createWorktreeFailed`, `stashFailed`, `wouldOverwriteChanges`            |
| `BranchError`                  | `alreadyExists`, `notFullyMerged`, `invalidName`, `noRemoteReference`, `other`                                                     |
| `CheckoutError`                | `invalidRef`, `pathspecNotFound`, `wouldOverwriteChanges`, `other`                                                                 |
| `CherryPickError`              | `aborted`, `alreadyInProgress`, `conflicts`, `emptyCommit`, `wouldOverwriteChanges`, `other`                                       |
| `CommitError`                  | `nothingToCommit`, `conflicts`, `noUserNameConfigured`, `other`                                                                    |
| `FetchError`                   | `noFastForward`, `noRemote`, `remoteConnectionFailed`, `other`                                                                     |
| `MergeError`                   | `alreadyMerged`, `conflicts`, `localChangesOverwritten`, ...                                                                       |
| `PausedOperationAbortError`    | `nothingToAbort`                                                                                                                   |
| `PausedOperationContinueError` | `conflicts`, `emptyCommit`, `nothingToContinue`, `uncommittedChanges`, `unmergedFiles`, `unstagedChanges`, `wouldOverwriteChanges` |
| `PullError`                    | `conflict`, `divergedBranches`, `noUpstream`, `overwrittenChanges`, ...                                                            |
| `PushError`                    | `noUpstream`, `permissionDenied`, `pushRejected`, `remoteConnectionFailed`, ...                                                    |
| `RebaseError`                  | `conflicts`, `abortWhenNothingInProgress`, `localChangesOverwritten`, ...                                                          |
| `ResetError`                   | `uncommittedChanges`, `localChangesOverwritten`                                                                                    |
| `RevertError`                  | `conflicts`, `conflictsWithPausedRevert`, `emptyCommit`, ...                                                                       |
| `StashApplyError`              | `uncommittedChanges`, `other`                                                                                                      |
| `StashPushError`               | `conflictingStagedAndUnstagedLines`, `nothingToSave`, `other`                                                                      |
| `ShowError`                    | `invalidObject`, `invalidRevision`, `notFound`, `notInRevision`, `other`                                                           |
| `TagError`                     | `alreadyExists`, `notFound`, `invalidName`                                                                                         |
| `WorktreeCreateError`          | `alreadyCheckedOut`, `alreadyExists`                                                                                               |
| `WorktreeDeleteError`          | `defaultWorkingTree`, `directoryNotEmpty`, `uncommittedChanges`                                                                    |
| `SigningError`                 | `noKey`, `gpgNotFound`, `sshNotFound`, `passphraseFailed`, `unknown`                                                               |
| `WorkspaceUntrustedError`      | (no reasons — thrown when `isTrusted: false`)                                                                                      |

Also: `BlameIgnoreRevsFileError`, `BlameIgnoreRevsFileBadRevisionError`, `GitSearchError`, `AuthenticationError`, `RequestClientError`, `RequestNotFoundError`, `RequestRateLimitError`.

---

## Utilities

All in `utils/`:

| Module                           | Key Exports                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `autolink.utils.js`              | Autolink reference handling                                                                                                                                               |
| `blame.utils.js`                 | `getBlameRange`                                                                                                                                                           |
| `branch.utils.js`                | `getBranchId`, `getBranchNameAndRemote`, `getBranchNameWithoutRemote`, `getRemoteNameFromBranchName`, `isDetachedHead`, `isRemoteBranch`, `parseRefName`, `parseUpstream` |
| `commit.utils.js`                | `getChangedFilesCount`, `splitCommitMessage`, `isOfCommitOrStashRefType`                                                                                                  |
| `contributor.utils.js`           | `calculateContributionScore`, `calculateDistribution`, `matchContributor`                                                                                                 |
| `fetch.utils.js`                 | Fetch operation utilities                                                                                                                                                 |
| `fileStatus.utils.js`            | `getGitFileStatusIcon`, `getGitFileStatusText`                                                                                                                            |
| `issue.utils.js`                 | Issue utilities                                                                                                                                                           |
| `issueOrPullRequest.utils.js`    | Issue/PR utilities                                                                                                                                                        |
| `mergeConflicts.utils.js`        | Merge conflict utilities                                                                                                                                                  |
| `pausedOperationStatus.utils.js` | Paused operation utilities                                                                                                                                                |
| `pullRequest.utils.js`           | Pull request utilities                                                                                                                                                    |
| `rebase.utils.js`                | Rebase todo parsing utilities                                                                                                                                             |
| `reference.utils.js`             | `createReference`, `isBranchReference`, `isTagReference`, `isStashReference`, `isRevisionReference`, `getReferenceTypeLabel`                                              |
| `remote.utils.js`                | `getDefaultRemoteOrHighlander`                                                                                                                                            |
| `repository.utils.js`            | Repository path helpers                                                                                                                                                   |
| `resourceDescriptor.utils.js`    | Resource descriptor utilities                                                                                                                                             |
| `revision.utils.js`              | `isUncommitted`, `isUncommittedStaged`, `isSha`, `shortenRevision`, `createRevisionRange`, `getRevisionRangeParts`                                                        |
| `search.utils.js`                | Search query helpers                                                                                                                                                      |
| `sorting.js`                     | `BranchSortOptions`, `TagSortOptions`, `BranchSorting`, `TagSorting`, `ContributorSorting`                                                                                |
| `status.utils.js`                | `getUpstreamStatus`                                                                                                                                                       |
| `statusFile.utils.js`            | Status file utilities                                                                                                                                                     |
| `tag.utils.js`                   | Tag utilities                                                                                                                                                             |
| `uriAuthority.js`                | URI authority helpers                                                                                                                                                     |
| `user.utils.js`                  | User/author utilities                                                                                                                                                     |
| `worktree.utils.js`              | Worktree utilities                                                                                                                                                        |

> **Note**: Path utilities (`splitPath`, `normalizePath`, `isChild`, `isDescendant`, etc.) are in `@gitlens/utils/path.js`, not in this package.

---

## Remote Providers

All in `remotes/`:

| Module                | Provider                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `matcher.js`          | `RemoteProviderConfig`, `RemoteProviderFactory`, `RemoteProviderMatcher`, `createRemoteProviderMatcher()` |
| `github.js`           | `GitHubRemoteProvider`                                                                                    |
| `gitlab.js`           | `GitLabRemoteProvider`                                                                                    |
| `bitbucket.js`        | `BitbucketRemoteProvider`                                                                                 |
| `bitbucket-server.js` | `BitbucketServerRemoteProvider`                                                                           |
| `azure-devops.js`     | `AzureDevOpsRemoteProvider`                                                                               |
| `gitea.js`            | `GiteaRemoteProvider`                                                                                     |
| `gerrit.js`           | `GerritRemoteProvider`                                                                                    |
| `google-source.js`    | `GoogleSourceRemoteProvider`                                                                              |
| `custom.js`           | `CustomRemoteProvider`                                                                                    |

---

## Other

| Export                                              | Module                      | Description                                            |
| --------------------------------------------------- | --------------------------- | ------------------------------------------------------ |
| `setGlobalRepositoryServiceResolver(resolver)`      | `repositoryService.js`      | Wire module-level repo lookup (called by `GitService`) |
| `clearGlobalRepositoryServiceResolver()`            | `repositoryService.js`      | Tear down module-level repo lookup                     |
| `getRepositoryService(repoPath)`                    | `repositoryService.js`      | Module-level hook used by models to access repo        |
| `Cache`                                             | `cache.js`                  | Repository-level cache                                 |
| `CachedGitTypes`                                    | `cache.js`                  | Cacheable type names                                   |
| `UriScopedCachedGitTypes`                           | `cache.js`                  | URI-scoped cache type names                            |
| `GitDir`                                            | `models/repository.js`      | Git directory info (`path`, `commonPath`)              |
| `GitCommitReachability`                             | `providers/commits.js`      | Commit reachability info                               |
| `GitContributorsResult`                             | `providers/contributors.js` | Contributors query result                              |
| `GitFeatures`                                       | `features.js`               | Feature flag union type                                |
| `gitFeaturesByVersion`                              | `features.js`               | Feature → minimum git version                          |
| `gitMinimumVersion`                                 | `features.js`               | `'2.7.2'`                                              |
| `BranchSorting`, `TagSorting`, `ContributorSorting` | `utils/sorting.js`          | Sorting type aliases                                   |
| `GitErrorHandling`                                  | `exec.types.js`             | `'throw' \| 'ignore'`                                  |

### Watching (`watching/`)

| Export                   | Module                        | Description                             |
| ------------------------ | ----------------------------- | --------------------------------------- |
| `RepositoryWatchService` | `watching/watchService.js`    | Manages file watching sessions per repo |
| `FileWatchingProvider`   | `watching/provider.js`        | Provider interface for file watching    |
| `GitIgnoreFilter`        | `watching/gitIgnoreFilter.js` | Git ignore pattern filtering            |

### Parsers (`parsers/`)

The `@gitlens/git` package has shared parsers:

| Module                        | Purpose                  |
| ----------------------------- | ------------------------ |
| `parsers/diffParser.js`       | Diff output parsing      |
| `parsers/rebaseTodoParser.js` | Rebase todo file parsing |

---

## Internal (not intended for consumers)

These are exported (wildcard package) but are implementation details:

| What                                                      | Package            | Why internal                                     |
| --------------------------------------------------------- | ------------------ | ------------------------------------------------ |
| `Git` class (`exec/git.js`)                               | `@gitlens/git-cli` | Low-level execution engine used by sub-providers |
| `GitQueue` (`exec/gitQueue.js`)                           | `@gitlens/git-cli` | Command queueing                                 |
| Sub-provider classes (`providers/*.js`)                   | `@gitlens/git-cli` | Consumers use interfaces from `providers/*.js`   |
| `CliGitProviderInternal` (`cliGitProvider.js`)            | `@gitlens/git-cli` | Internal wiring between sub-providers            |
| Parsers (`parsers/*.js`)                                  | `@gitlens/git-cli` | Git output parsing, abstracted by sub-providers  |
| `exec.js`, `exec.types.js`, `exec.errors.js` (in `exec/`) | `@gitlens/git-cli` | Low-level spawn utilities                        |

---

## Cancellation

All read operations accept an optional `cancellation?: AbortSignal` parameter for cancellation. Pass an `AbortController.signal` to cancel long-running operations:

```typescript
const controller = new AbortController();
const branches = await provider.branches.getBranches(repoPath, {}, controller.signal);
// To cancel: controller.abort();
```

---

## Known Limitations & Future Work

### `repositoryService` — hidden module-level state

`setGlobalRepositoryServiceResolver()` (in `repositoryService.ts`) sets module-level state that models depend on to access `RepositoryService` (e.g., `GitWorktree.hasWorkingChanges()`). This is wired automatically by the `GitService` constructor and torn down by `dispose()`.

**Risk**: If consumers create model instances before constructing `GitService`, `getRepositoryService()` silently returns `undefined` rather than signaling an error.

**Improvement**: Add a runtime warning (or throw) in `getRepositoryService()` when the resolver is unconfigured, so misconfigured consumers get clear feedback.

### `GitService` singleton — test isolation

`GitService.createSingleton()` throws if called twice; only `dispose()` resets the static instance. If a test forgets to call `dispose()`, subsequent tests fail with a cryptic `'GitService already exists'` error.

**Improvement**: Consider a `GitService.resetForTesting()` static method, or at minimum improve the error message to hint at calling `dispose()` on the existing instance.

### `Cache.clearCaches` — `gitResults` cleared broadly

The `gitResults` cache is added to `sharedCachesToClear` in nearly every type-specific invalidation branch (`branches`, `config`, `contributors`, `remotes`, `stashes`, `tags`, `worktrees`). This means almost any repository change event clears the entire git results cache.

**Investigation needed**: If `gitResults` is keyed granularly (per-command), the broad clearing may be overly aggressive and could be made more targeted to improve cache hit rates.
