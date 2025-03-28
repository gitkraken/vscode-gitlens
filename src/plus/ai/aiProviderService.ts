import type { CancellationToken, Disposable, Event, MessageItem, ProgressOptions } from 'vscode';
import { env, EventEmitter, window } from 'vscode';
import type { AIPrimaryProviders, AIProviderAndModel, AIProviders, SupportedAIModels } from '../../constants.ai';
import {
	anthropicProviderDescriptor,
	deepSeekProviderDescriptor,
	geminiProviderDescriptor,
	githubProviderDescriptor,
	gitKrakenProviderDescriptor,
	huggingFaceProviderDescriptor,
	openAIProviderDescriptor,
	vscodeProviderDescriptor,
	xAIProviderDescriptor,
} from '../../constants.ai';
import type { AIGenerateDraftEventData, Source, TelemetryEvents } from '../../constants.telemetry';
import type { Container } from '../../container';
import { CancellationError, GkAIError, GkAIErrorReason } from '../../errors';
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
import type { Deferred } from '../../system/promise';
import { getSettledValue, getSettledValues } from '../../system/promise';
import type { ServerConnection } from '../gk/serverConnection';
import { ensureFeatureAccess } from '../gk/utils/-webview/acount.utils';
import type {
	AIActionType,
	AIModel,
	AIModelDescriptor,
	AIProviderConstructor,
	AIProviderDescriptorWithConfiguration,
	AIProviderDescriptorWithType,
} from './models/model';
import type { PromptTemplateContext } from './models/promptTemplates';
import type { AIProvider, AIRequestResult } from './models/provider';

