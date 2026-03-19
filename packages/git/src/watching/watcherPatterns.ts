// Glob patterns for watching files inside the .git directory.
// They represent pure Git knowledge — the library owns these patterns and
// provides them to the pluggable FileWatcherFactory.

const dotGitFiles =
	'index,HEAD,*_HEAD,MERGE_*,rebase-apply,rebase-apply/**,rebase-merge,rebase-merge/**,sequencer,sequencer/**';

const dotGitWorktreeFiles =
	'worktrees/*,worktrees/**/index,worktrees/**/HEAD,worktrees/**/*_HEAD,worktrees/**/MERGE_*,worktrees/**/rebase-merge,worktrees/**/rebase-merge/**,worktrees/**/rebase-apply,worktrees/**/rebase-apply/**,worktrees/**/sequencer,worktrees/**/sequencer/**';

const dotGitCommonFiles = `config,gk/config,refs/**,info/exclude,FETCH_HEAD,${dotGitWorktreeFiles}`;

/** For standard repos (no worktrees): single watcher covering all .git files */
export const dotGitGlobCombined = `{${dotGitFiles},${dotGitCommonFiles}}`;

/** For worktree repos: root watcher (worktree-specific files only) */
export const dotGitGlobRoot = `{${dotGitFiles}}`;

/** For worktree repos: common watcher (shared config, refs, info, etc.) */
export const dotGitGlobCommon = `{${dotGitCommonFiles}}`;

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
