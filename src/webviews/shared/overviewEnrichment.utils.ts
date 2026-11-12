import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { Issue } from '@gitlens/git/models/issue.js';
import type {
	PullRequest,
	PullRequestMergeQueueEntry,
	PullRequestMergeQueueRemoval,
	PullRequestShape,
} from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import type { GitStatus } from '@gitlens/git/models/status.js';
import { GitWorktree } from '@gitlens/git/models/worktree.js';
import type { BranchContributionsOverview, GitBranchMergedStatus } from '@gitlens/git/providers/branches.js';
import type { GitCommandPriority } from '@gitlens/git/run.types.js';
import { getBranchReflogWork } from '@gitlens/git/utils/branch.utils.js';
import type { BranchLandedPullRequestCandidate, BranchLandedState } from '@gitlens/git/utils/branchLanded.utils.js';
import { getBranchLandedState } from '@gitlens/git/utils/branchLanded.utils.js';
import {
	getPullRequestNumberFromUrl,
	isPullRequestInMergeQueue,
	isPullRequestMergeQueueRemovalCurrent,
} from '@gitlens/git/utils/pullRequest.utils.js';
import { createRevisionRange } from '@gitlens/git/utils/revision.utils.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { filterMap } from '@gitlens/utils/iterable.js';
import { getSettledValue, pauseOnCancelOrTimeout } from '@gitlens/utils/promise.js';
import type { EnrichedAutolink } from '../../autolinks/models/autolinks.js';
import type { Container } from '../../container.js';
import { isContinuingPausedOperation } from '../../git/actions/pausedOperation.js';
import type { GitRepositoryService } from '../../git/gitRepositoryService.js';
import { getAssociatedIssuesForBranch } from '../../git/utils/-webview/branch.issue.utils.js';
import {
	cacheBranchAssociatedPullRequest,
	getBranchAssociatedPullRequest,
	getBranchEnrichedAutolinks,
	getBranchMergeTargetInfo,
	getBranchPullRequestsByHeadName,
	getBranchRemote,
	getDefaultBranchNameFromIntegration,
} from '../../git/utils/-webview/branch.utils.js';
import { getContributorAvatarUri } from '../../git/utils/-webview/contributor.utils.js';
import { isSubscriptionTrialOrPaidFromState } from '../../plus/gk/utils/subscription.utils.js';
import type { LaunchpadCategorizedResult } from '../../plus/launchpad/launchpadProvider.js';
import { getLaunchpadItemGroups } from '../../plus/launchpad/launchpadProvider.js';
import type {
	GetOverviewEnrichmentResponse,
	GetOverviewWipResponse,
	OverviewBranchContributor,
	OverviewBranchEnrichment,
	OverviewBranchIssue,
	OverviewBranchLanded,
	OverviewBranchLaunchpadItem,
	OverviewBranchMergeTarget,
	OverviewBranchPullRequest,
	SerializedPullRequestMergeQueueEntry,
	SerializedPullRequestMergeQueueRemoval,
} from './overviewBranches.js';

/** A pull request's merge-queue entry for the webviews, or `undefined` while it isn't queued. */
export function serializePullRequestMergeQueue(pr: {
	readonly state?: string;
	readonly mergeQueue?: PullRequestMergeQueueEntry;
}): SerializedPullRequestMergeQueueEntry | undefined {
	if (!isPullRequestInMergeQueue(pr)) return undefined;

	const entry = pr.mergeQueue;
	return {
		state: entry.state,
		enqueuedAt: entry.enqueuedAt.getTime(),
		estimatedMergeAt: entry.estimatedMergeAt?.getTime(),
		url: entry.url,
		position: entry.position,
	};
}

/** A pull request's merge-queue removal for the webviews, or `undefined` once it no longer describes the pull request
 *  (see `isPullRequestMergeQueueRemovalCurrent`) — decided here, so the webviews need only its presence. */
