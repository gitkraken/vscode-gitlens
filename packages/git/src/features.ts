// GitFeature's must start with `git:` to be recognized in all usages
export type GitFeatures =
	| 'git:checkout:pathspec-from-file'
	| 'git:commit-graph'
	| 'git:commit-graph:changed-paths'
	| 'git:for-each-ref:worktreePath'
	| 'git:fsmonitor'
	| 'git:fsmonitor:linux'
	| 'git:ignoreRevsFile'
	| 'git:index:skipHash'
	| 'git:maintenance'
	| 'git:maintenance:start'
	| 'git:maintenance:start:systemd'
	| 'git:manyFiles'
	| 'git:merge-tree'
	| 'git:merge-tree:write-tree'
	| 'git:push:force-if-includes'
	| 'git:rev-parse:end-of-options'
	| 'git:signing:ssh'
	| 'git:signing:x509'
	| 'git:stash:push:pathspecs'
	| 'git:stash:push:staged'
	| 'git:stash:push:stdin'
	| 'git:status:find-renames'
	| 'git:status:porcelain-v2'
	| 'git:untrackedCache'
	| 'git:worktrees';

type ExtractPrefix<T> = T extends `${infer Prefix}:${infer Rest}`
	? Rest extends `${infer SubPrefix}:${string}`
		? T | `${Prefix}:${SubPrefix}` | Prefix
		: T | Prefix
	: never;

export type GitFeatureOrPrefix = ExtractPrefix<GitFeatures>;
export type FilteredGitFeatures<T extends GitFeatureOrPrefix> = T extends GitFeatures
	? T
	: Extract<GitFeatures, T | `${T}:${string}`>;

export const gitMinimumVersion = '2.7.2';
export const gitFeaturesByVersion = new Map<GitFeatures, string>([
	['git:checkout:pathspec-from-file', '2.26'],
	// 2.24 is when git READS the commit-graph file by default (core.commitGraph on); writing it for
	// older gits would be dead weight.
	['git:commit-graph', '2.24'],
	// Changed-path Bloom filters (`--changed-paths`), the v2 filter format — pre-2.31 shipped Bloom filters
	// with real correctness bugs (bad results for merge commits), so 2.31 is the safe floor to write them.
	['git:commit-graph:changed-paths', '2.31'],
	['git:for-each-ref:worktreePath', '2.23'],
	// `core.fsmonitor=true` selects the built-in FSMonitor daemon (accepting a bool rather than only a
	// hook path). This 2.37 floor is the Windows + macOS one.
	['git:fsmonitor', '2.37'],
	// Linux got its own FSMonitor backend (inotify) only in 2.55, hence a separate floor. Note the backend
	// places a watch on EVERY directory, so a large repo can exhaust `fs.inotify.max_user_watches` and the
	// daemon fails at runtime even on a new enough git — the apply path must still probe, not just gate.
	['git:fsmonitor:linux', '2.55'],
	['git:ignoreRevsFile', '2.23'],
	// `index.skipHash` (skip the trailing index checksum for faster writes); part of `feature.manyFiles`.
	['git:index:skipHash', '2.40'],
	// `git maintenance run --task=…`. The `maintenance` builtin + `commit-graph`/`gc` tasks are 2.29, but
	// the loose-objects + incremental-repack tasks the auto tier uses landed in 2.30 (and `core.multiPackIndex`
	// is default-on from 2.30, so no separate midx config write is needed) — 2.30 is the safe floor.
	['git:maintenance', '2.30'],
	// `git maintenance start` — the subcommands exist from 2.30 (cron only); launchctl (macOS) + schtasks
	// (Windows) scheduling arrived in 2.31, so 2.31 is the cross-platform-safe floor.
	['git:maintenance:start', '2.31'],
	// `git maintenance start` systemd-timer scheduling. On Linux, 2.31–2.33 is cron-only and modern distros
	// often ship without cron (scheduling then silently fails); the systemd fallback arrived in 2.34.
	['git:maintenance:start:systemd', '2.34'],
	// `feature.manyFiles` umbrella (index v4 + untracked cache + skipHash where available).
	['git:manyFiles', '2.24'],
	['git:merge-tree', '2.33'],
	['git:merge-tree:write-tree', '2.38'],
	['git:push:force-if-includes', '2.30.0'],
	['git:rev-parse:end-of-options', '2.30'],
	['git:signing:ssh', '2.34.0'],
	['git:signing:x509', '2.19.0'],
	['git:stash:push:pathspecs', '2.13.2'],
	['git:stash:push:staged', '2.35.0'],
	['git:stash:push:stdin', '2.30.0'],
	['git:status:find-renames', '2.18'],
	['git:status:porcelain-v2', '2.11'],
	// `core.untrackedCache=true` (repo-local cache of untracked-file scans — the auto-tier config lever).
	['git:untrackedCache', '2.8'],
	['git:worktrees', '2.17.0'],
]);
