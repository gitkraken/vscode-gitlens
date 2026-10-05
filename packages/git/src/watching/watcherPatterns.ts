// Glob patterns for watching files inside the .git directory.
// They represent pure Git knowledge — the library owns these patterns and
// provides them to the pluggable FileWatcherFactory.

const dotGitFiles =
	'index,HEAD,*_HEAD,MERGE_*,rebase-apply,rebase-apply/**,rebase-merge,rebase-merge/**,sequencer,sequencer/**';

// `worktrees` (the bare entry, no `/*` suffix) is its own pattern: `worktree remove` deletes the whole
// `worktrees/<id>` subtree in one syscall, and some platforms/watcher backends coalesce a same-instant
// subtree delete into a single event for the PARENT directory — `worktrees/*` alone never matches that.
// `classifyGitDirChange` classifies a bare `worktrees` path, so this is watch-coverage only.
//
// Only what `git worktree list` reports per worktree is watched here (its HEAD, lock and location). A
// linked worktree's own index, `*_HEAD`, `MERGE_*`, rebase and sequencer state is watched by that
// worktree's root watcher (`dotGitGlobRoot`) instead, so it never wakes sibling worktrees.
const dotGitWorktreeFiles = 'worktrees,worktrees/*,worktrees/*/HEAD,worktrees/*/locked,worktrees/*/gitdir';

const dotGitCommonFiles = `config,gk/config,refs/**,packed-refs,shallow,info/exclude,FETCH_HEAD,${dotGitWorktreeFiles}`;

/** For standard repos (no worktrees): single watcher covering all .git files */
export const dotGitGlobCombined = `{${dotGitFiles},${dotGitCommonFiles}}`;

/** For worktree repos: root watcher (worktree-specific files only) */
export const dotGitGlobRoot = `{${dotGitFiles}}`;

/** For worktree repos: common watcher (shared config, refs, info, etc.) */
export const dotGitGlobCommon = `{${dotGitCommonFiles}}`;

/**
 * Directories to leave unwatched under the `.git` directory (relative to it), for a provider that prunes natively.
 * Only directories nothing in the globs above reads: never anything under `refs`, `worktrees/*` itself, `gk`, `info`,
 * or the rebase/sequencer directories.
 */
export const gitDirExcludes: readonly string[] = [
	'objects',
	'logs',
	'hooks',
	'lfs',
	'modules',
	'rr-cache',
	'fsmonitor--daemon',
	'worktrees/*/logs',
];

/**
 * Directories to leave unwatched in the working tree (relative to it), for a provider that prunes natively —
 * the same ones {@link shouldIgnoreWorkingTreePath} drops from events.
 */
export const workingTreeExcludes: readonly string[] = ['**/node_modules', '**/.git'];

/** Glob for watching .gitignore files in the working tree */
export const gitIgnoreGlob = '.gitignore';

/** Glob for detecting .git directory creation (repository init/clone) */
export const gitInitGlob = '**/.git';

// Regex-based filters that complement the globs above. The globs tell
// the watcher *what* to observe; these filters tell it what to *skip*
// at runtime (transient lock files, daemon artifacts, etc.).

const ignoredRepoPathRegex = /(?:\/|\\)fsmonitor--daemon(?:\/|\\)|(?:^|\/)index\.lock$/;

/**
 * Returns true if the `.git`-relative path should be ignored
 * (transient filesystem artifacts, not meaningful git state changes).
 */
export function shouldIgnoreRepoPath(relativePath: string): boolean {
	return ignoredRepoPathRegex.test(relativePath);
}

const ignoredWorkingTreePathRegex =
	/(?:(?:\/|\\)node_modules(?:\/|\\|$)|\.git(?:\/index\.lock)?(?:\/|\\|$)|\.watchman-cookie-)/;

/**
 * Returns true if the working tree path should be ignored
 * (node_modules, .git internals, watchman cookies).
 */
export function shouldIgnoreWorkingTreePath(absolutePath: string): boolean {
	return ignoredWorkingTreePathRegex.test(absolutePath);
}
