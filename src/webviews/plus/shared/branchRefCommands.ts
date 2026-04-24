/**
 * Shared command handlers for BranchRef / BranchAndTargetRefs command links
 * fired from webviews (home, graph, …). These back the action buttons in
 * components like `gl-merge-target-status`.
 *
 * Each webview registers a matching `@command(...)` that delegates here, so
 * the logic stays in one place and the per-webview class just wires the ID.
 */

import { env, window } from 'vscode';
import { PushError } from '@gitlens/git/errors.js';
import { getBranchNameWithoutRemote } from '@gitlens/git/utils/branch.utils.js';
import type { BranchGitCommandArgs } from '../../../commands/git/branch.js';
import type { Container } from '../../../container.js';
import * as RepoActions from '../../../git/actions/repository.js';
import { executeGitCommand } from '../../../git/actions.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { getBranchWorktree } from '../../../git/utils/-webview/branch.utils.js';
import { getReferenceFromBranch } from '../../../git/utils/-webview/reference.utils.js';
import { showGitErrorMessage } from '../../../messages.js';
import { executeCommand, executeCoreCommand } from '../../../system/-webview/command.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { UriTypes } from '../../../uris/deepLinks/deepLink.js';
import { DeepLinkServiceState, DeepLinkType } from '../../../uris/deepLinks/deepLink.js';
import type { BranchAndTargetRefs, BranchRef } from '../../shared/branchRefs.js';

async function resolveRepoAndBranch(container: Container, ref: BranchRef | { repoPath: string; branchName?: string }) {
	const repo: GlRepository | undefined = container.git.getRepository(ref.repoPath);
	if (repo == null) return { repo: undefined, branch: undefined } as const;
	if (!('branchName' in ref) || !ref.branchName) return { repo: repo, branch: undefined } as const;
	const branch = await repo.git.branches.getBranch(ref.branchName);
	return { repo: repo, branch: branch };
}

export function changeBranchMergeTarget(ref: BranchAndTargetRefs): void {
	void executeCommand<BranchGitCommandArgs>('gitlens.git.branch.setMergeTarget', {
		command: 'branch',
		state: {
			subcommand: 'mergeTarget',
			repo: ref.repoPath,
			reference: ref.branchName,
			suggestedMergeTarget: ref.mergeTargetName,
		},
	});
}

export async function mergeIntoCurrent(container: Container, ref: BranchRef): Promise<void> {
	const { repo, branch } = await resolveRepoAndBranch(container, ref);
	if (branch == null) return;
	void RepoActions.merge(repo, getReferenceFromBranch(branch));
}

export async function rebaseCurrentOnto(container: Container, ref: BranchRef): Promise<void> {
	const { repo, branch } = await resolveRepoAndBranch(container, ref);
	if (branch == null) return;
	void RepoActions.rebase(repo, getReferenceFromBranch(branch));
}

export async function pushBranch(container: Container, ref: BranchRef): Promise<void> {
	try {
		await container.git.getRepositoryService(ref.repoPath).ops?.push({
			reference: {
				name: ref.branchName,
				ref: ref.branchId,
				refType: 'branch',
				remote: false,
				repoPath: ref.repoPath,
				upstream: ref.branchUpstreamName ? { name: ref.branchUpstreamName, missing: false } : undefined,
			},
		});
	} catch (ex) {
		if (PushError.is(ex)) {
			void showGitErrorMessage(ex);
		} else {
			void showGitErrorMessage(ex, 'Unable to push branch');
		}
	}
}

export function openMergeTargetComparison(container: Container, ref: BranchAndTargetRefs): unknown {
	return container.views.searchAndCompare.compare(ref.repoPath, ref.branchName, ref.mergeTargetName);
}

export async function fetchBranch(container: Container, ref?: BranchRef): Promise<void> {
	if (ref == null) {
		void RepoActions.fetch(undefined);
		return;
	}
	const { repo, branch } = await resolveRepoAndBranch(container, ref);
	if (branch == null) {
		void RepoActions.fetch(repo);
		return;
	}
	void RepoActions.fetch(repo, getReferenceFromBranch(branch));
}

export async function deleteBranchOrWorktree(
	container: Container,
	ref: BranchRef,
	mergeTarget?: BranchRef,
): Promise<void> {
	const { repo, branch } = await resolveRepoAndBranch(container, ref);
	if (branch == null) return;

	const worktree =
		branch.worktree === false ? undefined : (branch.worktree ?? (await getBranchWorktree(container, branch)));

	if (branch.current && mergeTarget != null && (!worktree || worktree.isDefault)) {
		const mergeTargetLocalBranchName = getBranchNameWithoutRemote(mergeTarget.branchName);
		const confirm = await window.showWarningMessage(
			`Before deleting the current branch '${branch.name}', you will be switched to '${mergeTargetLocalBranchName}'.`,
			{ modal: true },
			{ title: 'Continue' },
		);
		if (confirm?.title !== 'Continue') return;

		try {
			await container.git.getRepositoryService(ref.repoPath).ops?.checkout(mergeTargetLocalBranchName);
		} catch (ex) {
			void showGitErrorMessage(ex, `Unable to switch to branch '${mergeTargetLocalBranchName}'`);
			return;
		}

		void executeGitCommand({
			command: 'branch',
			state: {
				subcommand: 'delete',
				repo: ref.repoPath,
				references: branch,
			},
		});
	} else if (repo != null && worktree != null && !worktree.isDefault) {
		const commonRepo = await repo.git.getOrOpenCommonRepository();
		const defaultWorktree = await repo.git.worktrees?.getWorktree(w => w.isDefault);
		if (defaultWorktree == null || commonRepo == null) return;

		const confirm = await window.showWarningMessage(
			`Before deleting the worktree for '${branch.name}', you will be switched to the default worktree.`,
			{ modal: true },
			{ title: 'Continue' },
		);
		if (confirm?.title !== 'Continue') return;

		const schemeOverride = configuration.get('deepLinks.schemeOverride');
		const scheme = typeof schemeOverride === 'string' ? schemeOverride : env.uriScheme;
		const deleteBranchDeepLink = {
			url: `${scheme}://${container.context.extension.id}/${'link' satisfies UriTypes}/${
				DeepLinkType.Repository
			}/-/${DeepLinkType.Branch}/${encodeURIComponent(branch.name)}?path=${encodeURIComponent(commonRepo.path)}&action=delete-branch`,
			repoPath: commonRepo.path,
			useProgress: false,
			state: DeepLinkServiceState.GoToTarget,
		};

		void executeGitCommand({
			command: 'worktree',
			state: {
				subcommand: 'open',
				repo: defaultWorktree.repoPath,
				worktree: defaultWorktree,
				onWorkspaceChanging: async (_isNewWorktree?: boolean) => {
					await container.storage.storeSecret('deepLinks:pending', JSON.stringify(deleteBranchDeepLink));
					setTimeout(() => {
						void executeCoreCommand('workbench.action.closeWindow');
					}, 2000);
				},
				worktreeDefaultOpen: 'current',
			},
		});
	}
}
