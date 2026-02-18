import type { CancellationToken, Disposable, Event, MessageItem, ProgressOptions } from 'vscode';
import { CancellationTokenSource, env, EventEmitter, window } from 'vscode';
import { fetch } from '@env/fetch.js';
import type { AIPrimaryProviders, AIProviderAndModel, AIProviders, SupportedAIModels } from '../../constants.ai.js';
import {
	anthropicProviderDescriptor,
	azureProviderDescriptor,
	deepSeekProviderDescriptor,
	geminiProviderDescriptor,
	githubProviderDescriptor,
	gitKrakenProviderDescriptor,
	huggingFaceProviderDescriptor,
	mistralProviderDescriptor,
	ollamaProviderDescriptor,
	openAICompatibleProviderDescriptor,
	openAIProviderDescriptor,
	openRouterProviderDescriptor,
	vscodeProviderDescriptor,
	xAIProviderDescriptor,
} from '../../constants.ai.js';
import type { Source, TelemetryEvents } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import {
	AIError,
	AIErrorReason,
	AINoRequestDataError,
	AuthenticationRequiredError,
	CancellationError,
	isCancellationError,
} from '../../errors.js';
import type { AIFeatures } from '../../features.js';
import { isAdvancedFeature } from '../../features.js';
import type { Repository } from '../../git/models/repository.js';
import { uncommitted, uncommittedStaged } from '../../git/models/revision.js';
import { filterDiffFiles } from '../../git/parsers/diffParser.js';
import { showAIModelPicker, showAIProviderPicker } from '../../quickpicks/aiModelPicker.js';
import { Directive, isDirective } from '../../quickpicks/items/directive.js';
import { configuration } from '../../system/-webview/configuration.js';
import { getContext } from '../../system/-webview/context.js';
import type { Storage } from '../../system/-webview/storage.js';
import { debug, trace } from '../../system/decorators/log.js';
import { debounce } from '../../system/function/debounce.js';
import { map } from '../../system/iterable.js';
import type { Lazy } from '../../system/lazy.js';
import { lazy } from '../../system/lazy.js';
import { Logger } from '../../system/logger.js';
import { getScopedLogger } from '../../system/logger.scope.js';
import type { Deferred } from '../../system/promise.js';
import { getSettledValue, getSettledValues } from '../../system/promise.js';
import { PromiseCache } from '../../system/promiseCache.js';
import type { Serialized } from '../../system/serialize.js';
import type { ServerConnection } from '../gk/serverConnection.js';
import { ensureFeatureAccess } from '../gk/utils/-webview/acount.utils.js';
import { isAiAllAccessPromotionActive } from '../gk/utils/-webview/promo.utils.js';
import {
	compareSubscriptionPlans,
	getSubscriptionPlanName,
	isSubscriptionPaid,
} from '../gk/utils/subscription.utils.js';
import { AIActions } from './aiActions.js';
import { AIIgnoreCache } from './aiIgnoreCache.js';
import type { AIService } from './aiService.js';
import { GitKrakenProvider } from './gitkrakenProvider.js';
import type {
	AIActionType,
	AIModel,
	AIModelDescriptor,
	AIProviderConstructor,
	AIProviderDescriptorWithConfiguration,
	AIProviderDescriptorWithType,
} from './models/model.js';
import type {
	PromptTemplate,
	PromptTemplateContext,
	PromptTemplateId,
	PromptTemplateType,
	TruncationHandler,
} from './models/promptTemplates.js';
import type { AIChatMessage, AIProvider, AIProviderResponse, AIProviderResult } from './models/provider.js';
import { ensureAccess, getOrgAIConfig, isProviderEnabledByOrg } from './utils/-webview/ai.utils.js';
import { getLocalPromptTemplate, resolvePrompt } from './utils/-webview/prompt.utils.js';

export interface AIResponse<T = void> extends AIProviderResponse<T> {
	readonly type: AIActionType;
	readonly feature: string;
}

export interface AIResult<T = void> {
	readonly model: AIModel;
	readonly promise: Promise<AIResponse<T> | 'cancelled' | undefined>;
	readonly type: AIActionType;
	readonly feature: string;
}

