import type { GitDirProbe } from './gitDirPoller.js';

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
 * What a poll stats in a worktree's own `.git` directory when its watcher can't be trusted — the files
 * {@link dotGitGlobRoot} reads.
 */
export const gitDirRootProbes: readonly GitDirProbe[] = [
	{ path: 'HEAD' },
	{ path: 'index' },
	{ path: 'ORIG_HEAD' },
	{ path: 'MERGE_HEAD' },
	{ path: 'CHERRY_PICK_HEAD' },
	{ path: 'REVERT_HEAD' },
	{ path: 'REBASE_HEAD' },
	{ path: 'rebase-merge' },
	{ path: 'rebase-apply' },
	{ path: 'sequencer' },
	// Moves with every commit, reset or checkout on the checked-out branch, without the poll knowing its name
	{ path: 'logs/HEAD', emitAs: ['HEAD'] },
];

/**
 * What a poll stats in the common `.git` directory — the files {@link dotGitGlobCommon} reads, with the `refs/**` it
 * can't list narrowed to its namespace directories (whose mtime moves as a top-level ref is created or deleted) and
 * to the named refs of {@link getGitDirRefProbes}.
 */
export const gitDirCommonProbes: readonly GitDirProbe[] = [
	{ path: 'packed-refs' },
	{ path: 'config' },
	{ path: 'gk/config' },
	{ path: 'info/exclude' },
	{ path: 'refs/heads' },
	{ path: 'refs/tags' },
	{ path: 'refs/stash' },
	{ path: 'worktrees' },
	{ path: 'shallow' },
	// A fetch writes it with the remote-tracking refs it updated, which the poll can't list. Git rewrites it even on a
	// fetch that moves nothing, so each fetch is reported as a `remotes` change: the cost of seeing remote-tracking
	// refs no subscriber names
	{ path: 'FETCH_HEAD', emitAs: ['FETCH_HEAD', 'refs/remotes'] },
];

/** For each path a probe of {@link gitDirRootProbes} or {@link gitDirCommonProbes} is emitted as, the probes emitted as it */
export const gitDirProbesByEmittedPath: ReadonlyMap<string, readonly string[]> = getProbesByEmittedPath([
	...gitDirRootProbes,
	...gitDirCommonProbes,
]);

function getProbesByEmittedPath(probes: readonly GitDirProbe[]): Map<string, string[]> {
	const map = new Map<string, string[]>();
	for (const probe of probes) {
		for (const path of probe.emitAs ?? []) {
			const paths = map.get(path);
			if (paths == null) {
				map.set(path, [probe.path]);
			} else {
				paths.push(probe.path);
			}
		}
	}
	return map;
}

/**
 * Probes for named branches and remote-tracking refs: each loose ref file, and each directory between it and its
 * namespace (`refs/heads/feature` for `refs/heads/feature/x`, `refs/remotes/origin`), whose mtime moves as a sibling
 * ref is created or deleted. A ref created in a directory no named ref sits in is left to `packed-refs`, `logs/HEAD`
 * and `FETCH_HEAD`.
 */
export function getGitDirRefProbes(refs: Iterable<string>): GitDirProbe[] {
	const paths = new Set<string>();
	for (const ref of refs) {
		const namespaceEnd = ref.startsWith('refs/heads/') ? 10 : ref.startsWith('refs/remotes/') ? 12 : -1;
		if (namespaceEnd === -1) continue;

		for (let path = ref; path.length > namespaceEnd; path = path.substring(0, path.lastIndexOf('/'))) {
			paths.add(path);
		}
	}
	return Array.from(paths, path => ({ path: path }));
}

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
