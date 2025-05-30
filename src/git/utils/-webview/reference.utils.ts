import type { GitBranch } from '../../models/branch';
import { isBranch } from '../../models/branch';
import type { GitCommit, GitStashCommit } from '../../models/commit';
import { isCommit } from '../../models/commit';
import type { GitBranchReference, GitReference, GitRevisionReference, GitTagReference } from '../../models/reference';
import type { GitTag } from '../../models/tag';
import { isTag } from '../../models/tag';
import { createReference } from '../reference.utils';

export function getReference(ref: GitReference): GitReference;
export function getReference(ref: GitReference | undefined): GitReference | undefined;
export function getReference(ref: GitReference | undefined): GitReference | undefined {
	if (ref == null) return undefined;

	switch (ref.refType) {
		case 'branch':
			return isBranch(ref) ? getReferenceFromBranch(ref) : ref;
		case 'tag':
			return isTag(ref) ? getReferenceFromTag(ref) : ref;
		default:
			return isCommit(ref) ? getReferenceFromRevision(ref) : ref;
	}
}

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
