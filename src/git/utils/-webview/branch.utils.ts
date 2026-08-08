import type { BranchDisposition, BranchTargetInfo, GitBranch } from '@gitlens/git/models/branch.js';
import type { PullRequest, PullRequestState } from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import { getBranchNameWithoutRemote } from '@gitlens/git/utils/branch.utils.js';
import { createRevisionRange } from '@gitlens/git/utils/revision.utils.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { MaybePausedResult } from '@gitlens/utils/promise.js';
import { getSettledValue, pauseOnCancelOrTimeout } from '@gitlens/utils/promise.js';
import type { EnrichedAutolink } from '../../../autolinks/models/autolinks.js';
import type { Container } from '../../../container.js';
import type { GitRepositoryService } from '../../gitRepositoryService.js';
import { getBestRemoteWithIntegration, getRemoteIntegration } from './remote.utils.js';

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
		cancellation?: AbortSignal;
		detectedOnly?: boolean;
		timeout?: number;
	},
): Promise<BranchTargetInfo> {
	const [targetResult, baseResult, defaultResult] = await Promise.allSettled([
		getBranchMergeTargetNameWithoutFallback(container, branch, options),
		container.git
			.getRepositoryService(branch.repoPath)
			.branches.getBaseBranchName?.(branch.name, undefined, options?.cancellation),
		getDefaultBranchName(container, branch.repoPath, branch.remoteName, {
			cancellation: options?.cancellation,
		}),
	]);

	if (options?.cancellation?.aborted) throw new CancellationError();

	return {
		mergeTargetBranch: getSettledValue(targetResult) ?? { value: undefined, paused: false },
		baseBranch: getSettledValue(baseResult),
		defaultBranch: getSettledValue(defaultResult),
	};
}

/**
 * True when the merge-target fallback chain landed on the focal branch itself — the default branch has no
 * other branch to target.
 *
 * `targetName` is remote-qualified on desktop and bare from the GitHub provider, hence both comparisons.
 * Only the target is stripped: `getBranchNameWithoutRemote` cuts at the first `/`, so stripping the focal
 * side too would turn `feature/x` into `x`.
 */
export function isSelfMergeTarget(targetName: string, branchName: string): boolean {
	return targetName === branchName || getBranchNameWithoutRemote(targetName) === branchName;
}

