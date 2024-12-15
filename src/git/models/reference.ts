export interface GitBranchReference {
	readonly refType: 'branch';
	id?: string;
	name: string;
	ref: string;
	sha?: string;
	readonly remote: boolean;
	readonly upstream?: { name: string; missing: boolean };
	repoPath: string;
}

export interface GitRevisionReference {
	readonly refType: 'revision' | 'stash';
	id?: undefined;
	name: string;
	ref: string;
	sha: string;
	repoPath: string;

	number?: string | undefined;
	message?: string | undefined;
}

export interface GitStashReference {
	readonly refType: 'stash';
	id?: undefined;
	name: string;
	ref: string;
	sha: string;
	repoPath: string;
	number: string;

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