export function serializePullRequestMergeQueueRemoval(pr: {
	readonly state?: string;
	readonly updatedDate: Date;
	readonly mergeQueue?: PullRequestMergeQueueEntry;
	readonly mergeQueueRemoval?: PullRequestMergeQueueRemoval;
}): SerializedPullRequestMergeQueueRemoval | undefined {
	if (!isPullRequestMergeQueueRemovalCurrent(pr)) return undefined;

	return { reason: pr.mergeQueueRemoval.reason, removedAt: pr.mergeQueueRemoval.removedAt.getTime() };
}

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

			return {
				type: issue.type,
				id: issue.id,
				title: issue.title,
				url: issue.url,
				state: issue.state,
				draft: issue.type === 'pullrequest' ? (issue as PullRequestShape).isDraft : undefined,
				mergeQueue: issue.type === 'pullrequest' ? serializePullRequestMergeQueue(issue) : undefined,
			};
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

/** How long pull request reads may hold up the merge-target status, all together, before it answers without them */
const lookupTimeout = 5000;

/** What's left of a shared deadline. At 0, a read that has already settled still wins: the timer fires after it */
function getRemainingTimeout(deadline: number): number {
	return Math.max(0, deadline - Date.now());
}

export async function getBranchMergeTargetStatusInfo(
	container: Container,
	branch: GitBranch,
	cancellation?: AbortSignal,
	associatedPullRequest?: Promise<PullRequest | undefined>,
): Promise<OverviewBranchMergeTarget | undefined> {
	// Forward cancellation and bound the PR-based merge-target lookup. Without these the
	// integration call (e.g. GitHub PR fetch) can take seconds-to-indefinite when slow,
	// stranding the webview's mergeTarget loading flag because the RPC promise never settles.
	// On timeout the answer without the pull request's base is used and the late one is ignored — a usable
	// answer instead of a stuck spinner.
	associatedPullRequest ??= getBranchAssociatedPullRequest(container, branch);
	// One deadline across the target lookup and the landed verdict's reads, so their waits can't add up
	const deadline = Date.now() + lookupTimeout;
	const info = await getBranchMergeTargetInfo(container, branch, {
		associatedPullRequest: associatedPullRequest,
		cancellation: cancellation,
		timeout: lookupTimeout,
	});

	const target = info.target?.ref;
	if (target == null) return undefined;

	const svc = container.git.getRepositoryService(branch.repoPath);
	const targetBranch = await svc.branches.getBranch(target, undefined, cancellation);
	// The tip SHA is required — without it the graph's scope anchor can't be placed.
	if (targetBranch?.sha == null) return undefined;

	// Conflict detection is Pro — same gate as its siblings (the merge/cherry-pick/rebase wizards and
	// the pull conflict preview), which this chip's field must agree with. The rest of the chip
	// (ahead/behind, merged status) stays ungated.
	const subscription = await container.subscription.getSubscription();
	const conflictsAllowed = isSubscriptionTrialOrPaidFromState(subscription?.state);

	const [countsResult, conflictResult, mergedStatusResult] = await Promise.allSettled([
		svc.commits.getLeftRightCommitCount(
			createRevisionRange(targetBranch.name, branch.ref, '...'),
			{ excludeMerges: true },
			cancellation,
		),
		conflictsAllowed
			? svc.branches.getPotentialMergeConflicts?.(branch.name, targetBranch.name, cancellation)
			: undefined,
		svc.branches.getBranchMergedStatus?.(branch, targetBranch, cancellation),
	]);

	const counts = getSettledValue(countsResult);
	const status = counts != null ? { ahead: counts.right, behind: counts.left } : undefined;
	const rawMergedStatus = getSettledValue(mergedStatusResult);

	let reflogWork: Promise<BranchReflogWork> | undefined;
	const getReflogWork = (): Promise<BranchReflogWork> =>
		(reflogWork ??= readBranchReflogWork(svc, branch, cancellation));

	// Zero unique commits vs. the target reads as "merged" to `git merge-base --is-ancestor`, but that is
	// also true of a brand-new branch, so the branch's reflog decides whether it was really merged.
	const mergedStatus =
		rawMergedStatus?.merged && status?.ahead === 0
			? await getZeroAheadMergedStatus(branch, rawMergedStatus, getReflogWork)
			: rawMergedStatus;

	// Decided apart from `mergedStatus`, which vscode.dev can't compute, so a pull request still decides there
	const verdict = await getBranchLandedVerdict(
		container,
		svc,
		branch,
		targetBranch.name,
		targetBranch.nameWithoutRemote,
		status?.ahead,
		associatedPullRequest,
		mergedStatus,
		getReflogWork,
		deadline,
		cancellation,
	);

	return {
		repoPath: branch.repoPath,
		id: targetBranch.id,
		sha: targetBranch.sha,
		name: targetBranch.name,
		status: status,
		mergedStatus: mergedStatus,
		landed: verdict.landed,
		successor: verdict.successor,
		potentialConflicts: getSettledValue(conflictResult),
		targetBranch: targetBranch.name,
		baseBranch: info.baseBranch,
		defaultBranch: info.defaultBranch,
	};
}

