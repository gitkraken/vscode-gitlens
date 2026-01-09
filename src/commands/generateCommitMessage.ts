import type { TextEditor, Uri } from 'vscode';
import { ProgressLocation } from 'vscode';
import type { Sources } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import { GitUri } from '../git/gitUri.js';
import { showGenericErrorMessage } from '../messages.js';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker.js';
import { command, executeCoreCommand } from '../system/-webview/command.js';
import { Logger } from '../system/logger.js';
import { ActiveEditorCommand } from './commandBase.js';
import { getCommandUri } from './commandBase.utils.js';
import type { CommandContext } from './commandContext.js';

export interface GenerateCommitMessageCommandArgs {
	repoPath?: string | Uri;
	source?: Sources;
}

@command()
export class GenerateCommitMessageCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(
			['gitlens.ai.generateCommitMessage', 'gitlens.ai.generateCommitMessage:scm'],
			[
				'gitlens.generateCommitMessage',
				'gitlens.scm.generateCommitMessage',
				'gitlens.scm.ai.generateCommitMessage',
			],
		);
	}

	protected override preExecute(context: CommandContext, args?: GenerateCommitMessageCommandArgs): Promise<void> {
		let source: Sources | undefined = args?.source;
		if (
			source == null &&
			(context.command === 'gitlens.ai.generateCommitMessage:scm' ||
				context.command === /** @deprecated */ 'gitlens.scm.ai.generateCommitMessage' ||
				context.command === /** @deprecated */ 'gitlens.scm.generateCommitMessage')
		) {
			source = 'scm-input';
			if (context.type === 'scm' && context.scm.rootUri != null) {
				args = { ...args, repoPath: context.scm.rootUri };
			}
		}

		return this.execute(context.editor, context.uri, { ...args, source: source });
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: GenerateCommitMessageCommandArgs): Promise<void> {
		args = { ...args };

		let repo;
		if (args.repoPath != null) {
			repo = this.container.git.getRepository(args.repoPath);
		} else {
			uri = getCommandUri(uri, editor);

			const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

			repo = await getBestRepositoryOrShowPicker(this.container, gitUri, editor, 'Generate Commit Message');
		}
		if (repo == null) return;

		const scmRepo = await repo.git.getScmRepository();
		if (scmRepo == null) return;

		try {
			const currentMessage = scmRepo.inputBox.value;
			const result = await this.container.ai.actions.generateCommitMessage(
				repo,
				{ source: args?.source ?? 'commandPalette' },
				{
					context: currentMessage,
					progress: { location: ProgressLocation.Notification, title: 'Generating commit message...' },
				},
			);
			if (result == null || result === 'cancelled') return;

			void executeCoreCommand('workbench.view.scm');
			scmRepo.inputBox.value = `${currentMessage ? `${currentMessage}\n\n` : ''}${result.result.summary}${
				result.result.body ? `\n\n${result.result.body}` : ''
			}`;
		} catch (ex) {
			Logger.error(ex, 'GenerateCommitMessageCommand');
			void showGenericErrorMessage(ex.message);
		}
	}
}
