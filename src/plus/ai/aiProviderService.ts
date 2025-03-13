import type { CancellationToken, Disposable, Event, MessageItem, ProgressOptions } from 'vscode';
import { env, EventEmitter, window } from 'vscode';
import type { AIPrimaryProviders, AIProviderAndModel, AIProviders, SupportedAIModels } from '../../constants.ai';
import { primaryAIProviders } from '../../constants.ai';
import type { AIGenerateDraftEventData, Source, TelemetryEvents } from '../../constants.telemetry';
import type { Container } from '../../container';
import { CancellationError } from '../../errors';
import type { GitCommit } from '../../git/models/commit';
import { isCommit } from '../../git/models/commit';
import type { GitRevisionReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { uncommitted, uncommittedStaged } from '../../git/models/revision';
import { assertsCommitHasFullDetails } from '../../git/utils/commit.utils';
import { showAIModelPicker } from '../../quickpicks/aiModelPicker';
import { configuration } from '../../system/-webview/configuration';
import type { Storage } from '../../system/-webview/storage';
import { supportedInVSCodeVersion } from '../../system/-webview/vscode';
import { debounce } from '../../system/function/debounce';
import { map } from '../../system/iterable';
import type { Lazy } from '../../system/lazy';
import { lazy } from '../../system/lazy';
import type { Deferred } from '../../system/promise';
import { getSettledValue } from '../../system/promise';
import type { ServerConnection } from '../gk/serverConnection';
import type { AIActionType, AIModel, AIModelDescriptor } from './models/model';
import type { PromptTemplateContext } from './models/promptTemplates';
import type { AIProvider } from './models/provider';

export interface AIResult {
	readonly summary: string;
	readonly body: string;
}

export interface AIGenerateChangelogChange {
	readonly message: string;
	readonly issues: readonly { readonly id: string; readonly url: string; readonly title: string | undefined }[];
}

interface AIProviderConstructor<Provider extends AIProviders = AIProviders> {
	new (container: Container, connection: ServerConnection): AIProvider<Provider>;
}

// Order matters for sorting the picker
const _supportedProviderTypes = new Map<AIProviders, Lazy<Promise<AIProviderConstructor>>>([
	...(configuration.getAny('gitkraken.ai.enabled', undefined, false)
		? [
				[
					'gitkraken',
					lazy(
						async () =>
							(await import(/* webpackChunkName: "ai" */ './gitkrakenProvider')).GitKrakenProvider,
					),
				],
		  ]
		: []),
	...(supportedInVSCodeVersion('language-models')
		? [
				[
					'vscode',
					lazy(async () => (await import(/* webpackChunkName: "ai" */ './vscodeProvider')).VSCodeAIProvider),
				],
		  ]
		: ([] as any)),
	['openai', lazy(async () => (await import(/* webpackChunkName: "ai" */ './openaiProvider')).OpenAIProvider)],
	[
		'anthropic',
		lazy(async () => (await import(/* webpackChunkName: "ai" */ './anthropicProvider')).AnthropicProvider),
	],
	['gemini', lazy(async () => (await import(/* webpackChunkName: "ai" */ './geminiProvider')).GeminiProvider)],
	['deepseek', lazy(async () => (await import(/* webpackChunkName: "ai" */ './deepSeekProvider')).DeepSeekProvider)],
	['xai', lazy(async () => (await import(/* webpackChunkName: "ai" */ './xaiProvider')).XAIProvider)],
	[
		'github',
		lazy(async () => (await import(/* webpackChunkName: "ai" */ './githubModelsProvider')).GitHubModelsProvider),
	],
	[
		'huggingface',
		lazy(async () => (await import(/* webpackChunkName: "ai" */ './huggingFaceProvider')).HuggingFaceProvider),
	],
]);

export interface AIModelChangeEvent {
	readonly model: AIModel | undefined;
}

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

	get currentProviderId(): AIProviders | undefined {
		return this._provider?.id;
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
			const type = _supportedProviderTypes.get(providerId);
			if (type == null) return [];

			return loadModels(type);
		}

		const modelResults = await Promise.allSettled(map(_supportedProviderTypes.values(), t => loadModels(t)));

		return modelResults.flatMap(m => getSettledValue(m, []));
	}

	async getModel(options?: { force?: boolean; silent?: boolean }, source?: Source): Promise<AIModel | undefined> {
		const cfg = this.getConfiguredModel();
		if (!options?.force && cfg?.provider != null && cfg?.model != null) {
			const model = await this.getOrUpdateModel(cfg.provider, cfg.model);
			if (model != null) return model;
		}

		if (options?.silent) return undefined;

		const pick = await showAIModelPicker(this.container, cfg);
		if (pick == null) return undefined;

		const model = await this.getOrUpdateModel(pick.model);

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

		return model;
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

			const type = await _supportedProviderTypes.get(providerId)?.value;
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

	async explainCommit(
		commitOrRevision: GitRevisionReference | GitCommit,
		sourceContext: Source & { type: TelemetryEvents['ai/explain']['changeType'] },
		options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
	): Promise<AIResult | undefined> {
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
		return result != null ? parseResult(result) : undefined;
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
	): Promise<AIResult | undefined> {
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
		return result != null ? parseResult(result) : undefined;
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
	): Promise<AIResult | undefined> {
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
		return result != null ? parseResult(result) : undefined;
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
	): Promise<AIResult | undefined> {
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
		return result != null ? parseResult(result) : undefined;
	}

	async generateChangelog(
		changes: Lazy<Promise<AIGenerateChangelogChange[]>>,
		source: Source,
		options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
	): Promise<string | undefined> {
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
		return result;
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
	): Promise<string | undefined> {
		const { confirmed, model } = await getModelAndConfirmAIProviderToS(
			'diff',
			source,
			this,
			this.container.storage,
		);
		if (model == null) {
			options?.generating?.cancel();
			return undefined;
		}

		const telementry = getTelemetryInfo(model);

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

			telementry.data['output.length'] = result?.length;
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

	supports(provider: AIProviders | string): boolean {
		return _supportedProviderTypes.has(provider as AIProviders);
	}

	switchModel(source?: Source): Promise<AIModel | undefined> {
		return this.getModel({ force: true }, source);
	}
}

async function getModelAndConfirmAIProviderToS(
	confirmationType: 'data' | 'diff',
	source: Source,
	service: AIProviderService,
	storage: Storage,
): Promise<{ confirmed: boolean; model: AIModel | undefined }> {
	let model = await service.getModel(undefined, source);
	while (true) {
		if (model == null) return { confirmed: false, model: model };

		const confirmed =
			storage.get(`confirm:ai:tos:${model.provider.id}`, false) ||
			storage.getWorkspace(`confirm:ai:tos:${model.provider.id}`, false);
		if (confirmed) return { confirmed: true, model: model };

		const accept: MessageItem = { title: 'Continue' };
		const switchModel: MessageItem = { title: 'Switch Model' };
		const acceptWorkspace: MessageItem = { title: 'Always for this Workspace' };
		const acceptAlways: MessageItem = { title: 'Always' };
		const decline: MessageItem = { title: 'Cancel', isCloseAffordance: true };

		const result = await window.showInformationMessage(
			`GitLens AI features require sending ${
				confirmationType === 'data' ? 'data' : 'a diff of the code changes'
			} to ${
				model.provider.name
			} for analysis. This may contain sensitive information.\n\nDo you want to continue?`,
			{ modal: true },
			accept,
			switchModel,
			acceptWorkspace,
			acceptAlways,
			decline,
		);

		if (result === switchModel) {
			model = await service.switchModel(source);
			continue;
		}

		if (result === accept) return { confirmed: true, model: model };

		if (result === acceptWorkspace) {
			void storage.storeWorkspace(`confirm:ai:tos:${model.provider.id}`, true).catch();
			return { confirmed: true, model: model };
		}

		if (result === acceptAlways) {
			void storage.store(`confirm:ai:tos:${model.provider.id}`, true).catch();
			return { confirmed: true, model: model };
		}

		return { confirmed: false, model: model };
	}
}

function parseResult(result: string): AIResult {
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

function splitMessageIntoSummaryAndBody(message: string): AIResult {
	const index = message.indexOf('\n');
	if (index === -1) return { summary: message, body: '' };

	return {
		summary: message.substring(0, index).trim(),
		body: message.substring(index + 1).trim(),
	};
}

function isPrimaryAIProvider(provider: AIProviders): provider is AIPrimaryProviders {
	return primaryAIProviders.includes(provider as AIPrimaryProviders);
}

function isPrimaryAIProviderModel(model: AIModel): model is AIModel<AIPrimaryProviders, AIProviderAndModel> {
	return isPrimaryAIProvider(model.provider.id);
}
