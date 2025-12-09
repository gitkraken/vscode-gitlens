import { window } from 'vscode';
import type { Sources } from '../constants.telemetry';
import type { Container } from '../container';
import { CommandQuickPickItem } from '../quickpicks/items/common';
import { showReferencePicker2 } from '../quickpicks/referencePicker';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command, executeCommand } from '../system/-webview/command';
import { getNodeRepoPath } from '../views/nodes/abstract/viewNode';
import type { ComposerWebviewShowingArgs } from '../webviews/plus/composer/registration';
import type { WebviewPanelShowCommandArgs } from '../webviews/webviewsController';
import { GlCommandBase } from './commandBase';
import type { CommandContext } from './commandContext';
import { isCommandContextViewNodeHasBranch } from './commandContext.utils';

export interface RecomposeBranchCommandArgs {
	repoPath?: string;
	branchName?: string;
	/** Optional filter: if provided, only these commits are selectable for composition */
	commitShas?: string[];
	/** If provided, defines the commit range directly (skips merge target resolution) */
	range?: { base: string; head: string };
	source?: Sources;
}

@command()
export class RecomposeBranchCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.recomposeBranch', 'gitlens.recomposeBranch:views', 'gitlens.recomposeSelectedCommits']);
	}

	protected override preExecute(context: CommandContext, args?: RecomposeBranchCommandArgs): Promise<void> {
		if (isCommandContextViewNodeHasBranch(context)) {
			args = { ...args };
			args.repoPath = args.repoPath ?? getNodeRepoPath(context.node);
			args.branchName = args.branchName ?? context.node.branch.name;
			args.source = args.source ?? 'view';
		}

		return this.execute(args);
	}

	async execute(args?: RecomposeBranchCommandArgs): Promise<void> {
		try {
			// Get repository path using picker fallback
			const repoPath =
				args?.repoPath ??
				(await getBestRepositoryOrShowPicker(this.container, undefined, undefined, 'Recompose Branch'))?.path;
			if (!repoPath) return;

			args = { ...args };

			// Get branch name using picker fallback
			let branchName = args.branchName;
			if (!branchName) {
				const result = await showReferencePicker2(
					repoPath,
					'Recompose Branch',
					'Choose a branch to recompose',
					{
						include: ['branches'],
						sort: { branches: { current: true } },
					},
				);
				if (result.value == null || result.value instanceof CommandQuickPickItem) return;

				const pick = result.value;
				if (pick.refType === 'branch') {
					branchName = pick.name;
				} else {
					return;
				}
			}

			// Validate that the repository exists
			const repo = this.container.git.getRepository(repoPath);
			if (!repo) {
				void window.showErrorMessage('Repository not found');
				return;
			}

			// Validate that the branch exists
			const branch = await repo.git.branches.getBranch(branchName);
			if (!branch) {
				void window.showErrorMessage(`Branch '${branchName}' not found`);
				return;
			}

			// Check if branch is remote-only
			if (branch.remote && !branch.upstream) {
				void window.showErrorMessage(`Cannot recompose remote-only branch '${branchName}'`);
				return;
			}

			// Open the composer with branch mode
			await executeCommand<WebviewPanelShowCommandArgs<ComposerWebviewShowingArgs>>(
				'gitlens.showComposerPage',
				undefined,
				{
					repoPath: repoPath,
					source: args?.source,
					mode: 'preview',
					branchName: branchName,
					commitShas: args?.commitShas,
					range: args?.range,
				},
			);
		} catch (ex) {
			void window.showErrorMessage(`Failed to recompose branch: ${ex}`);
		}
	}
}