type BranchReflogWork = ReturnType<typeof getBranchReflogWork>;

async function readBranchReflogWork(
	svc: GitRepositoryService,
	branch: GitBranch,
	cancellation?: AbortSignal,
): Promise<BranchReflogWork> {
	// Only a local branch has its own reflog
	if (branch.remote) return 'unknown';

	try {
		const entries = await svc.refs.getReflogEntries?.(`refs/heads/${branch.name}`, undefined, cancellation);
		return entries != null ? getBranchReflogWork(entries, branch.name) : 'unknown';
	} catch (ex) {
		if (isCancellationError(ex)) throw ex;

		return 'unknown';
	}
}

/**
 * Git evidence only. A merged pull request is checked before this is consulted (see `getBranchLandedVerdict`), so
 * this decides only when the branch's pull requests say nothing — and on its own, `mergedStatus` stays git evidence.
 */
async function getZeroAheadMergedStatus(
	branch: GitBranch,
	rawMergedStatus: Extract<GitBranchMergedStatus, { merged: true }>,
	getReflogWork: () => Promise<BranchReflogWork>,
): Promise<GitBranchMergedStatus> {
	// The upstream was deleted after the merge, which is a strong signal it really was merged
	if (branch.upstream?.missing) return rawMergedStatus;

	switch (await getReflogWork()) {
		case 'work':
			return rawMergedStatus;
		case 'none':
			return { merged: false };
		default:
			// Can't tell, so show it as "Likely Merged" (confidence below 'highest')
			return { ...rawMergedStatus, confidence: 'high' };
	}
}

/**
 * Whether the branch's work landed: its pull request decides first, then git evidence. When neither does and the
 * by-ref read found no pull request, the pull requests are read by head name once (cached) — the by-ref read
 * answers "none" once the host deletes a merged pull request's head branch, until the user prunes.
 */
