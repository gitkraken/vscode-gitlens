import { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitStashCommit } from '@gitlens/git/models/commit.js';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type {
	GitBranchReference,
	GitReference,
	GitRevisionReference,
	GitTagReference,
} from '@gitlens/git/models/reference.js';
import { GitTag } from '@gitlens/git/models/tag.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';

export function getReference(ref: GitReference): GitReference;
export function getReference(ref: GitReference | undefined): GitReference | undefined;
export function getReference(ref: GitReference | undefined): GitReference | undefined {
	if (ref == null) return undefined;

	switch (ref.refType) {
		case 'branch':
			return GitBranch.is(ref) ? getReferenceFromBranch(ref) : ref;
		case 'tag':
			return GitTag.is(ref) ? getReferenceFromTag(ref) : ref;
		default:
			return GitCommit.is(ref) ? getReferenceFromRevision(ref) : ref;
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
