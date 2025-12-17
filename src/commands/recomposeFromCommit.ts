import { window } from 'vscode';
import type { Sources } from '../constants.telemetry';
import type { Container } from '../container';
import { command, executeCommand } from '../system/-webview/command';
import { getNodeRepoPath } from '../views/nodes/abstract/viewNode';
import type { ComposerWebviewShowingArgs } from '../webviews/plus/composer/registration';
import type { WebviewPanelShowCommandArgs } from '../webviews/webviewsController';
import { GlCommandBase } from './commandBase';
import type { CommandContext } from './commandContext';
import { isCommandContextViewNodeHasCommit } from './commandContext.utils';

export interface RecomposeFromCommitCommandArgs {
	repoPath?: string;
	commitSha?: string;
	branchName?: string;
	source?: Sources;
}

@command()
export class RecomposeFromCommitCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.recomposeFromCommit']);
	}

	protected override preExecute(context: CommandContext, args?: RecomposeFromCommitCommandArgs): Promise<void> {
		if (isCommandContextViewNodeHasCommit(context)) {
			args = { ...args };
			args.repoPath = args.repoPath ?? getNodeRepoPath(context.node);
			args.commitSha = args.commitSha ?? context.node.commit.sha;
			args.source = args.source ?? 'view';
		}

		return this.execute(args);
	}

	async execute(args?: RecomposeFromCommitCommandArgs): Promise<void> {
		try {
			if (!args?.commitSha) {
				void window.showErrorMessage('Unable to recompose: missing commit information');
				return;
			}

			const repoPath = args.repoPath;
			if (!repoPath) {
				void window.showErrorMessage('Unable to recompose: missing repository information');
				return;
			}

			const repo = this.container.git.getRepository(repoPath);
			if (repo == null) {
				void window.showErrorMessage('Repository not found');
				return;
			}

			const commit = await repo.git.commits.getCommit(args.commitSha);
			if (!commit) {
				void window.showErrorMessage(`Commit '${args.commitSha}' not found`);
				return;
			}

			const branchName = args.branchName;
			if (!branchName) {
				void window.showErrorMessage('Unable to determine branch for commit');
				return;
			}

			const branch = await repo.git.branches.getBranch(branchName);
			if (!branch) {
				void window.showErrorMessage(`Branch '${branchName}' not found`);
				return;
			}

			if (branch.remote && !branch.upstream) {
				void window.showErrorMessage(`Cannot recompose remote-only branch '${branchName}'`);
				return;
			}

			const headCommitSha = branch.sha;
			if (!headCommitSha) {
				void window.showErrorMessage(`Unable to determine head commit for branch '${branchName}'`);
				return;
			}

			const baseCommitSha = commit.parents.length > 0 ? commit.parents[0] : undefined;
			if (!baseCommitSha) {
				void window.showErrorMessage('Unable to determine parent commit');
				return;
			}

			await executeCommand<WebviewPanelShowCommandArgs<ComposerWebviewShowingArgs>>(
				'gitlens.showComposerPage',
				undefined,
				{
					repoPath: args.repoPath,
					source: args.source,
					mode: 'preview',
					branchName: branchName,
					range: { base: baseCommitSha, head: headCommitSha },
				},
			);
		} catch (ex) {
			void window.showErrorMessage(`Failed to recompose from commit: ${ex}`);
		}
	}
}