async function getBranchLandedVerdict(
	container: Container,
	svc: GitRepositoryService,
	branch: GitBranch,
	target: string,
	targetWithoutRemote: string,
	ahead: number | undefined,
	associatedPullRequest: Promise<PullRequest | undefined>,
	mergedStatus: GitBranchMergedStatus | undefined,
	getReflogWork: () => Promise<BranchReflogWork>,
	deadline: number,
	cancellation?: AbortSignal,
): Promise<{ landed?: OverviewBranchLanded; successor?: BranchLandedState['successor'] }> {
	const tip = branch.sha;
	if (!tip) return {};

	const ctx: LandedCheckContext = {
		svc: svc,
		branch: branch,
		tip: tip,
		target: target,
		targetWithoutRemote: targetWithoutRemote,
		ahead: ahead,
		getReflogWork: getReflogWork,
		cancellation: cancellation,
	};

	const pr = await pauseOnCancelOrTimeout(
		associatedPullRequest.catch(() => undefined),
		cancellation,
		getRemainingTimeout(deadline),
	);
	cancellation?.throwIfAborted();

	if (!pr.paused && pr.value != null) {
		const state = await getPullRequestsLandedState(ctx, [pr.value]);
		// A live pull request at the tip means nothing landed, whatever git evidence says
		if (state.live) return {};
		if (state.landed != null || state.successor != null) {
			return { landed: withTipSha(state.landed, tip), successor: state.successor };
		}
	}

	if (mergedStatus?.merged) {
		return { landed: { via: 'git', confidence: mergedStatus.confidence } };
	}

	// Only a proven miss: a pull request that's still loading may yet decide
	if (pr.paused || pr.value != null) return {};

	const byName = await pauseOnCancelOrTimeout(
		getBranchPullRequestsByHeadName(container, branch).catch(() => undefined),
		cancellation,
		getRemainingTimeout(deadline),
	);
	cancellation?.throwIfAborted();
	if (byName.paused || !byName.value?.length) return {};

	const prs = byName.value;
	const state = await getPullRequestsLandedState(ctx, prs);
	if (state.live) return {};

	// So the branch's pull request pill agrees with the verdict, rather than keep the by-ref read's "none"
	const decidingUrl = state.landed?.pullRequest?.url ?? state.successor?.pullRequest.url;
	const deciding = decidingUrl != null ? prs.find(p => p.url === decidingUrl) : undefined;
	if (deciding != null) {
		void cacheBranchAssociatedPullRequest(container, branch, deciding);
	}

	return { landed: withTipSha(state.landed, tip), successor: state.successor };
}

/** Stamps a pull request verdict with the tip it was decided for, so a cached copy can't vouch for a later tip */
function withTipSha(landed: BranchLandedState['landed'], tip: string): OverviewBranchLanded | undefined {
	return landed != null ? { ...landed, tipSha: tip } : undefined;
}

interface LandedCheckContext {
	readonly svc: GitRepositoryService;
	readonly branch: GitBranch;
	readonly tip: string;
	/** The merge target's branch name */
	readonly target: string;
	/** The merge target's branch name without its remote, as a pull request's base names it */
	readonly targetWithoutRemote: string;
	/** The branch's commits not in the merge target (merges excluded), when known */
	readonly ahead: number | undefined;
	readonly getReflogWork: () => Promise<BranchReflogWork>;
	readonly cancellation: AbortSignal | undefined;
}

const maxCountedPullRequests = 3;

async function getPullRequestsLandedState(
	ctx: LandedCheckContext,
	prs: readonly PullRequest[],
): Promise<BranchLandedState> {
	// A pull request merged into another base (a release branch, or the branch below in a stack) didn't land the
	// branch's work in the merge target, so it can't vouch for it. An open one still counts: at the tip, it's live
	const relevant = prs.filter(
		p => p.state !== 'merged' || !p.refs?.base?.branch || p.refs.base.branch === ctx.targetWithoutRemote,
	);

	// Commits are only counted when no pull request's head is the tip — that alone decides
	const atTip = relevant.some(p => p.refs?.head?.sha === ctx.tip);

	// Each count is two rev-lists and the by-name read returns up to 10, so only the newest few are counted
	let counted = 0;
	const candidates = await Promise.all(
		relevant.map(async (p): Promise<BranchLandedPullRequestCandidate> => {
			const headSha = p.refs?.head?.sha;
			if (atTip || p.state !== 'merged' || !headSha || counted >= maxCountedPullRequests) {
				return { pullRequest: p };
			}

			counted++;
			return { pullRequest: p, newCommits: await getCommitsNotInPullRequest(ctx, headSha) };
		}),
	);

	return getBranchLandedState(ctx.tip, candidates);
}

/**
 * The branch's commits that are in neither the pull request's head nor the merge target, or `undefined` when that
 * can't be told — which leaves the pull request undecided, since a wrong 0 would offer the branch for a forced delete.
 */
