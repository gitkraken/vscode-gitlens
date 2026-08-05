/**
 * Branches service — per-branch enrichment operations for webviews.
 *
 * Provides branch-level enrichment (merge target status, associated issues,
 * branch autolinks) that any webview can reuse without re-implementing the
 * git-config + integration API plumbing.
 */

import type { GitBranch } from '@gitlens/git/models/branch.js';
import { GitFileWorkingTreeStatus } from '@gitlens/git/models/fileStatus.js';
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
	getBranchRemote,
} from '../../../git/utils/-webview/branch.utils.js';
import { getReferenceFromBranch } from '../../../git/utils/-webview/reference.utils.js';
import { getWorktreesByBranch } from '../../../git/utils/-webview/worktree.utils.js';
import { isSubscriptionTrialOrPaidFromState } from '../../../plus/gk/utils/subscription.utils.js';
import type {
	OverviewBranch,
	OverviewBranchIssue,
	OverviewBranchMergeTarget,
	OverviewBranchPullRequest,
	OverviewBranchRemote,
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
	/** The upstream's remote, for the hosting-provider icon. Its own leg so the Upstream card keeps
	 *  rendering synchronously and only swaps the icon in when this settles. */
	remote: Promise<OverviewBranchRemote | undefined>;
}

/**
 * What a pull would do to you, as a single verdict. `count` is a file count: for `dirty-overlap` the
 * working-tree files that make git refuse the pull outright — which files those are depends on the pull
 * mode and whether autostash is on, see {@link getPullBlockedFileCount}; for `merge`/`rebase` the files
 * that conflict, either in the integration itself or (when autostash is on) in reapplying the stash
 * afterward. `unavailable` means we couldn't tell (Git < 2.33, a provider without merge-tree, or a failed
 * simulation) — render nothing rather than guessing.
 */
export type PullConflictPreview =
	| { kind: 'dirty-overlap'; count: number }
	| { kind: 'merge'; count: number }
	| { kind: 'rebase'; count: number }
	| { kind: 'clean' }
	| { kind: 'unavailable' };

/** Git's false-y boolean spellings — anything else (including `merges`/`interactive`) means rebase. */
const gitFalseValues = new Set(['', 'false', 'no', 'off', '0']);

/**
 * Counts the working-tree files that make `git pull` refuse outright. `git stash create` (what autostash
 * runs before integrating) captures tracked changes AND the index, so an autostashed pull only trips over
 * untracked files the incoming commits would create. Without autostash, `pull --rebase` demands a wholly
 * clean tree, while a merging `pull` refuses on files the incoming commits touch — plus, only when it has to
 * build a merge commit (`ahead`), on any STAGED file, because that merge needs a clean index. A merging pull
 * that just fast-forwards carries staged changes across fine, so gating on `ahead` is what keeps the common
 * behind-only case from reading as blocked.
 */
