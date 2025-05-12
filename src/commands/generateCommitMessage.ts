import type { TextEditor, Uri } from 'vscode';
import { ProgressLocation, window } from 'vscode';
import type { Sources } from '../constants.telemetry';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { showGenericErrorMessage } from '../messages';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command, executeCoreCommand } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { CommandContext } from './commandContext';

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

		let repository;
		if (args.repoPath != null) {
			repository = this.container.git.getRepository(args.repoPath);
		} else {
			uri = getCommandUri(uri, editor);

			const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

			repository = await getBestRepositoryOrShowPicker(gitUri, editor, 'Generate Commit Message');
		}
		if (repository == null) return;

		const scmRepo = await this.container.git.getScmRepository(repository.path);
		if (scmRepo == null) return;

		try {
			const currentMessage = scmRepo.inputBox.value;
			const result = await this.container.ai.generateCommitMessage(
				repository,
				{ source: args?.source ?? 'commandPalette' },
				{
					context: currentMessage,
					progress: { location: ProgressLocation.Notification, title: 'Generating commit message...' },
				},
			);
			if (result == null) return;

			void executeCoreCommand('workbench.view.scm');
			scmRepo.inputBox.value = `${currentMessage ? `${currentMessage}\n\n` : ''}${result.parsed.summary}${
				result.parsed.body ? `\n\n${result.parsed.body}` : ''
			}`;
		} catch (ex) {
			Logger.error(ex, 'GenerateCommitMessageCommand');

			if (ex instanceof Error && ex.message.startsWith('No changes')) {
				void window.showInformationMessage('No changes to generate a commit message from.');
				return;
			}

			void showGenericErrorMessage(ex.message);
		}
	}
}
