import type { CancellationToken, Disposable, MessageItem, ProgressOptions, QuickInputButton } from 'vscode';
import { env, ThemeIcon, Uri, window } from 'vscode';
import type { AIModels, AIProviders } from '../constants';
import type { Container } from '../container';
import type { GitCommit } from '../git/models/commit';
import { assertsCommitHasFullDetails, isCommit } from '../git/models/commit';
import { uncommitted, uncommittedStaged } from '../git/models/constants';
import type { GitRevisionReference } from '../git/models/reference';
import type { Repository } from '../git/models/repository';
import { isRepository } from '../git/models/repository';
import { showAIModelPicker } from '../quickpicks/aiModelPicker';
import { configuration } from '../system/configuration';
import { getSettledValue } from '../system/promise';
import type { Storage } from '../system/storage';
import { supportedInVSCodeVersion } from '../system/utils';
import { AnthropicProvider } from './anthropicProvider';
import { CopilotProvider } from './copilotProvider';
import { GeminiProvider } from './geminiProvider';
import { OpenAIProvider } from './openaiProvider';

export interface AIModel<
	Provider extends AIProviders = AIProviders,
	Model extends AIModels<Provider> = AIModels<Provider>,
> {
	readonly id: Model;
	readonly name: string;
	readonly maxTokens: number;
	readonly provider: {
		id: Provider;
		name: string;
	};

	readonly default?: boolean;
	readonly hidden?: boolean;
}

interface AIProviderConstructor<Provider extends AIProviders = AIProviders> {
	new (container: Container): AIProvider<Provider>;
}

const _supportedProviderTypes = new Map<AIProviders, AIProviderConstructor>([
	['openai', OpenAIProvider],
	['anthropic', AnthropicProvider],
	['gemini', GeminiProvider],
	['copilot', CopilotProvider],
]);

export interface AIProvider<Provider extends AIProviders = AIProviders> extends Disposable {
	readonly id: Provider;
	readonly name: string;

	getModels(): Promise<readonly AIModel<Provider, AIModels<Provider>>[]>;

	explainChanges(
		message: string,
		diff: string,
		options?: { cancellation?: CancellationToken },
	): Promise<string | undefined>;
	generateCommitMessage(
		diff: string,
		options?: { cancellation?: CancellationToken; context?: string },
	): Promise<string | undefined>;
}

export class AIProviderService implements Disposable {
	private _provider: AIProvider | undefined;

	constructor(private readonly container: Container) {}

	dispose() {
		this._provider?.dispose();
	}

	get providerId() {
		return this._provider?.id;
	}

	async getModels(): Promise<readonly AIModel[]> {
		const providers = [..._supportedProviderTypes.values()].map(p => new p(this.container));
		const models = await Promise.allSettled(providers.map(p => p.getModels()));
		return models.flatMap(m => getSettledValue(m, []));
	}

	async generateCommitMessage(
		changes: string[],
		options?: { cancellation?: CancellationToken; context?: string; progress?: ProgressOptions },
	): Promise<string | undefined>;
	async generateCommitMessage(
		repoPath: Uri,
		options?: { cancellation?: CancellationToken; context?: string; progress?: ProgressOptions },
	): Promise<string | undefined>;
	async generateCommitMessage(
		repository: Repository,
		options?: { cancellation?: CancellationToken; context?: string; progress?: ProgressOptions },
	): Promise<string | undefined>;
	async generateCommitMessage(
		changesOrRepoOrPath: string[] | Repository | Uri,
		options?: { cancellation?: CancellationToken; context?: string; progress?: ProgressOptions },
	): Promise<string | undefined> {
		let changes: string;
		if (Array.isArray(changesOrRepoOrPath)) {
			changes = changesOrRepoOrPath.join('\n');
		} else {
			const repository = isRepository(changesOrRepoOrPath)
				? changesOrRepoOrPath
				: this.container.git.getRepository(changesOrRepoOrPath);
			if (repository == null) throw new Error('Unable to find repository');

			let diff = await this.container.git.getDiff(repository.uri, uncommittedStaged);
			if (!diff?.contents) {
				diff = await this.container.git.getDiff(repository.uri, uncommitted);
				if (!diff?.contents) throw new Error('No changes to generate a commit message from.');
			}
			if (options?.cancellation?.isCancellationRequested) return undefined;

			changes = diff.contents;
		}

		const provider = await this.getOrChooseProvider();
		if (provider == null) return undefined;

		const confirmed = await confirmAIProviderToS(provider, this.container.storage);
		if (!confirmed) return undefined;
		if (options?.cancellation?.isCancellationRequested) return undefined;

		if (options?.progress != null) {
			return window.withProgress(options.progress, async () =>
				provider.generateCommitMessage(changes, {
					cancellation: options?.cancellation,
					context: options?.context,
				}),
			);
		}
		return provider.generateCommitMessage(changes, {
			cancellation: options?.cancellation,
			context: options?.context,
		});
	}