async function getCommitsNotInPullRequest(ctx: LandedCheckContext, headSha: string): Promise<number | undefined> {
	const { svc, branch, tip, target, ahead, cancellation } = ctx;

	// The head can be missing locally, e.g. when the host added commits the user never fetched
	if ((await svc.refs.validateReference(headSha, undefined, cancellation)) == null) return undefined;

	const counts = await svc.commits.getLeftRightCommitCount(
		createRevisionRange(headSha, tip, '...'),
		{ excludeMerges: true },
		cancellation,
	);
	if (counts == null) return undefined;

	// Rewritten since the pull request (a rebase or reset), so its head says nothing about the tip
	if (counts.left > 0 && counts.right > 0) return undefined;

	// The tip is in the head's history, so the pull request carried all of it
	if (counts.right === 0) return 0;

	if (ahead == null) return undefined;

	// The head is in the tip's history, so the tip's commits not in the target (`ahead`) are the head's own commits
	// not in the target plus the new ones. Counting from the target rather than from the head leaves out what
	// pulling the target in brought, which a squash merge would otherwise count as new
	const headCounts = await svc.commits.getLeftRightCommitCount(
		createRevisionRange(target, headSha, '...'),
		{ excludeMerges: true },
		cancellation,
	);
	if (headCounts == null) return undefined;

	const newCommits = Math.max(0, ahead - headCounts.right);
	if (newCommits > 0) return newCommits;

	// The tip is past the head yet adds nothing — a branch freshly cut from a target that already holds an old
	// same-named pull request's head reads the same as a stale one. Only a reflog showing work here tells them apart;
	// PR evidence alone mustn't offer a forced delete for a tip the pull request never saw
	if (!branch.upstream?.missing && (await ctx.getReflogWork()) !== 'work') return undefined;

	return 0;
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
		number: getPullRequestNumberFromUrl(pr.url) ?? pr.id,
		url: pr.url,
		state: pr.state,
		title: pr.title,
		draft: pr.isDraft,
		authorName: pr.author?.name,
		updatedDate: pr.updatedDate?.getTime(),
		reviewDecision: pr.reviewDecision,
		providerId: pr.provider.id,
		stack:
			pr.stack != null
				? { number: pr.stack.number, position: pr.stack.position, size: pr.stack.size }
				: undefined,
		mergeQueue: serializePullRequestMergeQueue(pr),
		mergeQueueRequired: pr.mergeQueueRequired,
		mergeQueueRemoval: serializePullRequestMergeQueueRemoval(pr),
		launchpad: getLaunchpadItemInfo(container, pr, launchpadPromise),
	};
}

