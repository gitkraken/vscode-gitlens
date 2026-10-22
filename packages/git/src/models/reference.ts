export interface GitBranchReference {
	readonly refType: 'branch';
	id?: string;
	name: string;
	ref: string;
	sha?: string;
	readonly remote: boolean;
	readonly upstream?: { name: string; missing: boolean; remote?: string; remoteBranch?: string; local?: boolean };
	readonly worktree?: { path: string; isDefault: boolean } | boolean;
	repoPath: string;
}

export interface GitRevisionReference {
	readonly refType: 'revision' | 'stash';
	id?: undefined;
	name: string;
	ref: string;
	sha: string;
	repoPath: string;

	stashNumber?: string | undefined;
	message?: string | undefined;
}

export interface GitStashReference {
	readonly refType: 'stash';
	id?: undefined;
	name: string;
	ref: string;
	sha: string;
	repoPath: string;
	stashNumber: string;

	message?: string | undefined;
	stashOnRef?: string | undefined;
}

export interface GitTagReference {
	readonly refType: 'tag';
	id?: string;
	name: string;
	ref: string;
	sha?: string;
	repoPath: string;
}

export type GitReference = GitBranchReference | GitRevisionReference | GitStashReference | GitTagReference;

/**
 * Lightweight ref-tip tuple — the minimum needed to map a SHA back to the refs that point at it.
 * No upstream tracking, ahead/behind, annotation, etc. — use `GitBranch`/`GitTag` for those.
 */
export interface GitRefTip {
	readonly type: 'branch' | 'remote' | 'tag';
	/** Short name: `main`, `origin/main`, `v1.2.0` */
	readonly name: string;
	/** Full refname: `refs/heads/main`, `refs/remotes/origin/main`, `refs/tags/v1.2.0` */
	readonly fullName: string;
	/** Tip object SHA. For annotated tags, the peeled commit SHA */
	readonly sha: string;
}

/**
 * Raw parsed `git for-each-ref` record covering every field the unified format emits.
 * Inapplicable fields come back as empty strings from git (e.g. `upstream` on a tag,
 * `peeledObjectname` on a branch).
 */
export interface RefRecord {
	current: string;
	name: string;
	objectname: string;
	peeledObjectname: string;
	upstream: string;
	upstreamTracking: string;
	committerDate: string;
	creatorDate: string;
	authorDate: string;
	subject: string;
	worktreePath?: string;
	/** `%(upstream:remotename)` — the remote a local branch tracks on (`.` for a local upstream); only read where git supports it */
	upstreamRemote?: string;
	/** `%(upstream:remoteref)` — the ref a local branch tracks on its remote (`branch.<name>.merge`); only read where git supports it */
	upstreamRemoteRef?: string;
	/**
	 * `%(push)` — the full name of a local branch's push destination as git resolves `<branch>@{push}` from
	 * `push.default`, the push remote and its refspecs. Named even when that ref doesn't exist yet; empty when git
	 * can't name one (no upstream under `simple`/`upstream`, `nothing`, `simple` with another push remote, or a
	 * destination with no local tracking ref). Not always where `git push` goes: a triangular `simple` push goes like
	 * `current`, though it is empty here
	 */
	push: string;
}
