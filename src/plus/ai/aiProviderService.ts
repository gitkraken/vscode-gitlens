import type { CancellationToken, Disposable, Event, MessageItem, ProgressOptions } from 'vscode';
import { CancellationTokenSource, env, EventEmitter, window } from 'vscode';
import type { AIPrimaryProviders, AIProviderAndModel, AIProviders, SupportedAIModels } from '../../constants.ai';
import {
	anthropicProviderDescriptor,
	deepSeekProviderDescriptor,
	geminiProviderDescriptor,
	githubProviderDescriptor,
	gitKrakenProviderDescriptor,
	huggingFaceProviderDescriptor,
	openAIProviderDescriptor,
	openRouterProviderDescriptor,
	vscodeProviderDescriptor,
	xAIProviderDescriptor,
} from '../../constants.ai';
import { SubscriptionPlanId } from '../../constants.subscription';
import type { AIGenerateDraftEventData, Source, TelemetryEvents } from '../../constants.telemetry';
import type { Container } from '../../container';
import {
	AIError,
	AIErrorReason,
	AINoRequestDataError,
	AuthenticationRequiredError,
	CancellationError,
} from '../../errors';
import type { AIFeatures } from '../../features';
import { isAdvancedFeature } from '../../features';
import type { GitCommit } from '../../git/models/commit';
import { isCommit } from '../../git/models/commit';
import type { GitRevisionReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { uncommitted, uncommittedStaged } from '../../git/models/revision';
import { assertsCommitHasFullDetails } from '../../git/utils/commit.utils';
import { showAIModelPicker, showAIProviderPicker } from '../../quickpicks/aiModelPicker';
import { Directive, isDirective } from '../../quickpicks/items/directive';
import { configuration } from '../../system/-webview/configuration';
import { getContext } from '../../system/-webview/context';
import type { Storage } from '../../system/-webview/storage';
import { debounce } from '../../system/function/debounce';
import { map } from '../../system/iterable';
import type { Lazy } from '../../system/lazy';
import { lazy } from '../../system/lazy';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import type { Deferred } from '../../system/promise';
import { getSettledValue, getSettledValues } from '../../system/promise';
import { PromiseCache } from '../../system/promiseCache';
import type { ServerConnection } from '../gk/serverConnection';
import { ensureFeatureAccess } from '../gk/utils/-webview/acount.utils';
import { compareSubscriptionPlans, getSubscriptionPlanTier, isSubscriptionPaid } from '../gk/utils/subscription.utils';
import type {
	AIActionType,
	AIModel,
	AIModelDescriptor,
	AIProviderConstructor,
	AIProviderDescriptorWithConfiguration,
	AIProviderDescriptorWithType,
} from './models/model';
import type { PromptTemplate, PromptTemplateContext, PromptTemplateType } from './models/promptTemplates';
import type { AIChatMessage, AIProvider, AIRequestResult } from './models/provider';
import { getLocalPromptTemplate, resolvePrompt } from './utils/-webview/prompt.utils';

export interface AIResult {
	readonly id?: string;
	readonly content: string;
	readonly model: AIModel;
	readonly usage?: {
		readonly promptTokens?: number;
		readonly completionTokens?: number;
		readonly totalTokens?: number;

		readonly limits?: {
			readonly used: number;
			readonly limit: number;
			readonly resetsOn: Date;
		};
	};
}

export interface AISummarizeResult extends AIResult {
	readonly parsed: {
		readonly summary: string;
		readonly body: string;
	};
}

export interface AIGenerateChangelogChange {
	readonly message: string;
	readonly issues: readonly { readonly id: string; readonly url: string; readonly title: string | undefined }[];
}

export interface AIGenerateChangelogChanges {
	readonly changes: readonly AIGenerateChangelogChange[];
	readonly range: {
		readonly base: { readonly ref: string; readonly label?: string };
		readonly head: { readonly ref: string; readonly label?: string };
	};
}

export interface AIModelChangeEvent {
	readonly model: AIModel | undefined;
}

// Order matters for sorting the picker
const supportedAIProviders = new Map<AIProviders, AIProviderDescriptorWithType>([
	[
		'gitkraken',
		{
			...gitKrakenProviderDescriptor,
			type: lazy(
				async () => (await import(/* webpackChunkName: "ai" */ './gitkrakenProvider')).GitKrakenProvider,
			),
		},
	],
	[
		'vscode',
		{
			...vscodeProviderDescriptor,
			type: lazy(async () => (await import(/* webpackChunkName: "ai" */ './vscodeProvider')).VSCodeAIProvider),
		},
	],
	[
		'openai',
		{
			...openAIProviderDescriptor,
			type: lazy(async () => (await import(/* webpackChunkName: "ai" */ './openaiProvider')).OpenAIProvider),
		},
	],
	[
		'anthropic',
		{
			...anthropicProviderDescriptor,
			type: lazy(
				async () => (await import(/* webpackChunkName: "ai" */ './anthropicProvider')).AnthropicProvider,
			),
		},
	],
	[
		'gemini',
		{
			...geminiProviderDescriptor,
			type: lazy(async () => (await import(/* webpackChunkName: "ai" */ './geminiProvider')).GeminiProvider),
		},
	],
	[
		'deepseek',
		{
			...deepSeekProviderDescriptor,
			type: lazy(async () => (await import(/* webpackChunkName: "ai" */ './deepSeekProvider')).DeepSeekProvider),
		},
	],
	[
		'xai',
		{
			...xAIProviderDescriptor,
			type: lazy(async () => (await import(/* webpackChunkName: "ai" */ './xaiProvider')).XAIProvider),
		},
	],
	[
		'openrouter',
		{
			...openRouterProviderDescriptor,
			type: lazy(
				async () => (await import(/* webpackChunkName: "ai" */ './openRouterProvider')).OpenRouterProvider,
			),
		},
	],
	[
		'github',
		{
			...githubProviderDescriptor,
			type: lazy(
				async () => (await import(/* webpackChunkName: "ai" */ './githubModelsProvider')).GitHubModelsProvider,
			),
		},
	],
	[
		'huggingface',
		{
			...huggingFaceProviderDescriptor,
			type: lazy(
				async () => (await import(/* webpackChunkName: "ai" */ './huggingFaceProvider')).HuggingFaceProvider,
			),
		},
	],
]);

export class AIProviderService implements Disposable {
	private readonly _onDidChangeModel = new EventEmitter<AIModelChangeEvent>();
	get onDidChangeModel(): Event<AIModelChangeEvent> {
		return this._onDidChangeModel.event;
	}

	private readonly _disposable: Disposable;
	private _model: AIModel | undefined;
	private readonly _promptTemplates = new PromiseCache<PromptTemplateType, PromptTemplate>({
		createTTL: 12 * 60 * 60 * 1000, // 12 hours
		expireOnError: true,
	});
	private _provider: AIProvider | undefined;
	private _providerDisposable: Disposable | undefined;

	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {
		this._disposable = this.container.subscription.onDidChange(() => this._promptTemplates.clear());
	}

	dispose(): void {
		this._disposable.dispose();
		this._onDidChangeModel.dispose();
		this._providerDisposable?.dispose();
		this._provider?.dispose();
	}

	private getConfiguredModel(): AIModelDescriptor | undefined {
		const qualifiedModelId = configuration.get('ai.model') ?? undefined;
		if (qualifiedModelId == null) return undefined;

		const index = qualifiedModelId.indexOf(':');
		const providerId = (index === -1 ? qualifiedModelId : qualifiedModelId.substring(0, index)) as AIProviders;
		let modelId = index === -1 ? undefined : qualifiedModelId.substring(index + 1);

		if (providerId != null && this.supports(providerId)) {
			if (modelId != null) {
				return { provider: providerId, model: modelId };
			} else if (isPrimaryAIProvider(providerId)) {
				modelId = configuration.get(`ai.${providerId}.model`) ?? undefined;
				if (modelId != null) {
					// Model ids are in the form of `provider:model`
					if (/^(.+):(.+)$/.test(modelId)) {
						return { provider: providerId, model: modelId };
					}
				}
			}
		}

		return undefined;
	}

	async getModels(providerId?: AIProviders): Promise<readonly AIModel[]> {
		const loadModels = async (type: Lazy<Promise<AIProviderConstructor>>) => {
			return type.value.then(async t => {
				const p = new t(this.container, this.connection);
				try {
					return await p.getModels();
				} finally {
					p.dispose();
				}
			});
		};

		if (providerId != null && this.supports(providerId)) {
			const type = supportedAIProviders.get(providerId)?.type;
			if (type == null) return [];

			return loadModels(type);
		}

		const modelResults = await Promise.allSettled(map(supportedAIProviders.values(), p => loadModels(p.type)));

		return modelResults.flatMap(m => getSettledValue(m, []));
	}

	async getModel(options?: { force?: boolean; silent?: boolean }, source?: Source): Promise<AIModel | undefined> {
		const cfg = this.getConfiguredModel();
		if (!options?.force && cfg?.provider != null && cfg?.model != null) {
			const model = await this.getOrUpdateModel(cfg.provider, cfg.model);
			if (model != null) return model;
		}

		if (options?.silent) return undefined;

		let chosenProviderId: AIProviders | undefined;
		let chosenModel: AIModel | undefined;

		if (!options?.force) {
			const vsCodeModels = await this.getModels('vscode');
			if (vsCodeModels.length !== 0) {
				chosenProviderId = 'vscode';
			} else if ((await this.container.subscription.getSubscription()).account?.verified) {
				chosenProviderId = 'gitkraken';
				const gitkrakenModels = await this.getModels('gitkraken');
				chosenModel = gitkrakenModels.find(m => m.default);
			}
		}

		while (true) {
			chosenProviderId ??= (await showAIProviderPicker(this.container, cfg))?.provider;
			if (chosenProviderId == null) return;

			const provider = supportedAIProviders.get(chosenProviderId);
			if (provider == null) return;

			if (!(await this.ensureProviderConfigured(provider, false))) return;

			if (chosenModel == null) {
				const result = await showAIModelPicker(this.container, chosenProviderId, cfg);
				if (result == null || (isDirective(result) && result !== Directive.Back)) return;
				if (result === Directive.Back) {
					chosenProviderId = undefined;
					continue;
				}

				chosenModel = result.model;
			}

			break;
		}

		const model = await this.getOrUpdateModel(chosenModel);

		this.container.telemetry.sendEvent(
			'ai/switchModel',
			model != null
				? {
						'model.id': model.id,
						'model.provider.id': model.provider.id,
						'model.provider.name': model.provider.name,
				  }
				: { failed: true },
			source,
		);

		void (await showConfirmAIProviderToS(this.container.storage));
		return model;
	}

	async getProvidersConfiguration(): Promise<Map<AIProviders, AIProviderDescriptorWithConfiguration>> {
		const promises = await Promise.allSettled(
			map(
				supportedAIProviders.values(),
				async p =>
					[
						p.id,
						{ ...p, type: undefined, configured: await this.ensureProviderConfigured(p, true) },
					] as const,
			),
		);
		return new Map<AIProviders, AIProviderDescriptorWithConfiguration>(getSettledValues(promises));
	}

	private async ensureProviderConfigured(provider: AIProviderDescriptorWithType, silent: boolean): Promise<boolean> {
		if (provider.id === this._provider?.id) return this._provider.configured(silent);

		const type = await provider.type.value;
		if (type == null) return false;

		const p = new type(this.container, this.connection);
		try {
			return await p.configured(silent);
		} finally {
			p.dispose();
		}
	}

	private getOrUpdateModel(model: AIModel): Promise<AIModel | undefined>;
	private getOrUpdateModel<T extends AIProviders>(providerId: T, modelId: string): Promise<AIModel | undefined>;
	private async getOrUpdateModel(
		modelOrProviderId: AIModel | AIProviders,
		modelId?: string,
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
			this._providerDisposable?.dispose();
			this._provider?.dispose();

			const type = await supportedAIProviders.get(providerId)?.type.value;
			if (type == null) {
				this._provider = undefined;
				this._model = undefined;

				return undefined;
			}

			this._provider = new type(this.container, this.connection);
			this._providerDisposable = this._provider?.onDidChange?.(
				debounce(async () => {
					if (this._model != null) return;

					const model = await this.getModel({ silent: true });
					if (model == null) return;

					this._onDidChangeModel.fire({ model: this._model });
				}, 250),
				this,
			);
		}

		if (model == null) {
			if (modelId != null && modelId === this._model?.id) {
				model = this._model;
			} else {
				changed = true;

				const models = await this._provider.getModels();
				model = models?.find(m => m.id === modelId);
				if (model == null) {
					this._model = undefined;

					return undefined;
				}
			}
		} else if (model.id !== this._model?.id) {
			changed = true;
		}

		this._model = model;

		if (changed) {
			if (isPrimaryAIProviderModel(model)) {
				await configuration.updateEffective(`ai.model`, model.provider.id);
				await configuration.updateEffective(`ai.${model.provider.id}.model`, model.id);
			} else {
				await configuration.updateEffective(
					`ai.model`,
					`${model.provider.id}:${model.id}` as SupportedAIModels,
				);
			}
			this._onDidChangeModel.fire({ model: model });
		}

		return model;
	}

	private async ensureOrgAccess(): Promise<boolean> {
		const orgEnabled = getContext('gitlens:gk:organization:ai:enabled');
		if (orgEnabled === false) {
			await window.showErrorMessage(`AI features have been disabled for your organization.`);
			return false;
		}

		return true;
	}

	private async ensureFeatureAccess(feature: AIFeatures, source: Source): Promise<boolean> {
		if (!(await this.ensureOrgAccess())) return false;

		if (feature === 'generate-commitMessage') return true;
		if (
			!(await ensureFeatureAccess(
				this.container,
				isAdvancedFeature(feature)
					? `Advanced AI features require a trial or GitLens Advanced.`
					: `Pro AI features require a trial or GitLens Pro.`,
				feature,
				source,
			))
		) {
			return false;
		}

		return true;
	}

	async explainCommit(
		commitOrRevision: GitRevisionReference | GitCommit,
		sourceContext: Source & { type: TelemetryEvents['ai/explain']['changeType'] },
		options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
	): Promise<AISummarizeResult | undefined> {
		const { type, ...source } = sourceContext;

		const result = await this.sendRequest(
			'explain-changes',
			async (model, reporting, cancellation, maxInputTokens, retries) => {
				const diff = await this.container.git.diff(commitOrRevision.repoPath).getDiff?.(commitOrRevision.ref);
				if (!diff?.contents) throw new AINoRequestDataError('No changes found to explain.');
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const commit = isCommit(commitOrRevision)
					? commitOrRevision
					: await this.container.git.commits(commitOrRevision.repoPath).getCommit(commitOrRevision.ref);
				if (commit == null) throw new AINoRequestDataError('Unable to find commit');
				if (cancellation.isCancellationRequested) throw new CancellationError();

				if (!commit.hasFullDetails()) {
					await commit.ensureFullDetails();
					assertsCommitHasFullDetails(commit);

					if (cancellation.isCancellationRequested) throw new CancellationError();
				}

				const { prompt } = await this.getPrompt(
					'explain-changes',
					model,
					{
						diff: diff.contents,
						message: commit.message,
						instructions: configuration.get('ai.explainChanges.customInstructions'),
					},
					maxInputTokens,
					retries,
					reporting,
				);
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const messages: AIChatMessage[] = [{ role: 'user', content: prompt }];
				return messages;
			},

			m => `Explaining changes with ${m.name}...`,
			source,
			m => ({
				key: 'ai/explain',
				data: {
					type: 'change',
					changeType: type,
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
			options,
		);
		return result != null ? { ...result, parsed: parseSummarizeResult(result.content) } : undefined;
	}

	async generateCommitMessage(
		changesOrRepo: string | string[] | Repository,
		source: Source,
		options?: {
			cancellation?: CancellationToken;
			context?: string;
			generating?: Deferred<AIModel>;
			progress?: ProgressOptions;
		},
	): Promise<AISummarizeResult | undefined> {
		const result = await this.sendRequest(
			'generate-commitMessage',
			async (model, reporting, cancellation, maxInputTokens, retries) => {
				const changes: string | undefined = await this.getChanges(changesOrRepo);
				if (changes == null) throw new AINoRequestDataError('No changes to generate a commit message from.');
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const { prompt } = await this.getPrompt(
					'generate-commitMessage',
					model,
					{
						diff: changes,
						context: options?.context,
						instructions: configuration.get('ai.generateCommitMessage.customInstructions'),
					},
					maxInputTokens,
					retries,
					reporting,
				);
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const messages: AIChatMessage[] = [{ role: 'user', content: prompt }];
				return messages;
			},
			m => `Generating commit message with ${m.name}...`,
			source,
			m => ({
				key: 'ai/generate',
				data: {
					type: 'commitMessage',
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
			{ ...options, modelOptions: { outputTokens: 4096 } },
		);
		return result != null ? { ...result, parsed: parseSummarizeResult(result.content) } : undefined;
	}

	async generateCreatePullRequest(
		repo: Repository,
		baseRef: string,
		headRef: string,
		source: Source,
		options?: {
			cancellation?: CancellationToken;
			context?: string;
			generating?: Deferred<AIModel>;
			progress?: ProgressOptions;
		},
	): Promise<AISummarizeResult | undefined> {
		const result = await this.sendRequest(
			'generate-create-pullRequest',
			async (model, reporting, cancellation, maxInputTokens, retries) => {
				const [diffResult, logResult] = await Promise.allSettled([
					repo.git.diff().getDiff?.(headRef, baseRef, { notation: '...' }),
					repo.git.commits().getLog(`${baseRef}..${headRef}`),
				]);

				const diff = getSettledValue(diffResult);
				const log = getSettledValue(logResult);

				if (!diff?.contents || !log?.commits?.size) {
					throw new AINoRequestDataError('No changes to generate a pull request from.');
				}

				if (cancellation.isCancellationRequested) throw new CancellationError();

				const commitMessages: string[] = [];
				for (const commit of [...log.commits.values()].sort((a, b) => a.date.getTime() - b.date.getTime())) {
					commitMessages.push(commit.message ?? commit.summary);
				}

				const { prompt } = await this.getPrompt(
					'generate-create-pullRequest',
					model,
					{
						diff: diff.contents,
						data: commitMessages.join('\n'),
						context: options?.context,
						instructions: configuration.get('ai.generateCreatePullRequest.customInstructions'),
					},
					maxInputTokens,
					retries,
					reporting,
				);
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const messages: AIChatMessage[] = [{ role: 'user', content: prompt }];
				return messages;
			},
			m => `Generating pull request details with ${m.name}...`,
			source,
			m => ({
				key: 'ai/generate',
				data: {
					type: 'createPullRequest',
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
			options,
		);
		return result != null ? { ...result, parsed: parseSummarizeResult(result.content) } : undefined;
	}

	async generateCreateDraft(
		changesOrRepo: string | string[] | Repository,
		sourceContext: Source & { type: AIGenerateDraftEventData['draftType'] },
		options?: {
			cancellation?: CancellationToken;
			context?: string;
			generating?: Deferred<AIModel>;
			progress?: ProgressOptions;
			codeSuggestion?: boolean;
		},
	): Promise<AISummarizeResult | undefined> {
		const { type, ...source } = sourceContext;

		const result = await this.sendRequest(
			options?.codeSuggestion ? 'generate-create-codeSuggestion' : 'generate-create-cloudPatch',
			async (model, reporting, cancellation, maxInputTokens, retries) => {
				const changes: string | undefined = await this.getChanges(changesOrRepo);
				if (changes == null) {
					throw new AINoRequestDataError(
						`No changes to generate a ${options?.codeSuggestion ? 'code suggestion' : 'cloud patch'} from.`,
					);
				}
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const { prompt } = await this.getPrompt(
					options?.codeSuggestion ? 'generate-create-codeSuggestion' : 'generate-create-cloudPatch',
					model,
					{
						diff: changes,
						context: options?.context,
						instructions: options?.codeSuggestion
							? configuration.get('ai.generateCreateCodeSuggest.customInstructions')
							: configuration.get('ai.generateCreateCloudPatch.customInstructions'),
					},
					maxInputTokens,
					retries,
					reporting,
				);
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const messages: AIChatMessage[] = [{ role: 'user', content: prompt }];
				return messages;
			},
			m =>
				`Generating ${options?.codeSuggestion ? 'code suggestion' : 'cloud patch'} description with ${
					m.name
				}...`,
			source,
			m => ({
				key: 'ai/generate',
				data: {
					type: 'draftMessage',
					draftType: type,
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
			options,
		);
		return result != null ? { ...result, parsed: parseSummarizeResult(result.content) } : undefined;
	}

	async generateStashMessage(
		changesOrRepo: string | string[] | Repository,
		source: Source,
		options?: {
			cancellation?: CancellationToken;
			context?: string;
			generating?: Deferred<AIModel>;
			progress?: ProgressOptions;
		},
	): Promise<AISummarizeResult | undefined> {
		const result = await this.sendRequest(
			'generate-stashMessage',
			async (model, reporting, cancellation, maxInputTokens, retries) => {
				const changes: string | undefined = await this.getChanges(changesOrRepo);
				if (changes == null) throw new AINoRequestDataError('No changes to generate a stash message from.');
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const { prompt } = await this.getPrompt(
					'generate-stashMessage',
					model,
					{
						diff: changes,
						context: options?.context,
						instructions: configuration.get('ai.generateStashMessage.customInstructions'),
					},
					maxInputTokens,
					retries,
					reporting,
				);
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const messages: AIChatMessage[] = [{ role: 'user', content: prompt }];
				return messages;
			},
			m => `Generating stash message with ${m.name}...`,
			source,
			m => ({
				key: 'ai/generate',
				data: {
					type: 'stashMessage',
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
			{ ...options, modelOptions: { outputTokens: 1024 } },
		);
		return result != null ? { ...result, parsed: parseSummarizeResult(result.content) } : undefined;
	}

	async generateChangelog(
		changes: Lazy<Promise<AIGenerateChangelogChanges>>,
		source: Source,
		options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
	): Promise<AIResult | undefined> {
		const result = await this.sendRequest(
			'generate-changelog',
			async (model, reporting, cancellation, maxInputTokens, retries) => {
				const { changes: data } = await changes.value;
				if (!data.length) throw new AINoRequestDataError('No changes to generate a changelog from.');
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const { prompt } = await this.getPrompt(
					'generate-changelog',
					model,
					{
						data: JSON.stringify(data),
						instructions: configuration.get('ai.generateChangelog.customInstructions'),
					},
					maxInputTokens,
					retries,
					reporting,
				);
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const messages: AIChatMessage[] = [{ role: 'user', content: prompt }];
				return messages;
			},
			m => `Generating changelog with ${m.name}...`,
			source,
			m => ({
				key: 'ai/generate',
				data: {
					type: 'changelog',
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
			options,
		);
		return result != null ? { ...result } : undefined;
	}

	private async sendRequest<T extends AIActionType>(
		action: T,
		getMessages: (
			model: AIModel,
			reporting: TelemetryEvents['ai/generate' | 'ai/explain'],
			cancellation: CancellationToken,
			maxCodeCharacters: number,
			retries: number,
		) => Promise<AIChatMessage[]>,
		getProgressTitle: (model: AIModel) => string,
		source: Source,
		getTelemetryInfo: (model: AIModel) => {
			key: 'ai/generate' | 'ai/explain';
			data: TelemetryEvents['ai/generate' | 'ai/explain'];
		},
		options?: {
			cancellation?: CancellationToken;
			generating?: Deferred<AIModel>;
			modelOptions?: { outputTokens?: number; temperature?: number };
			progress?: ProgressOptions;
		},
	): Promise<AIRequestResult | undefined> {
		if (!(await this.ensureFeatureAccess(action, source))) {
			return undefined;
		}

		const model = await this.getModel(undefined, source);
		if (model == null || options?.cancellation?.isCancellationRequested) {
			options?.generating?.cancel();
			return undefined;
		}

		const telementry = getTelemetryInfo(model);

		const cancellationSource = new CancellationTokenSource();
		if (options?.cancellation) {
			options.cancellation.onCancellationRequested(() => cancellationSource.cancel());
		}
		const cancellation = cancellationSource.token;

		const confirmed = await showConfirmAIProviderToS(this.container.storage);
		if (!confirmed || cancellation.isCancellationRequested) {
			this.container.telemetry.sendEvent(
				telementry.key,
				{
					...telementry.data,
					'failed.reason': cancellation.isCancellationRequested ? 'user-cancelled' : 'user-declined',
				},
				source,
			);

			options?.generating?.cancel();
			return undefined;
		}

		const apiKey = await this._provider!.getApiKey(false);
		if (apiKey == null || cancellation.isCancellationRequested) {
			this.container.telemetry.sendEvent(
				telementry.key,
				cancellation.isCancellationRequested
					? { ...telementry.data, 'failed.reason': 'user-cancelled' }
					: { ...telementry.data, 'failed.reason': 'error', 'failed.error': 'Not authorized' },
				source,
			);

			options?.generating?.cancel();
			return undefined;
		}

		const promise = this._provider!.sendRequest(
			action,
			model,
			apiKey,
			getMessages.bind(this, model, telementry.data, cancellation),
			{
				cancellation: cancellation,
				modelOptions: options?.modelOptions,
			},
		);
		options?.generating?.fulfill(model);

		const start = Date.now();
		try {
			const result = await (options?.progress != null
				? window.withProgress(
						{ ...options.progress, cancellable: true, title: getProgressTitle(model) },
						(_progress, token) => {
							token.onCancellationRequested(() => cancellationSource.cancel());
							return promise;
						},
				  )
				: promise);

			telementry.data['output.length'] = result?.content?.length;
			telementry.data['usage.promptTokens'] = result?.usage?.promptTokens;
			telementry.data['usage.completionTokens'] = result?.usage?.completionTokens;
			telementry.data['usage.totalTokens'] = result?.usage?.totalTokens;
			telementry.data['usage.limits.used'] = result?.usage?.limits?.used;
			telementry.data['usage.limits.limit'] = result?.usage?.limits?.limit;
			telementry.data['usage.limits.resetsOn'] = result?.usage?.limits?.resetsOn?.toISOString();
			this.container.telemetry.sendEvent(
				telementry.key,
				{ ...telementry.data, duration: Date.now() - start },
				source,
			);

			return result;
		} catch (ex) {
			if (ex instanceof CancellationError) {
				this.container.telemetry.sendEvent(
					telementry.key,
					{ ...telementry.data, duration: Date.now() - start, 'failed.reason': 'user-cancelled' },
					source,
				);

				return undefined;
			}
			if (ex instanceof AIError) {
				this.container.telemetry.sendEvent(
					telementry.key,
					{
						...telementry.data,
						duration: Date.now() - start,
						// eslint-disable-next-line @typescript-eslint/no-base-to-string
						'failed.error': String(ex),
						'failed.error.detail': String(ex.original),
					},
					source,
				);

				switch (ex.reason) {
					case AIErrorReason.NoRequestData:
						void window.showErrorMessage(ex.message);
						return undefined;

					case AIErrorReason.NoEntitlement: {
						const sub = await this.container.subscription.getSubscription();

						if (isSubscriptionPaid(sub)) {
							const plan =
								compareSubscriptionPlans(sub.plan.actual.id, SubscriptionPlanId.Advanced) <= 0
									? SubscriptionPlanId.Business
									: SubscriptionPlanId.Advanced;

							const upgrade = { title: `Upgrade to ${getSubscriptionPlanTier(plan)}` };
							const result = await window.showErrorMessage(
								"This AI feature isn't included in your current plan. Please upgrade and try again.",
								upgrade,
							);

							if (result === upgrade) {
								void this.container.subscription.manageSubscription(source);
							}
						} else {
							// Users without accounts would never get here since they would have been blocked by `ensureFeatureAccess`
							const upgrade = { title: 'Upgrade to Pro' };
							const result = await window.showErrorMessage(
								'Please upgrade to GitLens Pro to access this AI feature and try again.',
								upgrade,
							);

							if (result === upgrade) {
								void this.container.subscription.upgrade(SubscriptionPlanId.Pro, source);
							}
						}

						return undefined;
					}
					case AIErrorReason.RequestTooLarge: {
						const switchModel: MessageItem = { title: 'Switch Model' };
						const result = await window.showErrorMessage(
							'Your request is too large. Please reduce the size of your request or switch to a different model, and then try again.',
							switchModel,
						);
						if (result === switchModel) {
							void this.switchModel(source);
						}
						return undefined;
					}
					case AIErrorReason.UserQuotaExceeded: {
						const increaseLimit: MessageItem = { title: 'Increase Limit' };
						const result = await window.showErrorMessage(
							"Your request could not be completed because you've reached the weekly Al usage limit for your current plan. Upgrade to unlock more Al-powered actions.",
							increaseLimit,
						);

						if (result === increaseLimit) {
							void this.container.subscription.manageSubscription(source);
						}

						return undefined;
					}
					case AIErrorReason.RateLimitExceeded: {
						const switchModel: MessageItem = { title: 'Switch Model' };
						const result = await window.showErrorMessage(
							'Rate limit exceeded. Please wait a few moments or switch to a different model, and then try again.',
							switchModel,
						);
						if (result === switchModel) {
							void this.switchModel(source);
						}

						return undefined;
					}
					case AIErrorReason.RateLimitOrFundsExceeded: {
						const switchModel: MessageItem = { title: 'Switch Model' };
						const result = await window.showErrorMessage(
							'Rate limit exceeded, or your account is out of funds. Please wait a few moments, check your account balance, or switch to a different model, and then try again.',
							switchModel,
						);
						if (result === switchModel) {
							void this.switchModel(source);
						}
						return undefined;
					}
					case AIErrorReason.ServiceCapacityExceeded: {
						void window.showErrorMessage(
							'GitKraken AI is temporarily unable to process your request due to high volume. Please wait a few moments and try again. If this issue persists, please contact support.',
							'OK',
						);
						return undefined;
					}
					case AIErrorReason.ModelNotSupported: {
						const switchModel: MessageItem = { title: 'Switch Model' };
						const result = await window.showErrorMessage(
							'The selected model is not supported for this request. Please select a different model and try again.',
							switchModel,
						);
						if (result === switchModel) {
							void this.switchModel(source);
						}
						return undefined;
					}
					case AIErrorReason.Unauthorized: {
						const switchModel: MessageItem = { title: 'Switch Model' };
						const result = await window.showErrorMessage(
							'You do not have access to the selected model. Please select a different model and try again.',
							switchModel,
						);
						if (result === switchModel) {
							void this.switchModel(source);
						}
						return undefined;
					}
					case AIErrorReason.DeniedByUser: {
						const switchModel: MessageItem = { title: 'Switch Model' };
						const result = await window.showErrorMessage(
							'You have denied access to the selected model. Please provide access or select a different model, and then try again.',
							switchModel,
						);
						if (result === switchModel) {
							void this.switchModel(source);
						}
						return undefined;
					}
				}

				return undefined;
			}

			this.container.telemetry.sendEvent(
				telementry.key,
				{
					...telementry.data,
					duration: Date.now() - start,
					'failed.error': String(ex),
					'failed.error.detail': ex.original ? String(ex.original) : undefined,
				},
				source,
			);
			throw ex;
		}
	}

	private async getChanges(
		changesOrRepo: string | string[] | Repository,
		options?: { cancellation?: CancellationToken; context?: string; progress?: ProgressOptions },
	): Promise<string | undefined> {
		let changes: string;
		if (typeof changesOrRepo === 'string') {
			changes = changesOrRepo;
		} else if (Array.isArray(changesOrRepo)) {
			changes = changesOrRepo.join('\n');
		} else {
			let diff = await changesOrRepo.git.diff().getDiff?.(uncommittedStaged);
			if (!diff?.contents) {
				diff = await changesOrRepo.git.diff().getDiff?.(uncommitted);
				if (!diff?.contents) throw new Error('No changes to generate a commit message from.');
			}
			if (options?.cancellation?.isCancellationRequested) return undefined;

			changes = diff.contents;
		}

		return changes;
	}

	private async getPrompt<T extends PromptTemplateType>(
		template: T,
		model: AIModel,
		context: PromptTemplateContext<T>,
		maxInputTokens: number,
		retries: number,
		reporting: TelemetryEvents['ai/generate' | 'ai/explain'],
	): Promise<{ prompt: string; truncated: boolean }> {
		const promptTemplate = await this.getPromptTemplate(template, model);
		if (promptTemplate == null) {
			debugger;
			throw new Error(`No prompt template found for ${template}`);
		}

		const result = await resolvePrompt(model, promptTemplate, context, maxInputTokens, retries, reporting);
		return result;
	}

	private async getPromptTemplate<T extends PromptTemplateType>(
		template: T,
		model: AIModel,
	): Promise<PromptTemplate | undefined> {
		if ((await this.container.subscription.getSubscription()).account) {
			const scope = getLogScope();

			try {
				return await this._promptTemplates.get(template, async () => {
					const url = this.container.urls.getGkAIApiUrl(`templates/message-prompt/${template}`);
					const rsp = await fetch(url, {
						headers: await this.connection.getGkHeaders(undefined, undefined, {
							Accept: 'application/json',
						}),
					});
					if (!rsp.ok) {
						throw new Error(`Getting prompt template (${url}) failed: ${rsp.status} (${rsp.statusText})`);
					}

					interface PromptResponse {
						data: {
							id: string;
							template: string;
							variables: string[];
						};
						error?: null;
					}

					const result: PromptResponse = (await rsp.json()) as PromptResponse;
					if (result.error != null) {
						throw new Error(`Getting prompt template (${url}) failed: ${String(result.error)}`);
					}

					return {
						id: result.data.id,
						template: result.data.template,
						variables: result.data.variables,
					};
				});
			} catch (ex) {
				if (!(ex instanceof AuthenticationRequiredError)) {
					debugger;
					Logger.error(ex, scope, `Unable to get prompt template for '${template}'`);
				}
			}
		}

		return getLocalPromptTemplate(template, model);
	}

	async reset(all?: boolean): Promise<void> {
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
			this.resetProviderKey(provider.id);
			this.resetConfirmations();
		} else if (result === resetAll) {
			const keys = [];
			for (const providerId of supportedAIProviders.keys()) {
				keys.push(await this.container.storage.getSecret(`gitlens.${providerId}.key`));

				this.resetProviderKey(providerId, true);
			}

			this.resetConfirmations();

			void env.clipboard.writeText(keys.join('\n'));
			void window.showInformationMessage(
				`All stored AI keys have been reset. The configured keys were copied to your clipboard.`,
			);
		}
	}

	resetConfirmations(): void {
		void this.container.storage.deleteWithPrefix(`confirm:ai:tos`);
		void this.container.storage.deleteWorkspaceWithPrefix(`confirm:ai:tos`);
	}

	resetProviderKey(provider: AIProviders, silent?: boolean): void {
		if (!silent) {
			void this.container.storage.getSecret(`gitlens.${provider}.key`).then(key => {
				if (key) {
					void env.clipboard.writeText(key);
					void window.showInformationMessage(
						`The stored AI key has been reset. The configured key was copied to your clipboard.`,
					);
				}
			});
		}
		void this.container.storage.deleteSecret(`gitlens.${provider}.key`);
	}

	supports(provider: AIProviders | string): boolean {
		return supportedAIProviders.has(provider as AIProviders);
	}

	switchModel(source?: Source): Promise<AIModel | undefined> {
		return this.getModel({ force: true }, source);
	}
}

async function showConfirmAIProviderToS(storage: Storage): Promise<boolean> {
	const confirmed = storage.get(`confirm:ai:tos`, false) || storage.getWorkspace(`confirm:ai:tos`, false);
	if (confirmed) return true;

	const acceptAlways: MessageItem = { title: 'Accept' };
	const acceptWorkspace: MessageItem = { title: 'Accept Only for this Workspace' };
	const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };

	const result = await window.showInformationMessage(
		'GitLens AI features can send code snippets, diffs, and other context to your selected AI provider for analysis.',
		{ modal: true },
		acceptAlways,
		acceptWorkspace,
		cancel,
	);

	if (result === acceptWorkspace) {
		void storage.storeWorkspace(`confirm:ai:tos`, true).catch();
		return true;
	}

	if (result === acceptAlways) {
		void storage.store(`confirm:ai:tos`, true).catch();
		return true;
	}

	return false;
}

function parseSummarizeResult(result: string): NonNullable<AISummarizeResult['parsed']> {
	result = result.trim();
	let summary = result.match(/<summary>\s?([\s\S]*?)\s?(<\/summary>|$)/)?.[1]?.trim() ?? '';
	let body = result.match(/<body>\s?([\s\S]*?)\s?(<\/body>|$)/)?.[1]?.trim() ?? '';

	// If both tags are missing, split the result
	if (!summary && !body) {
		return splitMessageIntoSummaryAndBody(result);
	}

	if (summary && !body) {
		// If only summary tag is present, use the remaining text as the body
		body = result.replace(/<summary>[\s\S]*?<\/summary>/, '')?.trim() ?? '';
		if (!body) {
			return splitMessageIntoSummaryAndBody(summary);
		}
	} else if (!summary && body) {
		// If only body tag is present, use the remaining text as the summary
		summary = result.replace(/<body>[\s\S]*?<\/body>/, '').trim() ?? '';
		if (!summary) {
			return splitMessageIntoSummaryAndBody(body);
		}
	}

	return { summary: summary, body: body };
}

function splitMessageIntoSummaryAndBody(message: string): NonNullable<AISummarizeResult['parsed']> {
	const index = message.indexOf('\n');
	if (index === -1) return { summary: message, body: '' };

	return {
		summary: message.substring(0, index).trim(),
		body: message.substring(index + 1).trim(),
	};
}

function isPrimaryAIProvider(provider: AIProviders): provider is AIPrimaryProviders {
	return supportedAIProviders.get(provider)?.primary === true;
}

function isPrimaryAIProviderModel(model: AIModel): model is AIModel<AIPrimaryProviders, AIProviderAndModel> {
	return isPrimaryAIProvider(model.provider.id);
}
