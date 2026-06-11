import type { CancellationToken, Event, MessageItem, ProgressOptions } from 'vscode';
import { CancellationTokenSource, Disposable, env, EventEmitter, window } from 'vscode';
import { fetch } from '@env/fetch.js';
import { getIsOffline } from '@env/platform.js';
import type { AIPrimaryProviders, AIProviderAndModel, AIProviders, SupportedAIModels } from '@gitlens/ai/constants.js';
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
	simulatorProviderDescriptor,
	vscodeProviderDescriptor,
	xAIProviderDescriptor,
} from '@gitlens/ai/constants.js';
import type {
	AIActionType,
	AIModel,
	AIModelDescriptor,
	AIProviderDescriptorWithConfiguration,
} from '@gitlens/ai/models/model.js';
import type {
	PromptTemplate,
	PromptTemplateContext,
	PromptTemplateId,
	PromptTemplateType,
	TruncationHandler,
} from '@gitlens/ai/models/promptTemplates.js';
import type { AIChatMessage, AIProvider, AIProviderResponse, AIProviderResult } from '@gitlens/ai/models/provider.js';
import type { AIProviderContext } from '@gitlens/ai/providers/context.js';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import { filterDiffFiles } from '@gitlens/git/parsers/diffParser.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import { DedupedAsyncCache } from '@gitlens/utils/dedupedAsyncCache.js';
import { map } from '@gitlens/utils/iterable.js';
import type { Lazy } from '@gitlens/utils/lazy.js';
import { lazy } from '@gitlens/utils/lazy.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { Deferred } from '@gitlens/utils/promise.js';
import { getSettledValue, getSettledValues } from '@gitlens/utils/promise.js';
import { PromiseCache } from '@gitlens/utils/promiseCache.js';
import type { Source, TelemetryEvents } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import {
	AIError,
	AIErrorReason,
	AINoRequestDataError,
	AuthenticationRequiredError,
	classifyNetworkError,
} from '../../errors.js';
import type { AIFeatures } from '../../features.js';
import { isAdvancedFeature } from '../../features.js';
import type { GlRepository } from '../../git/models/repository.js';
import { showAIModelPicker, showAIProviderPicker } from '../../quickpicks/aiModelPicker.js';
import { Directive, isDirective } from '../../quickpicks/items/directive.js';
import { configuration } from '../../system/-webview/configuration.js';
import { getContext } from '../../system/-webview/context.js';
import { loadChunk } from '../../system/-webview/loadChunk.js';
import type { Storage } from '../../system/-webview/storage.js';
import { openUrl } from '../../system/-webview/vscode/uris.js';
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
import type { AIProviderConstructor, AIProviderDescriptorWithType } from './models/model.js';
import {
	ensureAccess,
	ensureAccount,
	getOrgAIConfig,
	getOrgAIProviderOfType,
	getOrPromptApiKey,
	isProviderEnabledByOrg,
} from './utils/-webview/ai.utils.js';
import type { ResolvePromptOptions } from './utils/-webview/prompt.utils.js';
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

/**
 * Identifies an operation that maintains its own remembered AI model, independent of the
 * global default. Picking a model from a scoped surface (the composer chip, the graph
 * compose/review mode chip) writes only to that scope's storage — the global `ai.model`
 * config and other features (commit messages, explain, etc.) are untouched.
 */
export type AIModelScope = 'compose' | 'review';

export interface AIModelChangeEvent {
	readonly model: AIModel | undefined;
	/** Scope whose model changed, or `undefined` when the global default changed. */
	readonly scope?: AIModelScope;
}

/** Maps an `AIActionType` to its remembered scope, or `undefined` for unscoped actions. */
export function scopeForAction(action: AIActionType): AIModelScope | undefined {
	switch (action) {
		case 'generate-commits':
			return 'compose';
		case 'review-changes':
			return 'review';
		default:
			return undefined;
	}
}

