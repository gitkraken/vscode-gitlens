import type { BranchDisposition, GitBranch } from '@gitlens/git/models/branch.js';
import type { PullRequest, PullRequestState } from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import type { MergeTarget } from '@gitlens/git/providers/branches.js';
import { createRevisionRange } from '@gitlens/git/utils/revision.utils.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
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

export interface BranchMergeTarget {
	/**
	 * The merge target as of now: the full answer when the lookup settled within `timeout`, else the answer without
	 * the pull request's base
	 */
	readonly target: MergeTarget | undefined;
	/**
	 * Set only when the lookup outlasted `timeout`: settles to its full answer when that names a different ref, else
	 * `undefined`
	 */
	readonly pending: Promise<MergeTarget | undefined> | undefined;
}

export interface BranchTargetInfo extends BranchMergeTarget {
	/** The base recorded or inferred for the branch, for display */
	readonly baseBranch: string | undefined;
	/** The repository's default branch, for display */
	readonly defaultBranch: string | undefined;
}

export interface BranchMergeTargetOptions {
	associatedPullRequest?: Promise<PullRequest | undefined>;
	cancellation?: AbortSignal;
	keepSelfAtTip?: boolean;
	/** How long to wait on the lookup before answering without the pull request (see {@link BranchMergeTarget.pending}) */
	timeout?: number;
}

export async function getBranchMergeTargetInfo(
	container: Container,
	branch: GitBranch,
	options?: BranchMergeTargetOptions,
): Promise<BranchTargetInfo> {
	const [targetResult, baseResult, defaultResult] = await Promise.allSettled([
		getBranchMergeTarget(container, branch, options),
		container.git
			.getRepositoryService(branch.repoPath)
			.branches.getBaseBranchName?.(branch.name, undefined, options?.cancellation),
		getDefaultBranchName(container, branch.repoPath, branch.remoteName, {
			cancellation: options?.cancellation,
		}),
	]);

	if (options?.cancellation?.aborted) throw new CancellationError();

	const merge = getSettledValue(targetResult);
	return {
		target: merge?.target,
		pending: merge?.pending,
		baseBranch: getSettledValue(baseResult),
		defaultBranch: getSettledValue(defaultResult),
	};
}

/**
 * Resolves the branch a branch is measured against. The pull request is read only when the lookup finds no stored
 * target, and only once however many lookups run.
 *
 * With a `timeout`, a slow lookup doesn't hold up the answer: `target` is what resolves without the pull request, and
 * `pending` settles to the full answer when it differs.
 */
export async function getBranchMergeTarget(
	container: Container,
	branch: GitBranch,
	options?: BranchMergeTargetOptions,
): Promise<BranchMergeTarget> {
	const svc = container.git.getRepositoryService(branch.repoPath);

	let pullRequest: Promise<PullRequest | undefined> | undefined;
	function getPullRequest(): Promise<PullRequest | undefined> {
		return (pullRequest ??= options?.associatedPullRequest ?? getBranchAssociatedPullRequest(container, branch));
	}

	function lookup(
		getAssociatedPullRequest: (() => Promise<PullRequest | undefined>) | undefined,
	): Promise<MergeTarget | undefined> {
		return svc.branches.getMergeTarget(
			branch.name,
			{
				inferBase: true,
				defaultBranch: 'remote',
				keepSelfAtTip: options?.keepSelfAtTip,
				getFallbackDefaultBranch: () =>
					getDefaultBranchNameFromIntegration(branch.repoPath, { cancellation: options?.cancellation }),
				getAssociatedPullRequest: getAssociatedPullRequest,
			},
			options?.cancellation,
		);
	}

	const full = lookup(getPullRequest);
	if (options?.timeout == null) return { target: await full, pending: undefined };

	// The whole lookup is bounded, not only its pull request read: core joins a lookup of the same branch already in
	// flight, such as the overview's, which waits on the pull request however long it takes
	const result = await pauseOnCancelOrTimeout(full, options.cancellation, options.timeout);
	if (!result.paused) return { target: result.value, pending: undefined };

	const late = result.value.catch(() => undefined);
	if (result.reason === 'cancelled') throw new CancellationError();

	// Without the pull request, core keys the lookup apart from one waiting on it
	const target = await lookup(undefined);
	return { target: target, pending: late.then(t => (t?.ref !== target?.ref ? t : undefined)) };
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
		/** Rethrow a failed lookup rather than folding it into `undefined` ("no pull request"). */
		throwOnError?: boolean;
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
		return integration.getPullRequestForCommit(remote.provider.repoDesc, branch.sha, {
			throwOnError: options?.throwOnError,
		});
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
			.worktrees?.getWorktree(wt => wt.branch?.id === id, undefined, cancellation);
	}

	const { path } = branch.worktree;
	return container.git
		.getRepositoryService(branch.repoPath)
		.worktrees?.getWorktree(wt => wt.path === path, undefined, cancellation);
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