export interface AIResultContext extends Serialized<Omit<AIResponse<any>, 'content' | 'result'>, string> {}
export type AISourceContext<T> = Source & { context: T };

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
				async () => (await import(/* webpackChunkName: "ai" */ './gitkrakenProvider.js')).GitKrakenProvider,
			),
		},
	],
	[
		'vscode',
		{
			...vscodeProviderDescriptor,
			type: lazy(async () => (await import(/* webpackChunkName: "ai" */ './vscodeProvider.js')).VSCodeAIProvider),
		},
	],
	[
		'anthropic',
		{
			...anthropicProviderDescriptor,
			type: lazy(
				async () => (await import(/* webpackChunkName: "ai" */ './anthropicProvider.js')).AnthropicProvider,
			),
		},
	],
	[
		'gemini',
		{
			...geminiProviderDescriptor,
			type: lazy(async () => (await import(/* webpackChunkName: "ai" */ './geminiProvider.js')).GeminiProvider),
		},
	],
	[
		'openai',
		{
			...openAIProviderDescriptor,
			type: lazy(async () => (await import(/* webpackChunkName: "ai" */ './openaiProvider.js')).OpenAIProvider),
		},
	],
	[
		'azure',
		{
			...azureProviderDescriptor,
			type: lazy(async () => (await import(/* webpackChunkName: "ai" */ './azureProvider.js')).AzureProvider),
		},
	],
	[
		'mistral',
		{
			...mistralProviderDescriptor,
			type: lazy(async () => (await import(/* webpackChunkName: "ai" */ './mistralProvider.js')).MistralProvider),
		},
	],
	[
		'openaicompatible',
		{
			...openAICompatibleProviderDescriptor,
			type: lazy(
				async () =>
					(await import(/* webpackChunkName: "ai" */ './openAICompatibleProvider.js'))
						.OpenAICompatibleProvider,
			),
		},
	],
	[
		'ollama',
		{
			...ollamaProviderDescriptor,
			type: lazy(async () => (await import(/* webpackChunkName: "ai" */ './ollamaProvider.js')).OllamaProvider),
		},
	],
	[
		'openrouter',
		{
			...openRouterProviderDescriptor,
			type: lazy(
				async () => (await import(/* webpackChunkName: "ai" */ './openRouterProvider.js')).OpenRouterProvider,
			),
		},
	],
	[
		'huggingface',
		{
			...huggingFaceProviderDescriptor,
			type: lazy(
				async () => (await import(/* webpackChunkName: "ai" */ './huggingFaceProvider.js')).HuggingFaceProvider,
			),
		},
	],
	[
		'github',
		{
			...githubProviderDescriptor,
			type: lazy(
				async () =>
					(await import(/* webpackChunkName: "ai" */ './githubModelsProvider.js')).GitHubModelsProvider,
			),
		},
	],
	[
		'deepseek',
		{
			...deepSeekProviderDescriptor,
			type: lazy(
				async () => (await import(/* webpackChunkName: "ai" */ './deepSeekProvider.js')).DeepSeekProvider,
			),
		},
	],
	[
		'xai',
		{
			...xAIProviderDescriptor,
			type: lazy(async () => (await import(/* webpackChunkName: "ai" */ './xaiProvider.js')).XAIProvider),
		},
	],
]);

export interface AIRequestProvider {
	/**
	 * Get the messages for the current conversation state.
	 * Called before each AI request (including the first one).
	 * @param attempt The current attempt number (0-based)
	 */
	getMessages: (
		model: AIModel,
		reporting: TelemetryEvents['ai/generate' | 'ai/explain'],
		cancellation: CancellationToken,
		maxInputTokens: number,
		retries: number,
	) => Promise<AIChatMessage[]>;

	/**
	 * Get the progress title for each attempt.
	 * @param model The AI model being used
	 * @param attempt The current attempt number (0-based)
	 */
	getProgressTitle: (model: AIModel, attempt: number) => string;