// Order matters for sorting the picker
const supportedAIProviders = new Map<AIProviders, AIProviderDescriptorWithType>([
	[
		'gitkraken',
		{
			...gitKrakenProviderDescriptor,
			type: lazy(
				async () =>
					(
						await loadChunk(
							() => import(/* webpackChunkName: "ai" */ '@gitlens/ai/providers/gitkrakenProvider.js'),
						)
					).GitKrakenProvider,
			),
		},
	],
	[
		'vscode',
		{
			...vscodeProviderDescriptor,
			type: lazy(
				async () =>
					(await loadChunk(() => import(/* webpackChunkName: "ai" */ './vscodeProvider.js')))
						.VSCodeAIProvider,
			),
		},
	],
	[
		'anthropic',
		{
			...anthropicProviderDescriptor,
			type: lazy(
				async () =>
					(
						await loadChunk(
							() => import(/* webpackChunkName: "ai" */ '@gitlens/ai/providers/anthropicProvider.js'),
						)
					).AnthropicProvider,
			),
		},
	],
	[
		'gemini',
		{
			...geminiProviderDescriptor,
			type: lazy(
				async () =>
					(
						await loadChunk(
							() => import(/* webpackChunkName: "ai" */ '@gitlens/ai/providers/geminiProvider.js'),
						)
					).GeminiProvider,
			),
		},
	],
	[
		'openai',
		{
			...openAIProviderDescriptor,
			type: lazy(
				async () =>
					(
						await loadChunk(
							() => import(/* webpackChunkName: "ai" */ '@gitlens/ai/providers/openaiProvider.js'),
						)
					).OpenAIProvider,
			),
		},
	],
	[
		'azure',
		{
			...azureProviderDescriptor,
			type: lazy(
				async () =>
					(
						await loadChunk(
							() => import(/* webpackChunkName: "ai" */ '@gitlens/ai/providers/azureProvider.js'),
						)
					).AzureProvider,
			),
		},
	],
	[
		'mistral',
		{
			...mistralProviderDescriptor,
			type: lazy(
				async () =>
					(
						await loadChunk(
							() => import(/* webpackChunkName: "ai" */ '@gitlens/ai/providers/mistralProvider.js'),
						)
					).MistralProvider,
			),
		},
	],
	[
		'openaicompatible',
		{
			...openAICompatibleProviderDescriptor,
			type: lazy(
				async () =>
					(
						await loadChunk(
							() =>
								import(
									/* webpackChunkName: "ai" */ '@gitlens/ai/providers/openAICompatibleProvider.js'
								),
						)
					).OpenAICompatibleProvider,
			),
		},
	],
	[
		'ollama',
		{
			...ollamaProviderDescriptor,
			type: lazy(
				async () =>
					(
						await loadChunk(
							() => import(/* webpackChunkName: "ai" */ '@gitlens/ai/providers/ollamaProvider.js'),
						)
					).OllamaProvider,
			),
		},
	],
	[
		'openrouter',
		{
			...openRouterProviderDescriptor,
			type: lazy(
				async () =>
					(
						await loadChunk(
							() => import(/* webpackChunkName: "ai" */ '@gitlens/ai/providers/openRouterProvider.js'),
						)
					).OpenRouterProvider,
			),
		},
	],
	[
		'huggingface',
		{
			...huggingFaceProviderDescriptor,
			type: lazy(
				async () =>
					(
						await loadChunk(
							() => import(/* webpackChunkName: "ai" */ '@gitlens/ai/providers/huggingFaceProvider.js'),
						)
					).HuggingFaceProvider,
			),
		},
	],
	[
		'github',
		{
			...githubProviderDescriptor,
			type: lazy(
				async () =>
					(
						await loadChunk(
							() => import(/* webpackChunkName: "ai" */ '@gitlens/ai/providers/githubModelsProvider.js'),
						)
					).GitHubModelsProvider,
			),
		},
	],
	[
		'deepseek',
		{
			...deepSeekProviderDescriptor,
			type: lazy(
				async () =>
					(
						await loadChunk(
							() => import(/* webpackChunkName: "ai" */ '@gitlens/ai/providers/deepSeekProvider.js'),
						)
					).DeepSeekProvider,
			),
		},
	],
	[
		'xai',
		{
			...xAIProviderDescriptor,
			type: lazy(
				async () =>
					(await loadChunk(() => import(/* webpackChunkName: "ai" */ '@gitlens/ai/providers/xaiProvider.js')))
						.XAIProvider,
			),
		},
	],
]);

if (DEBUG) {
	supportedAIProviders.set('simulator', {
		...simulatorProviderDescriptor,
		type: lazy(
			async () =>
				(await import(/* webpackChunkName: "__debug__" */ './__debug__simulatorProvider.js')).SimulatorProvider,
		),
	});
}

export interface AIRequestProvider {
	/**
	 * Get the messages for the current conversation state.
	 * Called before each AI request (including the first one).
	 * @param attempt The current attempt number (0-based)
	 */
	getMessages: (
		model: AIModel,
		reporting: TelemetryEvents['ai/generate' | 'ai/explain' | 'ai/review'],
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
		key: 'ai/generate' | 'ai/explain' | 'ai/review';
		data: TelemetryEvents['ai/generate' | 'ai/explain' | 'ai/review'];
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

	// Resolved AIModel per scope ('global' for the global default). Populated lazily by `getModel`
	// and proactively by `getOrUpdateModel` after every persist. Invalidated on config changes,
	// subscription changes, provider state changes, and `force` reads. Lets repeated silent reads
	// (graph details, composer event handler, etc.) skip the full resolve pipeline and the network
	// `provider.getModels()` call inside it.
	private readonly _modelCache = new DedupedAsyncCache<AIModelScope | 'global', AIModel | undefined>();
	// Per-provider available-models list cache. Dedupes concurrent `provider.getModels()` calls so
	// scope reads on the same provider don't each hit the network. Cleared on provider change,
	// subscription change, and force.
	private readonly _providerModelsCache = new Map<AIProviders, Promise<readonly AIModel[]>>();

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
		this._disposable = Disposable.from(
			this.container.subscription.onDidChange(e => {
				// Prompt templates are tied to account identity & subscription state — clear on every
				// fire. Model caches are heavier and only affected by account identity or plan changes
				// (which can shift available providers/entitlements); filter to avoid wiping the cache
				// on no-op subscription ticks like session refresh.
				this._promptTemplates.clear();
				const accountChanged = e.current.account?.id !== e.previous.account?.id;
				const planChanged = e.current.plan?.actual?.id !== e.previous.plan?.actual?.id;
				if (accountChanged || planChanged) {
					this._modelCache.clear();
					this._providerModelsCache.clear();
				}
			}),
			configuration.onDidChange(e => {
				if (!configuration.changed(e, 'ai')) return;

				// Only invalidate when the configured global model actually drifted from what's
				// cached. Our own `updateEffective` writes inside `getOrUpdateModel` also trigger
				// this listener, but the cache was already populated proactively for them — a
				// matching compare lets us skip the redundant invalidate-and-reresolve cycle. An
				// external settings edit will produce a mismatch and correctly invalidate.
				if (!this._modelCache.has('global')) return;

				const cached = this._modelCache.get('global');
				const cfg = this.getConfiguredModel()?.descriptor;
				const matches =
					cfg == null ? cached == null : cfg.provider === cached?.provider.id && cfg.model === cached.id;
				if (matches) return;

				// Drift detected — any scope whose `fromScope: false` resolution used the global
				// fallback could now be stale, so clear everything.
				this._modelCache.clear();
			}),
		);

		if (DEBUG) {
			void import(/* webpackChunkName: "__debug__" */ './__debug__aiSimulator.js').then(m =>
				m.registerAISimulator(this.container),
			);
		}
	}