export function getPullBlockedFileCount(
	tracked: readonly { path: string; staged: boolean }[],
	untracked: readonly string[],
	incoming: ReadonlySet<string>,
	options: { rebase: boolean; autoStash: boolean; ahead: boolean },
): number {
	let count = 0;
	for (const path of untracked) {
		if (incoming.has(path)) {
			count++;
		}
	}

	if (options.autoStash) return count;

	if (options.rebase) {
		return count + tracked.length;
	}

	for (const file of tracked) {
		if (incoming.has(file.path) || (options.ahead && file.staged)) {
			count++;
		}
	}
	return count;
}

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

		const rebase = await this.willPullRebase(svc, branch.name);
		signal?.throwIfAborted();
		const autoStash = await this.willAutoStash(svc, rebase);
		signal?.throwIfAborted();

		// Merge-base → upstream, not tip-to-tip: a two-dot diff would pull in files only the local
		// (ahead) commits touched, which have nothing to do with what's incoming.
		const incoming = createRevisionRange(branch.ref, upstream.name, '...');
		const blocked = await this.getBlockedFileCount(
			svc,
			incoming,
			{ rebase: rebase, autoStash: autoStash, ahead: upstream.state.ahead > 0 },
			signal,
		);
		signal?.throwIfAborted();
		if (blocked > 0) return { kind: 'dirty-overlap', count: blocked };

		let onto: string | undefined;
		if (!upstream.state.ahead) {
			// A fast-forward can't conflict on its own — there's nothing to integrate — but with autostash
			// on, reapplying the stash after the fast-forward still can, so the landing tree is still needed.
			onto = `${upstream.name}^{tree}`;
		} else {
			const result = rebase
				? await this.getPotentialRebaseConflicts(svc, upstream.name, branch.ref, signal)
				: await svc.branches.getPotentialMergeConflicts?.(branch.name, upstream.name, signal);
			signal?.throwIfAborted();

			if (result == null || result.status === 'error') return { kind: 'unavailable' };
			if (result.status === 'conflicts') {
				return { kind: rebase ? 'rebase' : 'merge', count: result.conflict.files.length };
			}

			onto = result.treeOid;
		}

		// A conflicted integration already returned above, so reaching here means `onto` is either the
		// fast-forward tree or a clean simulation's tree — worth checking whether reapplying the autostash
		// on top of it conflicts too.
		if (autoStash && onto != null) {
			const reapply = await svc.branches.getPotentialStashReapplyConflicts?.(onto, signal);
			signal?.throwIfAborted();
			// A reapply we couldn't simulate (Git < 2.38, a `stash create` that failed) is NOT a clean pull —
			// the integration legs above degrade to `unavailable` for the same reason, and this leg is the only
			// thing standing between an autostashed pull and a conflict.
			if (reapply?.status === 'error') return { kind: 'unavailable' };
			if (reapply?.status === 'conflicts') {
				return { kind: rebase ? 'rebase' : 'merge', count: reapply.conflict.files.length };
			}
		}

		return { kind: 'clean' };
	}

	/** Counts the working-tree files that make git refuse the pull outright, per {@link getPullBlockedFileCount}. */
	private async getBlockedFileCount(
		svc: GitRepositoryService,
		incoming: string,
		options: { rebase: boolean; autoStash: boolean; ahead: boolean },
		signal?: AbortSignal,
	): Promise<number> {
		// A clean tree can't block anything, so bail before spending anything — this is the common case.
		if (!(await svc.status.hasWorkingChanges(undefined, signal))) return 0;

		signal?.throwIfAborted();

		const status = await svc.status.getStatus(undefined, signal);
		signal?.throwIfAborted();

		const tracked: { path: string; staged: boolean }[] = [];
		const untracked: string[] = [];
		for (const f of status?.files ?? []) {
			if (f.workingTreeStatus === GitFileWorkingTreeStatus.Untracked) {
				untracked.push(f.path);
			} else {
				tracked.push({ path: f.path, staged: f.staged });
			}
		}
		if (!tracked.length && !untracked.length) return 0;

		// A rebasing pull without autostash refuses on any dirty tracked file, overlapping or not — so with
		// nothing untracked to intersect, the answer is already decided and the incoming diff is wasted work.
		if (options.rebase && !options.autoStash && tracked.length > 0 && !untracked.length) return tracked.length;

		// A failed/unavailable diff only costs the overlap terms — the staged and rebase-clean-tree terms
		// don't depend on it, so degrade to an empty incoming set rather than dropping the whole verdict.
		const incomingFiles = await svc.diff.getDiffStatus(incoming);
		const incomingSet = new Set(incomingFiles?.map(f => f.path));
		return getPullBlockedFileCount(tracked, untracked, incomingSet, options);
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
		// Nothing to replay (every ahead commit is a merge, which `pull --rebase` drops too) — the landing
		// tree is the upstream's own, and it has to be reported or the autostash reapply check is skipped.
		if (!shas.length) return { status: 'clean', treeOid: `${upstreamName}^{tree}` };

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

	/** Whether `git pull` will stash-and-reapply uncommitted changes rather than refusing on a dirty tree.
	 *  `pull.autoStash` decides for either mode; otherwise only the key matching the mode is consulted —
	 *  `rebase.autoStash` is inert for a merging pull, and `merge.autoStash` for a rebasing one. */
	private async willAutoStash(svc: GitRepositoryService, rebase: boolean): Promise<boolean> {
		const pullAutoStash = await svc.config.getConfig?.('pull.autoStash');
		if (pullAutoStash != null) return !gitFalseValues.has(pullAutoStash.trim().toLowerCase());

		const autoStash = await svc.config.getConfig?.(rebase ? 'rebase.autoStash' : 'merge.autoStash');
		return autoStash != null && !gitFalseValues.has(autoStash.trim().toLowerCase());
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
			remote: this.fetchRemoteLeg(branch),
		};
	}

	/** Only name + provider name/icon — the sheet has no use for the provider URL, and resolving it
	 *  would add an async hop for nothing. Icon takes the same `'remote'` → `'cloud'` normalization
	 *  every other projection applies. */
	private async fetchRemoteLeg(branch: GitBranch): Promise<OverviewBranchRemote | undefined> {
		const remote = await getBranchRemote(this.container, branch);
		if (remote == null) return undefined;

		return {
			name: remote.name,
			provider: remote.provider
				? {
						name: remote.provider.name,
						icon: remote.provider.icon === 'remote' ? 'cloud' : remote.provider.icon,
						supportedFeatures: remote.provider.supportedFeatures,
					}
				: undefined,
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