export async function getBranchMergeTargetName(
	container: Container,
	branch: GitBranch,
	options?: {
		associatedPullRequest?: Promise<PullRequest | undefined>;
		cancellation?: AbortSignal;
		detectedOnly?: boolean;
		timeout?: number;
	},
): Promise<MaybePausedResult<string | undefined>> {
	async function getMergeTargetFallback() {
		const [baseResult, defaultResult] = await Promise.allSettled([
			container.git
				.getRepositoryService(branch.repoPath)
				.branches.getBaseBranchName?.(branch.name, undefined, options?.cancellation),
			getDefaultBranchName(container, branch.repoPath, branch.remoteName, {
				cancellation: options?.cancellation,
			}),
		]);
		return getSettledValue(baseResult) ?? getSettledValue(defaultResult);
	}

	const result = await getBranchMergeTargetNameWithoutFallback(container, branch, options);
	if (!result.paused) {
		if (result.value) return { value: result.value, paused: false };

		if (options?.cancellation?.aborted) {
			return { value: Promise.resolve(undefined), paused: true, reason: 'cancelled' };
		}

		const fallback = await getMergeTargetFallback();
		if (options?.cancellation?.aborted) {
			return { value: Promise.resolve(undefined), paused: true, reason: 'cancelled' };
		}

		return { value: fallback, paused: false };
	}

	if (options?.cancellation?.aborted || result.reason === 'cancelled') {
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
		cancellation?: AbortSignal;
		detectedOnly?: boolean;
		timeout?: number;
	},
): Promise<MaybePausedResult<string | undefined>> {
	const svc = container.git.getRepositoryService(branch.repoPath);
	const targetBranch = options?.detectedOnly
		? await svc.branches.getStoredDetectedMergeTargetBranchName?.(branch.name)
		: await svc.branches.getStoredMergeTargetBranchName?.(branch.name);
	if (targetBranch) {
		const validated = await svc.refs.getSymbolicReferenceName?.(targetBranch, undefined, options?.cancellation);
		return { value: validated || targetBranch, paused: false };
	}

	if (options?.cancellation?.aborted) return { value: undefined, paused: false };

	return pauseOnCancelOrTimeout(
		(options?.associatedPullRequest ?? getBranchAssociatedPullRequest(container, branch))?.then(pr => {
			if (pr?.refs?.base == null) return undefined;

			const name = `${branch.remoteName}/${pr.refs.base.branch}`;

			// A stacked PR's base is the layer below it — an ephemeral branch that is deleted when the
			// stack merges. Persisting it would outlive the branch it names, and because a stored target
			// wins over every other source it would keep winning, silently, until cleared by hand. Return
			// it for display (per-layer diffs are what makes a stack reviewable) but never write it.
			if (pr.stack != null) return name;

			// Same self-write semantics as `getBranchContributionsOverview`'s Tier 2: the value
			// being stored is the canonical mergeTarget any future overview lookup will resolve
			// to, so skip the wholesale `branchOverviews` invalidation that would otherwise
			// evict an in-cache entry keyed by `${ref}|${name}`.
			void svc.branches.storeMergeTargetBranchName?.(branch.name, name, {
				skipInvalidation: ['branchOverviews'],
			});

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
	options?: { cancellation?: AbortSignal },
): Promise<string | undefined> {
	const name = await container.git
		.getRepositoryService(repoPath)
		.branches.getDefaultBranchName(remoteName, undefined, options?.cancellation);
	return name ?? getDefaultBranchNameFromIntegration(repoPath, options);
}

export async function getDefaultBranchNameFromIntegration(
	repoPath: string,
	options?: { cancellation?: AbortSignal },
): Promise<string | undefined> {
	const remote = await getBestRemoteWithIntegration(repoPath, undefined, options?.cancellation);
	if (remote == null) return undefined;

	const integration = await getRemoteIntegration(remote);
	const defaultBranch = await integration?.getDefaultBranch?.(remote.provider.repoDesc);
	return defaultBranch && `${remote.name}/${defaultBranch?.name}`;
}

export function getStarredBranches(branches: Iterable<GitBranch>): Set<string> {
	const ids = new Set<string>();
	for (const b of branches) {
		if (b.starred) {
			ids.add(b.id);
		}
	}
	return ids;
}

export async function getBranchRemote(container: Container, branch: GitBranch): Promise<GitRemote | undefined> {
	const remoteName = branch.remoteName;
	if (remoteName == null) return undefined;

	return container.git.getRepositoryService(branch.repoPath).remotes.getRemote(remoteName);
}

export async function getBranchAssociatedPullRequest(
	container: Container,
	branch: GitBranch,
	options?: {
		avatarSize?: number;
		include?: PullRequestState[];
		expiryOverride?: boolean | number;
		/** Only return a value already in the local cache. No remote fetch — returns undefined on cache miss. */
		cached?: boolean;
	},
): Promise<PullRequest | undefined> {
	const remote = await getBranchRemote(container, branch);
	if (remote?.provider == null) return undefined;

	const integration = await getRemoteIntegration(remote);

	if (options?.cached) {
		if (branch.upstream?.missing) {
			if (!branch.sha) return undefined;
			return container.cache.peekPullRequestForSha(branch.sha, remote.provider.repoDesc, integration);
		}
		return container.cache.peekPullRequestForBranch(
			branch.trackingWithoutRemote ?? branch.nameWithoutRemote,
			remote.provider.repoDesc,
			integration,
		);
	}

	if (integration == null) return undefined;

	if (branch.upstream?.missing) {
		if (!branch.sha) return undefined;
		return integration.getPullRequestForCommit(remote.provider.repoDesc, branch.sha);
	}

	return integration.getPullRequestForBranch(
		remote.provider.repoDesc,
		branch.trackingWithoutRemote ?? branch.nameWithoutRemote,
		options,
	);
}

export async function getBranchEnrichedAutolinks(
	container: Container,
	branch: GitBranch,
): Promise<Map<string, EnrichedAutolink> | undefined> {
	const remote = await container.git.getRepositoryService(branch.repoPath).remotes.getBestRemoteWithProvider();
	const branchAutolinks = await container.autolinks.getBranchAutolinks(branch.name, remote);
	return container.autolinks.getEnrichedAutolinks(branchAutolinks, remote);
}

export async function getBranchWorktree(
	container: Container,
	branch: GitBranch,
	cancellation?: AbortSignal,
): Promise<GitWorktree | undefined> {
	if (branch.worktree === false) return undefined;

	if (branch.worktree == null) {
		const { id } = branch;
		return container.git
			.getRepositoryService(branch.repoPath)
			.worktrees?.getWorktree(wt => wt.branch?.id === id, cancellation);
	}

	const { path } = branch.worktree;
	return container.git
		.getRepositoryService(branch.repoPath)
		.worktrees?.getWorktree(wt => wt.path === path, cancellation);
}

export async function setBranchDisposition(
	container: Container,
	branch: GitBranch,
	disposition: BranchDisposition | undefined,
): Promise<void> {
	const svc = container.git.getRepositoryService(branch.repoPath);
	await svc.branches.setBranchDisposition?.(branch.name, disposition);

	// Apply paired update: starring a remote branch also stars its local counterpart (and vice versa)
	if (branch.remote) {
		const local = await svc.branches.getLocalBranchByUpstream?.(branch.name);
		if (local != null) {
			await svc.branches.setBranchDisposition?.(local.name, disposition);
		}
	} else if (branch.upstream != null && !branch.upstream.missing) {
		const remoteBranch = await svc.branches.getBranch(branch.upstream.name);
		if (remoteBranch != null) {
			await svc.branches.setBranchDisposition?.(remoteBranch.name, disposition);
		}
	}
}
