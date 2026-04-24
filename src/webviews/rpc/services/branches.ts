/**
 * Branches service — per-branch enrichment operations for webviews.
 *
 * Provides branch-level enrichment (merge target status, associated issues)
 * that any webview can reuse without re-implementing the git-config +
 * integration API plumbing.
 */

import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import type { Container } from '../../../container.js';
import {
	getAssociatedIssuesForBranch,
	removeAssociatedIssueFromBranch,
} from '../../../git/utils/-webview/branch.issue.utils.js';
import { getReferenceFromBranch } from '../../../git/utils/-webview/reference.utils.js';
import { getWorktreesByBranch } from '../../../git/utils/-webview/worktree.utils.js';
import type { OverviewBranch, OverviewBranchIssue, OverviewBranchMergeTarget } from '../../shared/overviewBranches.js';
import { toOverviewBranch } from '../../shared/overviewBranches.js';
import { getBranchMergeTargetStatusInfo } from '../../shared/overviewEnrichment.utils.js';

export interface BranchMergeTargetStatus {
	/** Shape compatible with gl-merge-target-status's `branch` prop. */
	branch: Pick<OverviewBranch, 'reference' | 'repoPath' | 'id' | 'name' | 'opened' | 'upstream' | 'worktree'>;
	mergeTarget: OverviewBranchMergeTarget | undefined;
}

export class BranchesService {
	constructor(private readonly container: Container) {}

	/**
	 * Get the merge target status for a branch along with the branch shape the
	 * `gl-merge-target-status` component expects as its `branch` prop.
	 */
	async getMergeTargetStatus(repoPath: string, branchName: string): Promise<BranchMergeTargetStatus | undefined> {
		const svc = this.container.git.getRepositoryService(repoPath);
		const branch = await svc.branches.getBranch(branchName);
		if (branch == null) return undefined;

		const repo = this.container.git.getRepository(repoPath);
		const [worktreesByBranch, mergeTarget] = await Promise.all([
			repo != null ? getWorktreesByBranch(repo) : Promise.resolve(new Map<string, GitWorktree>()),
			getBranchMergeTargetStatusInfo(this.container, branch),
		]);
		const opened = branch.current || worktreesByBranch.get(branch.id)?.opened === true;

		const overview = toOverviewBranch(branch, worktreesByBranch, opened);

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
			mergeTarget: mergeTarget,
		};
	}

	/**
	 * Get issues explicitly associated with a branch (persisted in git config).
	 * Returns the same serialized shape as `OverviewBranchEnrichment.issues`.
	 */
	async getAssociatedIssues(repoPath: string, branchName: string): Promise<OverviewBranchIssue[]> {
		const svc = this.container.git.getRepositoryService(repoPath);
		const branch = await svc.branches.getBranch(branchName);
		if (branch == null) return [];

		const result = await getAssociatedIssuesForBranch(this.container, branch);
		const issues = result.paused ? await result.value : result.value;
		return (
			issues?.map(i => ({
				id: i.number || i.id,
				title: i.title,
				state: i.state,
				url: i.url,
				entityId: i.nodeId,
			})) ?? []
		);
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
}
