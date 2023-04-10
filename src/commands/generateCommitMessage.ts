import type { MessageItem, TextEditor, Uri } from 'vscode';
import { ProgressLocation, window } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { showGenericErrorMessage } from '../messages';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command, executeCoreCommand } from '../system/command';
import { Logger } from '../system/logger';
import type { Storage } from '../system/storage';
import { ActiveEditorCommand, Command, getCommandUri } from './base';

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

@command()
export class ResetOpenAIKeyCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ResetOpenAIKey);
	}

	execute() {
		void this.container.storage.deleteSecret('gitlens.openai.key');
		void this.container.storage.delete('confirm:sendToOpenAI');
		void this.container.storage.deleteWorkspace('confirm:sendToOpenAI');
	}
}

export async function confirmSendToOpenAI(storage: Storage): Promise<boolean> {
	const confirmed = storage.get('confirm:sendToOpenAI', false) || storage.getWorkspace('confirm:sendToOpenAI', false);
	if (confirmed) return true;

	const accept: MessageItem = { title: 'Yes' };
	const acceptWorkspace: MessageItem = { title: 'Always for this Workspace' };
	const acceptAlways: MessageItem = { title: 'Always' };
	const decline: MessageItem = { title: 'No', isCloseAffordance: true };
	const result = await window.showInformationMessage(
		'This GitLens experimental feature automatically generates commit messages by sending the diff of your staged changes to OpenAI. This may contain sensitive information.\n\nDo you want to continue?',
		{ modal: true },
		accept,
		acceptWorkspace,
		acceptAlways,
		decline,
	);

	if (result === accept) return true;

	if (result === acceptWorkspace) {
		void storage.storeWorkspace('confirm:sendToOpenAI', true);
		return true;
	}

	if (result === acceptAlways) {
		void storage.store('confirm:sendToOpenAI', true);
		return true;
	}

	return false;
}
