import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import type { GitStatus } from '@gitlens/git/models/status.js';
import { GitWorktree } from '@gitlens/git/models/worktree.js';
import type { BranchContributionsOverview } from '@gitlens/git/providers/branches.js';
import { createRevisionRange } from '@gitlens/git/utils/revision.utils.js';
import { filterMap } from '@gitlens/utils/iterable.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { EnrichedAutolink } from '../../autolinks/models/autolinks.js';
import type { Container } from '../../container.js';
import { getAssociatedIssuesForBranch } from '../../git/utils/-webview/branch.issue.utils.js';
import {
	getBranchAssociatedPullRequest,
	getBranchEnrichedAutolinks,
	getBranchMergeTargetInfo,
	getBranchRemote,
} from '../../git/utils/-webview/branch.utils.js';
import { getContributorAvatarUri } from '../../git/utils/-webview/contributor.utils.js';
import type { LaunchpadCategorizedResult } from '../../plus/launchpad/launchpadProvider.js';
import { getLaunchpadItemGroups } from '../../plus/launchpad/launchpadProvider.js';
import type {
	GetOverviewEnrichmentResponse,
	GetOverviewWipResponse,
	OverviewBranchContributor,
	OverviewBranchEnrichment,
	OverviewBranchIssue,
	OverviewBranchLaunchpadItem,
	OverviewBranchMergeTarget,
	OverviewBranchPullRequest,
} from './overviewBranches.js';

export async function getAutolinkIssuesInfo(
	links: Map<string, EnrichedAutolink> | undefined,
): Promise<OverviewBranchIssue[]> {
	if (links == null) return [];

	const results = await Promise.allSettled(
		filterMap([...links.values()], async autolink => {
			const issueOrPullRequest = autolink?.[0];
			if (issueOrPullRequest == null) return undefined;

			const issue = await issueOrPullRequest;
			if (issue == null) return undefined;

			return { id: issue.id, title: issue.title, url: issue.url, state: issue.state };
		}),
	);

	return results.map(r => (r.status === 'fulfilled' ? r.value : undefined)).filter(r => r != null);
}

export async function getContributorsInfo(
	_container: Container,
	contributorsPromise: Promise<BranchContributionsOverview | undefined> | undefined,
): Promise<OverviewBranchContributor[]> {
	if (contributorsPromise == null) return [];

	const contributors = await contributorsPromise;
	if (contributors?.contributors == null) return [];

	const result = await Promise.allSettled(
		contributors.contributors.map(
			async c =>
				({
					name: c.name ?? '',
					email: c.email ?? '',
					current: c.current,
					timestamp: c.latestCommitDate?.getTime(),
					count: c.contributionCount,
					stats: c.stats,
					avatarUrl: (await getContributorAvatarUri(c))?.toString(),
				}) satisfies OverviewBranchContributor,
		),
	);
	return result.map(r => (r.status === 'fulfilled' ? r.value : undefined)).filter(r => r != null);
}

export async function getBranchMergeTargetStatusInfo(
	container: Container,
	branch: GitBranch,
): Promise<OverviewBranchMergeTarget | undefined> {
	const info = await getBranchMergeTargetInfo(container, branch, {
		associatedPullRequest: getBranchAssociatedPullRequest(container, branch),
	});

	let targetResult;
	if (!info.mergeTargetBranch.paused && info.mergeTargetBranch.value) {
		targetResult = info.mergeTargetBranch.value;
	}

	const target = targetResult ?? info.baseBranch ?? info.defaultBranch;
	if (target == null) return undefined;

	const svc = container.git.getRepositoryService(branch.repoPath);
	const targetBranch = await svc.branches.getBranch(target);
	// The tip SHA is required — without it the graph's scope anchor can't be placed.
	if (targetBranch?.sha == null) return undefined;

	const [countsResult, conflictResult, mergedStatusResult] = await Promise.allSettled([
		svc.commits.getLeftRightCommitCount(createRevisionRange(targetBranch.name, branch.ref, '...'), {
			excludeMerges: true,
		}),
		svc.branches.getPotentialMergeConflicts?.(branch.name, targetBranch.name),
		svc.branches.getBranchMergedStatus?.(branch, targetBranch),
	]);

	const counts = getSettledValue(countsResult);
	const status = counts != null ? { ahead: counts.right, behind: counts.left } : undefined;
	const mergedStatus = getSettledValue(mergedStatusResult);

	return {
		repoPath: branch.repoPath,
		id: targetBranch.id,
		sha: targetBranch.sha,
		name: targetBranch.name,
		status: status,
		mergedStatus: mergedStatus,
		potentialConflicts: getSettledValue(conflictResult),
		targetBranch: targetBranch.name,
		baseBranch: info.baseBranch,
		defaultBranch: info.defaultBranch,
	};
}

