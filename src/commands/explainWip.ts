import type { TextEditor, Uri } from 'vscode';
import { ProgressLocation } from 'vscode';
import type { Container } from '../container';
import { uncommitted, uncommittedStaged } from '../git/models/revision';
import { showGenericErrorMessage } from '../messages';
import { command } from '../system/-webview/command';
import { createMarkdownCommandLink } from '../system/commands';
import { Logger } from '../system/logger';
import { capitalize } from '../system/string';
import type { CommandContext } from './commandContext';
import {
	isCommandContextViewNodeHasRepoPath,
	isCommandContextViewNodeHasRepository,
	isCommandContextViewNodeHasWorktree,
} from './commandContext.utils';
import type { ExplainBaseArgs } from './explainBase';
import { ExplainCommandBase } from './explainBase';

export interface ExplainWipCommandArgs extends ExplainBaseArgs {
	staged?: boolean;
}

@command()
export class ExplainWipCommand extends ExplainCommandBase {
	static createMarkdownCommandLink(args: ExplainWipCommandArgs): string {
		return createMarkdownCommandLink<ExplainWipCommandArgs>('gitlens.ai.explainWip:editor', args);
	}

	pickerTitle = 'Explain Working Changes';
	repoPickerPlaceholder = 'Choose which repository to explain working changes from';

	constructor(container: Container) {
		super(container, ['gitlens.ai.explainWip', 'gitlens.ai.explainWip:editor', 'gitlens.ai.explainWip:views']);
	}

	protected override preExecute(context: CommandContext, args?: ExplainWipCommandArgs): Promise<void> {
		if (isCommandContextViewNodeHasWorktree(context)) {
			args = { ...args };
			args.repoPath = context.node.worktree.repoPath;
			args.worktreePath = context.node.worktree.path;
			args.source = args.source ?? { source: 'view', context: { type: 'wip' } };
		} else if (isCommandContextViewNodeHasRepository(context)) {
			args = { ...args };
			args.repoPath = context.node.repo.path;
			args.source = args.source ?? { source: 'view', context: { type: 'wip' } };
		} else if (isCommandContextViewNodeHasRepoPath(context)) {
			args = { ...args };
			args.repoPath = context.node.repoPath;
			args.source = args.source ?? { source: 'view', context: { type: 'wip' } };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ExplainWipCommandArgs): Promise<void> {
		args = { ...args };

		// Get the diff of working changes
		const svc = await this.getRepositoryService(editor, uri, args);
		if (svc?.diff?.getDiff == null) {
			void showGenericErrorMessage('Unable to get diff service');
			return;
		}

		args.repoPath ??= svc.path;

		let label;
		let to;
		if (args?.staged === true) {
			label = 'staged';
			to = uncommittedStaged;
		} else if (args?.staged === false) {
			label = 'unstaged';
			to = uncommitted;
		} else {
			label = 'working';
			to = '';
		}

		let repoName = svc.getRepository()?.name ?? svc.path;
		try {
			const diff = await svc.diff.getDiff(to, undefined);
			if (!diff?.contents) {
				void showGenericErrorMessage(`No ${label} changes found to explain`);
				return;
			}

			if (args?.worktreePath) {
				// Get the worktree name if available
				const worktrees = await svc.worktrees?.getWorktrees();
				const worktree = worktrees?.find(w => w.path === args.worktreePath);

				repoName = worktree?.name ?? args.worktreePath.toString();
			}

			// Call the AI service to explain the changes
			const result = await this.container.ai.actions.explainChanges(
				{
					diff: diff.contents,
					message: `${capitalize(label)} changes in ${repoName}`,
				},
				{
					...args.source,
					source: args.source?.source ?? 'commandPalette',
					context: { type: 'wip' },
				},
				{
					progress: {
						location: ProgressLocation.Notification,
						title: `Explaining ${label} changes in ${repoName}...`,
					},
				},
			);

			if (result === 'cancelled') return;

			if (result == null) {
				void showGenericErrorMessage(`Unable to explain ${label} changes`);
				return;
			}

			const { promise, model } = result;
			this.openDocument(promise, `/explain/wip/${svc.path}/${model.id}`, model, 'explain-wip', {
				header: {
					title: `${capitalize(label)} Changes Summary`,
					subtitle: `${capitalize(label)} Changes (${repoName})`,
				},
				command: {
					label: `Explain ${label} Changes`,
					name: 'gitlens.ai.explainWip',
					args: { ...args },
				},
			});
		} catch (ex) {
			Logger.error(ex, 'ExplainWipCommand', 'execute');
			void showGenericErrorMessage(`Unable to explain ${label} changes`);
		}
	}
}
