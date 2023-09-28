import type { TextEditor, Uri } from 'vscode';
import { ProgressLocation, window } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { showGenericErrorMessage } from '../messages';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command, executeCoreCommand } from '../system/command';
import { Logger } from '../system/logger';
import { ActiveEditorCommand, getCommandUri } from './base';

export interface GenerateCommitMessageCommandArgs {
	repoPath?: string;
}

@command()
export class GenerateCommitMessageCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(Commands.GenerateCommitMessage);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: GenerateCommitMessageCommandArgs) {
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
			const message = await this.container.ai.generateCommitMessage(repository, {
				context: currentMessage,
				progress: { location: ProgressLocation.Notification, title: 'Generating commit message...' },
			});
			if (message == null) return;

			void executeCoreCommand('workbench.view.scm');
			scmRepo.inputBox.value = `${currentMessage ? `${currentMessage}\n\n` : ''}${message}`;
		} catch (ex) {
			Logger.error(ex, 'GenerateCommitMessageCommand');

			if (ex instanceof Error && ex.message.startsWith('No staged changes')) {
				void window.showInformationMessage('No staged changes to generate a commit message from.');
				return;
			}

			void showGenericErrorMessage(ex.message);
		}
	}
}
