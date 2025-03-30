import type { Range } from 'vscode';
import type { GitCommit } from './commit';
import type { GitRevisionRangeNotation } from './revision';

export const enum RemoteResourceType {
	Branch = 'branch',
	Branches = 'branches',
	Commit = 'commit',
	Comparison = 'comparison',
	CreatePullRequest = 'createPullRequest',
	File = 'file',
	Repo = 'repo',
	Revision = 'revision',
	// Tag = 'tag',
}

export interface BranchRemoteResource {
	type: RemoteResourceType.Branch;
	branch: string;
}

export interface BranchesRemoteResource {
	type: RemoteResourceType.Branches;
}

export interface CommitRemoteResource {
	type: RemoteResourceType.Commit;
	sha: string;
}

export interface ComparisonRemoteResource {
	type: RemoteResourceType.Comparison;
	base: string;
	head: string;
	notation?: GitRevisionRangeNotation;
}

export interface CreatePullRequestRemoteResource {
	type: RemoteResourceType.CreatePullRequest;
	repoPath: string;
	base: {
		branch: string | undefined;
		remote: { path: string; url: string; name: string };
	};
	head: {
		branch: string;
		remote: { path: string; url: string; name: string };
	};
	details?:
		| { title: string; description: string; describeWithAI?: never }
		| { describeWithAI: boolean; title?: never; description?: never };
}

export interface FileRemoteResource {
	type: RemoteResourceType.File;
	branchOrTag?: string;
	fileName: string;
	range?: Range;
}

export interface RepoRemoteResource {
	type: RemoteResourceType.Repo;
}

export interface RevisionRemoteResource {
	type: RemoteResourceType.Revision;
	branchOrTag?: string;
	commit?: GitCommit;
	fileName: string;
	range?: Range;
	sha?: string;
}

// export interface TagRemoteResource {
// 	type: RemoteResourceType.Tag;
// 	tag: string;
// }

export type RemoteResource =
	| BranchRemoteResource
	| BranchesRemoteResource
	| CommitRemoteResource
	| ComparisonRemoteResource
	| CreatePullRequestRemoteResource
	| FileRemoteResource
	| RepoRemoteResource
	| RevisionRemoteResource;