export interface AIResult {
	readonly id?: string;
	readonly content: string;
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

export interface AIModelChangeEvent {
	readonly model: AIModel | undefined;
}

// Order matters for sorting the picker
const supportedAIProviders = new Map<AIProviders, AIProviderDescriptorWithType>([
	...(configuration.getAny('gitkraken.ai.enabled', undefined, false)
		? [
				[
					'gitkraken',
					{
						...gitKrakenProviderDescriptor,
						type: lazy(
							async () =>
								(await import(/* webpackChunkName: "ai" */ './gitkrakenProvider')).GitKrakenProvider,
						),
					},
				],
		  ]
		: ([] as any)),
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
	private _model: AIModel | undefined;
	private _provider: AIProvider | undefined;
	private _providerDisposable: Disposable | undefined;

	private readonly _onDidChangeModel = new EventEmitter<AIModelChangeEvent>();
	get onDidChangeModel(): Event<AIModelChangeEvent> {
		return this._onDidChangeModel.event;
	}

	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	dispose(): void {
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
		if (!(await this.ensureFeatureAccess('explainCommit', sourceContext))) {
			return undefined;
		}

		const diff = await this.container.git.diff(commitOrRevision.repoPath).getDiff?.(commitOrRevision.ref);
		if (!diff?.contents) throw new Error('No changes found to explain.');

		const commit = isCommit(commitOrRevision)
			? commitOrRevision
			: await this.container.git.commits(commitOrRevision.repoPath).getCommit(commitOrRevision.ref);
		if (commit == null) throw new Error('Unable to find commit');

		if (!commit.hasFullDetails()) {
			await commit.ensureFullDetails();
			assertsCommitHasFullDetails(commit);
		}

		const { type, ...source } = sourceContext;

		const result = await this.sendRequest(
			'explain-changes',
			() => ({
				diff: diff.contents,
				message: commit.message,
				instructions: configuration.get('ai.explainChanges.customInstructions') ?? '',
			}),
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
		if (!(await this.ensureOrgAccess())) return undefined;

		const changes: string | undefined = await this.getChanges(changesOrRepo);
		if (changes == null) return undefined;

		const result = await this.sendRequest(
			'generate-commitMessage',
			() => ({
				diff: changes,
				context: options?.context ?? '',
				instructions: configuration.get('ai.generateCommitMessage.customInstructions') ?? '',
			}),
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
			options,
		);
		return result != null ? { ...result, parsed: parseSummarizeResult(result.content) } : undefined;
	}

	async generatePullRequestMessage(
		repo: Repository,
		baseRef: string,
		compareRef: string,
		source: Source,
		options?: {
			cancellation?: CancellationToken;
			context?: string;
			generating?: Deferred<AIModel>;
			progress?: ProgressOptions;
		},
	): Promise<AISummarizeResult | undefined> {
		if (!(await this.ensureFeatureAccess('generateChangelog', source))) {
			return undefined;
		}

		const diff = await repo.git.diff().getDiff?.(compareRef, baseRef, { notation: '...' });

		const log = await this.container.git.commits(repo.path).getLog(`${baseRef}..${compareRef}`);
		const commits: [string, number][] = [];
		for (const [_sha, commit] of log?.commits ?? []) {
			commits.push([commit.message ?? '', commit.date.getTime()]);
		}

		if (!diff?.contents && !commits.length) {
			throw new Error('No changes found to generate a pull request message from.');
		}

		const result = await this.sendRequest(
			'generate-pullRequestMessage',
			() => ({
				diff: diff?.contents ?? '',
				data: commits.sort((a, b) => a[1] - b[1]).map(c => c[0]),
				context: options?.context ?? '',
				instructions: configuration.get('ai.generateCommitMessage.customInstructions') ?? '',
			}),
			m => `Generating pull request details with ${m.name}...`,
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
			options,
		);
		return result != null ? { ...result, parsed: parseSummarizeResult(result.content) } : undefined;
	}

	async generateDraftMessage(
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
		if (!(await this.ensureFeatureAccess('cloudPatchGenerateTitleAndDescription', sourceContext))) {
			return undefined;
		}

		const changes: string | undefined = await this.getChanges(changesOrRepo);
		if (changes == null) return undefined;

		const { type, ...source } = sourceContext;

		const result = await this.sendRequest(
			options?.codeSuggestion ? 'generate-create-codeSuggestion' : 'generate-create-cloudPatch',
			() => ({
				diff: changes,
				context: options?.context ?? '',
				instructions:
					(options?.codeSuggestion
						? configuration.get('ai.generateCodeSuggestMessage.customInstructions')
						: configuration.get('ai.generateCloudPatchMessage.customInstructions')) ?? '',
			}),
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
		if (!(await this.ensureFeatureAccess('generateStashMessage', source))) {
			return undefined;
		}

		const changes: string | undefined = await this.getChanges(changesOrRepo);
		if (changes == null) {
			options?.generating?.cancel();
			return undefined;
		}

		const result = await this.sendRequest(
			'generate-stashMessage',
			() => ({
				diff: changes,
				context: options?.context ?? '',
				instructions: configuration.get('ai.generateStashMessage.customInstructions') ?? '',
			}),
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
			options,
		);
		return result != null ? { ...result, parsed: parseSummarizeResult(result.content) } : undefined;
	}

	async generateChangelog(
		changes: Lazy<Promise<AIGenerateChangelogChange[]>>,
		source: Source,
		options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
	): Promise<AIResult | undefined> {
		if (!(await this.ensureFeatureAccess('generateChangelog', source))) {
			return undefined;
		}

		const result = await this.sendRequest(
			'generate-changelog',
			async () => ({
				data: JSON.stringify(await changes.value),
				instructions: configuration.get('ai.generateChangelog.customInstructions') ?? '',
			}),
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
		getContext: () => PromptTemplateContext<T> | Promise<PromptTemplateContext<T>>,
		getProgressTitle: (model: AIModel) => string,
		source: Source,
		getTelemetryInfo: (model: AIModel) => {
			key: 'ai/generate' | 'ai/explain';
			data: TelemetryEvents['ai/generate' | 'ai/explain'];
		},
		options?: {
			cancellation?: CancellationToken;
			generating?: Deferred<AIModel>;
			progress?: ProgressOptions;
		},
	): Promise<AIRequestResult | undefined> {
		const model = await this.getModel(undefined, source);
		if (model == null) {
			options?.generating?.cancel();
			return undefined;
		}

		const telementry = getTelemetryInfo(model);

		const confirmed = await showConfirmAIProviderToS(this.container.storage);
		if (!confirmed) {
			this.container.telemetry.sendEvent(
				telementry.key,
				{ ...telementry.data, 'failed.reason': 'user-declined' },
				source,
			);

			options?.generating?.cancel();
			return undefined;
		}

		if (options?.cancellation?.isCancellationRequested) {
			this.container.telemetry.sendEvent(
				telementry.key,
				{ ...telementry.data, 'failed.reason': 'user-cancelled' },
				source,
			);

			options?.generating?.cancel();
			return undefined;
		}

		const context = await getContext();
		const promise = this._provider!.sendRequest(action, context, model, telementry.data, {
			cancellation: options?.cancellation,
		});
		options?.generating?.fulfill(model);

		const start = Date.now();
		try {
			const result = await (options?.progress != null
				? window.withProgress({ ...options.progress, title: getProgressTitle(model) }, () => promise)
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
			this.container.telemetry.sendEvent(
				telementry.key,
				{
					...telementry.data,
					duration: Date.now() - start,
					...(ex instanceof CancellationError
						? { 'failed.reason': 'user-cancelled' }
						: { 'failed.reason': 'error', 'failed.error': String(ex) }),
				},
				source,
			);

			if (ex instanceof GkAIError) {
				switch (ex.reason) {
					case GkAIErrorReason.Entitlement:
						void window.showErrorMessage(
							'You do not have the required entitlement or are over the limits to use this AI feature',
						);
						return undefined;
					case GkAIErrorReason.RequestTooLarge:
						void window.showErrorMessage(
							'Your request is too large. Please reduce the size of your request and try again.',
						);
						return undefined;
					case GkAIErrorReason.UserQuotaExceeded: {
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
					case GkAIErrorReason.RateLimitExceeded:
						void window.showErrorMessage(
							'Rate limit exceeded. Please wait a few moments and try again later.',
						);
						return undefined;
					case GkAIErrorReason.ServiceCapacityExceeded: {
						void window.showErrorMessage(
							'GitKraken AI is temporarily unable to process your request due to high volume. Please wait a few moments and try again. If this issue persists, please contact support.',
							'OK',
						);
						return undefined;
					}
				}

				return undefined;
			}

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
			const diffProvider = this.container.git.diff(changesOrRepo.uri);
			let diff = await diffProvider.getDiff?.(uncommittedStaged);
			if (!diff?.contents) {
				diff = await diffProvider.getDiff?.(uncommitted);
				if (!diff?.contents) throw new Error('No changes to generate a commit message from.');
			}
			if (options?.cancellation?.isCancellationRequested) return undefined;

			changes = diff.contents;
		}

		return changes;
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
		'GitLens AI features can send code snippets, diffs, and other context to your selected AI provider for analysis. This may contain sensitive information.',
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
