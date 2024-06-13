import type { CancellationToken, Disposable, MessageItem, ProgressOptions, QuickInputButton } from 'vscode';
import { env, ThemeIcon, Uri, window } from 'vscode';
import type { AIModels, AIProviders, SupportedAIModels } from '../constants';
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
import { GeminiProvider } from './geminiProvider';
import { OpenAIProvider } from './openaiProvider';
import type { VSCodeAIModels } from './vscodeProvider';
import { isVSCodeAIModel, VSCodeAIProvider } from './vscodeProvider';

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
]);
if (supportedInVSCodeVersion('language-models')) {
	_supportedProviderTypes.set('vscode', VSCodeAIProvider);
}

export interface AIProvider<Provider extends AIProviders = AIProviders> extends Disposable {
	readonly id: Provider;
	readonly name: string;

	getModels(): Promise<readonly AIModel<Provider, AIModels<Provider>>[]>;

	explainChanges(
		model: AIModel<Provider, AIModels<Provider>>,
		message: string,
		diff: string,
		options?: { cancellation?: CancellationToken },
	): Promise<string | undefined>;
	generateCommitMessage(
		model: AIModel<Provider, AIModels<Provider>>,
		diff: string,
		options?: { cancellation?: CancellationToken; context?: string },
	): Promise<string | undefined>;
	generateDraftMessage(
		model: AIModel<Provider, AIModels<Provider>>,
		diff: string,
		options?: { cancellation?: CancellationToken; context?: string; codeSuggestion?: boolean },
	): Promise<string | undefined>;
}

export class AIProviderService implements Disposable {
	private _provider: AIProvider | undefined;
	private _model: AIModel | undefined;

	constructor(private readonly container: Container) {}

	dispose() {
		this._provider?.dispose();
	}

	get currentProviderId() {
		return this._provider?.id;
	}

	private getConfiguredModel(): { provider: AIProviders; model: AIModels } | undefined {
		const qualifiedModelId = configuration.get('ai.experimental.model') ?? undefined;
		if (qualifiedModelId != null) {
			let [providerId, modelId] = qualifiedModelId.split(':') as [AIProviders, AIModels];
			if (providerId != null && this.supports(providerId)) {
				if (modelId != null) {
					return { provider: providerId, model: modelId };
				} else if (providerId === 'vscode') {
					modelId = configuration.get('ai.experimental.vscode.model') as VSCodeAIModels;
					if (modelId != null) {
						// Model ids are in the form of `vendor:family`
						if (/^(.+):(.+)$/.test(modelId)) {
							return { provider: providerId, model: modelId };
						}
					}
				}
			}
		}
		return undefined;
	}

	async getModels(): Promise<readonly AIModel[]> {
		const providers = [..._supportedProviderTypes.values()].map(p => new p(this.container));
		const models = await Promise.allSettled(providers.map(p => p.getModels()));
		return models.flatMap(m => getSettledValue(m, []));
	}

	private async getModel(options?: { force?: boolean; silent?: boolean }): Promise<AIModel | undefined> {
		const cfg = this.getConfiguredModel();
		if (!options?.force && cfg?.provider != null && cfg?.model != null) {
			const model = await this.getOrUpdateModel(cfg.provider, cfg.model);
			if (model != null) return model;
		}

		if (options?.silent) return undefined;

		const pick = await showAIModelPicker(this.container, cfg);
		if (pick == null) return undefined;

		return this.getOrUpdateModel(pick.model);
	}

