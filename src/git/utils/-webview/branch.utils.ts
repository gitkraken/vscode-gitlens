import type { CancellationToken } from 'vscode';
import type { Container } from '../../../container';
import { CancellationError } from '../../../errors';
import type { MaybePausedResult } from '../../../system/promise';
import { getSettledValue, pauseOnCancelOrTimeout } from '../../../system/promise';
import type { GitRepositoryService } from '../../gitRepositoryService';
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

export async function getBranchAheadRange(svc: GitRepositoryService, branch: GitBranch): Promise<string | undefined> {
	if (branch.upstream?.state.ahead) {
		return createRevisionRange(branch.upstream?.name, branch.ref, '..');
	}

	if (branch.upstream == null) {
		// If we have no upstream branch, try to find a best guess branch to use as the "base"
		const { values: branches } = await svc.branches.getBranches({
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
		container.git
			.getRepositoryService(branch.repoPath)
			.branches.getBaseBranchName?.(branch.name, options?.cancellation),
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
		const [storedBase, baseResult, defaultResult] = await Promise.allSettled([
			container.git.getRepositoryService(branch.repoPath).branches.getStoredMergeTargetBranchName?.(branch.name),
			container.git
				.getRepositoryService(branch.repoPath)
				.branches.getBaseBranchName?.(branch.name, options?.cancellation),
			getDefaultBranchName(container, branch.repoPath, branch.getRemoteName(), {
				cancellation: options?.cancellation,
			}),
		]);
		return getSettledValue(storedBase) ?? getSettledValue(baseResult) ?? getSettledValue(defaultResult);
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
	const svc = container.git.getRepositoryService(branch.repoPath);
	const targetBranch = options?.detectedOnly
		? await svc.branches.getStoredDetectedMergeTargetBranchName?.(branch.name)
		: await svc.branches.getStoredMergeTargetBranchName?.(branch.name);
	if (targetBranch) {
		const validated = await svc.refs.getSymbolicReferenceName?.(targetBranch, options?.cancellation);
		return { value: validated || targetBranch, paused: false };
	}

	if (options?.cancellation?.isCancellationRequested) return { value: undefined, paused: false };

	return pauseOnCancelOrTimeout(
		(options?.associatedPullRequest ?? branch?.getAssociatedPullRequest())?.then(pr => {
			if (pr?.refs?.base == null) return undefined;

			const name = `${branch.getRemoteName()}/${pr.refs.base.branch}`;
			void svc.branches.storeMergeTargetBranchName?.(branch.name, name);

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
	const name = await container.git
		.getRepositoryService(repoPath)
		.branches.getDefaultBranchName(remoteName, options?.cancellation);
	return name ?? getDefaultBranchNameFromIntegration(container, repoPath, options);
}

export async function getDefaultBranchNameFromIntegration(
	container: Container,
	repoPath: string,
	options?: { cancellation?: CancellationToken },
): Promise<string | undefined> {
	const remote = await container.git
		.getRepositoryService(repoPath)
		.remotes.getBestRemoteWithIntegration(undefined, options?.cancellation);
	if (remote == null) return undefined;

	const integration = await remote.getIntegration();
	const defaultBranch = await integration?.getDefaultBranch?.(remote.provider.repoDesc, options);
	return defaultBranch && `${remote.name}/${defaultBranch?.name}`;
}

export function isBranchStarred(container: Container, branchId: string): boolean {
	const starred = container.storage.getWorkspace('starred:branches');
	return starred?.[branchId] === true;
}

export function getStarredBranchIds(container: Container): Set<string> {
	const starred = container.storage.getWorkspace('starred:branches');
	if (starred == null) return new Set();

	return new Set(Object.keys(starred).filter(branchId => starred[branchId] === true));
}

/**
 * Gets the merge base for a branch by checking stored merge target configurations.
 *
 * Among two type of base branches targetBranch, mergeBaseBranch we select one that:
 * - is defined
 * - is not the upstream branch (because the upstream is not a valid base and we have another way to search base commit with the upstream)
 * - has the most recent common commit
 *
 * if mergeBase is not defined we try to use defaultBranch
 *
 * This function consolidates the common logic used in both graph.ts and branchNode.ts
 * for determining if a branch is recomposable.
 */
export async function getBranchMergeBaseAndCommonCommit(
	container: Container,
	branch: GitBranch,
	// options?: GetBranchMergeBaseOptions,
): Promise<{ commit: string; branch: string } | undefined> {
	if (branch.remote) return undefined;

	const isString = Boolean as unknown as (t: string | undefined) => t is string;

	try {
		const svc = container.git.getRepositoryService(branch.repoPath);
		const upstreamName = branch.upstream?.name;

		// Get stored merge target configurations
		const [targetBranchResult, mergeBaseResult, defaultBranchResult] = await Promise.allSettled([
			svc.branches.getStoredMergeTargetBranchName?.(branch.name),
			svc.branches.getBaseBranchName?.(branch.name),
			getDefaultBranchName(container, branch.repoPath, branch.name),
		]);
		const targetBranch = getSettledValue(targetBranchResult);
		const validTargetBranch = targetBranch && targetBranch !== upstreamName ? targetBranch : undefined;
		const mergeBase = getSettledValue(mergeBaseResult) || getSettledValue(defaultBranchResult);
		const validMergeBase = mergeBase && mergeBase !== upstreamName ? mergeBase : undefined;
		const validTargets = [validTargetBranch, validMergeBase].filter(isString);
		if (validTargets.length === 0) return undefined;

		return await selectMostRecentMergeBase(branch.name, validTargets, svc);
	} catch {
		// If we can't determine, assume not recomposable
		return undefined;
	}
}

/**
 * Selects the most recent merge base from multiple target branches.
 *
 * It gets the merge base for each target, then uses isAncestorOf() to find which one is newest.
 */
async function selectMostRecentMergeBase(
	branchName: string,
	targets: string[],
	svc: ReturnType<typeof Container.prototype.git.getRepositoryService>,
): Promise<{ commit: string; branch: string } | undefined> {
	const mergeBaseResults = await Promise.allSettled(
		targets.map(async target => {
			const commit = await svc.refs.getMergeBase(branchName, target);
			return {
				commit: commit,
				branch: target,
			};
		}),
	);
	const mergeBases = mergeBaseResults
		.map(result => getSettledValue(result))
		.filter((r): r is { commit: string; branch: string } => r?.commit != null);

	if (mergeBases.length === 0) return undefined;

	let mostRecentMergeBase = mergeBases[0];
	for (let i = 1; i < mergeBases.length; i++) {
		const isCurrentMoreRecent = await svc.commits.isAncestorOf(mostRecentMergeBase?.commit, mergeBases[i].commit);
		if (isCurrentMoreRecent) {
			mostRecentMergeBase = mergeBases[i];
		}
	}

	return mostRecentMergeBase;
}
