import type { TextEditor, Uri } from 'vscode';
import { ProgressLocation } from 'vscode';
import type { Container } from '../container';
import type { GitCommit, GitStashCommit } from '../git/models/commit';
import { showGenericErrorMessage } from '../messages';
import { showStashPicker } from '../quickpicks/stashPicker';
import { command } from '../system/-webview/command';
import { Logger } from '../system/logger';
import type { CommandContext } from './commandContext';
import { isCommandContextViewNodeHasCommit } from './commandContext.utils';
import type { ExplainBaseArgs } from './explainBase';
import { ExplainCommandBase } from './explainBase';

export interface ExplainStashCommandArgs extends ExplainBaseArgs {
	rev?: string;
}

@command()
export class ExplainStashCommand extends ExplainCommandBase {
	pickerTitle = 'Explain Stash Changes';
	repoPickerPlaceholder = 'Choose which repository to explain a stash from';

	constructor(container: Container) {
		super(container, ['gitlens.ai.explainStash', 'gitlens.ai.explainStash:views']);
	}

	protected override preExecute(context: CommandContext, args?: ExplainStashCommandArgs): Promise<void> {
		// Check if the command is being called from a CommitNode
		if (isCommandContextViewNodeHasCommit<GitStashCommit>(context)) {
			args = { ...args };
			args.repoPath = args.repoPath ?? context.node.commit.repoPath;
			args.rev = args.rev ?? context.node.commit.sha;
			args.source = args.source ?? { source: 'view', context: { type: 'stash' } };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ExplainStashCommandArgs): Promise<void> {
		args = { ...args };

		const svc = await this.getRepositoryService(editor, uri, args);
		if (svc == null) {
			void showGenericErrorMessage('Unable to find a repository');
			return;
		}

		try {
			let commit: GitCommit | undefined;
			if (args.rev == null) {
				const pick = await showStashPicker(
					svc.stash?.getStash(),
					this.pickerTitle,
					'Choose a stash to explain',
				);
				if (pick?.ref == null) return;
				args.rev = pick.ref;
				commit = pick;
			} else {
				commit = await svc.commits.getCommit(args.rev);
				if (commit == null) {
					void showGenericErrorMessage('Unable to find the specified stash commit');
					return;
				}
			}

			const result = await this.container.ai.actions.explainCommit(
				commit,
				{
					...args.source,
					source: args.source?.source ?? 'commandPalette',
					context: { type: 'stash' },
				},
				{
					progress: { location: ProgressLocation.Notification, title: 'Explaining stash...' },
				},
			);

			if (result === 'cancelled') return;

			if (result == null) {
				void showGenericErrorMessage('Unable to explain stash');
				return;
			}

			const { promise, model } = result;
			this.openDocument(promise, `/explain/stash/${commit.ref}/${model.id}`, model, 'explain-stash', {
				header: { title: 'Stash Summary', subtitle: commit.message || commit.ref },
				command: {
					label: 'Explain Stash Changes',
					name: 'gitlens.ai.explainStash',
					args: { repoPath: svc.path, ref: commit.ref, source: args.source },
				},
			});
		} catch (ex) {
			Logger.error(ex, 'ExplainStashCommand', 'execute');
			void showGenericErrorMessage('Unable to explain stash');
		}
	}
}