	private getOrUpdateModel(model: AIModel): Promise<AIModel | undefined>;
	private getOrUpdateModel<T extends AIProviders>(providerId: T, modelId: AIModels<T>): Promise<AIModel | undefined>;
	private async getOrUpdateModel(
		modelOrProviderId: AIModel | AIProviders,
		modelId?: AIModels,
	): Promise<AIModel | undefined> {
		let providerId: AIProviders;
		let model: AIModel | undefined;
		if (typeof modelOrProviderId === 'string') {
			providerId = modelOrProviderId;
		} else {
			model = modelOrProviderId;
			providerId = model.provider.id;
		}

		let changed = false;

		if (providerId !== this._provider?.id) {
			changed = true;
			this._provider?.dispose();

			const type = _supportedProviderTypes.get(providerId);
			if (type == null) {
				this._provider = undefined;
				this._model = undefined;

				return undefined;
			}

			this._provider = new type(this.container);
		}

		if (model == null) {
			if (modelId != null && modelId === this._model?.id) {
				model = this._model;
			} else {
				changed = true;

				model = (await this._provider.getModels())?.find(m => m.id === modelId);
				if (model == null) {
					this._model = undefined;

					return undefined;
				}
			}
		} else if (model.id !== this._model?.id) {
			changed = true;
		}

		if (changed) {
			if (isVSCodeAIModel(model)) {
				await configuration.updateEffective(`ai.experimental.model`, 'vscode');
				await configuration.updateEffective(`ai.experimental.vscode.model`, model.id);
			} else {
				await configuration.updateEffective(
					`ai.experimental.model`,
					`${model.provider.id}:${model.id}` as SupportedAIModels,
				);
			}
		}

		this._model = model;
		return model;
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
		const changes: string | undefined = await this.getChanges(changesOrRepoOrPath);
		if (changes == null) return undefined;

		const model = await this.getModel();
		if (model == null) return undefined;

		const provider = this._provider!;

		const confirmed = await confirmAIProviderToS(model, this.container.storage);
		if (!confirmed) return undefined;
		if (options?.cancellation?.isCancellationRequested) return undefined;

		if (options?.progress != null) {
			return window.withProgress(options.progress, async () =>
				provider.generateCommitMessage(model, changes, {
					cancellation: options?.cancellation,
					context: options?.context,
				}),
			);
		}
		return provider.generateCommitMessage(model, changes, {
			cancellation: options?.cancellation,
			context: options?.context,
		});
	}

	async generateDraftMessage(
		changesOrRepoOrPath: string[] | Repository | Uri,
		options?: {
			cancellation?: CancellationToken;
			context?: string;
			progress?: ProgressOptions;
			codeSuggestion?: boolean;
		},
	): Promise<string | undefined> {
		const changes: string | undefined = await this.getChanges(changesOrRepoOrPath);
		if (changes == null) return undefined;

		const model = await this.getModel();
		if (model == null) return undefined;

		const provider = this._provider!;

		const confirmed = await confirmAIProviderToS(model, this.container.storage);
		if (!confirmed) return undefined;
		if (options?.cancellation?.isCancellationRequested) return undefined;

		if (options?.progress != null) {
			return window.withProgress(options.progress, async () =>
				provider.generateDraftMessage(model, changes, {
					cancellation: options?.cancellation,
					context: options?.context,
					codeSuggestion: options?.codeSuggestion,
				}),
			);
		}
		return provider.generateDraftMessage(model, changes, {
			cancellation: options?.cancellation,
			context: options?.context,
			codeSuggestion: options?.codeSuggestion,
		});
	}

	private async getChanges(
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

		return changes;
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

		const model = await this.getModel();
		if (model == null) return undefined;

		const provider = this._provider!;

		const confirmed = await confirmAIProviderToS(model, this.container.storage);
		if (!confirmed) return undefined;

		if (!commit.hasFullDetails()) {
			await commit.ensureFullDetails();
			assertsCommitHasFullDetails(commit);
		}

		if (options?.progress != null) {
			return window.withProgress(options.progress, async () =>
				provider.explainChanges(model, commit.message, diff.contents, {
					cancellation: options?.cancellation,
				}),
			);
		}
		return provider.explainChanges(model, commit.message, diff.contents, {
			cancellation: options?.cancellation,
		});
	}

