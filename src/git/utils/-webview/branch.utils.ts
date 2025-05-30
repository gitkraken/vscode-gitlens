import type { CancellationToken } from 'vscode';
import type { Container } from '../../../container';
import { CancellationError } from '../../../errors';
import type { MaybePausedResult } from '../../../system/promise';
import { getSettledValue, pauseOnCancelOrTimeout } from '../../../system/promise';
import type { BranchTargetInfo, GitBranch } from '../../models/branch';
import type { PullRequest } from '../../models/pullRequest';
import { createRevisionRange } from '../revision.utils';

const maxDefaultBranchWeight = 100;
const weightedDefaultBranches = new Map<string, number>([
	['master', maxDefaultBranchWeight],
	['main', 15],
	['default', 10],
	['develop', 5],
	['development', 1],
]);

export async function getBranchAheadRange(container: Container, branch: GitBranch): Promise<string | undefined> {
	if (branch.upstream?.state.ahead) {
		return createRevisionRange(branch.upstream?.name, branch.ref, '..');
	}

	if (branch.upstream == null) {
		// If we have no upstream branch, try to find a best guess branch to use as the "base"
		const { values: branches } = await container.git.branches(branch.repoPath).getBranches({
			filter: b => weightedDefaultBranches.has(b.name),
		});
		if (branches.length > 0) {
			let weightedBranch: { weight: number; branch: GitBranch } | undefined;
			for (const branch of branches) {
				const weight = weightedDefaultBranches.get(branch.name)!;
				if (weightedBranch == null || weightedBranch.weight < weight) {
					weightedBranch = { weight: weight, branch: branch };
				}

				if (weightedBranch.weight === maxDefaultBranchWeight) break;
			}

			const possibleBranch = weightedBranch!.branch.upstream?.name ?? weightedBranch!.branch.ref;
			if (possibleBranch !== branch.ref) {
				return createRevisionRange(possibleBranch, branch.ref, '..');
			}
		}
	}

	return undefined;
}

export async function getBranchMergeTargetInfo(
	container: Container,
	branch: GitBranch,
	options?: {
		associatedPullRequest?: Promise<PullRequest | undefined>;
		cancellation?: CancellationToken;
		detectedOnly?: boolean;
		timeout?: number;
	},
): Promise<BranchTargetInfo> {
	const [targetResult, baseResult, defaultResult] = await Promise.allSettled([
		getBranchMergeTargetNameWithoutFallback(container, branch, options),
		container.git.branches(branch.repoPath).getBaseBranchName?.(branch.name, options?.cancellation),
		getDefaultBranchName(container, branch.repoPath, branch.getRemoteName(), {
			cancellation: options?.cancellation,
		}),
	]);

	if (options?.cancellation?.isCancellationRequested) throw new CancellationError();

	return {
		mergeTargetBranch: getSettledValue(targetResult) ?? { value: undefined, paused: false },
		baseBranch: getSettledValue(baseResult),
		defaultBranch: getSettledValue(defaultResult),
	};
}

export async function getBranchMergeTargetName(
	container: Container,
	branch: GitBranch,
	options?: {
		associatedPullRequest?: Promise<PullRequest | undefined>;
		cancellation?: CancellationToken;
		detectedOnly?: boolean;
		timeout?: number;
	},
): Promise<MaybePausedResult<string | undefined>> {
	async function getMergeTargetFallback() {
		const [baseResult, defaultResult] = await Promise.allSettled([
			container.git.branches(branch.repoPath).getBaseBranchName?.(branch.name, options?.cancellation),
			getDefaultBranchName(container, branch.repoPath, branch.getRemoteName(), {
				cancellation: options?.cancellation,
			}),
		]);
		return getSettledValue(baseResult) ?? getSettledValue(defaultResult);
	}

	const result = await getBranchMergeTargetNameWithoutFallback(container, branch, options);
	if (!result.paused) {
		if (result.value) return { value: result.value, paused: false };

		if (options?.cancellation?.isCancellationRequested) {
			return { value: Promise.resolve(undefined), paused: true, reason: 'cancelled' };
		}

		const fallback = await getMergeTargetFallback();
		if (options?.cancellation?.isCancellationRequested) {
			return { value: Promise.resolve(undefined), paused: true, reason: 'cancelled' };
		}

		return { value: fallback, paused: false };
	}

	if (options?.cancellation?.isCancellationRequested || result.reason === 'cancelled') {
		return { value: Promise.resolve(undefined), paused: true, reason: 'cancelled' };
	}

	return {
		value: result.value.then(r => r ?? getMergeTargetFallback()),
		paused: true,
		reason: 'timedout',
	};
}

/** This is an internal helper function for getting only the merge target from stored data or a PR, not falling back to base/default */
async function getBranchMergeTargetNameWithoutFallback(
	container: Container,
	branch: GitBranch,
	options?: {
		associatedPullRequest?: Promise<PullRequest | undefined>;
		cancellation?: CancellationToken;
		detectedOnly?: boolean;
		timeout?: number;
	},
): Promise<MaybePausedResult<string | undefined>> {
	const targetBranch = options?.detectedOnly
		? await container.git.branches(branch.repoPath).getStoredDetectedMergeTargetBranchName?.(branch.name)
		: await container.git.branches(branch.repoPath).getStoredMergeTargetBranchName?.(branch.name);
	if (targetBranch) {
		const validated = await container.git
			.refs(branch.repoPath)
			.getSymbolicReferenceName?.(targetBranch, options?.cancellation);
		return { value: validated || targetBranch, paused: false };
	}

	if (options?.cancellation?.isCancellationRequested) return { value: undefined, paused: false };

	return pauseOnCancelOrTimeout(
		(options?.associatedPullRequest ?? branch?.getAssociatedPullRequest())?.then(pr => {
			if (pr?.refs?.base == null) return undefined;

			const name = `${branch.getRemoteName()}/${pr.refs.base.branch}`;
			void container.git.branches(branch.repoPath).storeMergeTargetBranchName?.(branch.name, name);

			return name;
		}),
		options?.cancellation,
		options?.timeout,
	);
}

export async function getDefaultBranchName(
	container: Container,
	repoPath: string,
	remoteName?: string,
	options?: { cancellation?: CancellationToken },
): Promise<string | undefined> {
	const name = await container.git.branches(repoPath).getDefaultBranchName(remoteName, options?.cancellation);
	return name ?? getDefaultBranchNameFromIntegration(container, repoPath, options);
}

export async function getDefaultBranchNameFromIntegration(
	container: Container,
	repoPath: string,
	options?: { cancellation?: CancellationToken },
): Promise<string | undefined> {
	const remote = await container.git.remotes(repoPath).getBestRemoteWithIntegration(undefined, options?.cancellation);
	if (remote == null) return undefined;

	const integration = await remote.getIntegration();
	const defaultBranch = await integration?.getDefaultBranch?.(remote.provider.repoDesc, options);
	return defaultBranch && `${remote.name}/${defaultBranch?.name}`;
}
