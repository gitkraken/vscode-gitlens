import type { Uri } from '@gitlens/utils/uri.js';
import type { GitBranch } from '../models/branch.js';
import type { GitReference } from '../models/reference.js';
import type { GitTag } from '../models/tag.js';

export interface GitRefsSubProvider {
	checkIfCouldBeValidBranchOrTagName(repoPath: string, ref: string): Promise<boolean>;
	getMergeBase(
		repoPath: string,
		ref1: string,
		ref2: string,
		options?: { forkPoint?: boolean | undefined },
		cancellation?: AbortSignal,
	): Promise<string | undefined>;
	getReference(repoPath: string, ref: string, cancellation?: AbortSignal): Promise<GitReference | undefined>;
	getSymbolicReferenceName?(repoPath: string, ref: string, cancellation?: AbortSignal): Promise<string | undefined>;
	hasBranchOrTag(
		repoPath: string | undefined,
		options?: {
			filter?:
				| { branches?: ((b: GitBranch) => boolean) | undefined; tags?: ((t: GitTag) => boolean) | undefined }
				| undefined;
		},
		cancellation?: AbortSignal,
	): Promise<boolean>;
	isValidReference(
		repoPath: string,
		ref: string,
		pathOrUri?: string | Uri,
		cancellation?: AbortSignal,
	): Promise<boolean>;
	validateReference(
		repoPath: string,
		ref: string,
		relativePath?: string,
		cancellation?: AbortSignal,
	): Promise<string | undefined>;
	updateReference(repoPath: string, ref: string, newRef: string, cancellation?: AbortSignal): Promise<void>;
}
