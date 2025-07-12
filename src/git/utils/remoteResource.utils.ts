import type { RemoteResource } from '../models/remoteResource';
import { RemoteResourceType } from '../models/remoteResource';

// | {
// 		type: RemoteResourceType.Tag;
// 		tag: string;
//   };
export function getNameFromRemoteResource(resource: RemoteResource): string {
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
