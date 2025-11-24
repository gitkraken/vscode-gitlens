import type { TextEditor, Uri } from 'vscode';
import { ProgressLocation } from 'vscode';
import type { Container } from '../container';
import type { GitCommit } from '../git/models/commit';
import { isStash } from '../git/models/commit';
import { showGenericErrorMessage } from '../messages';
import { showCommitPicker } from '../quickpicks/commitPicker';
import { command } from '../system/-webview/command';
import { createMarkdownCommandLink } from '../system/commands';
import { Logger } from '../system/logger';
import { getNodeRepoPath } from '../views/nodes/abstract/viewNode';
import type { CommandContext } from './commandContext';
import { isCommandContextViewNodeHasCommit } from './commandContext.utils';
import type { ExplainBaseArgs } from './explainBase';
import { ExplainCommandBase } from './explainBase';

export interface ExplainCommitCommandArgs extends ExplainBaseArgs {
	rev?: string;
}

@command()
export class ExplainCommitCommand extends ExplainCommandBase {
	pickerTitle = 'Explain Commit Changes';
	repoPickerPlaceholder = 'Choose which repository to explain a commit from';
	static createMarkdownCommandLink(args: ExplainCommitCommandArgs): string {
		return createMarkdownCommandLink<ExplainCommitCommandArgs>('gitlens.ai.explainCommit:editor', args);
	}

	constructor(container: Container) {
		super(container, [
			'gitlens.ai.explainCommit',
			'gitlens.ai.explainCommit:editor',
			'gitlens.ai.explainCommit:views',
		]);
	}

	protected override preExecute(context: CommandContext, args?: ExplainCommitCommandArgs): Promise<void> {
		// Check if the command is being called from a CommitNode
		if (isCommandContextViewNodeHasCommit(context)) {
			args = { ...args };
			args.repoPath = args.repoPath ?? getNodeRepoPath(context.node);
			args.rev = args.rev ?? context.node.commit.sha;
			args.source = args.source ?? {
				source: 'view',
				context: { type: isStash(context.node.commit) ? 'stash' : 'commit' },
			};
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ExplainCommitCommandArgs): Promise<void> {
		args = { ...args };

		const svc = await this.getRepositoryService(editor, uri, args);
		if (svc == null) {
			void showGenericErrorMessage('Unable to find a repository');
			return;
		}

		try {
			const commitsProvider = svc.commits;

			let commit: GitCommit | undefined;
			if (args.rev == null) {
				const log = await commitsProvider.getLog();
				const pick = await showCommitPicker(log, this.pickerTitle, 'Choose a commit to explain');
				if (pick?.sha == null) return;
				args.rev = pick.sha;
				commit = pick;
			} else {
				// Get the commit
				commit = await commitsProvider.getCommit(args.rev);
				if (commit == null) {
					void showGenericErrorMessage('Unable to find the specified commit');
					return;
				}
			}

			// Call the AI service to explain the commit
			const result = await this.container.ai.actions.explainCommit(
				commit,
				{
					...args.source,
					source: args.source?.source ?? 'commandPalette',
					context: { type: args.source?.context?.type ?? 'commit' },
				},
				{
					progress: { location: ProgressLocation.Notification, title: 'Explaining commit...' },
				},
			);

			if (result === 'cancelled') return;

			if (result == null) {
				void showGenericErrorMessage('Unable to explain commit');
				return;
			}

			const { promise, model } = result;
			this.openDocument(promise, `/explain/commit/${commit.ref}/${model.id}`, model, 'explain-commit', {
				header: { title: 'Commit Summary', subtitle: `${commit.summary} (${commit.shortSha})` },
				command: {
					label: 'Explain Commit Summary',
					name: 'gitlens.ai.explainCommit',
					args: {
						repoPath: svc.path,
						rev: commit.ref,
						source: args.source,
					},
				},
			});
		} catch (ex) {
			Logger.error(ex, 'ExplainCommitCommand', 'execute');
			void showGenericErrorMessage('Unable to explain commit');
		}
	}
}