	/**
	 * Get telemetry information for each attempt.
	 * @param model The AI model being used
	 * @param attempt The current attempt number (0-based)
	 */
	getTelemetryInfo: (
		model: AIModel,
		attempt: number,
	) => {
		key: 'ai/generate' | 'ai/explain';
		data: TelemetryEvents['ai/generate' | 'ai/explain'];
	};
}

export interface AIConversationProvider<TResult> extends AIRequestProvider {
	/**
	 * Validate the AI response and return either:
	 * - { isValid: true, result: TResult } if validation passes
	 * - { isValid: false, errorMessage: string, retryPrompt: string } if validation fails
	 */
	validateResponse: (
		response: AIProviderResponse<void>,
		attempt: number,
	) => { isValid: true; result: TResult } | { isValid: false; errorMessage: string; retryPrompt: string };
}

export class AIProviderService implements AIService, Disposable {
	private readonly _onDidChangeModel = new EventEmitter<AIModelChangeEvent>();
	get onDidChangeModel(): Event<AIModelChangeEvent> {
		return this._onDidChangeModel.event;
	}

	private readonly _disposable: Disposable;
	private _model: AIModel | undefined;
	private readonly _promptTemplates = new PromiseCache<PromptTemplateId, PromptTemplate | undefined>({
		createTTL: 12 * 60 * 60 * 1000, // 12 hours,
		expireOnError: false,
	});
	private _provider: AIProvider | undefined;
	private _providerDisposable: Disposable | undefined;

	private _actions: AIActions | undefined;
	get actions(): AIActions {
		this._actions ??= new AIActions(this);
		return this._actions;
	}

	get allowed(): boolean {
		return getContext('gitlens:gk:organization:ai:enabled', true);
	}

	get enabled(): boolean {
		return configuration.get('ai.enabled', undefined, true);
	}