	async explainCommit(
		repoPath: string | Uri,
		sha: string,
		options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
	): Promise<string | undefined>;
	async explainCommit(
		commit: GitRevisionReference | GitCommit,
		options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
	): Promise<string | undefined>;
	async explainCommit(
		commitOrRepoPath: string | Uri | GitRevisionReference | GitCommit,
		shaOrOptions?: string | { progress?: ProgressOptions },
		options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
	): Promise<string | undefined> {
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

		const diff = await this.container.git.getDiff(commit.repoPath, commit.sha);
		if (!diff?.contents) throw new Error('No changes found to explain.');

		const provider = await this.getOrChooseProvider();
		if (provider == null) return undefined;

		const confirmed = await confirmAIProviderToS(provider, this.container.storage);
		if (!confirmed) return undefined;

		if (!commit.hasFullDetails()) {
			await commit.ensureFullDetails();
			assertsCommitHasFullDetails(commit);
		}

		if (options?.progress != null) {
			return window.withProgress(options.progress, async () =>
				provider.explainChanges(commit.message, diff.contents, { cancellation: options?.cancellation }),
			);
		}
		return provider.explainChanges(commit.message, diff.contents, { cancellation: options?.cancellation });
	}

	reset() {
		const { providerId } = this;
		if (providerId == null) return;

		void this.container.storage.deleteSecret(`gitlens.${providerId}.key`);

		void this.container.storage.delete(`confirm:ai:tos:${providerId}`);
		void this.container.storage.deleteWorkspace(`confirm:ai:tos:${providerId}`);
	}

	supports(provider: AIProviders | string) {
		return _supportedProviderTypes.has(provider as AIProviders);
	}

	async switchProvider() {
		void (await this.getOrChooseProvider(true));
	}

	private async getOrChooseProvider(force?: boolean): Promise<AIProvider | undefined> {
		let providerId = !force ? configuration.get('ai.experimental.provider') || undefined : undefined;
		if (providerId == null || !this.supports(providerId)) {
			const pick = await showAIModelPicker(this.container);
			if (pick == null) return undefined;

			providerId = pick.provider;
			await configuration.updateEffective('ai.experimental.provider', providerId);
			await configuration.updateEffective(`ai.experimental.${providerId}.model`, pick.model);
		}

		if (providerId !== this._provider?.id) {
			this._provider?.dispose();

			let type = _supportedProviderTypes.get(providerId);
			if (type == null && providerId !== 'openai') {
				type = _supportedProviderTypes.get('openai');
				await configuration.updateEffective('ai.experimental.provider', 'openai');
			}
			if (type != null) {
				this._provider = new type(this.container);
			}
		}

		return this._provider;
	}
}

async function confirmAIProviderToS(provider: AIProvider, storage: Storage): Promise<boolean> {
	const confirmed =
		storage.get(`confirm:ai:tos:${provider.id}`, false) ||
		storage.getWorkspace(`confirm:ai:tos:${provider.id}`, false);
	if (confirmed) return true;

	const accept: MessageItem = { title: 'Yes' };
	const acceptWorkspace: MessageItem = { title: 'Always for this Workspace' };
	const acceptAlways: MessageItem = { title: 'Always' };
	const decline: MessageItem = { title: 'No', isCloseAffordance: true };
	const result = await window.showInformationMessage(
		`GitLens experimental AI features require sending a diff of the code changes to ${provider.name} for analysis. This may contain sensitive information.\n\nDo you want to continue?`,
		{ modal: true },
		accept,
		acceptWorkspace,
		acceptAlways,
		decline,
	);

	if (result === accept) return true;

	if (result === acceptWorkspace) {
		void storage.storeWorkspace(`confirm:ai:tos:${provider.id}`, true);
		return true;
	}

	if (result === acceptAlways) {
		void storage.store(`confirm:ai:tos:${provider.id}`, true);
		return true;
	}

	return false;
}

export function getMaxCharacters(model: AIModel, outputLength: number): number {
	const tokensPerCharacter = 3.1;
	const max = model.maxTokens * tokensPerCharacter - outputLength / tokensPerCharacter;
	return Math.floor(max - max * 0.1);
}

export async function getApiKey(
	storage: Storage,
	provider: { id: AIProviders; name: string; validator: (value: string) => boolean; url: string },
): Promise<string | undefined> {
	let apiKey = await storage.getSecret(`gitlens.${provider.id}.key`);
	if (!apiKey) {
		const input = window.createInputBox();
		input.ignoreFocusOut = true;

		const disposables: Disposable[] = [];

		try {
			const infoButton: QuickInputButton = {
				iconPath: new ThemeIcon(`link-external`),
				tooltip: `Open the ${provider.name} API Key Page`,
			};

			apiKey = await new Promise<string | undefined>(resolve => {
				disposables.push(
					input.onDidHide(() => resolve(undefined)),
					input.onDidChangeValue(value => {
						if (value && !provider.validator(value)) {
							input.validationMessage = `Please enter a valid ${provider.name} API key`;
							return;
						}
						input.validationMessage = undefined;
					}),
					input.onDidAccept(() => {
						const value = input.value.trim();
						if (!value || !provider.validator(value)) {
							input.validationMessage = `Please enter a valid ${provider.name} API key`;
							return;
						}

						resolve(value);
					}),
					input.onDidTriggerButton(e => {
						if (e === infoButton) {
							void env.openExternal(Uri.parse(provider.url));
						}
					}),
				);

				input.password = true;
				input.title = `Connect to ${provider.name}`;
				input.placeholder = `Please enter your ${provider.name} API key to use this feature`;
				input.prompt = supportedInVSCodeVersion('input-prompt-links')
					? `Enter your [${provider.name} API Key](${provider.url} "Get your ${provider.name} API key")`
					: `Enter your ${provider.name} API Key`;
				input.buttons = [infoButton];

				input.show();
			});
		} finally {
			input.dispose();
			disposables.forEach(d => void d.dispose());
		}

		if (!apiKey) return undefined;

		void storage.storeSecret(`gitlens.${provider.id}.key`, apiKey);
	}

	return apiKey;
}