	async reset(all?: boolean) {
		let { _provider: provider } = this;
		if (provider == null) {
			// If we have no provider, try to get the current model (which will load the provider)
			await this.getModel({ silent: true });
			provider = this._provider;
		}

		const resetCurrent: MessageItem = { title: `Reset Current` };
		const resetAll: MessageItem = { title: 'Reset All' };
		const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };

		let result;
		if (all) {
			result = resetAll;
		} else if (provider == null) {
			result = await window.showInformationMessage(
				`Do you want to reset all of the stored AI keys?`,
				{ modal: true },
				resetAll,
				cancel,
			);
		} else {
			result = await window.showInformationMessage(
				`Do you want to reset the stored key for the current provider (${provider.name}) or reset all of the stored AI keys?`,
				{ modal: true },
				resetCurrent,
				resetAll,
				cancel,
			);
		}

		if (provider != null && result === resetCurrent) {
			void env.clipboard.writeText((await this.container.storage.getSecret(`gitlens.${provider.id}.key`)) ?? '');
			void this.container.storage.deleteSecret(`gitlens.${provider.id}.key`);

			void this.container.storage.delete(`confirm:ai:tos:${provider.id}`);
			void this.container.storage.deleteWorkspace(`confirm:ai:tos:${provider.id}`);
		} else if (result === resetAll) {
			const keys = [];
			for (const [providerId] of _supportedProviderTypes) {
				keys.push(await this.container.storage.getSecret(`gitlens.${providerId}.key`));
			}
			void env.clipboard.writeText(keys.join('\n'));

			for (const [providerId] of _supportedProviderTypes) {
				void this.container.storage.deleteSecret(`gitlens.${providerId}.key`);
			}

			void this.container.storage.deleteWithPrefix(`confirm:ai:tos`);
			void this.container.storage.deleteWorkspaceWithPrefix(`confirm:ai:tos`);
		}
	}

	supports(provider: AIProviders | string) {
		return _supportedProviderTypes.has(provider as AIProviders);
	}

	async switchModel() {
		void (await this.getModel({ force: true }));
	}
}

async function confirmAIProviderToS<Provider extends AIProviders>(
	model: AIModel<Provider, AIModels<Provider>>,
	storage: Storage,
): Promise<boolean> {
	const confirmed =
		storage.get(`confirm:ai:tos:${model.provider.id}`, false) ||
		storage.getWorkspace(`confirm:ai:tos:${model.provider.id}`, false);
	if (confirmed) return true;

	const accept: MessageItem = { title: 'Continue' };
	const acceptWorkspace: MessageItem = { title: 'Always for this Workspace' };
	const acceptAlways: MessageItem = { title: 'Always' };
	const decline: MessageItem = { title: 'Cancel', isCloseAffordance: true };
	const result = await window.showInformationMessage(
		`GitLens experimental AI features require sending a diff of the code changes to ${model.provider.name} for analysis. This may contain sensitive information.\n\nDo you want to continue?`,
		{ modal: true },
		accept,
		acceptWorkspace,
		acceptAlways,
		decline,
	);

	if (result === accept) return true;

	if (result === acceptWorkspace) {
		void storage.storeWorkspace(`confirm:ai:tos:${model.provider.id}`, true);
		return true;
	}

	if (result === acceptAlways) {
		void storage.store(`confirm:ai:tos:${model.provider.id}`, true);
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
				input.prompt = `Enter your [${provider.name} API Key](${provider.url} "Get your ${provider.name} API key")`;
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

export function extractDraftMessage(
	message: string,
	splitter = '\n\n',
): { title: string; description: string | undefined } {
	const firstBreak = message.indexOf(splitter) ?? 0;
	const title = firstBreak > -1 ? message.substring(0, firstBreak) : message;
	const description = firstBreak > -1 ? message.substring(firstBreak + splitter.length) : undefined;

	return {
		title: title,
		description: description,
	};
}