export async function getLaunchpadItemInfo(
	container: Container,
	pr: PullRequest,
	launchpadPromise: Promise<LaunchpadCategorizedResult> | undefined,
): Promise<OverviewBranchLaunchpadItem | undefined> {
	launchpadPromise ??= container.launchpad.getCategorizedItems();
	let result = await launchpadPromise;
	if (!result.items) return undefined;

	let lpi = result.items.find(i => i.url === pr.url);
	if (lpi == null) {
		// result = await container.launchpad.getCategorizedItems({ search: pr.url });
		result = await container.launchpad.getCategorizedItems({ search: [pr] });
		if (!result.items) return undefined;

		lpi = result.items.find(i => i.url === pr.url);
	}

	if (lpi == null) return undefined;

	return {
		uuid: lpi.uuid,
		category: lpi.actionableCategory,
		groups: getLaunchpadItemGroups(lpi),
		suggestedActions: lpi.suggestedActions,

		failingCI: lpi.failingCI,
		hasConflicts: lpi.hasConflicts,

		review: {
			decision: lpi.reviewDecision,
			reviews: lpi.reviews ?? [],
			counts: {
				approval: lpi.approvalReviewCount,
				changeRequest: lpi.changeRequestReviewCount,
				comment: lpi.commentReviewCount,
				codeSuggest: lpi.codeSuggestionsCount,
			},
		},

		author: lpi.author,
		createdDate: lpi.createdDate,

		viewer: { ...lpi.viewer, enrichedItems: undefined },
	};
}

export async function getPullRequestInfo(
	container: Container,
	branch: GitBranch,
	launchpadPromise: Promise<LaunchpadCategorizedResult> | undefined,
	associatedPullRequest?: Promise<PullRequest | undefined>,
): Promise<OverviewBranchPullRequest | undefined> {
	const pr = await (associatedPullRequest ?? getBranchAssociatedPullRequest(container, branch, { avatarSize: 64 }));
	if (pr == null) return undefined;

	return {
		id: pr.id,
		url: pr.url,
		state: pr.state,
		title: pr.title,
		draft: pr.isDraft,
		launchpad: getLaunchpadItemInfo(container, pr, launchpadPromise),
	};
}

export async function getOverviewWip(
	container: Container,
	branches: Iterable<GitBranch>,
	worktreesByBranch: ReadonlyMap<string, GitWorktree>,
	branchIds: string[],
	options?: { signal?: AbortSignal },
): Promise<GetOverviewWipResponse> {
	if (branchIds.length === 0) return {};

	const branchesById = new Map<string, GitBranch>();
	for (const branch of branches) {
		if (branch.remote) continue;
		branchesById.set(branch.id, branch);
	}

	const result: GetOverviewWipResponse = {};
	const statusPromises = new Map<string, Promise<GitStatus | undefined>>();
	let repoStatusPromise: Promise<GitStatus | undefined> | undefined;

	for (const branchId of branchIds) {
		const branch = branchesById.get(branchId);
		if (branch == null) continue;

		const wt = worktreesByBranch.get(branchId);
		if (wt != null) {
			statusPromises.set(branchId, GitWorktree.getStatus(wt));
		} else if (branch.current) {
			repoStatusPromise ??= container.git.getRepositoryService(branch.repoPath).status.getStatus();
			statusPromises.set(branchId, repoStatusPromise);
		}
	}

	await Promise.allSettled(
		Array.from(statusPromises.entries(), async ([branchId, statusPromise]) => {
			const branch = branchesById.get(branchId)!;
			const isActive = branch.current || worktreesByBranch.get(branchId)?.opened === true;
			const [statusResult, pausedOpStatusResult] = await Promise.allSettled([
				statusPromise,
				isActive
					? container.git.getRepositoryService(branch.repoPath).pausedOps?.getPausedOperationStatus?.()
					: undefined,
			]);

			const status = getSettledValue(statusResult);
			const pausedOpStatus = getSettledValue(pausedOpStatusResult);

			if (status != null || pausedOpStatus != null) {
				result[branchId] = {
					workingTreeState: status?.diffStatus,
					hasConflicts: status?.hasConflicts,
					conflictsCount: status?.conflicts.length,
					pausedOpStatus: pausedOpStatus,
				};
			}
		}),
	);

	options?.signal?.throwIfAborted();
	return result;
}

