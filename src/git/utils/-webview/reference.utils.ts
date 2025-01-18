import type { GitBranch } from '../../models/branch';
import type { GitCommit, GitStashCommit } from '../../models/commit';
import type { GitRevisionReference } from '../../models/reference';
import type { GitTag } from '../../models/tag';
import { createReference } from "../reference.utils";

export function getReferenceFromBranch(branch: GitBranch) {
	return createReference(branch.ref, branch.repoPath, {
		id: branch.id,
		refType: branch.refType,
		name: branch.name,
		remote: branch.remote,
		upstream: branch.upstream,
	});
}

export function getReferenceFromRevision(
	revision: GitCommit | GitStashCommit | GitRevisionReference,
	options?: { excludeMessage?: boolean },
) {
	if (revision.refType === 'stash') {
		return createReference(revision.ref, revision.repoPath, {
			refType: revision.refType,
			name: revision.name,
			number: revision.number,
			message: options?.excludeMessage ? undefined : revision.message,
		});
	}

	return createReference(revision.ref, revision.repoPath, {
		refType: revision.refType,
		name: revision.name,
		message: options?.excludeMessage ? undefined : revision.message,
	});
}

export function getReferenceFromTag(tag: GitTag) {
	return createReference(tag.ref, tag.repoPath, {
		id: tag.id,
		refType: tag.refType,
		name: tag.name,
	});
}
