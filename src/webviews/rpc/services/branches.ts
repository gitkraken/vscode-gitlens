/**
 * Branches service — per-branch enrichment operations for webviews.
 *
 * Provides branch-level enrichment (merge target status, associated issues,
 * branch autolinks) that any webview can reuse without re-implementing the
 * git-config + integration API plumbing.
 */

import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { ConflictDetectionResult } from '@gitlens/git/models/mergeConflicts.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import { createRevisionRange } from '@gitlens/git/utils/revision.utils.js';
import type { Container } from '../../../container.js';
import type { GitRepositoryService } from '../../../git/gitRepositoryService.js';
import {
	getAssociatedIssuesForBranch,
	removeAssociatedIssueFromBranch,
} from '../../../git/utils/-webview/branch.issue.utils.js';
import {
	getBranchAssociatedPullRequest,
	getBranchEnrichedAutolinks,
} from '../../../git/utils/-webview/branch.utils.js';
import { getReferenceFromBranch } from '../../../git/utils/-webview/reference.utils.js';
import { getWorktreesByBranch } from '../../../git/utils/-webview/worktree.utils.js';
import { isSubscriptionTrialOrPaidFromState } from '../../../plus/gk/utils/subscription.utils.js';
import type {
	OverviewBranch,
	OverviewBranchIssue,
	OverviewBranchMergeTarget,
	OverviewBranchPullRequest,
} from '../../shared/overviewBranches.js';
import { toOverviewBranch } from '../../shared/overviewBranches.js';
import {
	getAutolinkIssuesInfo,
	getBranchMergeTargetStatusInfo,
	getPullRequestInfo,
} from '../../shared/overviewEnrichment.utils.js';

export interface BranchMergeTargetStatus {
	/** Shape compatible with gl-merge-target-status's `branch` prop. */
	branch: Pick<OverviewBranch, 'reference' | 'repoPath' | 'id' | 'name' | 'opened' | 'upstream' | 'worktree'>;
	mergeTarget: OverviewBranchMergeTarget | undefined;
}

/**
 * Combined branch enrichment payload. The outer Promise resolves once the host has
 * the branch and its `gl-merge-target-status`-shaped projection (cheap, single git
 * lookup); each field below is a separate wire-promise that settles on its own
 * roundtrip. Callers can `.then` each leg independently — autolinks (fast/local)
 * and issues (mostly cached) don't wait for the slower `mergeTargetStatus` leg
 * which can hit integration APIs.
 */
export interface BranchEnrichment {
	branch: Pick<OverviewBranch, 'reference' | 'repoPath' | 'id' | 'name' | 'opened' | 'upstream' | 'worktree'>;
	autolinks: Promise<OverviewBranchIssue[]>;
	issues: Promise<OverviewBranchIssue[]>;
	mergeTargetStatus: Promise<OverviewBranchMergeTarget | undefined>;
	pullRequest: Promise<OverviewBranchPullRequest | undefined>;
}

/**
 * What a pull would do to you, as a single verdict. `count` is a file count: for `dirty-overlap` the
 * uncommitted files the incoming commits also touch (git refuses the pull outright); for `merge`/`rebase`
 * the files the simulated integration conflicts in. `unavailable` means we couldn't tell (Git < 2.33, a
 * provider without merge-tree, or a failed simulation) — render nothing rather than guessing.
 */
export type PullConflictPreview =
	| { kind: 'dirty-overlap'; count: number }
	| { kind: 'merge'; count: number }
	| { kind: 'rebase'; count: number }
	| { kind: 'clean' }
	| { kind: 'unavailable' };

/** Git's false-y boolean spellings — anything else (including `merges`/`interactive`) means rebase. */
const gitFalseValues = new Set(['', 'false', 'no', 'off', '0']);

export class BranchesService {
	constructor(private readonly container: Container) {}