interface BranchEnrichmentPromises {
	remote?: Promise<GitRemote | undefined>;
	pr?: Promise<OverviewBranchPullRequest | undefined>;
	autolinks?: ReturnType<typeof getBranchEnrichedAutolinks>;
	issues?: Promise<Issue[] | undefined>;
	contributors?: Promise<BranchContributionsOverview | undefined>;
	mergeTarget?: Promise<OverviewBranchMergeTarget | undefined>;
}

export async function getOverviewEnrichment(
	container: Container,
	branches: Iterable<GitBranch>,
	branchIds: string[],
	options: {
		isPro: boolean;
		/** When true, `await` each `pr.launchpad` and populate `enrichment.resolvedLaunchpad`. Use for transports that can't serialize Promises (traditional IPC). */
		resolveLaunchpad?: boolean;
		signal?: AbortSignal;
	},
): Promise<GetOverviewEnrichmentResponse> {
	if (branchIds.length === 0) return {};

	const { isPro, resolveLaunchpad, signal } = options;
	const launchpadPromise: Promise<LaunchpadCategorizedResult> | undefined = isPro
		? container.launchpad.getCategorizedItems()
		: undefined;

	const branchesById = new Map<string, GitBranch>();
	for (const branch of branches) {
		if (branch.remote) continue;
		branchesById.set(branch.id, branch);
	}

	const enrichmentPromises = new Map<string, BranchEnrichmentPromises>();

	for (const branchId of branchIds) {
		const branch = branchesById.get(branchId);
		if (branch == null) continue;

		const promises: BranchEnrichmentPromises = {};

		if (branch.upstream?.missing === false) {
			promises.remote = getBranchRemote(container, branch);
		}

		if (isPro) {
			const associatedPR = getBranchAssociatedPullRequest(container, branch, { avatarSize: 64 });
			promises.pr = getPullRequestInfo(container, branch, launchpadPromise, associatedPR);
			promises.autolinks = getBranchEnrichedAutolinks(container, branch);
			promises.issues = getAssociatedIssuesForBranch(container, branch).then(issues => issues.value);
			promises.contributors = container.git
				.getRepositoryService(branch.repoPath)
				.branches.getBranchContributionsOverview(branch.ref, { associatedPullRequest: associatedPR });
			// Compute merge target for every enriched branch (not just the current one) so the graph's
			// scope popover can render a merge-target anchor when the user focuses any branch, and so
			// recent-branch cards can show merged status.
			promises.mergeTarget = getBranchMergeTargetStatusInfo(container, branch);
		}

		enrichmentPromises.set(branchId, promises);
	}

	const result: GetOverviewEnrichmentResponse = {};

	await Promise.allSettled(
		Array.from(enrichmentPromises.entries(), async ([branchId, promises]) => {
			const enrichment: OverviewBranchEnrichment = {};

			const [remoteResult, prResult, autolinksResult, issuesResult, contributorsResult, mergeTargetResult] =
				await Promise.allSettled([
					promises.remote,
					promises.pr,
					promises.autolinks?.then(a => getAutolinkIssuesInfo(a)),
					promises.issues?.then(
						issues =>
							issues?.map(i => ({
								id: i.number || i.id,
								title: i.title,
								state: i.state,
								url: i.url,
							})) ?? [],
					),
					getContributorsInfo(container, promises.contributors),
					promises.mergeTarget,
				]);

			const remote = getSettledValue(remoteResult);
			if (remote != null) {
				enrichment.remote = {
					name: remote.name,
					provider: remote.provider
						? {
								name: remote.provider.name,
								icon: remote.provider.icon === 'remote' ? 'cloud' : remote.provider.icon,
								url: await remote.provider.url({ type: RemoteResourceType.Repo }),
								supportedFeatures: remote.provider.supportedFeatures,
							}
						: undefined,
				};
			}

			const prValue = getSettledValue(prResult);
			if (prValue != null) {
				enrichment.pr = prValue;
				if (resolveLaunchpad && prValue.launchpad != null) {
					enrichment.resolvedLaunchpad = await prValue.launchpad;
				}
			}
			enrichment.autolinks = getSettledValue(autolinksResult);
			enrichment.issues = getSettledValue(issuesResult);
			enrichment.contributors = getSettledValue(contributorsResult);
			enrichment.mergeTarget = getSettledValue(mergeTargetResult);

			result[branchId] = enrichment;
		}),
	);

	signal?.throwIfAborted();
	return result;
}