	dispose(): void {
		this._disposable.dispose();
		this._onDidChangeModel.dispose();
		this._providerDisposable?.dispose();
		this._provider?.dispose();
	}

	private createAIProviderContext(providerId?: AIProviders): AIProviderContext {
		const baseContext: AIProviderContext = {
			defaultTemperature: configuration.get('ai.modelOptions.temperature'),
			// node-fetch types are structurally compatible but nominally different from the standard Fetch API,
			// so we bridge the types here to satisfy the platform-agnostic AIProviderContext interface
			fetch: (url: string | URL, init?: RequestInit): Promise<Response> => {
				return fetch(url, init);
			},
			getApiKey: (
				config: {
					id: string;
					name: string;
					requiresAccount: boolean;
					validator?: (value: string) => boolean;
					url?: string;
				},
				silent: boolean,
			): Promise<string | undefined> => {
				return getOrPromptApiKey(
					this.container,
					{
						id: config.id as AIProviders,
						name: config.name,
						requiresAccount: config.requiresAccount,
						validator: config.validator ?? (() => true),
						url: config.url,
					},
					silent,
				);
			},
			getProviderConfig: (type: string): { enabled: boolean; key?: string; url?: string } => {
				const orgConfig = getOrgAIProviderOfType(type as AIProviders);
				if (orgConfig.url) return orgConfig;

				const userUrl = configuration.get(`ai.${type}.url` as any) as string | undefined;
				return { ...orgConfig, url: userUrl || undefined };
			},
			getOrPromptUrl: async (
				providerId: string,
				options: {
					currentUrl: string | undefined;
					title: string;
					placeholder: string;
					validator?: (url: string) => string | undefined | Promise<string | undefined>;
				},
				silent: boolean,
			): Promise<string | undefined> => {
				const configKey = `ai.${providerId}.url` as const;
				let url = configuration.get(configKey as any) as string | undefined;
				url ||= options.currentUrl;

				if (silent) return url;

				const input = window.createInputBox();
				input.ignoreFocusOut = true;
				if (url) {
					input.value = url;
				}

				const disposables: Disposable[] = [];
				try {
					url = await new Promise<string | undefined>(resolve => {
						disposables.push(
							input.onDidHide(() => resolve(undefined)),
							input.onDidChangeValue(value => {
								if (value) {
									try {
										new URL(value);
									} catch {
										input.validationMessage = 'Please enter a valid URL';
										return;
									}
								}
								input.validationMessage = undefined;
							}),
							input.onDidAccept(async () => {
								const value = input.value.trim();
								if (!value) {
									input.validationMessage = 'Please enter a valid URL';
									return;
								}

								try {
									new URL(value);
								} catch {
									input.validationMessage = 'Please enter a valid URL';
									return;
								}
								const error = await options.validator?.(value);
								if (error) {
									input.validationMessage = error;
									return;
								}

								resolve(value);
							}),
						);

						input.title = options.title;
						input.placeholder = options.placeholder;
						input.prompt = `Enter your ${options.title} URL`;
						input.show();
					});
				} finally {
					input.dispose();
					disposables.forEach(d => void d.dispose());
				}

				if (url) {
					void configuration.updateEffective(configKey as any, url);
				}

				return url;
			},
		};

		if (providerId === 'gitkraken') {
			return {
				...baseContext,
				fetch: async (url: string | URL, init?: RequestInit): Promise<Response> => {
					const urlStr = typeof url === 'string' ? url : url.toString();
					// Resolve relative URLs against the GK AI API base URL and inject GK auth/telemetry headers
					if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
						const fullUrl = this.container.urls.getGkAIApiUrl(urlStr);
						// Extract apiKey from the Authorization header if present
						const headers = (init?.headers ?? {}) as Record<string, string>;
						const authHeader = headers['Authorization'] ?? headers['authorization'];
						const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
						const gkHeaders = await this.connection.getGkHeaders(apiKey, undefined, headers);
						return fetch(fullUrl, { ...init, headers: gkHeaders });
					}
					return fetch(url, init);
				},
				getApiKey: async (
					_config: {
						id: string;
						name: string;
						requiresAccount: boolean;
						validator?: (value: string) => boolean;
						url?: string;
					},
					silent: boolean,
				): Promise<string | undefined> => {
					let session = await this.container.subscription.getAuthenticationSession();
					if (session?.accessToken) return session.accessToken;
					if (silent) return undefined;

					const result = await ensureAccount(this.container, silent);
					if (!result) return undefined;

					session = await this.container.subscription.getAuthenticationSession();
					return session?.accessToken;
				},
			};
		}