	/**
	 * Predicts whether pulling the current branch will hurt, as one verdict for the Graph's Pull button.
	 *
	 * Ordered by what stops you first: uncommitted changes overlapping the incoming commits block the pull
	 * before any integration happens (and are the only risk on a fast-forward), so they win over a merge or
	 * rebase simulation. Pro-only — this mirrors the merge-target chip, and the simulation is the expensive
	 * part.
	 */
	async getPullConflictPreview(repoPath: string, signal?: AbortSignal): Promise<PullConflictPreview | undefined> {
		signal?.throwIfAborted();

		const subscription = await this.container.subscription.getSubscription();
		if (!isSubscriptionTrialOrPaidFromState(subscription?.state)) return undefined;

		signal?.throwIfAborted();

		const svc = this.container.git.getRepositoryService(repoPath);
		// `getBranch(undefined)` rather than `getCurrentBranch()` — the latter hardcodes a zeroed tracking
		// state, and this must agree with the `BranchState` the button renders from, which is built the same way.
		const branch = await svc.branches.getBranch(undefined, signal);
		signal?.throwIfAborted();

		const upstream = branch?.upstream;
		if (branch == null || upstream == null || upstream.missing) return undefined;
		if (!upstream.state.behind) return { kind: 'clean' };

		const overlap = await this.getDirtyOverlapCount(
			svc,
			createRevisionRange(branch.ref, upstream.name, '..'),
			signal,
		);
		signal?.throwIfAborted();
		if (overlap > 0) return { kind: 'dirty-overlap', count: overlap };

		// A fast-forward can't conflict — there's nothing to integrate, so skip the simulation entirely.
		if (!upstream.state.ahead) return { kind: 'clean' };

		const rebase = await this.willPullRebase(svc, branch.name);
		signal?.throwIfAborted();

		const result = rebase
			? await this.getPotentialRebaseConflicts(svc, upstream.name, branch.ref, signal)
			: await svc.branches.getPotentialMergeConflicts?.(branch.name, upstream.name, signal);
		signal?.throwIfAborted();

		if (result == null || result.status === 'error') return { kind: 'unavailable' };
		if (result.status === 'clean') return { kind: 'clean' };

		return { kind: rebase ? 'rebase' : 'merge', count: result.conflict.files.length };
	}

	/** Counts uncommitted files that the incoming commits also change — what makes git refuse the pull with
	 *  "Your local changes to the following files would be overwritten by merge". */
	private async getDirtyOverlapCount(
		svc: GitRepositoryService,
		incoming: string,
		signal?: AbortSignal,
	): Promise<number> {
		// A clean tree can't overlap, so bail before spending anything — this is the common case.
		if (!(await svc.status.hasWorkingChanges(undefined, signal))) return 0;

		signal?.throwIfAborted();

		const status = await svc.status.getStatus(undefined, signal);
		signal?.throwIfAborted();

		const dirty = new Set(status?.files.map(f => f.path));
		if (!dirty.size) return 0;

		const incomingFiles = await svc.diff.getDiffStatus(incoming);
		if (incomingFiles == null) return 0;

		let count = 0;
		for (const file of incomingFiles) {
			if (dirty.has(file.path)) {
				count++;
			}
		}
		return count;
	}

	/** Replays the local (ahead) commits onto the upstream, the way `pull --rebase` will. Stops at the first
	 *  conflicting commit because a rebase does too — that commit's files are what you'll actually face. */
	private async getPotentialRebaseConflicts(
		svc: GitRepositoryService,
		upstreamName: string,
		branchRef: string,
		signal?: AbortSignal,
	): Promise<ConflictDetectionResult | undefined> {
		const shas = [
			...(await svc.commits.getLogShas(
				createRevisionRange(upstreamName, branchRef, '..'),
				{ merges: false, reverse: true },
				signal,
			)),
		];
		signal?.throwIfAborted();
		if (!shas.length) return { status: 'clean' };

		return svc.branches.getPotentialApplyConflicts?.(upstreamName, shas, { stopOnFirstConflict: true }, signal);
	}

