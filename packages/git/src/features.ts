// GitFeature's must start with `git:` to be recognized in all usages
export type GitFeatures =
	| 'git:for-each-ref:worktreePath'
	| 'git:ignoreRevsFile'
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
	['git:for-each-ref:worktreePath', '2.23'],
	['git:ignoreRevsFile', '2.23'],
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
	['git:worktrees', '2.17.0'],
]);