export async function getOverviewWip(
	container: Container,
	branches: Iterable<GitBranch>,
	worktreesByBranch: ReadonlyMap<string, GitWorktree>,
	branchIds: string[],
	options?: {
		priority?: GitCommandPriority;
		signal?: AbortSignal;
		/**
		 * Optional cache-aware status fetcher. Callers (the Graph webview) supply a callback that
		 * routes through their `_wipStatusCache` so repeat hovers / overview refreshes within the
		 * cache TTL don't re-fetch. When omitted, falls back to direct fetches (Home uses this).
		 */
		fetchStatus?: (repoPath: string, signal?: AbortSignal) => Promise<GitStatus | undefined>;
		/**
		 * Cheap mode for Recent worktree-backed branches: probes `status.hasWorkingChanges()`
		 * (`git diff --quiet` + `git ls-files`) per worktree instead of running a full status. Result
		 * carries `hasChanges` only — `workingTreeState`, conflicts, and pausedOp are all undefined
		 * and get filled in lazily on hover via `GraphOverviewService.getWipDetailed`. The probe is
		 * `@gate`d at the sub-provider so concurrent identical calls dedup.
		 */
		cheap?: boolean;
	},
): Promise<GetOverviewWipResponse> {
	if (branchIds.length === 0) return {};

	const { priority, signal, fetchStatus, cheap } = options ?? {};
	const statusOptions = priority != null ? { priority: priority } : undefined;

	const branchesById = new Map<string, GitBranch>();
	for (const branch of branches) {
		if (branch.remote) continue;

		branchesById.set(branch.id, branch);
	}

	const result: GetOverviewWipResponse = {};

	if (cheap) {
		// Cheap path: dirty-bit only, no paused-op, no breakdown. Used for Recent worktree-backed
		// cards so they can show a clean/dirty indicator without paying for a full `git status` per
		// branch. The full breakdown is fetched on hover via `GraphOverviewService.getWipDetailed`.
		await Promise.allSettled(
			branchIds.map(async branchId => {
				if (!branchesById.has(branchId)) return;

				const wt = worktreesByBranch.get(branchId);
				const path = wt != null && wt.type !== 'bare' ? wt.uri.fsPath : undefined;
				if (path == null) return;

				// Pin staged/unstaged/untracked to true so this matches `status.files.length > 0`
				// (the full-status path's dirty check). Without it, defaults could exclude one of
				// those categories and the cheap probe would disagree with the on-hover detailed
				// fetch — e.g. an all-staged worktree showing the clean pill until hover.
				const hasChanges = await container.git
					.getRepositoryService(path)
					.status.hasWorkingChanges({ staged: true, unstaged: true, untracked: true }, signal);
				result[branchId] = { hasChanges: hasChanges };
			}),
		);

		signal?.throwIfAborted();
		return result;
	}

	const statusPromises = new Map<string, Promise<GitStatus | undefined>>();
	let repoStatusPromise: Promise<GitStatus | undefined> | undefined;

	for (const branchId of branchIds) {
		const branch = branchesById.get(branchId);
		if (branch == null) continue;

		const wt = worktreesByBranch.get(branchId);
		if (wt != null) {
			const wtStatusPromise =
				fetchStatus != null && wt.type !== 'bare'
					? fetchStatus(wt.uri.fsPath, signal)
					: GitWorktree.getStatus(wt, statusOptions, signal);
			statusPromises.set(branchId, wtStatusPromise);
		} else if (branch.current) {
			repoStatusPromise ??=
				fetchStatus != null
					? fetchStatus(branch.repoPath, signal)
					: container.git.getRepositoryService(branch.repoPath).status.getStatus(statusOptions, signal);
			statusPromises.set(branchId, repoStatusPromise);
		}
	}

	await Promise.allSettled(
		Array.from(statusPromises.entries(), async ([branchId, statusPromise]) => {
			const branch = branchesById.get(branchId)!;
			const wt = worktreesByBranch.get(branchId);
			const isActive = branch.current || wt?.opened === true;
			// Paused-op must come from the same repo as the status — for a worktree-backed branch,
			// `branch.repoPath` is the MAIN repo, so a worktree mid-rebase/merge/cherry-pick would
			// otherwise show the main repo's paused-op state (likely none) instead of its own.
			const repoPath = wt?.uri.fsPath ?? branch.repoPath;
			const [statusResult, pausedOpStatusResult] = await Promise.allSettled([
				statusPromise,
				isActive
					? container.git
							.getRepositoryService(repoPath)
							.pausedOps?.getPausedOperationStatus?.(undefined, signal)
					: undefined,
			]);

			const status = getSettledValue(statusResult);
			const pausedOpStatus = getSettledValue(pausedOpStatusResult);

			if (status != null || pausedOpStatus != null) {
				const workingTreeState = status?.diffStatus;
				const hasChanges =
					workingTreeState != null &&
					workingTreeState.added + workingTreeState.changed + workingTreeState.deleted > 0;
				result[branchId] = {
					hasChanges: hasChanges,
					workingTreeState: workingTreeState,
					hasConflicts: status?.hasConflicts,
					conflictsCount: status?.conflicts.length,
					pausedOpStatus: pausedOpStatus,
					// Asked with the same worktree-aware path as the status above — the in-flight set holds
					// the path of the repo that OWNS the paused op. `repoPath` may be a raw `Uri.fsPath`
					// (backslashes on Windows); the lookup normalizes it to the set's key form.
					pausedOpContinuing:
						pausedOpStatus != null && isContinuingPausedOperation(repoPath) ? true : undefined,
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
		/**
		 * Optional caller-provided fetcher for `BranchContributionsOverview`. When supplied, callers
		 * can route the fetch through their own cache so scope resolution and enrichment share one
		 * computation per branch. Must accept the same `associatedPullRequest` promise the
		 * enrichment uses for `pr` so PR-based merge target detection is consistent.
		 */
		getBranchOverview?: (
			branch: GitBranch,
			associatedPullRequest: Promise<PullRequest | undefined>,
		) => Promise<BranchContributionsOverview | undefined>;
		/**
		 * Skip the (expensive) per-branch merge-target fetch. Callers that defer merge-target
		 * loading to the moment a consumer actually needs it (e.g. the graph overview card's rich
		 * hover) opt in here so initial enrichment doesn't pay for ~4 git/integration ops per branch.
		 */
		skipMergeTarget?: boolean;
		/**
		 * Priority for the underlying git operations on the *fallback* branch-overview path (when
		 * `getBranchOverview` is not provided). Callers wiring their own `getBranchOverview` must
		 * apply this themselves — there's no automatic plumbing past the callback boundary.
		 */
		priority?: GitCommandPriority;
	},
): Promise<GetOverviewEnrichmentResponse> {
	if (branchIds.length === 0) return {};

	const { isPro, resolveLaunchpad, signal, getBranchOverview, skipMergeTarget, priority } = options;
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
			promises.issues = getAssociatedIssuesForBranch(container, branch).then(async result =>
				(await result.value)?.map(association => association.issue),
			);
			promises.contributors =
				getBranchOverview?.(branch, associatedPR) ??
				container.git.getRepositoryService(branch.repoPath).branches.getBranchContributionsOverview(
					branch.ref,
					{
						associatedPullRequest: associatedPR,
						getFallbackDefaultBranch: () =>
							getDefaultBranchNameFromIntegration(branch.repoPath, { cancellation: signal }),
						priority: priority,
					},
					signal,
				);
			// Compute merge target for every enriched branch (not just the current one) so the graph's
			// scope popover can render a merge-target anchor when the user focuses any branch, and so
			// recent-branch cards can show merged status. Callers that defer this work to hover-time
			// (graph overview cards) opt out via `skipMergeTarget`.
			if (!skipMergeTarget) {
				promises.mergeTarget = getBranchMergeTargetStatusInfo(container, branch, signal, associatedPR);
			}
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
							issues?.map(
								i =>
									({
										type: 'issue',
										id: i.number || i.id,
										title: i.title,
										state: i.state,
										url: i.url,
									}) satisfies OverviewBranchIssue,
							) ?? [],
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
			// Partition resolved autolinks by their resolved `type`:
			// - URL matches the branch's primary PR or any associated issue → drop (already represented).
			// - Resolved as an issue → move into `issues` (rendered with the issue icon).
			// - Resolved as a PR (and not the primary) → keep in `autolinks` (rendered with the PR icon).
			// - Unresolved (`type` undefined) → keep in `autolinks` (rendered with the link icon).
			// `getAutolinkIssuesInfo` filters out items whose underlying issueOrPullRequest is null,
			// so today every item has a resolved `type`; the `undefined` branch is here for forward-compat.
			const associatedIssues = getSettledValue(issuesResult) ?? [];
			const rawAutolinks = getSettledValue(autolinksResult) ?? [];
			const seenUrls = new Set<string>();
			if (enrichment.pr != null) {
				seenUrls.add(enrichment.pr.url);
			}
			for (const issue of associatedIssues) {
				seenUrls.add(issue.url);
			}

			const finalIssues: OverviewBranchIssue[] = [...associatedIssues];
			const finalAutolinks: OverviewBranchIssue[] = [];
			for (const item of rawAutolinks) {
				if (seenUrls.has(item.url)) continue;

				seenUrls.add(item.url);
				if (item.type === 'issue') {
					finalIssues.push(item);
				} else {
					finalAutolinks.push(item);
				}
			}

			enrichment.issues = finalIssues;
			enrichment.autolinks = finalAutolinks;
			enrichment.contributors = getSettledValue(contributorsResult);
			enrichment.mergeTarget = getSettledValue(mergeTargetResult);

			result[branchId] = enrichment;
		}),
	);

	signal?.throwIfAborted();
	return result;
}
