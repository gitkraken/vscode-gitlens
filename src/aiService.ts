import type { Disposable, MessageItem, ProgressOptions, QuickInputButton } from 'vscode';
import { env, ThemeIcon, Uri, window } from 'vscode';
import { fetch } from '@env/fetch';
import type { Container } from './container';
import type { GitCommit } from './git/models/commit';
import { isCommit } from './git/models/commit';
import { uncommittedStaged } from './git/models/constants';
import type { GitRevisionReference } from './git/models/reference';
import type { Repository } from './git/models/repository';
import { isRepository } from './git/models/repository';
import { configuration } from './system/configuration';
import type { Storage } from './system/storage';
import { supportedInVSCodeVersion } from './system/utils';

const maxCodeCharacters = 12000;

export class AIService implements Disposable {
	constructor(private readonly container: Container) {}

	dispose() {}

	public async generateCommitMessage(
		repoPath: string | Uri,
		options?: { context?: string; progress?: ProgressOptions },
	): Promise<string | undefined>;
	public async generateCommitMessage(
		repository: Repository,
		options?: { context?: string; progress?: ProgressOptions },
	): Promise<string | undefined>;
	public async generateCommitMessage(
		repoOrPath: string | Uri | Repository,
		options?: { context?: string; progress?: ProgressOptions },
	): Promise<string | undefined> {
		const repository = isRepository(repoOrPath) ? repoOrPath : this.container.git.getRepository(repoOrPath);
		if (repository == null) throw new Error('Unable to find repository');

		const diff = await this.container.git.getDiff(repository.uri, uncommittedStaged, undefined, {
			includeRawDiff: true,
		});
		if (diff?.diff == null) throw new Error('No staged changes to generate a commit message from.');

		const openaiApiKey = await confirmAndRequestApiKey(this.container.storage);
		if (openaiApiKey == null) return undefined;

		const code = diff.diff.substring(0, maxCodeCharacters);
		if (diff.diff.length > maxCodeCharacters) {
			void window.showWarningMessage(
				`The diff of the staged changes had to be truncated to ${maxCodeCharacters} characters to fit within the OpenAI's limits.`,
			);
		}

		async function openAI() {
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

			if (options?.context) {
				data.messages.push({
					role: 'user',
					content: `Use "${options.context}" to help craft the commit message.`,
				});
			}
			data.messages.push({
				role: 'user',
				content: `Write a meaningful commit message for the following code changes:\n\n${code}`,
			});

			const rsp = await fetch('https://api.openai.com/v1/chat/completions', {
				headers: {
					Authorization: `Bearer ${openaiApiKey}`,
					'Content-Type': 'application/json',
				},
				method: 'POST',
				body: JSON.stringify(data),
			});

			if (!rsp.ok) {
				debugger;
				throw new Error(`Unable to generate commit message: ${rsp.status}: ${rsp.statusText}`);
			}

			const completion: OpenAIChatCompletionResponse = await rsp.json();
			const message = completion.choices[0].message.content.trim();
			return message;
		}

		if (options?.progress != null) {
			return window.withProgress(options.progress, async () => openAI());
		}
		return openAI();
	}

	async explainCommit(
		repoPath: string | Uri,
		sha: string,
		options?: { progress?: ProgressOptions },
	): Promise<string | undefined>;
	async explainCommit(
		commit: GitRevisionReference | GitCommit,
		options?: { progress?: ProgressOptions },
	): Promise<string | undefined>;
	async explainCommit(
		commitOrRepoPath: string | Uri | GitRevisionReference | GitCommit,
		shaOrOptions?: string | { progress?: ProgressOptions },
		options?: { progress?: ProgressOptions },
	): Promise<string | undefined> {
		const openaiApiKey = await confirmAndRequestApiKey(this.container.storage);
		if (openaiApiKey == null) return undefined;

		let commit: GitCommit | undefined;
		if (typeof commitOrRepoPath === 'string' || commitOrRepoPath instanceof Uri) {
			if (typeof shaOrOptions !== 'string' || !shaOrOptions) throw new Error('Invalid arguments provided');

			commit = await this.container.git.getCommit(commitOrRepoPath, shaOrOptions);
		} else {
			if (typeof shaOrOptions === 'string') throw new Error('Invalid arguments provided');

			commit = isCommit(commitOrRepoPath)
				? commitOrRepoPath
				: await this.container.git.getCommit(commitOrRepoPath.repoPath, commitOrRepoPath.ref);
			options = shaOrOptions;
		}
		if (commit == null) throw new Error('Unable to find commit');

		const diff = await this.container.git.getDiff(commit.repoPath, commit.sha, undefined, {
			includeRawDiff: true,
		});
		if (diff?.diff == null) throw new Error('No changes found to explain.');

		const code = diff.diff.substring(0, maxCodeCharacters);
		if (diff.diff.length > maxCodeCharacters) {
			void window.showWarningMessage(
				`The diff of the commit changes had to be truncated to ${maxCodeCharacters} characters to fit within the OpenAI's limits.`,
			);
		}

		async function openAI() {
			const data: OpenAIChatCompletionRequest = {
				model: 'gpt-3.5-turbo',
				messages: [
					{
						role: 'system',
						content:
							"You are an AI programming assistant tasked with providing a detailed explanation of a commit by summarizing the code changes while also using the commit message as additional context and framing.\n\n- Don't make anything up!",
					},
					{
						role: 'user',
						content: `Use the following user-provided commit message, which should provide some explanation to why these changes where made, when attempting to generate the rich explanation:\n\n${
							commit!.message
						}`,
					},
					{
						role: 'assistant',
						content: 'OK',
					},
					{
						role: 'user',
						content: `Explain the following code changes:\n\n${code}`,
					},
				],
			};

			const rsp = await fetch('https://api.openai.com/v1/chat/completions', {
				headers: {
					Authorization: `Bearer ${openaiApiKey}`,
					'Content-Type': 'application/json',
				},
				method: 'POST',
				body: JSON.stringify(data),
			});

			if (!rsp.ok) {
				debugger;
				throw new Error(`Unable to explain commit: ${rsp.status}: ${rsp.statusText}`);
			}

			const completion: OpenAIChatCompletionResponse = await rsp.json();
			const message = completion.choices[0].message.content.trim();
			return message;
		}

		if (options?.progress != null) {
			return window.withProgress(options.progress, async () => openAI());
		}
		return openAI();
	}
}

async function confirmAndRequestApiKey(storage: Storage): Promise<string | undefined> {
	const confirmed = await confirmSendToOpenAI(storage);
	if (!confirmed) return undefined;

	let openaiApiKey = await storage.getSecret('gitlens.openai.key');
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

		if (!openaiApiKey) return undefined;

		void storage.storeSecret('gitlens.openai.key', openaiApiKey);
	}

	return openaiApiKey;
}

async function confirmSendToOpenAI(storage: Storage): Promise<boolean> {
	const confirmed = storage.get('confirm:sendToOpenAI', false) || storage.getWorkspace('confirm:sendToOpenAI', false);
	if (confirmed) return true;

	const accept: MessageItem = { title: 'Yes' };
	const acceptWorkspace: MessageItem = { title: 'Always for this Workspace' };
	const acceptAlways: MessageItem = { title: 'Always' };
	const decline: MessageItem = { title: 'No', isCloseAffordance: true };
	const result = await window.showInformationMessage(
		'This GitLens experimental feature requires sending a diff of the code changes to OpenAI. This may contain sensitive information.\n\nDo you want to continue?',
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
