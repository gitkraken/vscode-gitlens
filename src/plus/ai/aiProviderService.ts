import type { CancellationToken, Disposable, Event, MessageItem, ProgressOptions } from 'vscode';
import { CancellationTokenSource, env, EventEmitter, window } from 'vscode';
import { fetch } from '@env/fetch';
import type { AIPrimaryProviders, AIProviderAndModel, AIProviders, SupportedAIModels } from '../../constants.ai';
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
} from '../../constants.ai';
import type { AIGenerateCreateDraftEventData, Source, TelemetryEvents } from '../../constants.telemetry';
import type { Container } from '../../container';
import {
	AIError,
	AIErrorReason,
	AINoRequestDataError,
	AuthenticationRequiredError,
	CancellationError,
	isCancellationError,
} from '../../errors';
import type { AIFeatures } from '../../features';
import { isAdvancedFeature } from '../../features';
import type { GitRepositoryService } from '../../git/gitRepositoryService';
import type { GitCommit } from '../../git/models/commit';
import { isCommit } from '../../git/models/commit';
import type { GitRevisionReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { uncommitted, uncommittedStaged } from '../../git/models/revision';
import { assertsCommitHasFullDetails } from '../../git/utils/commit.utils';
import { showAIModelPicker, showAIProviderPicker } from '../../quickpicks/aiModelPicker';
import { Directive, isDirective } from '../../quickpicks/items/directive';
import { configuration } from '../../system/-webview/configuration';
import type { Storage } from '../../system/-webview/storage';
import { log } from '../../system/decorators/log';
import { debounce } from '../../system/function/debounce';
import { map } from '../../system/iterable';
import type { Lazy } from '../../system/lazy';
import { lazy } from '../../system/lazy';
import { Logger } from '../../system/logger';
import { getLogScope, setLogScopeExit } from '../../system/logger.scope';
import type { Deferred } from '../../system/promise';
import { getSettledValue, getSettledValues } from '../../system/promise';
import { PromiseCache } from '../../system/promiseCache';
import type { Serialized } from '../../system/serialize';
import { dedent } from '../../system/string';
import type { ServerConnection } from '../gk/serverConnection';
import { ensureFeatureAccess } from '../gk/utils/-webview/acount.utils';
import { isAiAllAccessPromotionActive } from '../gk/utils/-webview/promo.utils';
import { compareSubscriptionPlans, getSubscriptionPlanName, isSubscriptionPaid } from '../gk/utils/subscription.utils';
import { GitKrakenProvider } from './gitkrakenProvider';
import type {
	AIActionType,
	AIModel,
	AIModelDescriptor,
	AIProviderConstructor,
	AIProviderDescriptorWithConfiguration,
	AIProviderDescriptorWithType,
} from './models/model';
import type {
	PromptTemplate,
	PromptTemplateContext,
	PromptTemplateId,
	PromptTemplateType,
} from './models/promptTemplates';
import type { AIChatMessage, AIDeferredRequestResult, AIProvider, AIRequestResult } from './models/provider';
import { ensureAccess, getOrgAIConfig, isProviderEnabledByOrg } from './utils/-webview/ai.utils';
import { getLocalPromptTemplate, resolvePrompt } from './utils/-webview/prompt.utils';

export interface AIResult {
	readonly id: string;
	readonly type: AIActionType;

	readonly content: string;
	readonly feature: string;
	readonly model: AIModel;
	readonly usage?: {
		readonly promptTokens?: number;
		readonly completionTokens?: number;
		readonly totalTokens?: number;

		readonly limits?: { readonly used: number; readonly limit: number; readonly resetsOn: Date };
	};
}

export type AIDeferredResult<T extends AIResult> = {
	readonly type: AIActionType;
	readonly feature: string;
	readonly model: AIModel;

	readonly promise: Promise<T | 'cancelled' | undefined>;
};

export interface AIResultContext extends Serialized<Omit<AIResult, 'content'>, string> {}

export interface AISummarizeResult extends AIResult {
	readonly parsed: { readonly summary: string; readonly body: string };
}

export interface AIRebaseResult extends AIResult {
	readonly diff: string;
	readonly hunkMap: { index: number; hunkHeader: string }[];
	readonly commits: { readonly message: string; readonly explanation: string; readonly hunks: { hunk: number }[] }[];
}

export interface AIGenerateCommitsResult {
	readonly commits: { readonly message: string; readonly explanation: string; readonly hunks: { hunk: number }[] }[];
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

export type AISourceContext<T> = Source & { context: T };
export type AIExplainSourceContext = AISourceContext<{ type: TelemetryEvents['ai/explain']['changeType'] }>;

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
		'openai',
		{
			...openAIProviderDescriptor,
			type: lazy(async () => (await import(/* webpackChunkName: "ai" */ './openaiProvider')).OpenAIProvider),
		},
	],
	[
		'azure',
		{
			...azureProviderDescriptor,
			type: lazy(async () => (await import(/* webpackChunkName: "ai" */ './azureProvider')).AzureProvider),
		},
	],
	[
		'mistral',
		{
			...mistralProviderDescriptor,
			type: lazy(async () => (await import(/* webpackChunkName: "ai" */ './mistralProvider')).MistralProvider),
		},
	],
	[
		'openaicompatible',
		{
			...openAICompatibleProviderDescriptor,
			type: lazy(
				async () =>
					(await import(/* webpackChunkName: "ai" */ './openAICompatibleProvider')).OpenAICompatibleProvider,
			),
		},
	],
	[
		'ollama',
		{
			...ollamaProviderDescriptor,
			type: lazy(async () => (await import(/* webpackChunkName: "ai" */ './ollamaProvider')).OllamaProvider),
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
		'huggingface',
		{
			...huggingFaceProviderDescriptor,
			type: lazy(
				async () => (await import(/* webpackChunkName: "ai" */ './huggingFaceProvider')).HuggingFaceProvider,
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
]);

export class AIProviderService implements Disposable {
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
		const fallbackModel = lazy(() => this.getBestFallbackModel());

		if (!options?.silent) {
			if (!options?.force) {
				chosenModel = await fallbackModel.value;
				chosenProviderId = chosenModel?.provider.id;
			}

			while (true) {
				chosenProviderId ??= (await showAIProviderPicker(this.container, cfg))?.provider;
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
					const result = await showAIModelPicker(this.container, chosenProviderId, cfg);
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

		chosenModel ??= await fallbackModel.value;
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
		if (!(await ensureAccess())) return false;

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

	@log({ args: false })
	async explainCommit(
		commitOrRevision: GitRevisionReference | GitCommit,
		sourceContext: AIExplainSourceContext,
		options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
	): Promise<AIDeferredResult<AISummarizeResult> | 'cancelled' | undefined> {
		const svc = this.container.git.getRepositoryService(commitOrRevision.repoPath);
		return this.explainChanges(
			async cancellation => {
				const diff = await svc.diff.getDiff?.(commitOrRevision.ref);
				if (!diff?.contents) throw new AINoRequestDataError('No changes found to explain.');
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const commit = isCommit(commitOrRevision)
					? commitOrRevision
					: await svc.commits.getCommit(commitOrRevision.ref);
				if (commit == null) throw new AINoRequestDataError('No commit found to explain.');
				if (cancellation.isCancellationRequested) throw new CancellationError();

				if (!commit.hasFullDetails()) {
					await commit.ensureFullDetails();
					assertsCommitHasFullDetails(commit);
					if (cancellation.isCancellationRequested) throw new CancellationError();
				}

				return { diff: diff.contents, message: commit.message };
			},
			sourceContext,
			options,
		);
	}

	@log({ args: false })
	async explainChanges(
		promptContext:
			| PromptTemplateContext<'explain-changes'>
			| ((cancellationToken: CancellationToken) => Promise<PromptTemplateContext<'explain-changes'>>),
		sourceContext: AIExplainSourceContext,
		options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
	): Promise<AIDeferredResult<AISummarizeResult> | 'cancelled' | undefined> {
		const { context, ...source } = sourceContext;

		const deferredResult = await this.sendRequestWithDeferredResult(
			'explain-changes',
			async (model, reporting, cancellation, maxInputTokens, retries) => {
				if (typeof promptContext === 'function') {
					promptContext = await promptContext(cancellation);
				}

				promptContext.instructions = `${
					promptContext.instructions ? `${promptContext.instructions}\n` : ''
				}${configuration.get('ai.explainChanges.customInstructions')}`;

				if (cancellation.isCancellationRequested) throw new CancellationError();

				const { prompt } = await this.getPrompt(
					'explain-changes',
					model,
					promptContext,
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
					changeType: context.type,
					id: undefined,
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
			options,
		);

		if (deferredResult === 'cancelled') return deferredResult;
		if (deferredResult == null) return undefined;

		const promise: Promise<AISummarizeResult | 'cancelled' | undefined> = deferredResult.promise.then(result =>
			result === 'cancelled'
				? result
				: result != null
					? {
							...result,
							type: 'explain-changes',
							feature: `explain-${context?.type}`,
							parsed: parseSummarizeResult(result.content),
						}
					: undefined,
		);

		return {
			...deferredResult,
			type: 'explain-changes',
			feature: `explain-${context.type}`,
			promise: promise,
		};
	}

	@log({ args: false })
	async generateCommitMessage(
		changesOrRepo: string | string[] | Repository,
		source: Source,
		options?: {
			cancellation?: CancellationToken;
			context?: string;
			generating?: Deferred<AIModel>;
			progress?: ProgressOptions;
		},
	): Promise<AISummarizeResult | 'cancelled' | undefined> {
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
					id: undefined,
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
			{ ...options, modelOptions: { outputTokens: 4096 } },
		);
		return result === 'cancelled'
			? result
			: result != null
				? {
						...result,
						type: 'generate-commitMessage',
						feature: 'generate-commitMessage',
						parsed: parseSummarizeResult(result.content),
					}
				: undefined;
	}

	@log({ args: false })
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
	): Promise<AISummarizeResult | 'cancelled' | undefined> {
		const result = await this.sendRequest(
			'generate-create-pullRequest',
			async (model, reporting, cancellation, maxInputTokens, retries) => {
				const compareData = await prepareCompareDataForAIRequest(repo.git, headRef, baseRef, {
					cancellation: cancellation,
				});

				if (!compareData?.diff || !compareData?.logMessages) {
					throw new AINoRequestDataError('No changes to generate a pull request from.');
				}

				const { diff, logMessages } = compareData;
				const { prompt } = await this.getPrompt(
					'generate-create-pullRequest',
					model,
					{
						diff: diff,
						data: logMessages,
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
					id: undefined,
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
			options,
		);
		return result === 'cancelled'
			? result
			: result != null
				? {
						...result,
						type: 'generate-create-pullRequest',
						feature: 'generate-create-pullRequest',
						parsed: parseSummarizeResult(result.content),
					}
				: undefined;
	}

	@log({ args: false })
	async generateCreateDraft(
		changesOrRepo: string | string[] | Repository,
		sourceContext: AISourceContext<{ type: AIGenerateCreateDraftEventData['draftType'] }>,
		options?: {
			cancellation?: CancellationToken;
			context?: string;
			generating?: Deferred<AIModel>;
			progress?: ProgressOptions;
			codeSuggestion?: boolean;
		},
	): Promise<AISummarizeResult | 'cancelled' | undefined> {
		const { context, ...source } = sourceContext;

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
					draftType: context?.type,
					id: undefined,
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
			options,
		);
		return result === 'cancelled'
			? result
			: result != null
				? {
						...result,
						type: options?.codeSuggestion ? 'generate-create-codeSuggestion' : 'generate-create-cloudPatch',
						feature: options?.codeSuggestion
							? 'generate-create-codeSuggestion'
							: 'generate-create-cloudPatch',
						parsed: parseSummarizeResult(result.content),
					}
				: undefined;
	}

	@log({ args: false })
	async generateStashMessage(
		changesOrRepo: string | string[] | Repository,
		source: Source,
		options?: {
			cancellation?: CancellationToken;
			context?: string;
			generating?: Deferred<AIModel>;
			progress?: ProgressOptions;
		},
	): Promise<AISummarizeResult | 'cancelled' | undefined> {
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
					id: undefined,
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
			{ ...options, modelOptions: { outputTokens: 1024 } },
		);
		return result === 'cancelled'
			? result
			: result != null
				? {
						...result,
						type: 'generate-stashMessage',
						feature: 'generate-stashMessage',
						parsed: parseSummarizeResult(result.content),
					}
				: undefined;
	}

	@log({ args: false })
	async generateChangelog(
		changes: Lazy<Promise<AIGenerateChangelogChanges>>,
		source: Source,
		options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
	): Promise<AIResult | 'cancelled' | undefined> {
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
					id: undefined,
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
			options,
		);
		return result === 'cancelled'
			? result
			: result != null
				? { ...result, type: 'generate-changelog', feature: 'generate-changelog' }
				: undefined;
	}

	@log({ args: false })
	async generateSearchQuery(
		search: { query: string; context: string | undefined },
		source: Source,
		options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
	): Promise<AIResult | 'cancelled' | undefined> {
		const result = await this.sendRequest(
			'generate-searchQuery',
			async (model, reporting, cancellation, maxInputTokens, retries) => {
				const { prompt } = await this.getPrompt(
					'generate-searchQuery',
					model,
					{
						query: search.query,
						date: new Date().toISOString().split('T')[0],
						context: search.context,
						instructions: configuration.get('ai.generateSearchQuery.customInstructions'),
					},
					maxInputTokens,
					retries,
					reporting,
				);
				if (cancellation.isCancellationRequested) throw new CancellationError();

				const messages: AIChatMessage[] = [{ role: 'user', content: prompt }];
				return messages;
			},
			m => `Generating search query with ${m.name}...`,
			source,
			m => ({
				key: 'ai/generate',
				data: {
					type: 'searchQuery',
					id: undefined,
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
			options,
		);
		return result === 'cancelled'
			? result
			: result != null
				? { ...result, type: 'generate-searchQuery', feature: 'generate-searchQuery' }
				: undefined;
	}

	/**
	 * Generates a rebase using AI to organize code changes into logical commits.
	 *
	 * This method includes automatic retry logic that validates the AI response and
	 * continues the conversation if the response has issues like:
	 * - Missing hunks that were in the original diff
	 * - Extra hunks that weren't in the original diff
	 * - Duplicate hunks used multiple times
	 *
	 * The method will retry up to 3 times, providing specific feedback to the AI
	 * about what was wrong with the previous response.
	 */
	@log({ args: false })
	async generateRebase(
		repo: Repository,
		baseRef: string,
		headRef: string,
		source: Source,
		options?: {
			cancellation?: CancellationToken;
			context?: string;
			generating?: Deferred<AIModel>;
			progress?: ProgressOptions;
			generateCommits?: boolean;
		},
	): Promise<AIRebaseResult | 'cancelled' | undefined> {
		const result: Mutable<AIRebaseResult> = {
			diff: undefined!,
			explanation: undefined!,
			hunkMap: [],
			commits: [],
		} as unknown as AIRebaseResult;

		const confirmed = this.container.storage.get(
			options?.generateCommits ? 'confirm:ai:generateCommits' : 'confirm:ai:generateRebase',
			false,
		);
		if (!confirmed) {
			const accept: MessageItem = { title: 'Continue' };
			const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };

			const result = await window.showInformationMessage(
				`This will ${
					options?.generateCommits
						? 'stash all of your changes and commit directly to your current branch'
						: 'create a new branch at the chosen commit and commit directly to that branch'
				}.`,
				{ modal: true },
				accept,
				cancel,
			);

			if (result === cancel) {
				return undefined;
			} else if (result === accept) {
				await this.container.storage.store(
					options?.generateCommits ? 'confirm:ai:generateCommits' : 'confirm:ai:generateRebase',
					true,
				);
			}
		}

		const rq = await this.sendRebaseRequestWithRetry(repo, baseRef, headRef, source, result, options);

		if (rq === 'cancelled') return rq;

		if (rq == null) return undefined;

		return {
			...rq,
			...result,
			type: 'generate-rebase',
			feature: options?.generateCommits ? 'generate-commits' : 'generate-rebase',
		};
	}

	@log({ args: false })
	private async sendRebaseRequestWithRetry(
		repo: Repository,
		baseRef: string,
		headRef: string,
		source: Source,
		result: Mutable<AIRebaseResult>,
		options?: {
			cancellation?: CancellationToken;
			context?: string;
			generating?: Deferred<AIModel>;
			progress?: ProgressOptions;
			generateCommits?: boolean;
		},
	): Promise<AIRequestResult | 'cancelled' | undefined> {
		let conversationMessages: AIChatMessage[] = [];
		let attempt = 0;
		const maxAttempts = 4;

		// First attempt - setup diff and hunk map
		const firstAttemptResult = await this.sendRebaseFirstAttempt(repo, baseRef, headRef, source, result, options);

		if (firstAttemptResult === 'cancelled' || firstAttemptResult == null) {
			return firstAttemptResult;
		}

		conversationMessages = [...firstAttemptResult.conversationMessages];
		let rq = firstAttemptResult.response;

		while (attempt < maxAttempts) {
			const validationResult = this.validateRebaseResponse(rq, result.hunkMap, options);
			if (validationResult.isValid) {
				result.commits = validationResult.commits;
				return rq;
			}

			Logger.warn(
				undefined,
				'AIProviderService',
				'sendRebaseRequestWithRetry',
				`Validation failed on attempt ${attempt + 1}: ${validationResult.errorMessage}`,
			);

			// If this was the last attempt, throw the error
			if (attempt === maxAttempts - 1) {
				throw new Error(validationResult.errorMessage);
			}

			// Prepare retry message for conversation
			conversationMessages.push(
				{ role: 'assistant', content: rq.content },
				{ role: 'user', content: validationResult.retryPrompt },
			);

			attempt++;

			// Send retry request
			const currentAttempt = attempt;
			const retryResult = await this.sendRequest(
				'generate-rebase',
				async () => Promise.resolve(conversationMessages),
				m =>
					`Generating ${options?.generateCommits ? 'commits' : 'rebase'} with ${m.name}... (attempt ${
						currentAttempt + 1
					})`,
				source,
				m => ({
					key: 'ai/generate',
					data: {
						type: 'rebase',
						id: undefined,
						'model.id': m.id,
						'model.provider.id': m.provider.id,
						'model.provider.name': m.provider.name,
						'retry.count': currentAttempt,
					},
				}),
				options,
			);

			if (retryResult === 'cancelled' || retryResult == null) {
				return retryResult;
			}

			rq = retryResult;
		}

		return undefined;
	}

	@log({ args: false })
	private async sendRebaseFirstAttempt(
		repo: Repository,
		baseRef: string,
		headRef: string,
		source: Source,
		result: Mutable<AIRebaseResult>,
		options?: {
			cancellation?: CancellationToken;
			context?: string;
			generating?: Deferred<AIModel>;
			progress?: ProgressOptions;
			generateCommits?: boolean;
		},
	): Promise<
		| { readonly response: AIRequestResult; readonly conversationMessages: readonly AIChatMessage[] }
		| 'cancelled'
		| undefined
	> {
		let storedPrompt = '';
		const rq = await this.sendRequest(
			'generate-rebase',
			async (model, reporting, cancellation, maxInputTokens, retries) => {
				const diff = await repo.git.diff.getDiff?.(headRef, baseRef, { notation: '...' });
				if (!diff?.contents) {
					throw new AINoRequestDataError(
						`No changes found to generate ${options?.generateCommits ? 'commits' : 'a rebase'} from.`,
					);
				}
				if (cancellation.isCancellationRequested) throw new CancellationError();

				result.diff = diff.contents;

				const hunkMap: { index: number; hunkHeader: string }[] = [];
				let counter = 0;
				//const filesDiffs = await repo.git.diff().getDiffFiles!(diff.contents)!;
				//for (const f of filesDiffs!.files)
				//for (const hunk of parsedDiff.hunks) {
				//	hunkMap.push({ index: ++counter, hunkHeader: hunk.contents.split('\n', 1)[0] });
				//}

				// let hunksByNumber= '';

				for (const hunkHeader of diff.contents.matchAll(/@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(.*)$/gm)) {
					hunkMap.push({ index: ++counter, hunkHeader: hunkHeader[0] });
				}

				result.hunkMap = hunkMap;
				// 	const hunkNumber = `hunk-${counter++}`;
				// 	hunksByNumber += `${hunkNumber}: ${hunk[0]}\n`;
				// }

				// const commits: { diff: string; message: string }[] = [];
				// for (const commit of [...log.commits.values()].sort((a, b) => a.date.getTime() - b.date.getTime())) {
				// 	const diff = await repo.git.diff().getDiff?.(commit.ref);
				// 	commits.push({ message: commit.message ?? commit.summary, diff: diff?.contents ?? '' });

				// 	if (cancellation.isCancellationRequested) throw new CancellationError();
				// }

				const { prompt } = await this.getPrompt(
					'generate-rebase',
					model,
					{
						diff: diff.contents,
						// commits: JSON.stringify(commits),
						data: JSON.stringify(hunkMap),
						context: options?.context,
						// instructions: configuration.get('ai.generateRebase.customInstructions'),
					},
					maxInputTokens,
					retries,
					reporting,
				);
				if (cancellation.isCancellationRequested) throw new CancellationError();

				// Store the prompt for later use in conversation messages
				storedPrompt = prompt;

				const messages: AIChatMessage[] = [{ role: 'user', content: prompt }];
				return messages;
			},
			m => `Generating ${options?.generateCommits ? 'commits' : 'rebase'} with ${m.name}...`,
			source,
			m => ({
				key: 'ai/generate',
				data: {
					type: 'rebase',
					id: undefined,
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
			options,
		);

		if (rq === 'cancelled') return rq;

		if (rq == null) return undefined;

		return {
			response: rq,
			conversationMessages: [{ role: 'user', content: storedPrompt }],
		};
	}

	private validateRebaseResponse(
		rq: AIRequestResult,
		inputHunkMap: { index: number; hunkHeader: string }[],
		options?: {
			generateCommits?: boolean;
		},
	):
		| { isValid: false; errorMessage: string; retryPrompt: string }
		| { isValid: true; commits: AIRebaseResult['commits'] } {
		// if it is wrapped in markdown, we need to strip it
		const content = rq.content.replace(/^\s*```json\s*/, '').replace(/\s*```$/, '');

		let commits: AIRebaseResult['commits'];
		try {
			// Parse the JSON content from the result
			commits = JSON.parse(content) as AIRebaseResult['commits'];
		} catch {
			const errorMessage = `Unable to parse ${options?.generateCommits ? 'commits' : 'rebase'} result`;
			const retryPrompt = dedent(`
					Your previous response could not be parsed as valid JSON. Please ensure your response is a valid JSON array of commits with the correct structure.
					Don't include any preceeding or succeeding text or markup, such as "Here are the commits:" or "Here is a valid JSON array of commits:".

					Here was your previous response:
					${rq.content}

					Please provide a valid JSON array of commits following this structure:
					[
					  {
					    "message": "commit message",
					    "explanation": "detailed explanation",
					    "hunks": [{"hunk": 1}, {"hunk": 2}]
					  }
					]
				`);

			return { isValid: false, errorMessage: errorMessage, retryPrompt: retryPrompt };
		}

		// Validate the structure and hunk assignments
		try {
			const inputHunkIndices = inputHunkMap.map(h => h.index);
			const allOutputHunks = commits.flatMap(c => c.hunks.map(h => h.hunk));
			const outputHunkIndices = new Map(allOutputHunks.map((hunk, index) => [hunk, index]));
			const missingHunks = inputHunkIndices.filter(i => !outputHunkIndices.has(i));

			if (missingHunks.length > 0 || allOutputHunks.length > inputHunkIndices.length) {
				const errorParts: string[] = [];
				const retryParts: string[] = [];

				if (missingHunks.length > 0) {
					const pluralize = missingHunks.length > 1 ? 's' : '';
					errorParts.push(`${missingHunks.length} missing hunk${pluralize}`);
					retryParts.push(`You missed hunk${pluralize} ${missingHunks.join(', ')} in your response`);
				}
				const extraHunks = [...outputHunkIndices.keys()].filter(i => !inputHunkIndices.includes(i));
				if (extraHunks.length > 0) {
					const pluralize = extraHunks.length > 1 ? 's' : '';
					errorParts.push(`${extraHunks.length} extra hunk${pluralize}`);
					retryParts.push(
						`You included hunk${pluralize} ${extraHunks.join(', ')} which ${
							extraHunks.length > 1 ? 'were' : 'was'
						} not in the original diff`,
					);
				}
				const duplicateHunks = allOutputHunks.filter((hunk, index) => outputHunkIndices.get(hunk)! !== index);
				const uniqueDuplicates = [...new Set(duplicateHunks)];
				if (uniqueDuplicates.length > 0) {
					const pluralize = uniqueDuplicates.length > 1 ? 's' : '';
					errorParts.push(`${uniqueDuplicates.length} duplicate hunk${pluralize}`);
					retryParts.push(`You used hunk${pluralize} ${uniqueDuplicates.join(', ')} multiple times`);
				}

				const errorMessage = `Invalid response in generating ${
					options?.generateCommits ? 'commits' : 'rebase'
				} result. ${errorParts.join(', ')}.`;

				const retryPrompt = dedent(`
						Your previous response had issues: ${retryParts.join(', ')}.

						Please provide a corrected JSON response that:
						1. Includes ALL hunks from 1 to ${Math.max(...inputHunkIndices)} exactly once
						2. Does not include any hunk numbers outside this range
						3. Does not use any hunk more than once

						Here was your previous response:
						${rq.content}

						Please provide the corrected JSON array of commits.
						Don't include any preceeding or succeeding text or markup, such as "Here are the commits:" or "Here is a valid JSON array of commits:".
					`);

				return { isValid: false, errorMessage: errorMessage, retryPrompt: retryPrompt };
			}

			// If validation passes, return the commits
			return { isValid: true, commits: commits };
		} catch {
			// Handle any errors during hunk validation (e.g., malformed commit structure)
			const errorMessage = `Invalid commit structure in ${
				options?.generateCommits ? 'commits' : 'rebase'
			} result`;
			const retryPrompt = dedent(`
					Your previous response has an invalid commit structure. Each commit must have "message", "explanation", and "hunks" properties, where "hunks" is an array of objects with "hunk" numbers.

					Here was your previous response:
					${rq.content}

					Please provide a valid JSON array of commits following this structure:
					[
					  {
					    "message": "commit message",
					    "explanation": "detailed explanation",
					    "hunks": [{"hunk": 1}, {"hunk": 2}]
					  }
					]
				`);

			return { isValid: false, errorMessage: errorMessage, retryPrompt: retryPrompt };
		}
	}

	@log({ args: false })
	private async sendRequestWithDeferredResult<T extends AIActionType>(
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
	): Promise<AIDeferredRequestResult<AIRequestResult> | 'cancelled' | undefined> {
		if (!(await this.ensureFeatureAccess(action, source))) {
			return 'cancelled';
		}
		const model = await this.getModel(undefined, source);
		if (model == null || options?.cancellation?.isCancellationRequested) {
			options?.generating?.cancel();
			return 'cancelled';
		}

		const promise = this.sendRequestWithModel(
			model,
			action,
			getMessages,
			getProgressTitle,
			source,
			getTelemetryInfo,
			options,
		);
		return { model: model, promise: promise };
	}

	@log({ args: false })
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
	): Promise<AIRequestResult | 'cancelled' | undefined> {
		if (!(await this.ensureFeatureAccess(action, source))) {
			return 'cancelled';
		}

		const model = await this.getModel(undefined, source);
		if (model == null || options?.cancellation?.isCancellationRequested) {
			options?.generating?.cancel();
			return 'cancelled';
		}

		return this.sendRequestWithModel(
			model,
			action,
			getMessages,
			getProgressTitle,
			source,
			getTelemetryInfo,
			options,
		);
	}

	@log({ args: false })
	private async sendRequestWithModel<T extends AIActionType>(
		model: AIModel | undefined,
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
	): Promise<AIRequestResult | 'cancelled' | undefined> {
		const scope = getLogScope();

		if (!(await this.ensureFeatureAccess(action, source))) {
			setLogScopeExit(scope, undefined, 'cancelled: no feature access');
			return 'cancelled';
		}

		if (options?.cancellation?.isCancellationRequested) {
			setLogScopeExit(scope, undefined, 'cancelled: user cancelled');
			options?.generating?.cancel();
			return 'cancelled';
		}

		if (model == null || options?.cancellation?.isCancellationRequested) {
			setLogScopeExit(
				scope,
				model ? `model: ${model.provider.id}/${model.id}` : undefined,
				model == null ? 'cancelled: no model set' : 'cancelled: user cancelled',
			);
			options?.generating?.cancel();
			return undefined;
		}

		const telementry = getTelemetryInfo(model);

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
			setLogScopeExit(
				scope,
				`model: ${model.provider.id}/${model.id}`,

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
				setLogScopeExit(scope, `model: ${model.provider.id}/${model.id}`, 'cancelled: user cancelled');
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
			setLogScopeExit(scope, `model: ${model.provider.id}/${model.id}`, 'cancelled: user cancelled');
			this.container.telemetry.sendEvent(
				telementry.key,
				{ ...telementry.data, failed: true, 'failed.reason': 'user-cancelled' },
				source,
			);

			options?.generating?.cancel();
			return 'cancelled';
		}

		if (apiKey == null) {
			setLogScopeExit(scope, `model: ${model.provider.id}/${model.id}`, 'failed: Not authorized');
			this.container.telemetry.sendEvent(
				telementry.key,
				{ ...telementry.data, failed: true, 'failed.reason': 'error', 'failed.error': 'Not authorized' },
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

			setLogScopeExit(scope, `model: ${model.provider.id}/${model.id}, id: ${result?.id}`);
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
				setLogScopeExit(scope, `model: ${model.provider.id}/${model.id}`, 'cancelled: user cancelled');
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
				setLogScopeExit(
					scope,
					`model: ${model.provider.id}/${model.id}`,
					`failed: ${String(ex)} (${String(ex.original)})`,
				);

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
								compareSubscriptionPlans(sub.plan.actual.id, 'advanced') <= 0 ? 'teams' : 'advanced';

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

			setLogScopeExit(
				scope,
				`model: ${model.provider.id}/${model.id}`,
				`failed: ${String(ex)}${ex.original ? ` (${String(ex.original)})` : ''}`,
			);
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
			let diff = await changesOrRepo.git.diff.getDiff?.(uncommittedStaged);
			if (!diff?.contents) {
				diff = await changesOrRepo.git.diff.getDiff?.(uncommitted);
				if (!diff?.contents) throw new AINoRequestDataError('No changes to generate a commit message from.');
			}
			if (options?.cancellation?.isCancellationRequested) return undefined;

			changes = diff.contents;
		}

		return changes;
	}

	private async getPrompt<T extends PromptTemplateType>(
		templateType: T,
		model: AIModel,
		context: PromptTemplateContext<T>,
		maxInputTokens: number,
		retries: number,
		reporting: TelemetryEvents['ai/generate' | 'ai/explain'],
	): Promise<{ prompt: string; truncated: boolean }> {
		const promptTemplate = await this.getPromptTemplate(templateType, model);
		if (promptTemplate == null) {
			debugger;
			throw new Error(`No prompt template found for ${templateType}`);
		}

		if ('instructions' in context && context.instructions) {
			context.instructions = `Carefully follow these additional instructions (provided directly by the user), but do not deviate from the output structure:\n${context.instructions}`;
		}

		const result = await resolvePrompt(model, promptTemplate, context, maxInputTokens, retries, reporting);
		return result;
	}

	private async getPromptTemplate<T extends PromptTemplateType>(
		templateType: T,
		model: AIModel,
	): Promise<PromptTemplate | undefined> {
		const scope = getLogScope();

		const template = getLocalPromptTemplate(templateType, model);
		const templateId = template?.id ?? templateType;

		return this._promptTemplates.get(templateId, async cancellable => {
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
				cancellable.cancelled();
				if (!(ex instanceof AuthenticationRequiredError)) {
					debugger;
					Logger.error(ex, scope, String(ex));
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
		void this.container.storage.deleteWithPrefix(`confirm:ai:generateRebase`);
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

	/**
	 * Generates commits using AI to organize existing hunks into logical commits.
	 * Similar to generateRebase but works with existing hunks instead of generating a diff.
	 *
	 * This method includes automatic retry logic that validates the AI response and
	 * continues the conversation if the response has issues like:
	 * - Missing hunks that were in the original hunk map
	 * - Extra hunks that weren't in the original hunk map
	 * - Duplicate hunks used multiple times
	 *
	 * The method will retry up to 3 times, providing specific feedback to the AI
	 * about what was wrong with the previous response.
	 */
	async generateCommits(
		hunks: {
			index: number;
			fileName: string;
			diffHeader: string;
			hunkHeader: string;
			content: string;
			source: string;
		}[],
		existingCommits: { id: string; message: string; aiExplanation?: string; hunkIndices: number[] }[],
		hunkMap: { index: number; hunkHeader: string }[],
		source: Source,
		options?: {
			cancellation?: CancellationToken;
			generating?: Deferred<AIModel>;
			progress?: ProgressOptions;
			customInstructions?: string;
		},
	): Promise<AIGenerateCommitsResult | 'cancelled' | undefined> {
		// Use retry logic similar to generateRebase
		const result = await this.sendCommitsRequestWithRetry(hunks, existingCommits, hunkMap, source, options);
		if (result === 'cancelled' || result == null) return result;

		return result;
	}

	private async sendCommitsRequestWithRetry(
		hunks: {
			index: number;
			fileName: string;
			diffHeader: string;
			hunkHeader: string;
			content: string;
			source: string;
		}[],
		existingCommits: { id: string; message: string; aiExplanation?: string; hunkIndices: number[] }[],
		hunkMap: { index: number; hunkHeader: string }[],
		source: Source,
		options?: {
			cancellation?: CancellationToken;
			generating?: Deferred<AIModel>;
			progress?: ProgressOptions;
			customInstructions?: string;
		},
	): Promise<AIGenerateCommitsResult | 'cancelled' | undefined> {
		let conversationMessages: AIChatMessage[] = [];
		let attempt = 0;
		const maxAttempts = 4;

		// First attempt - send initial request
		const firstAttemptResult = await this.sendCommitsFirstAttempt(hunks, existingCommits, hunkMap, source, options);

		if (firstAttemptResult === 'cancelled' || firstAttemptResult == null) {
			return firstAttemptResult;
		}

		let rq = firstAttemptResult.response;
		conversationMessages = [...firstAttemptResult.conversationMessages];

		while (attempt < maxAttempts) {
			const validationResult = this.validateCommitsResponse(rq, hunks, existingCommits);
			if (validationResult.isValid) {
				return { commits: validationResult.commits };
			}

			Logger.warn(
				undefined,
				'AIProviderService',
				'sendCommitsRequestWithRetry',
				`Validation failed on attempt ${attempt + 1}: ${validationResult.errorMessage}`,
			);

			// If this was the last attempt, throw the error
			if (attempt === maxAttempts - 1) {
				throw new Error(validationResult.errorMessage);
			}

			// Prepare retry message for conversation
			conversationMessages.push(
				{ role: 'assistant', content: rq.content },
				{ role: 'user', content: validationResult.retryPrompt },
			);

			attempt++;

			// Send retry request
			const currentAttempt = attempt;
			const retryResult = await this.sendRequest(
				'generate-commits',
				async () => Promise.resolve(conversationMessages),
				m => `Generating commits with ${m.name}... (attempt ${currentAttempt + 1})`,
				source,
				m => ({
					key: 'ai/generate',
					data: {
						type: 'commits',
						id: undefined,
						'model.id': m.id,
						'model.provider.id': m.provider.id,
						'model.provider.name': m.provider.name,
						'retry.count': currentAttempt,
					},
				}),
				options,
			);

			if (retryResult === 'cancelled' || retryResult == null) {
				return retryResult;
			}

			rq = retryResult;
		}

		return undefined;
	}

	private async sendCommitsFirstAttempt(
		hunks: {
			index: number;
			fileName: string;
			diffHeader: string;
			hunkHeader: string;
			content: string;
			source: string;
		}[],
		existingCommits: { id: string; message: string; aiExplanation?: string; hunkIndices: number[] }[],
		hunkMap: { index: number; hunkHeader: string }[],
		source: Source,
		options?: {
			cancellation?: CancellationToken;
			generating?: Deferred<AIModel>;
			progress?: ProgressOptions;
			customInstructions?: string;
		},
	): Promise<{ response: AIRequestResult; conversationMessages: AIChatMessage[] } | 'cancelled' | undefined> {
		let storedPrompt = '';
		const rq = await this.sendRequest(
			'generate-commits',
			async (model, reporting, cancellation, maxInputTokens, retries) => {
				// Prepare the data for the AI prompt
				const hunksJson = JSON.stringify(hunks);
				const existingCommitsJson = JSON.stringify(existingCommits);
				const hunkMapJson = JSON.stringify(hunkMap);

				if (cancellation.isCancellationRequested) throw new CancellationError();

				let customInstructions: string | undefined = undefined;
				const customInstructionsConfig = configuration.get('ai.generateCommits.customInstructions');
				if (customInstructionsConfig) {
					customInstructions = `${customInstructionsConfig}${options?.customInstructions ? `\nAnd here is additional guidance for this session:\n${options.customInstructions}` : ''}`;
				} else {
					customInstructions = options?.customInstructions;
				}

				const { prompt } = await this.getPrompt(
					'generate-commits',
					model,
					{
						hunks: hunksJson,
						existingCommits: existingCommitsJson,
						hunkMap: hunkMapJson,
						instructions: customInstructions,
					},
					maxInputTokens,
					retries,
					reporting,
				);
				if (cancellation.isCancellationRequested) throw new CancellationError();

				// Store the prompt for later use in conversation messages
				storedPrompt = prompt;

				const messages: AIChatMessage[] = [{ role: 'user', content: prompt }];
				return messages;
			},
			m => `Generating commits with ${m.name}...`,
			source,
			m => ({
				key: 'ai/generate',
				data: {
					type: 'commits',
					id: undefined,
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
			options,
		);

		if (rq === 'cancelled') return rq;

		if (rq == null) return undefined;

		return {
			response: rq,
			conversationMessages: [{ role: 'user', content: storedPrompt }],
		};
	}

	private validateCommitsResponse(
		rq: AIRequestResult,
		inputHunks: {
			index: number;
			fileName: string;
			diffHeader: string;
			hunkHeader: string;
			content: string;
			source: string;
		}[],
		existingCommits: { id: string; message: string; aiExplanation?: string; hunkIndices: number[] }[],
	):
		| {
				isValid: true;
				commits: {
					readonly message: string;
					readonly explanation: string;
					readonly hunks: { hunk: number }[];
				}[];
		  }
		| { isValid: false; errorMessage: string; retryPrompt: string } {
		try {
			const rqContent = parseOutputResult(rq.content);

			// Parse the JSON response
			const commits: {
				readonly message: string;
				readonly explanation: string;
				readonly hunks: { hunk: number }[];
			}[] = JSON.parse(rqContent);

			if (!Array.isArray(commits)) {
				throw new Error('Commits result is not an array');
			}

			// Collect all hunk indices used in the commits
			const usedHunkIndices = new Set<number>();
			const duplicateHunks: number[] = [];

			for (const commit of commits) {
				if (!commit.hunks || !Array.isArray(commit.hunks)) {
					throw new Error('Invalid commit structure: missing or invalid hunks array');
				}

				for (const hunkRef of commit.hunks) {
					const hunkIndex = hunkRef.hunk;
					if (usedHunkIndices.has(hunkIndex)) {
						duplicateHunks.push(hunkIndex);
					}
					usedHunkIndices.add(hunkIndex);
				}
			}

			// Check for duplicate hunks
			if (duplicateHunks.length > 0) {
				const errorMessage = `Duplicate hunks found: ${duplicateHunks.join(', ')}`;
				const retryPrompt = dedent(`
					Your previous response uses some hunks multiple times. Each hunk can only be used once across all commits.

					Duplicate hunks: ${duplicateHunks.join(', ')}

					Please provide a corrected response where each hunk is used only once.
				`);
				return { isValid: false, errorMessage: errorMessage, retryPrompt: retryPrompt };
			}

			// Check for missing hunks
			const inputHunkIndices = new Set(inputHunks.map(h => h.index));
			const previouslyAssignedHunkIndices = new Set(existingCommits.flatMap(c => c.hunkIndices));
			const unassignedHunkIndices = new Set(
				[...inputHunkIndices].filter(i => !previouslyAssignedHunkIndices.has(i)),
			);
			const illegallyAssignedHunkIndices = Array.from(usedHunkIndices).filter(i => !inputHunkIndices.has(i));
			const missingHunkIndices = Array.from(unassignedHunkIndices).filter(i => !usedHunkIndices.has(i));
			const extraHunkIndices = Array.from(usedHunkIndices).filter(index => !inputHunkIndices.has(index));

			// Check for missing hunks
			if (missingHunkIndices.length > 0) {
				const errorMessage = `Missing hunks: ${missingHunkIndices.join(', ')}`;
				const retryPrompt = dedent(`
					Your previous response is missing some hunks that were in the original input. All hunks must be included in the commits.

					Missing hunks: ${missingHunkIndices.join(', ')}

					Please provide a corrected response that includes all hunks.
				`);
				return { isValid: false, errorMessage: errorMessage, retryPrompt: retryPrompt };
			}

			// Check for extra hunks
			if (extraHunkIndices.length > 0) {
				const errorMessage = `Extra hunks found: ${extraHunkIndices.join(', ')}`;
				const retryPrompt = dedent(`
					Your previous response includes hunks that were not in the original input. Only use the hunks that were provided.

					Extra hunks: ${extraHunkIndices.join(', ')}

					Please provide a corrected response that only uses the provided hunks.
				`);
				return { isValid: false, errorMessage: errorMessage, retryPrompt: retryPrompt };
			}

			// Check for illegally assigned hunks
			if (illegallyAssignedHunkIndices.length > 0) {
				const errorMessage = `Illegally assigned hunks: ${illegallyAssignedHunkIndices.join(', ')}`;
				const retryPrompt = dedent(`
					Your previous response includes hunks that are already assigned to existing commits. Do not reassign hunks that are already assigned.

					Illegally assigned hunks: ${illegallyAssignedHunkIndices.join(', ')}

					Please provide a corrected response that does not reassign existing hunks.
				`);
				return { isValid: false, errorMessage: errorMessage, retryPrompt: retryPrompt };
			}

			// If validation passes, return the commits
			return { isValid: true, commits: commits };
		} catch {
			// Handle any errors during hunk validation (e.g., malformed commit structure)
			const errorMessage = 'Invalid response from the AI model';
			const retryPrompt = dedent(`
				Your previous response has an invalid commit structure. Ensure each commit has "message", "explanation", and "hunks" properties, where "hunks" is an array of objects with "hunk" numbers.

				Please provide the valid JSON structure below inside a <output> tag and include no other text:
				<output>
				[
					{
						"message": "[commit message here]",
						"explanation": "[detailed explanation of changes here]",
						"hunks": [{"hunk": [index from hunk_map]}, {"hunk": [index from hunk_map]}]
					}
				]
				</output>

				Text in [] brackets above should be replaced with your own text, not including the brackets. Return only the <output> tag and no other text.
			`);
			return { isValid: false, errorMessage: errorMessage, retryPrompt: retryPrompt };
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

function parseOutputResult(result: string): string {
	return result.match(/<output>([\s\S]*?)(?:<\/output>|$)/)?.[1]?.trim() ?? '';
}

function parseSummarizeResult(result: string): NonNullable<AISummarizeResult['parsed']> {
	result = result.trim();
	const summary = result.match(/<summary>([\s\S]*?)(?:<\/summary>|$)/)?.[1]?.trim() ?? undefined;
	if (summary != null) {
		result = result.replace(/<summary>[\s\S]*?(?:<\/summary>|$)/, '').trim();
	}

	let body = result.match(/<body>([\s\S]*?)(?:<\/body>|$)/)?.[1]?.trim() ?? undefined;
	if (body != null) {
		result = result.replace(/<body>[\s\S]*?(?:<\/body>|$)/, '').trim();
	}

	// Check for self-closing body tag
	if (body == null && result.includes('<body/>')) {
		body = '';
	}

	// If both tags are present, return them
	if (summary != null && body != null) return { summary: summary, body: body };

	// If both tags are missing, split the result
	if (summary == null && body == null) return splitMessageIntoSummaryAndBody(result);

	// If only summary tag is present, use any remaining text as the body
	if (summary && body == null) {
		return result ? { summary: summary, body: result } : splitMessageIntoSummaryAndBody(summary);
	}

	// If only body tag is present, use the remaining text as the summary
	if (summary == null && body) {
		return result ? { summary: result, body: body } : splitMessageIntoSummaryAndBody(body);
	}

	return { summary: summary ?? '', body: body ?? '' };
}

function splitMessageIntoSummaryAndBody(message: string): NonNullable<AISummarizeResult['parsed']> {
	message = message.replace(/```([\s\S]*?)```/, '$1').trim();
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

export async function prepareCompareDataForAIRequest(
	svc: GitRepositoryService,
	headRef: string,
	baseRef: string,
	options?: {
		cancellation?: CancellationToken;
		reportNoDiffService?: () => void;
		reportNoCommitsService?: () => void;
		reportNoChanges?: () => void;
	},
): Promise<{ diff: string; logMessages: string } | undefined> {
	const { cancellation, reportNoDiffService, reportNoCommitsService, reportNoChanges } = options ?? {};
	const getDiff = svc.diff?.getDiff;
	if (getDiff == null) {
		if (reportNoDiffService) {
			reportNoDiffService();
			return;
		}
	}

	const getLog = svc.commits?.getLog;
	if (getLog === undefined) {
		if (reportNoCommitsService) {
			reportNoCommitsService();
			return;
		}
	}

	const [diffResult, logResult] = await Promise.allSettled([
		getDiff?.(headRef, baseRef, { notation: '...' }),
		getLog(`${baseRef}..${headRef}`),
	]);
	const diff = getSettledValue(diffResult);
	const log = getSettledValue(logResult);

	if (!diff?.contents || !log?.commits?.size) {
		reportNoChanges?.();
		return undefined;
	}

	if (cancellation?.isCancellationRequested) throw new CancellationError();

	const commitMessages: string[] = [];
	for (const commit of [...log.commits.values()].sort((a, b) => a.date.getTime() - b.date.getTime())) {
		const message = commit.message ?? commit.summary;
		if (message) {
			commitMessages.push(
				`<commit-message ${commit.date.toISOString()}>\n${
					commit.message ?? commit.summary
				}\n<end-of-commit-message>`,
			);
		}
	}

	return { diff: diff.contents, logMessages: commitMessages.join('\n\n') };
}