	/** Whether `git pull` will rebase rather than merge. A per-branch `branch.<name>.rebase` overrides the
	 *  repository-wide `pull.rebase`, and both accept `merges`/`interactive` alongside plain booleans. */
	private async willPullRebase(svc: GitRepositoryService, branchName: string): Promise<boolean> {
		const branchRebase = await svc.config.getConfig?.(`branch.${branchName}.rebase`);
		if (branchRebase != null) return !gitFalseValues.has(branchRebase.trim().toLowerCase());

		const pullRebase = await svc.config.getConfig?.('pull.rebase');
		return pullRebase != null && !gitFalseValues.has(pullRebase.trim().toLowerCase());
	}

	/**
	 * Get branch enrichment with deferred legs. The host resolves the branch and its
	 * worktree-aware shape once, then returns three independent Promise legs; each
	 * settles on its own roundtrip so per-leg latency is preserved.
	 */
	async getBranchEnrichment(
		repoPath: string,
		branchName: string,
		signal?: AbortSignal,
	): Promise<BranchEnrichment | undefined> {
		signal?.throwIfAborted();
		const svc = this.container.git.getRepositoryService(repoPath);
		const branch = await svc.branches.getBranch(branchName, signal);
		signal?.throwIfAborted();
		if (branch == null) return undefined;

		const repo = this.container.git.getRepository(repoPath);
		const worktreesByBranch = repo != null ? await getWorktreesByBranch(repo) : new Map<string, GitWorktree>();
		signal?.throwIfAborted();
		const opened = branch.current || worktreesByBranch.get(branch.id)?.opened === true;
		const overview = toOverviewBranch(branch, worktreesByBranch, opened);

		// Shared associated-PR fetch so the merge-target and PR legs don't fire two
		// integration calls for the same branch.
		const associatedPR = getBranchAssociatedPullRequest(this.container, branch, { avatarSize: 64 });

		return {
			branch: {
				reference: overview.reference,
				repoPath: overview.repoPath,
				id: overview.id,
				name: overview.name,
				opened: overview.opened,
				upstream: overview.upstream,
				worktree: overview.worktree,
			},
			// Each leg fires immediately; Supertalk wire-serializes the Promises so they
			// settle independently on the consumer side. Signal forwards into each leg so
			// in-flight cancellation checks honor the same abort.
			autolinks: this.fetchAutolinksLeg(branch, signal),
			issues: this.fetchIssuesLeg(branch, signal),
			mergeTargetStatus: getBranchMergeTargetStatusInfo(this.container, branch, signal, associatedPR),
			pullRequest: this.fetchPullRequestLeg(branch, associatedPR, signal),
		};
	}

	/**
	 * Unassociate an issue from a branch by its stable identifier (Issue.nodeId).
	 * The association is persisted in git config; this removes its entry.
	 */
	async removeAssociatedIssue(repoPath: string, branchName: string, entityId: string): Promise<void> {
		const svc = this.container.git.getRepositoryService(repoPath);
		const branch = await svc.branches.getBranch(branchName);
		if (branch == null) return;

		await removeAssociatedIssueFromBranch(this.container, getReferenceFromBranch(branch), entityId);
	}

	private async fetchAutolinksLeg(branch: GitBranch, signal?: AbortSignal): Promise<OverviewBranchIssue[]> {
		const enriched = await getBranchEnrichedAutolinks(this.container, branch);
		signal?.throwIfAborted();
		return getAutolinkIssuesInfo(enriched);
	}

	private async fetchIssuesLeg(branch: GitBranch, signal?: AbortSignal): Promise<OverviewBranchIssue[]> {
		const result = await getAssociatedIssuesForBranch(this.container, branch);
		signal?.throwIfAborted();
		const issues = result.paused ? await result.value : result.value;
		signal?.throwIfAborted();
		return (
			issues?.map(i => ({
				type: 'issue' as const,
				id: i.number || i.id,
				title: i.title,
				state: i.state,
				url: i.url,
				entityId: i.nodeId,
			})) ?? []
		);
	}

	private async fetchPullRequestLeg(
		branch: GitBranch,
		associatedPullRequest: Promise<PullRequest | undefined>,
		signal?: AbortSignal,
	): Promise<OverviewBranchPullRequest | undefined> {
		const pr = await getPullRequestInfo(this.container, branch, undefined, associatedPullRequest);
		signal?.throwIfAborted();
		return pr;
	}
}
