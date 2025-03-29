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

export type RemoteResource =
	| {
			type: RemoteResourceType.Branch;
			branch: string;
	  }
	| {
			type: RemoteResourceType.Branches;
	  }
	| {
			type: RemoteResourceType.Commit;
			sha: string;
	  }
	| {
			type: RemoteResourceType.Comparison;
			base: string;
			compare: string;
			notation?: GitRevisionRangeNotation;
	  }
	| {
			type: RemoteResourceType.CreatePullRequest;
			base: {
				branch: string | undefined;
				remote: { path: string; url: string; name: string };
			};
			compare: {
				branch: string;
				remote: { path: string; url: string; name: string };
			};
			describePullRequest?: (
				completedResource: RemoteResource & { type: RemoteResourceType.CreatePullRequest },
			) => Promise<{ summary: string; body: string } | undefined>;
	  }
	| {
			type: RemoteResourceType.File;
			branchOrTag?: string;
			fileName: string;
			range?: Range;
	  }
	| {
			type: RemoteResourceType.Repo;
	  }
	| {
			type: RemoteResourceType.Revision;
			branchOrTag?: string;
			commit?: GitCommit;
			fileName: string;
			range?: Range;
			sha?: string;
	  };