	constructor(
		readonly container: Container,
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

	async enable(source?: Source): Promise<void> {
		if (this.enabled) return;

		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('ai/enabled', undefined, source);
		}
		await configuration.updateEffective('ai.enabled', true);
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

	private async getBestFallbackModel(): Promise<AIModel | undefined> {
		let model: AIModel | undefined;
		let models: readonly AIModel[];

		const orgAIConfig = getOrgAIConfig();
		// First, use Copilot GPT 4.1 or first model
		if (isProviderEnabledByOrg('vscode', orgAIConfig)) {
			try {
				models = await this.getModels('vscode');
				if (models.length) {
					model = models.find(m => m.id === 'copilot:gpt-4.1') ?? models[0];
					if (model != null) return model;
				}
			} catch {}
		}

		// Second, use the GitKraken AI default or first model
		if (isProviderEnabledByOrg('gitkraken', orgAIConfig)) {
			try {
				const subscription = await this.container.subscription.getSubscription();
				if (subscription.account?.verified) {
					models = await this.getModels('gitkraken');

					model = models.find(m => m.default) ?? models[0];
					if (model != null) return model;
				}
			} catch {}
		}

		return model;
	}

	async getModel(options?: { force?: boolean; silent?: boolean }, source?: Source): Promise<AIModel | undefined> {
		const cfg = this.getConfiguredModel();
		if (!options?.force && cfg?.provider != null && cfg?.model != null) {
			const model = await this.getOrUpdateModel(cfg.provider, cfg.model);
			if (model != null) return model;
		}

		let chosenModel: AIModel | undefined;
		let chosenProviderId: AIProviders | undefined;
		const currentModel =
			cfg?.provider != null && cfg?.model != null
				? lazy(() => this.getOrUpdateModel(cfg.provider, cfg.model))
				: undefined;
		const fallbackModel = lazy(() => this.getBestFallbackModel());

		if (!options?.silent) {
			if (!options?.force) {
				chosenModel = currentModel != null ? await currentModel.value : await fallbackModel.value;
				chosenProviderId = chosenModel?.provider.id;
			}

			while (true) {
				chosenProviderId ??= (await showAIProviderPicker(this.container, cfg, source))?.provider;
				if (chosenProviderId == null) {
					chosenModel = undefined;
					break;
				}

				const provider = supportedAIProviders.get(chosenProviderId);
				if (provider == null) {
					chosenModel = undefined;
					break;
				}

				if (!(await this.ensureProviderConfigured(provider, false))) {
					chosenModel = undefined;
				}

				if (chosenModel == null) {
					const result = await showAIModelPicker(this.container, chosenProviderId, cfg, source);
					if (result == null || (isDirective(result) && result !== Directive.Back)) {
						chosenModel = undefined;
						break;
					}
					if (result === Directive.Back) {
						chosenProviderId = undefined;
						continue;
					}

					chosenModel = result.model;
				}

				break;
			}
		}

		chosenModel ??= currentModel != null ? await currentModel.value : await fallbackModel.value;
		const model = chosenModel == null ? undefined : await this.getOrUpdateModel(chosenModel);
		if (options?.silent) return model;

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

		if (model != null) {
			void (await showConfirmAIProviderToS(this.container.storage));
		}
		return model;
	}

	async getProvidersConfiguration(): Promise<Map<AIProviders, AIProviderDescriptorWithConfiguration>> {
		const orgAiConfig = getOrgAIConfig();
		const promises = await Promise.allSettled(
			map(
				[...supportedAIProviders.values()].filter(p => isProviderEnabledByOrg(p.id, orgAiConfig)),
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

		if (providerId && !isProviderEnabledByOrg(providerId)) {
			this._provider = undefined;
			this._model = undefined;
			return undefined;
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

	private async ensureFeatureAccess(feature: AIFeatures, source: Source): Promise<boolean> {
		if (!(await ensureAccess(this.container, undefined, source))) return false;

		if (feature === 'generate-commitMessage') return true;
		const suffix = isAdvancedFeature(feature)
			? 'requires GitLens Advanced or a trial'
			: 'requires GitLens Pro or a trial';
		let label;
		switch (feature) {
			case 'generate-searchQuery':
				label = `AI-powered search (preview) ${suffix}`;
				break;

			default:
				label = isAdvancedFeature(feature) ? `This AI preview feature ${suffix}` : `This AI feature ${suffix}`;
		}

		if (!(await ensureFeatureAccess(this.container, label, feature, source))) {
			return false;
		}

		return true;
	}

	@debug({
		args: (action, model, _, source) => ({
			action: action,
			model: model ? `${model.provider.id}/${model.id}` : undefined,
			source: source,
		}),
	})
	async sendRequest<T extends AIActionType>(
		action: T,
		model: AIModel | undefined,
		provider: AIRequestProvider,
		source: Source,
		options?: {
			cancellation?: CancellationToken;
			generating?: Deferred<AIModel>;
			modelOptions?: { outputTokens?: number; temperature?: number };
			progress?: ProgressOptions;
		},
	): Promise<AIProviderResult<void> | 'cancelled' | undefined> {
		const scope = getScopedLogger();
		if (model != null) {
			scope?.addExitInfo(`model: ${model.provider.id}/${model.id}`);
		}

		if (!(await this.ensureFeatureAccess(action, source))) {
			scope?.setFailed('cancelled: no feature access');
			return 'cancelled';
		}

		model ??= await this.getModel(undefined, source);
		if (model == null || options?.cancellation?.isCancellationRequested) {
			scope?.setFailed(model != null ? 'cancelled: user cancelled' : 'cancelled: no model set');
			options?.generating?.cancel();
			return 'cancelled';
		}

		const telementry = provider.getTelemetryInfo(model, 0);

		const cancellationSource = new CancellationTokenSource();
		if (options?.cancellation) {
			options.cancellation.onCancellationRequested(() => cancellationSource.cancel());
		}
		const cancellation = cancellationSource.token;

		const isGkModel = model.provider.id === 'gitkraken';
		if (isGkModel) {
			await this.showAiAllAccessNotificationIfNeeded(true);
		}

		const confirmed = await showConfirmAIProviderToS(this.container.storage);
		if (!confirmed || cancellation.isCancellationRequested) {
			scope?.setFailed(
				cancellation.isCancellationRequested ? 'cancelled: user cancelled' : 'cancelled: user declined ToS',
			);
			this.container.telemetry.sendEvent(
				telementry.key,
				{
					...telementry.data,
					failed: true,
					'failed.reason': cancellation.isCancellationRequested ? 'user-cancelled' : 'user-declined',
				},
				source,
			);

			options?.generating?.cancel();
			return 'cancelled';
		}

		let apiKey: string | undefined;
		try {
			apiKey = await this._provider!.getApiKey(false);
		} catch (ex) {
			if (isCancellationError(ex)) {
				scope?.setFailed('cancelled: user cancelled');
				this.container.telemetry.sendEvent(
					telementry.key,
					{ ...telementry.data, failed: true, 'failed.reason': 'user-cancelled' },
					source,
				);

				options?.generating?.cancel();
				return 'cancelled';
			}

			throw ex;
		}

		if (cancellation.isCancellationRequested) {
			scope?.setFailed('cancelled: user cancelled');
			this.container.telemetry.sendEvent(
				telementry.key,
				{ ...telementry.data, failed: true, 'failed.reason': 'user-cancelled' },
				source,
			);

			options?.generating?.cancel();
			return 'cancelled';
		}

		if (apiKey == null) {
			scope?.setFailed('failed: Not authorized');
			this.container.telemetry.sendEvent(
				telementry.key,
				{ ...telementry.data, failed: true, 'failed.reason': 'error', 'failed.error': 'Not authorized' },
				source,
			);

			options?.generating?.cancel();
			return undefined;
		}

		const requestPromise = this._provider!.sendRequest(
			action,
			model,
			apiKey,
			provider.getMessages.bind(this, model, telementry.data, cancellation),
			{
				cancellation: cancellation,
				modelOptions: options?.modelOptions,
			},
		);
		options?.generating?.fulfill(model);

		const start = Date.now();
		const promise = (async (): Promise<AIProviderResponse<void> | 'cancelled' | undefined> => {
			try {
				const result = await (options?.progress != null
					? window.withProgress(
							{ ...options.progress, cancellable: true, title: provider.getProgressTitle(model, 0) },
							(_progress, token) => {
								token.onCancellationRequested(() => cancellationSource.cancel());
								return requestPromise;
							},
						)
					: requestPromise);

				telementry.data['output.length'] = result?.content?.length;
				telementry.data['usage.promptTokens'] = result?.usage?.promptTokens;
				telementry.data['usage.completionTokens'] = result?.usage?.completionTokens;
				telementry.data['usage.totalTokens'] = result?.usage?.totalTokens;
				telementry.data['usage.limits.used'] = result?.usage?.limits?.used;
				telementry.data['usage.limits.limit'] = result?.usage?.limits?.limit;
				telementry.data['usage.limits.resetsOn'] = result?.usage?.limits?.resetsOn?.toISOString();

				scope?.addExitInfo(`id: ${result?.id}`);
				this.container.telemetry.sendEvent(
					telementry.key,
					{ ...telementry.data, duration: Date.now() - start, id: result?.id },
					source,
				);

				if (!isGkModel) {
					void this.showAiAllAccessNotificationIfNeeded();
				}

				return result;
			} catch (ex) {
				if (ex instanceof CancellationError) {
					scope?.setFailed('cancelled: user cancelled');
					this.container.telemetry.sendEvent(
						telementry.key,
						{
							...telementry.data,
							duration: Date.now() - start,
							failed: true,
							'failed.reason': 'user-cancelled',
						},
						source,
					);

					return 'cancelled';
				}
				if (ex instanceof AIError) {
					scope?.setFailed(`failed: ${String(ex)} (${String(ex.original)})`);

					this.container.telemetry.sendEvent(
						telementry.key,
						{
							...telementry.data,
							duration: Date.now() - start,
							failed: true,
							'failed.error': String(ex),
							'failed.error.detail': String(ex.original),
						},
						source,
					);

					switch (ex.reason) {
						case AIErrorReason.NoRequestData:
							void window.showInformationMessage(ex.message);
							return undefined;

						case AIErrorReason.NoEntitlement: {
							const sub = await this.container.subscription.getSubscription();

							if (isSubscriptionPaid(sub)) {
								const plan =
									compareSubscriptionPlans(sub.plan.actual.id, 'advanced') <= 0
										? 'teams'
										: 'advanced';

								const upgrade = { title: `Upgrade to ${getSubscriptionPlanName(plan)}` };
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
									void this.container.subscription.upgrade('pro', source);
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
								"Your request could not be completed because you've reached the weekly AI usage limit for your current plan. Upgrade to unlock more AI-powered actions.",
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

				scope?.setFailed(`failed: ${String(ex)}${ex.original ? ` (${String(ex.original)})` : ''}`);
				this.container.telemetry.sendEvent(
					telementry.key,
					{
						...telementry.data,
						duration: Date.now() - start,
						failed: true,
						'failed.error': String(ex),
						'failed.error.detail': ex.original ? String(ex.original) : undefined,
					},
					source,
				);
				throw ex;
			}
		})();

		return { model: model, promise: promise };
	}

	/**
	 * Generic conversation loop for AI requests with validation and retry logic.
	 *
	 * This method handles the common pattern of:
	 * 1. Making an AI request
	 * 2. Validating the response
	 * 3. If invalid, continuing the conversation with feedback
	 * 4. Retrying up to maxAttempts times
	 *
	 * @template TResult The type of the final result after validation
	 */
	@debug({
		args: (action, model, _, source) => ({
			action: action,
			model: model ? `${model.provider.id}/${model.id}` : undefined,
			source: source,
		}),
	})
	async sendRequestConversation<TResult>(
		action: AIActionType,
		model: AIModel | undefined,
		provider: AIConversationProvider<TResult>,
		source: Source,
		options?: {
			cancellation?: CancellationToken;
			generating?: Deferred<AIModel>;
			progress?: ProgressOptions;
			modelOptions?: { outputTokens?: number; temperature?: number };
			maxAttempts?: number;
		},
	): Promise<{ response: AIProviderResponse<void>; result: TResult } | 'cancelled' | undefined> {
		const maxAttempts = options?.maxAttempts ?? 4;
		let attempt = 0;
		let response: AIProviderResponse<void> | 'cancelled' | undefined;

		// Conversation loop
		while (attempt < maxAttempts) {
			// Capture attempt for closures
			const currentAttempt = attempt;

			const result = await this.sendRequest(
				action,
				model,
				{
					getMessages: provider.getMessages,
					getProgressTitle: model => provider.getProgressTitle(model, currentAttempt),
					getTelemetryInfo: model => provider.getTelemetryInfo(model, currentAttempt),
				},
				source,
				options,
			);
			if (result == null || result === 'cancelled') return result;

			// Await the promise to get the actual response
			response = await result.promise;

			if (response === 'cancelled' || response == null) {
				return response;
			}

			// Validate response
			const validationResult = provider.validateResponse(response, attempt);

			if (validationResult.isValid) {
				return { response: response, result: validationResult.result };
			}

			Logger.warn(
				undefined,
				'AIProviderService',
				'sendRequestWithConversation',
				`Validation failed on attempt ${attempt + 1}: ${validationResult.errorMessage}`,
			);

			// If this was the last attempt, throw the error
			if (attempt === maxAttempts - 1) {
				throw new Error(validationResult.errorMessage);
			}

			// Handler needs to append retry prompt to conversation for next iteration
			// This is done in the getMessages callback

			attempt++;
		}

		return undefined;
	}

	async getChanges(
		changesOrRepo: string | string[] | Repository,
		options?: { cancellation?: CancellationToken; context?: string; progress?: ProgressOptions },
	): Promise<string | undefined> {
		let changes: string;
		let repoPath: string | undefined;

		if (typeof changesOrRepo === 'string') {
			changes = changesOrRepo;
		} else if (Array.isArray(changesOrRepo)) {
			changes = changesOrRepo.join('\n');
		} else {
			repoPath = changesOrRepo.path;
			let diff = await changesOrRepo.git.diff.getDiff?.(uncommittedStaged);
			if (!diff?.contents) {
				diff = await changesOrRepo.git.diff.getDiff?.(uncommitted);
				if (!diff?.contents) throw new AINoRequestDataError('No changes to generate a commit message from.');
			}
			if (options?.cancellation?.isCancellationRequested) return undefined;

			changes = diff.contents;
		}

		// Filter ignored files when we have a repository path
		if (repoPath != null && changes) {
			const aiIgnore = new AIIgnoreCache(this.container, repoPath);
			changes = await filterDiffFiles(changes, paths => aiIgnore.excludeIgnored(paths));
		}

		return changes;
	}

	async getPrompt<T extends PromptTemplateType>(
		templateType: T,
		model: AIModel,
		context: PromptTemplateContext<T>,
		maxInputTokens: number | undefined,
		retries: number | undefined,
		reporting: TelemetryEvents['ai/generate' | 'ai/explain'] | undefined,
		truncationHandler?: TruncationHandler<T>,
	): Promise<{ prompt: string; truncated: boolean }>;

	async getPrompt<T extends PromptTemplateType>(
		templateType: T,
		model: undefined,
		context: PromptTemplateContext<T>,
		maxInputTokens?: undefined,
		retries?: undefined,
		reporting?: undefined,
		truncationHandler?: undefined,
	): Promise<{ prompt: string; truncated: boolean }>;

	async getPrompt<T extends PromptTemplateType>(
		templateType: T,
		model: AIModel | undefined,
		context: PromptTemplateContext<T>,
		maxInputTokens?: number | undefined,
		retries?: number | undefined,
		reporting?: TelemetryEvents['ai/generate' | 'ai/explain'] | undefined,
		truncationHandler?: TruncationHandler<T>,
	): Promise<{ prompt: string; truncated: boolean }> {
		const promptTemplate = await this.getPromptTemplate(templateType, model);
		if (promptTemplate == null) {
			debugger;
			throw new Error(`No prompt template found for ${templateType}`);
		}

		if ('instructions' in context && context.instructions) {
			context.instructions = `Carefully follow these additional instructions (provided directly by the user), but do not deviate from the output structure:\n${context.instructions}`;
		}

		// Handle the two overload cases
		if (model == null) {
			return resolvePrompt(undefined, promptTemplate, context, undefined, undefined, undefined, undefined);
		}

		return resolvePrompt(model, promptTemplate, context, maxInputTokens, retries, reporting, truncationHandler);
	}

	@trace({
		args: (templateType, model) => ({
			templateType: templateType,
			model: model ? `${model.provider.id}/${model.id}` : undefined,
		}),
	})
	private async getPromptTemplate<T extends PromptTemplateType>(
		templateType: T,
		model: AIModel | undefined,
	): Promise<PromptTemplate | undefined> {
		const scope = getScopedLogger();

		const template = getLocalPromptTemplate(templateType, model);
		const templateId = template?.id ?? templateType;

		return this._promptTemplates.getOrCreate(templateId, async cancellable => {
			if (!(await this.container.subscription.getSubscription()).account) {
				return template;
			}

			try {
				const url = this.container.urls.getGkAIApiUrl(`templates/message-prompt/${templateId}`);
				const rsp = await fetch(url, {
					headers: await this.connection.getGkHeaders(undefined, undefined, { Accept: 'application/json' }),
				});
				if (!rsp.ok) {
					if (rsp.status === 404) {
						Logger.warn(
							scope,
							`${rsp.status} (${rsp.statusText}): Failed to get prompt template '${templateId}' (${url})`,
						);
						return template;
					}

					if (rsp.status === 401) throw new AuthenticationRequiredError();
					throw new Error(
						`${rsp.status} (${rsp.statusText}): Failed to get prompt template '${templateId}' (${url})`,
					);
				}

				interface PromptResponse {
					data: { id: string; template: string; variables: string[] };
					error?: null;
				}

				const result: PromptResponse = (await rsp.json()) as PromptResponse;
				if (result.error != null) {
					throw new Error(`Failed to get prompt template '${templateId}' (${url}). ${String(result.error)}`);
				}

				return {
					id: result.data.id as PromptTemplateId<T>,
					template: result.data.template,
					variables: result.data.variables as (keyof PromptTemplateContext<T>)[],
				} satisfies PromptTemplate<T>;
			} catch (ex) {
				cancellable.invalidate();
				if (!(ex instanceof AuthenticationRequiredError)) {
					debugger;
					scope?.error(ex, String(ex));
				}
				return template;
			}
		});
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
		void this.container.storage.deleteWithPrefix(`confirm:ai:generateCommits`);
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

	private async showAiAllAccessNotificationIfNeeded(usingGkProvider?: boolean): Promise<void> {
		// Only show during the AI All Access promotion period
		if (!isAiAllAccessPromotionActive()) return;

		// Get current subscription to determine user ID
		const subscription = await this.container.subscription.getSubscription(true);
		const userId = subscription?.account?.id ?? '00000000';

		// Check if notification has already been shown or if user already completed opt-in
		const notificationShown = this.container.storage.get(`gk:promo:${userId}:ai:allAccess:notified`, false);
		const alreadyCompleted = this.container.storage.get(`gk:promo:${userId}:ai:allAccess:dismissed`, false);
		if (notificationShown || alreadyCompleted) return;

		const hasAdvancedOrHigher =
			subscription.plan &&
			(compareSubscriptionPlans(subscription.plan.actual.id, 'advanced') >= 0 ||
				compareSubscriptionPlans(subscription.plan.effective.id, 'advanced') >= 0);

		let body = 'All Access Week - now until July 11th!';
		const detail = hasAdvancedOrHigher
			? 'Opt in now to get unlimited GitKraken AI until July 11th!'
			: 'Opt in now to try all Advanced GitLens features with unlimited GitKraken AI for FREE until July 11th!';

		if (!usingGkProvider) {
			body += ` ${detail}`;
		}

		const optInButton: MessageItem = usingGkProvider
			? { title: 'Opt in for Unlimited AI' }
			: { title: 'Opt in and Switch to GitKraken AI' };
		const dismissButton: MessageItem = { title: 'No, Thanks', isCloseAffordance: true };

		// Show the notification
		const result = await window.showInformationMessage(
			body,
			{ modal: usingGkProvider, detail: detail },
			optInButton,
			dismissButton,
		);

		// Mark notification as shown regardless of user action
		void this.container.storage.store(`gk:promo:${userId}:ai:allAccess:notified`, true);

		// If user clicked the button, trigger the opt-in command
		if (result === optInButton) {
			void this.allAccessOptIn(usingGkProvider);
		}
	}

	private async allAccessOptIn(usingGkProvider?: boolean): Promise<void> {
		const optIn = await this.container.subscription.aiAllAccessOptIn({ source: 'notification' });
		if (optIn && !usingGkProvider && isProviderEnabledByOrg('gitkraken')) {
			const gkProvider = new GitKrakenProvider(this.container, this.connection);
			const defaultModel = (await gkProvider.getModels()).find(m => m.default);
			if (defaultModel != null) {
				this._provider = gkProvider;
				this._model = defaultModel;
				if (isPrimaryAIProviderModel(defaultModel)) {
					await configuration.updateEffective('ai.model', 'gitkraken');
					await configuration.updateEffective(`ai.gitkraken.model`, defaultModel.id);
				} else {
					await configuration.updateEffective(
						'ai.model',
						`gitkraken:${defaultModel.id}` as SupportedAIModels,
					);
				}

				this._onDidChangeModel.fire({ model: defaultModel });
			}
		}
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

function isPrimaryAIProvider(provider: AIProviders): provider is AIPrimaryProviders {
	return supportedAIProviders.get(provider)?.primary === true;
}

function isPrimaryAIProviderModel(model: AIModel): model is AIModel<AIPrimaryProviders, AIProviderAndModel> {
	return isPrimaryAIProvider(model.provider.id);
}