		if (providerId === 'ollama') {
			return {
				...baseContext,
				getApiKey: async (
					_config: {
						id: string;
						name: string;
						requiresAccount: boolean;
						validator?: (value: string) => boolean;
						url?: string;
					},
					silent: boolean,
				): Promise<string | undefined> => {
					// Ollama doesn't require an API key but still needs account enrollment
					const result = await ensureAccount(this.container, silent);
					if (!result) return undefined;
					return '<not applicable>';
				},
			};
		}

		return baseContext;
	}

	async enable(source?: Source): Promise<void> {
		if (this.enabled) return;

		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('ai/enabled', undefined, source);
		}
		await configuration.updateEffective('ai.enabled', true);
	}

	/**
	 * Resolves the configured model for the given scope. Returns `fromScope: true` when the
	 * value was read from the scope's Memento storage; `false` when it fell back to the
	 * global `ai.model` config (or scope was undefined). Callers use this to decide whether
	 * a subsequent persist should write to scope storage — silent reads that fell back to
	 * global must NOT auto-populate scope storage, otherwise the scope would "snapshot" the
	 * global default at first read and stop tracking later changes.
	 */
	private getConfiguredModel(
		scope?: AIModelScope,
	): { descriptor: AIModelDescriptor; fromScope: boolean } | undefined {
		const scopedQualifiedModelId =
			scope != null ? this.container.storage.get(`ai:scope:${scope}:model`) : undefined;
		const fromScope = scopedQualifiedModelId != null;
		const qualifiedModelId = scopedQualifiedModelId ?? configuration.get('ai.model') ?? undefined;
		if (qualifiedModelId == null) return undefined;

		const index = qualifiedModelId.indexOf(':');
		const providerId = (index === -1 ? qualifiedModelId : qualifiedModelId.substring(0, index)) as AIProviders;
		let modelId = index === -1 ? undefined : qualifiedModelId.substring(index + 1);

		if (providerId != null && this.supports(providerId)) {
			if (modelId != null) {
				return { descriptor: { provider: providerId, model: modelId }, fromScope: fromScope };
			} else if (isPrimaryAIProvider(providerId)) {
				// Primary providers may store just the providerId in `ai.model` and the model id
				// in `ai.${providerId}.model`. Scoped storage always carries the qualified form,
				// so this path only matters for the global fallback (always `fromScope: false`).
				modelId = configuration.get(`ai.${providerId}.model`) ?? undefined;
				if (modelId != null) {
					// Model ids are in the form of `provider:model`
					if (/^(.+):(.+)$/.test(modelId)) {
						return { descriptor: { provider: providerId, model: modelId }, fromScope: false };
					}
				}
			}
		}

		return undefined;
	}

	async getModels(providerId?: AIProviders): Promise<readonly AIModel[]> {
		const loadModels = async (id: AIProviders, type: Lazy<Promise<AIProviderConstructor>>) => {
			return type.value.then(async t => {
				const p = new t(this.createAIProviderContext(id));
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

			return loadModels(providerId, type);
		}

		const modelResults = await Promise.allSettled(
			map(supportedAIProviders.entries(), ([id, p]) => loadModels(id, p.type)),
		);

		return modelResults.flatMap(m => getSettledValue(m, []));
	}

	/**
	 * Returns the available-models list for `provider`, deduping concurrent and repeated calls via
	 * a per-providerId Promise cache. Without this, every cache-miss `getOrUpdateModel` (e.g. two
	 * scopes resolving on the same provider) independently calls `provider.getModels()` and hammers
	 * the network. Invalidated on provider change, `provider.onDidChange`, subscription change, and
	 * `force` reads.
	 */
	private getCachedProviderModels(provider: AIProvider, providerId: AIProviders): Promise<readonly AIModel[]> {
		let pending = this._providerModelsCache.get(providerId);
		if (pending == null) {
			pending = (async () => {
				try {
					return await provider.getModels();
				} catch (ex) {
					// Don't cache a failure — let the next call retry.
					this._providerModelsCache.delete(providerId);
					throw ex;
				}
			})();
			this._providerModelsCache.set(providerId, pending);
		}
		return pending;
	}

	private async getBestFallbackModel(scope?: AIModelScope): Promise<AIModel | undefined> {
		let model: AIModel | undefined;
		let models: readonly AIModel[];

		const orgAIConfig = getOrgAIConfig();
		const isComposeOrReviewScope = scope === 'compose' || scope === 'review';

		// First, use the GitKraken AI scope-preferred (compose/review), default, or first model
		if (isProviderEnabledByOrg('gitkraken', orgAIConfig)) {
			try {
				const subscription = await this.container.subscription.getSubscription();
				if (subscription.account?.verified) {
					models = await this.getModels('gitkraken');
					const scopedDefault = isComposeOrReviewScope
						? models.find(m => m.id === 'gemini:gemini-3-flash-preview')
						: undefined;
					model = scopedDefault ?? models.find(m => m.default) ?? models[0];
					if (model != null) return model;
				}
			} catch {}
		}

		// Second, use Copilot GPT 4.1 or first model
		if (isProviderEnabledByOrg('vscode', orgAIConfig)) {
			try {
				models = await this.getModels('vscode');
				if (models.length) {
					model = models.find(m => m.id === 'copilot:gpt-4.1') ?? models[0];
					if (model != null) return model;
				}
			} catch {}
		}

		return model;
	}

	async getModel(
		options?: { force?: boolean; silent?: boolean; scope?: AIModelScope },
		source?: Source,
	): Promise<AIModel | undefined> {
		const scope = options?.scope;
		const cacheKey: AIModelScope | 'global' = scope ?? 'global';

		if (options?.force) {
			// User explicitly wants to re-resolve (switch model picker, etc.) — invalidate the
			// caches for this scope so we don't short-circuit and so the picker sees a fresh
			// `provider.getModels()` list.
			this._modelCache.delete(cacheKey);
			this._providerModelsCache.clear();
		} else if (options?.silent) {
			// Silent reads are the hot path (graph details, composer event handler, RPC chip reads).
			// Cache hits skip the storage/config reads + `getOrUpdateModel` + `provider.getModels()`
			// network call entirely. The picker / non-silent path always falls through to the full
			// pipeline below; `getOrUpdateModel` repopulates the cache after a successful resolve.
			if (this._modelCache.has(cacheKey)) {
				const cached = this._modelCache.get(cacheKey);
				// If a cached model's provider was org-disabled since we cached it, the configured
				// model is no longer usable — drop the entry and re-resolve so the fallback path runs.
				if (cached == null || isProviderEnabledByOrg(cached.provider.id)) {
					return cached;
				}

				this._modelCache.delete(cacheKey);
			}

			return this._modelCache.getOrResolve(cacheKey, () => this.resolveModelUncached(options, source));
		}

		return this.resolveModelUncached(options, source);
	}

	private async resolveModelUncached(
		options?: { force?: boolean; silent?: boolean; scope?: AIModelScope },
		source?: Source,
	): Promise<AIModel | undefined> {
		const scope = options?.scope;
		const cfgResult = this.getConfiguredModel(scope);
		const cfg = cfgResult?.descriptor;
		// Persist to scope storage only when (a) the value already exists in scope storage —
		// a write-through update — or (b) the user explicitly picks via a scoped picker (set
		// inside the loop below). Silent reads that fell back to the global default must NOT
		// auto-populate scope storage, otherwise the scope would "snapshot" the global default
		// at first read and stop tracking later global changes.
		const cfgFromScope = cfgResult?.fromScope ?? false;
		let scopeForPersist: AIModelScope | undefined = cfgFromScope ? scope : undefined;

		if (!options?.force && cfg?.provider != null && cfg?.model != null) {
			const model = await this.getOrUpdateModel(cfg.provider, cfg.model, scopeForPersist);
			if (model != null) return model;
		}

		let chosenModel: AIModel | undefined;
		let chosenProviderId: AIProviders | undefined;
		const currentModel =
			cfg?.provider != null && cfg?.model != null
				? lazy(() => this.getOrUpdateModel(cfg.provider, cfg.model, scopeForPersist))
				: undefined;
		const fallbackModel = lazy(() => this.getBestFallbackModel(scope));

		if (!options?.silent) {
			if (!options?.force) {
				chosenModel = currentModel != null ? await currentModel.value : await fallbackModel.value;
				chosenProviderId = chosenModel?.provider.id;
			}

			const titles = getPickerTitlesForScope(scope);

			while (true) {
				chosenProviderId ??= (await showAIProviderPicker(this.container, cfg, source, titles.provider))
					?.provider;
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
					const result = await showAIModelPicker(
						this.container,
						chosenProviderId,
						cfg,
						source,
						titles.model,
						scope,
					);
					if (result == null || (isDirective(result) && result !== Directive.Back)) {
						chosenModel = undefined;
						break;
					}
					if (result === Directive.Back) {
						chosenProviderId = undefined;
						continue;
					}

					chosenModel = result.model;
					// User explicitly picked from a scoped picker — persist to scope going forward.
					scopeForPersist = scope;
				}

				break;
			}
		}

		chosenModel ??= currentModel != null ? await currentModel.value : await fallbackModel.value;
		const model = chosenModel == null ? undefined : await this.getOrUpdateModel(chosenModel, scopeForPersist);
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

		const p = new type(this.createAIProviderContext(provider.id));
		try {
			return await p.configured(silent);
		} finally {
			p.dispose();
		}
	}

	private getOrUpdateModel(model: AIModel, scope?: AIModelScope): Promise<AIModel | undefined>;
	private getOrUpdateModel<T extends AIProviders>(
		providerId: T,
		modelId: string,
		scope?: AIModelScope,
	): Promise<AIModel | undefined>;
	private async getOrUpdateModel(
		modelOrProviderId: AIModel | AIProviders,
		modelIdOrScope?: string | AIModelScope,
		maybeScope?: AIModelScope,
	): Promise<AIModel | undefined> {
		let providerId: AIProviders;
		let model: AIModel | undefined;
		let modelId: string | undefined;
		let scope: AIModelScope | undefined;
		if (typeof modelOrProviderId === 'string') {
			providerId = modelOrProviderId;
			modelId =
				typeof modelIdOrScope === 'string' && !isAIModelScope(modelIdOrScope) ? modelIdOrScope : undefined;
			scope = maybeScope ?? (isAIModelScope(modelIdOrScope) ? modelIdOrScope : undefined);
		} else {
			model = modelOrProviderId;
			providerId = model.provider.id;
			scope = isAIModelScope(modelIdOrScope) ? modelIdOrScope : undefined;
		}

		if (providerId && !isProviderEnabledByOrg(providerId)) {
			// Only clear the singleton cache when working on the global default — the cache
			// represents "currently active global provider/model", not scoped state.
			if (scope == null) {
				this._provider = undefined;
				this._model = undefined;
			}
			return undefined;
		}

		let changed = false;

		if (providerId !== this._provider?.id) {
			changed = true;
			const oldProviderId = this._provider?.id;
			this._providerDisposable?.dispose();
			this._provider?.dispose();
			if (oldProviderId != null) {
				// Old provider's models list is no longer relevant to anyone awaiting `_provider`.
				this._providerModelsCache.delete(oldProviderId);
			}

			const type = await supportedAIProviders.get(providerId)?.type.value;
			if (type == null) {
				this._provider = undefined;
				this._model = undefined;

				return undefined;
			}

			this._provider = new type(this.createAIProviderContext(providerId));
			const newProvider = this._provider;
			this._providerDisposable = newProvider?.onDidChange?.(
				debounce(async () => {
					// Provider's internal state changed (VSCode chat models list updated, etc.) —
					// drop the resolved/list caches so subsequent reads pick up the new state.
					this._modelCache.clear();
					this._providerModelsCache.delete(providerId);

					// Validate the singleton against the fresh models list — the provider may have
					// un-registered the model that's currently selected. Without this, the next read
					// would cache-miss, fall into `getOrUpdateModel`, match `modelId === _model.id`,
					// and return the now-removed model.
					if (this._model != null && this._provider === newProvider) {
						const models = await this.getCachedProviderModels(newProvider, providerId);
						if (models.some(m => m.id === this._model?.id)) return;

						this._model = undefined;
					} else if (this._model != null) {
						return;
					}

					const model = await this.getModel({ silent: true });
					if (model == null) return;

					this._onDidChangeModel.fire({ model: model, scope: undefined });
				}, 250),
				this,
			);
		}

		if (model == null) {
			if (modelId != null && modelId === this._model?.id) {
				model = this._model;
			} else {
				changed = true;

				const models = await this.getCachedProviderModels(this._provider, providerId);
				model = models?.find(m => m.id === modelId);
				if (model == null) {
					this._model = undefined;
					// Cache the "no model configured" outcome so silent reads don't keep re-running
					// the full pipeline (and re-hitting the network) just to land back on `undefined`.
					this._modelCache.set(scope ?? 'global', undefined);
					return undefined;
				}
			}
		} else if (model.id !== this._model?.id) {
			changed = true;
		}

		this._model = model;
		// Mirror the resolved value into the per-scope cache. This is the source of truth for the
		// hot `getModel({ silent: true })` path — populated here on every successful resolve so
		// subsequent reads (including same-scope re-reads from event handlers) skip the network.
		this._modelCache.set(scope ?? 'global', model);

		if (changed) {
			if (scope != null) {
				// Scoped persistence: only the scope's Memento key is updated. The global default
				// `ai.model` config is intentionally NOT touched so other features keep their model.
				// Scoped storage uses the fully qualified `provider:model` form for ALL providers
				// (including primaries) so a single read resolves the model without consulting any
				// global `ai.${providerId}.model` config — keeping scope isolation airtight.
				const qualified: AIProviderAndModel = `${model.provider.id}:${model.id}`;
				await this.container.storage.store(`ai:scope:${scope}:model`, qualified);
			} else if (isPrimaryAIProviderModel(model)) {
				await configuration.updateEffective(`ai.model`, model.provider.id);
				await configuration.updateEffective(`ai.${model.provider.id}.model`, model.id);
			} else {
				await configuration.updateEffective(
					`ai.model`,
					`${model.provider.id}:${model.id}` as SupportedAIModels,
				);
			}
			this._onDidChangeModel.fire({ model: model, scope: scope });
		}

		return model;
	}

	/**
	 * Resolves an AI provider instance scoped to a single request. Always constructs a fresh
	 * provider rather than returning the cached `this._provider` — even when the ids match —
	 * because a concurrent `getOrUpdateModel(different-provider)` would otherwise dispose the
	 * cached instance mid-flight on an unrelated request. Provider construction is cheap;
	 * decoupling lifetime is the safer trade-off. The caller MUST `dispose()` when finished.
	 */
	private async getProviderForModel(
		model: AIModel,
	): Promise<{ provider: AIProvider; dispose: () => void } | undefined> {
		const type = await supportedAIProviders.get(model.provider.id)?.type.value;
		if (type == null) return undefined;

		const provider = new type(this.createAIProviderContext(model.provider.id));
		return { provider: provider, dispose: () => provider.dispose() };
	}

	private async ensureFeatureAccess(feature: AIFeatures, source: Source): Promise<boolean> {
		if (!(await ensureAccess(this.container, undefined, source))) return false;

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
			throwAIErrors?: boolean;
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

		model ??= await this.getModel({ scope: scopeForAction(action) }, source);
		if (model == null || options?.cancellation?.isCancellationRequested) {
			scope?.setFailed(model != null ? 'cancelled: user cancelled' : 'cancelled: no model set');
			options?.generating?.cancel();
			return 'cancelled';
		}

		const telementry = provider.getTelemetryInfo(model, 0);

		// Resolve the provider for the resolved model independent of `this._provider` — the
		// singleton cache reflects whichever `getModel` ran most recently, which races with
		// concurrent ops on different models. Ownership transfers to the inner promise once
		// the request loop owns it; until then, every early-return path must dispose.
		const requestProviderRef = await this.getProviderForModel(model);
		if (requestProviderRef == null) {
			scope?.setFailed('cancelled: provider not available');
			options?.generating?.cancel();
			return 'cancelled';
		}

		let providerDisposed = false;
		const disposeRequestProvider = () => {
			if (providerDisposed) return;

			providerDisposed = true;
			requestProviderRef.dispose();
		};

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
			disposeRequestProvider();
			return 'cancelled';
		}

		let apiKey: string | undefined;
		try {
			apiKey = await requestProviderRef.provider.getApiKey(false);
		} catch (ex) {
			if (isCancellationError(ex)) {
				scope?.setFailed('cancelled: user cancelled');
				this.container.telemetry.sendEvent(
					telementry.key,
					{ ...telementry.data, failed: true, 'failed.reason': 'user-cancelled' },
					source,
				);

				options?.generating?.cancel();
				disposeRequestProvider();
				return 'cancelled';
			}

			disposeRequestProvider();
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
			disposeRequestProvider();
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
			disposeRequestProvider();
			return undefined;
		}

		const promise = (async (): Promise<AIProviderResponse<void> | 'cancelled' | undefined> => {
			let fulfilled = false;
			try {
				while (true) {
					const controller = new AbortController();
					const cancellationListener = cancellation.onCancellationRequested(() => controller.abort());
					const start = performance.now();
					try {
						if (getIsOffline()) {
							throw new AIError(AIErrorReason.NoNetwork);
						}

						const requestPromise = requestProviderRef.provider.sendRequest(
							action,
							model,
							apiKey,
							provider.getMessages.bind(this, model, telementry.data, cancellation),
							{ signal: controller.signal, modelOptions: options?.modelOptions },
						);
						if (!fulfilled) {
							options?.generating?.fulfill(model);
							fulfilled = true;
						}

						const result = await (options?.progress != null
							? window.withProgress(
									{
										...options.progress,
										cancellable: true,
										title: provider.getProgressTitle(model, 0),
									},
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
							{ ...telementry.data, duration: performance.now() - start, id: result?.id },
							source,
						);

						if (result != null && supportedAIProviders.get(model.provider.id)?.requiresUserKey) {
							void this.reportBYOKUsage(action, result);
						}

						if (!isGkModel) {
							void this.showAiAllAccessNotificationIfNeeded();
						}

						return result;
					} catch (ex) {
						if (isCancellationError(ex)) {
							scope?.setFailed('cancelled: user cancelled');
							this.container.telemetry.sendEvent(
								telementry.key,
								{
									...telementry.data,
									duration: performance.now() - start,
									failed: true,
									'failed.reason': 'user-cancelled',
								},
								source,
							);

							if (!fulfilled) {
								options?.generating?.cancel();
							}
							return 'cancelled';
						}

						const networkReason = ex instanceof AIError ? undefined : classifyNetworkError(ex);
						const error =
							networkReason != null
								? new AIError(networkReason, ex instanceof Error ? ex : undefined)
								: ex;

						if (error instanceof AIError) {
							scope?.setFailed(
								`failed: ${String(error)}${error.original ? ` (${String(error.original)})` : ''}`,
							);

							this.container.telemetry.sendEvent(
								telementry.key,
								{
									...telementry.data,
									duration: performance.now() - start,
									failed: true,
									'failed.error': String(error),
									'failed.error.detail': error.original ? String(error.original) : undefined,
								},
								source,
							);

							switch (error.reason) {
								case AIErrorReason.NoNetwork:
								case AIErrorReason.Unreachable: {
									const retry: MessageItem = { title: 'Retry' };
									const result = await window.showErrorMessage(
										error.reason === AIErrorReason.NoNetwork
											? 'Unable to reach the AI service. Please check your internet connection and try again.'
											: 'The AI service is temporarily unreachable. Please try again.',
										retry,
									);
									if (cancellation.isCancellationRequested) {
										if (!fulfilled) {
											options?.generating?.cancel();
										}
										return 'cancelled';
									}
									if (result === retry) continue;

									if (!fulfilled) {
										options?.generating?.cancel();
									}
									if (options?.throwAIErrors) throw error;

									return undefined;
								}
								case AIErrorReason.NoRequestData:
									void window.showInformationMessage(error.message);
									if (options?.throwAIErrors) throw error;

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

									if (options?.throwAIErrors) throw error;

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
									if (options?.throwAIErrors) throw error;

									return undefined;
								}
								case AIErrorReason.UserQuotaExceeded: {
									const sub = await this.container.subscription.getSubscription();
									const role = sub.activeOrganization?.role;
									const canPurchase =
										role == null || role === 'owner' || role === 'admin' || role === 'billing';

									if (canPurchase) {
										const getMoreCredits: MessageItem = {
											title: 'Get More Credits',
										};
										const dismiss: MessageItem = {
											title: 'Dismiss',
											isCloseAffordance: true,
										};
										const result = await window.showErrorMessage(
											"Your request could not be completed because you've reached the weekly usage included in your plan. Purchase additional AI credits to keep using GitKraken AI.",
											getMoreCredits,
											dismiss,
										);

										if (result === getMoreCredits) {
											this.container.telemetry.sendEvent(
												'ai/credits/addOnClicked',
												{ 'organization.role': role },
												source,
											);
											void openUrl(
												await this.container.urls.getGkDevUrl('subscription/credit-add-on'),
											);
										} else {
											this.container.telemetry.sendEvent(
												'ai/credits/addOnDismissed',
												{ 'organization.role': role },
												source,
											);
										}
									} else {
										const ok: MessageItem = {
											title: 'OK',
											isCloseAffordance: true,
										};
										await window.showErrorMessage(
											"Your request could not be completed because you've reached the weekly usage included in your plan. Contact your organization admin or owner to request more AI credits.",
											ok,
										);

										this.container.telemetry.sendEvent(
											'ai/credits/addOnDismissed',
											{ 'organization.role': role },
											source,
										);
									}

									if (options?.throwAIErrors) throw error;

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

									if (options?.throwAIErrors) throw error;

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
									if (options?.throwAIErrors) throw error;

									return undefined;
								}
								case AIErrorReason.ServiceCapacityExceeded: {
									void window.showErrorMessage(
										'GitKraken AI is temporarily unable to process your request due to high volume. Please wait a few moments and try again. If this issue persists, please contact support.',
										'OK',
									);
									if (options?.throwAIErrors) throw error;

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
									if (options?.throwAIErrors) throw error;

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
									if (options?.throwAIErrors) throw error;

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
									if (options?.throwAIErrors) throw error;

									return undefined;
								}
							}

							if (options?.throwAIErrors) throw error;

							return undefined;
						}

						scope?.setFailed(`failed: ${String(ex)}${ex.original ? ` (${String(ex.original)})` : ''}`);
						this.container.telemetry.sendEvent(
							telementry.key,
							{
								...telementry.data,
								duration: performance.now() - start,
								failed: true,
								'failed.error': String(ex),
								'failed.error.detail': ex.original ? String(ex.original) : undefined,
							},
							source,
						);
						throw ex;
					} finally {
						cancellationListener.dispose();
					}
				}
			} finally {
				disposeRequestProvider();
			}
		})();

		return { model: model, promise: promise };
	}

	private async reportBYOKUsage(action: AIActionType, response: AIProviderResponse<void>): Promise<void> {
		const model = response.model;
		const promptTokens = response.usage?.promptTokens;
		const completionTokens = response.usage?.completionTokens;
		const totalTokens = response.usage?.totalTokens ?? (promptTokens ?? 0) + (completionTokens ?? 0);

		// API requires total_tokens >= 1
		if (totalTokens < 1) return;

		try {
			await this.connection.fetchGkApi('v1/ai-tasks/usage/reports', {
				method: 'POST',
				body: JSON.stringify({
					provider: model.provider.id,
					model: model.id,
					task_type: 'message-prompt',
					action: action,
					total_tokens: totalTokens,
					...(promptTokens != null && { input_tokens: promptTokens }),
				}),
			});
		} catch {}
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
		changesOrRepo: string | string[] | GlRepository,
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
		reporting: TelemetryEvents['ai/generate' | 'ai/explain' | 'ai/review'] | undefined,
		truncationHandler?: TruncationHandler<T>,
		options?: ResolvePromptOptions,
	): Promise<{ prompt: string; truncated: boolean }>;

	async getPrompt<T extends PromptTemplateType>(
		templateType: T,
		model: undefined,
		context: PromptTemplateContext<T>,
		maxInputTokens?: undefined,
		retries?: undefined,
		reporting?: undefined,
		truncationHandler?: undefined,
		options?: undefined,
	): Promise<{ prompt: string; truncated: boolean }>;

	async getPrompt<T extends PromptTemplateType>(
		templateType: T,
		model: AIModel | undefined,
		context: PromptTemplateContext<T>,
		maxInputTokens?: number | undefined,
		retries?: number | undefined,
		reporting?: TelemetryEvents['ai/generate' | 'ai/explain' | 'ai/review'] | undefined,
		truncationHandler?: TruncationHandler<T>,
		options?: ResolvePromptOptions,
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

		return resolvePrompt(
			model,
			promptTemplate,
			context,
			maxInputTokens,
			retries,
			reporting,
			truncationHandler,
			options,
		);
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

	switchModel(source?: Source, options?: { scope?: AIModelScope }): Promise<AIModel | undefined> {
		return this.getModel({ force: true, scope: options?.scope }, source);
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
			const gkProvider = new (
				await loadChunk(() => import(/* webpackChunkName: "ai" */ '@gitlens/ai/providers/gitkrakenProvider.js'))
			).GitKrakenProvider(this.createAIProviderContext('gitkraken'));
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

				this._onDidChangeModel.fire({ model: defaultModel, scope: undefined });
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

function isAIModelScope(value: unknown): value is AIModelScope {
	return value === 'compose' || value === 'review';
}

function getPickerTitlesForScope(scope: AIModelScope | undefined): {
	provider: { title: string; placeholder: string; scope: AIModelScope } | undefined;
	model: { title: string; placeholder: string; scope: AIModelScope } | undefined;
} {
	if (scope === 'compose') {
		return {
			provider: {
				title: 'Select AI Provider for Composing',
				placeholder: 'Choose an AI provider for composing',
				scope: scope,
			},
			model: {
				title: 'Select AI Model for Composing',
				placeholder: 'Choose an AI model for composing',
				scope: scope,
			},
		};
	}
	if (scope === 'review') {
		return {
			provider: {
				title: 'Select AI Provider for Reviewing',
				placeholder: 'Choose an AI provider for reviewing',
				scope: scope,
			},
			model: {
				title: 'Select AI Model for Reviewing',
				placeholder: 'Choose an AI model for reviewing',
				scope: scope,
			},
		};
	}
	return { provider: undefined, model: undefined };
}
