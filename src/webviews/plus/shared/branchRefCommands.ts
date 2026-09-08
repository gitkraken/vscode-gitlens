/**
 * Shared command handlers for BranchRef / BranchAndTargetRefs command links
 * fired from webviews (graph, …). These back the action buttons in
 * components like `gl-merge-target-status`.
 *
 * Each webview registers a matching `@command(...)` that delegates here, so
 * the logic stays in one place and the per-webview class just wires the ID.
 */

import { env, l10n, Uri, window } from 'vscode';
import { PushError } from '@gitlens/git/errors.js';
import { getBranchNameWithoutRemote } from '@gitlens/utils/gitRefs.js';
import type { BranchGitCommandArgs } from '../../../commands/git/branch.js';
import type { Container } from '../../../container.js';
import { executeGitCommand } from '../../../git/actions.js';
import * as RepoActions from '../../../git/actions/repository.js';
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
	// A branch checked out in a worktree other than the primary one isn't necessarily surfaced as
	// a known Repository (e.g. it was never opened in this window) — getRepository() only finds
	// already-surfaced repos. Fall back to getOrAddRepository (opened: false, so it doesn't inflate
	// openRepositoryCount or surface the worktree in multi-repo UI), mirroring the pattern used for
	// secondary-worktree lookups elsewhere in the webview RPC layer.
	let repo: GlRepository | undefined = container.git.getRepository(ref.repoPath);
	repo ??= await container.git.getOrAddRepository(Uri.file(ref.repoPath), { opened: false, detectNested: true });
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

export async function changeBranchUpstream(container: Container, ref: BranchRef): Promise<void> {
	// Unlike `changeBranchMergeTarget`, the upstream wizard's `reference` field only accepts a
	// resolved `GitBranchReference` (no plain-name shorthand), so the branch needs resolving first.
	const { branch } = await resolveRepoAndBranch(container, ref);
	if (branch == null) return;

	void executeCommand<BranchGitCommandArgs>('gitlens.git.branch.setUpstream', {
		command: 'branch',
		state: { subcommand: 'upstream', repo: ref.repoPath, reference: getReferenceFromBranch(branch) },
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
			void showGitErrorMessage(ex, l10n.t('Unable to push branch'));
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
		const continueItem = { title: l10n.t('Continue') };
		const confirm = await window.showWarningMessage(
			l10n.t(
				"Before deleting the current branch '{0}', you will be switched to '{1}'.",
				branch.name,
				mergeTargetLocalBranchName,
			),
			{ modal: true },
			continueItem,
		);
		if (confirm !== continueItem) return;

		try {
			await container.git.getRepositoryService(ref.repoPath).ops?.checkout(mergeTargetLocalBranchName);
		} catch (ex) {
			void showGitErrorMessage(ex, l10n.t("Unable to switch to branch '{0}'", mergeTargetLocalBranchName));
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

		const continueItem = { title: l10n.t('Continue') };
		const confirm = await window.showWarningMessage(
			l10n.t(
				"Before deleting the worktree for '{0}', you will be switched to the default worktree.",
				branch.name,
			),
			{ modal: true },
			continueItem,
		);
		if (confirm !== continueItem) return;

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
