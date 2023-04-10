import type { Disposable, MessageItem, QuickInputButton, TextEditor } from 'vscode';
import { env, ProgressLocation, ThemeIcon, Uri, window } from 'vscode';
import { fetch } from '@env/fetch';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { uncommittedStaged } from '../git/models/constants';
import { showGenericErrorMessage } from '../messages';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command, executeCoreCommand } from '../system/command';
import { configuration } from '../system/configuration';
import { Logger } from '../system/logger';
import type { Storage } from '../system/storage';
import { supportedInVSCodeVersion } from '../system/utils';
import { ActiveEditorCommand, Command, getCommandUri } from './base';

const maxCodeCharacters = 12000;

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
			const diff = await this.container.git.getDiff(repository.uri, uncommittedStaged, undefined, {
				includeRawDiff: true,
			});
			if (diff?.diff == null) {
				void window.showInformationMessage('No staged changes to generate a commit message from.');

				return;
			}

			const confirmed = await confirmSendToOpenAI(this.container.storage);
			if (!confirmed) return;

			let openaiApiKey = await this.container.storage.getSecret('gitlens.openai.key');
			if (!openaiApiKey) {
				const input = window.createInputBox();
				input.ignoreFocusOut = true;

				const disposables: Disposable[] = [];

				try {
					const infoButton: QuickInputButton = {
						iconPath: new ThemeIcon(`link-external`),
						tooltip: 'Open the OpenAI API Key Page',
					};

					openaiApiKey = await new Promise<string | undefined>(resolve => {
						disposables.push(
							input.onDidHide(() => resolve(undefined)),
							input.onDidChangeValue(value => {
								if (value && !/sk-[a-zA-Z0-9]{32}/.test(value)) {
									input.validationMessage = 'Please enter a valid OpenAI API key';
									return;
								}
								input.validationMessage = undefined;
							}),
							input.onDidAccept(() => {
								const value = input.value.trim();
								if (!value || !/sk-[a-zA-Z0-9]{32}/.test(value)) {
									input.validationMessage = 'Please enter a valid OpenAI API key';
									return;
								}

								resolve(value);
							}),
							input.onDidTriggerButton(e => {
								if (e === infoButton) {
									void env.openExternal(Uri.parse('https://platform.openai.com/account/api-keys'));
								}
							}),
						);

						input.password = true;
						input.title = 'Connect to OpenAI';
						input.placeholder = 'Please enter your OpenAI API key to use this feature';
						input.prompt = supportedInVSCodeVersion('input-prompt-links')
							? 'Enter your [OpenAI API Key](https://platform.openai.com/account/api-keys "Get your OpenAI API key")'
							: 'Enter your OpenAI API Key';
						input.buttons = [infoButton];

						input.show();
					});
				} finally {
					input.dispose();
					disposables.forEach(d => void d.dispose());
				}

				if (!openaiApiKey) return;

				void this.container.storage.storeSecret('gitlens.openai.key', openaiApiKey);
			}

			const currentMessage = scmRepo.inputBox.value;
			const code = diff.diff.substring(0, maxCodeCharacters);

			let customPrompt = configuration.get('experimental.generateCommitMessagePrompt');
			if (!customPrompt.endsWith('.')) {
				customPrompt += '.';
			}

			const data: OpenAIChatCompletionRequest = {
				model: 'gpt-3.5-turbo',
				messages: [
					{
						role: 'system',
						content:
							"You are an AI programming assistant tasked with writing a meaningful commit message by summarizing code changes.\n\n- Follow the user's instructions carefully & to the letter!\n- Don't repeat yourself or make anything up!\n- Minimize any other prose.",
					},
					{
						role: 'user',
						content: `${customPrompt}\n- Avoid phrases like "this commit", "this change", etc.`,
					},
				],
			};

			if (currentMessage) {
				data.messages.push({
					role: 'user',
					content: `Use "${currentMessage}" to help craft the commit message.`,
				});
			}
			data.messages.push({
				role: 'user',
				content: `Write a meaningful commit message for the following code changes:\n\n${code}`,
			});

			await window.withProgress(
				{ location: ProgressLocation.Notification, title: 'Generating commit message...' },
				async () => {
					const rsp = await fetch('https://api.openai.com/v1/chat/completions', {
						headers: {
							Authorization: `Bearer ${openaiApiKey}`,
							'Content-Type': 'application/json',
						},
						method: 'POST',
						body: JSON.stringify(data),
					});

					if (!rsp.ok) {
						void showGenericErrorMessage(
							`Unable to generate commit message: ${rsp.status}: ${rsp.statusText}`,
						);

						return;
					}

					const completion: OpenAIChatCompletionResponse = await rsp.json();

					void executeCoreCommand('workbench.view.scm');

					const message = completion.choices[0].message.content.trim();
					scmRepo.inputBox.value = `${currentMessage ? `${currentMessage}\n\n` : ''}${message}`;
				},
			);
			if (diff.diff.length > maxCodeCharacters) {
				void window.showWarningMessage(
					`The diff of the staged changes had to be truncated to ${maxCodeCharacters} characters to fit within the OpenAI's limits.`,
				);
			}
		} catch (ex) {
			Logger.error(ex, 'GenerateCommitMessageCommand');
			void showGenericErrorMessage('Unable to generate commit message');
		}
	}
}

interface OpenAIChatCompletionRequest {
	model: 'gpt-3.5-turbo' | 'gpt-3.5-turbo-0301';
	messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
	temperature?: number;
	top_p?: number;
	n?: number;
	stream?: boolean;
	stop?: string | string[];
	max_tokens?: number;
	presence_penalty?: number;
	frequency_penalty?: number;
	logit_bias?: { [token: string]: number };
	user?: string;
}

interface OpenAIChatCompletionResponse {
	id: string;
	object: 'chat.completion';
	created: number;
	model: string;
	choices: {
		index: number;
		message: {
			role: 'system' | 'user' | 'assistant';
			content: string;
		};
		finish_reason: string;
	}[];
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
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
