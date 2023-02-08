import type { Range } from 'vscode';
import type { GitCommit } from './commit';

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
			notation?: '..' | '...';
	  }
	| {
			type: RemoteResourceType.CreatePullRequest;
			base: {
				branch?: string;
				remote: { path: string; url: string };
			};
			compare: {
				branch: string;
				remote: { path: string; url: string };
			};
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
// | {
// 		type: RemoteResourceType.Tag;
// 		tag: string;
//   };

export function getNameFromRemoteResource(resource: RemoteResource) {
	switch (resource.type) {
		case RemoteResourceType.Branch:
			return 'Branch';
		case RemoteResourceType.Branches:
			return 'Branches';
		case RemoteResourceType.Commit:
			return 'Commit';
		case RemoteResourceType.Comparison:
			return 'Comparison';
		case RemoteResourceType.CreatePullRequest:
			return 'Create Pull Request';
		case RemoteResourceType.File:
			return 'File';
		case RemoteResourceType.Repo:
			return 'Repository';
		case RemoteResourceType.Revision:
			return 'File';
		// case RemoteResourceType.Tag:
		// 	return 'Tag';
		default:
			return '';
	}
}
