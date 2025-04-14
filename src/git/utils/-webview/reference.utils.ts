import type { GitBranch } from '../../models/branch';
import type { GitCommit, GitStashCommit } from '../../models/commit';
import type { GitBranchReference, GitRevisionReference, GitTagReference } from '../../models/reference';
import type { GitTag } from '../../models/tag';
import { createReference } from '../reference.utils';

export function getReferenceFromBranch(branch: GitBranch): GitBranchReference {
	return createReference(branch.ref, branch.repoPath, {
		id: branch.id,
		refType: branch.refType,
		name: branch.name,
		remote: branch.remote,
		upstream: branch.upstream,
		sha: branch.sha,
	});
}

export function getReferenceFromRevision(
	revision: GitCommit | GitStashCommit | GitRevisionReference,
	options?: { excludeMessage?: boolean },
): GitRevisionReference {
	if (revision.refType === 'stash') {
		return createReference(revision.ref, revision.repoPath, {
			refType: revision.refType,
			name: revision.name,
			number: revision.stashNumber,
			message: options?.excludeMessage ? undefined : revision.message,
		});
	}

	return createReference(revision.ref, revision.repoPath, {
		refType: revision.refType,
		name: revision.name,
		message: options?.excludeMessage ? undefined : revision.message,
	});
}

export function getReferenceFromTag(tag: GitTag): GitTagReference {
	return createReference(tag.ref, tag.repoPath, {
		id: tag.id,
		refType: tag.refType,
		name: tag.name,
		sha: tag.sha,
	});
}
