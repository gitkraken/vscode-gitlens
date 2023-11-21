import type { CancellationToken, Disposable, MessageItem, ProgressOptions } from 'vscode';
import { Uri, window } from 'vscode';
import type { AIProviders } from '../constants';
import type { Container } from '../container';
import type { GitCommit } from '../git/models/commit';
import { assertsCommitHasFullDetails, isCommit } from '../git/models/commit';
import { uncommitted, uncommittedStaged } from '../git/models/constants';
import type { GitRevisionReference } from '../git/models/reference';
import type { Repository } from '../git/models/repository';
import { isRepository } from '../git/models/repository';
import { showAIModelPicker } from '../quickpicks/aiModelPicker';
import { configuration } from '../system/configuration';
import type { Storage } from '../system/storage';
import type { AnthropicModels } from './anthropicProvider';
import { AnthropicProvider } from './anthropicProvider';
import type { OpenAIModels } from './openaiProvider';
import { OpenAIProvider } from './openaiProvider';

export interface AIProvider<Provider extends AIProviders = AIProviders> extends Disposable {
	readonly id: Provider;
	readonly name: string;

	generateCommitMessage(diff: string, options?: { context?: string }): Promise<string | undefined>;
	explainChanges(message: string, diff: string): Promise<string | undefined>;
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

	public async generateCommitMessage(
		changes: string[],
		options?: { cancellation?: CancellationToken; context?: string; progress?: ProgressOptions },
	): Promise<string | undefined>;
	public async generateCommitMessage(
		repoPath: Uri,
		options?: { cancellation?: CancellationToken; context?: string; progress?: ProgressOptions },
	): Promise<string | undefined>;
	public async generateCommitMessage(
		repository: Repository,
		options?: { cancellation?: CancellationToken; context?: string; progress?: ProgressOptions },
	): Promise<string | undefined>;
	public async generateCommitMessage(
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
				provider.generateCommitMessage(changes, { context: options?.context }),
			);
		}
		return provider.generateCommitMessage(changes, { context: options?.context });
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
				provider.explainChanges(commit!.message!, diff.contents),
			);
		}
		return provider.explainChanges(commit.message, diff.contents);
	}

	reset() {
		const { providerId } = this;
		if (providerId == null) return;

		void this.container.storage.deleteSecret(`gitlens.${providerId}.key`);

		void this.container.storage.delete(`confirm:ai:tos:${providerId}`);
		void this.container.storage.deleteWorkspace(`confirm:ai:tos:${providerId}`);
	}

	supports(provider: AIProviders | string) {
		return provider === 'anthropic' || provider === 'openai';
	}

	async switchProvider() {
		void (await this.getOrChooseProvider(true));
	}

	private async getOrChooseProvider(force?: boolean): Promise<AIProvider | undefined> {
		let providerId = !force ? configuration.get('ai.experimental.provider') || undefined : undefined;
		if (providerId == null || !this.supports(providerId)) {
			const pick = await showAIModelPicker();
			if (pick == null) return undefined;

			providerId = pick.provider;
			await configuration.updateEffective('ai.experimental.provider', providerId);
			await configuration.updateEffective(`ai.experimental.${providerId}.model`, pick.model);
		}

		if (providerId !== this._provider?.id) {
			this._provider?.dispose();

			if (providerId === 'anthropic') {
				this._provider = new AnthropicProvider(this.container);
			} else {
				this._provider = new OpenAIProvider(this.container);
				if (providerId !== 'openai') {
					await configuration.updateEffective('ai.experimental.provider', 'openai');
				}
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
		`This GitLens experimental feature requires sending a diff of the code changes to ${provider.name}. This may contain sensitive information.\n\nDo you want to continue?`,
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

export function getMaxCharacters(model: OpenAIModels | AnthropicModels, outputLength: number): number {
	const tokensPerCharacter = 3.1;

	let tokens;
	switch (model) {
		case 'gpt-4-1106-preview': // 128,000 tokens (4,096 max output tokens)
			tokens = 128000;
			break;
		case 'gpt-4-32k': // 32,768 tokens
		case 'gpt-4-32k-0613':
			tokens = 32768;
			break;
		case 'gpt-4': // 8,192 tokens
		case 'gpt-4-0613':
			tokens = 8192;
			break;
		case 'gpt-3.5-turbo-1106': // 16,385 tokens (4,096 max output tokens)
			tokens = 16385;
			break;
		case 'gpt-3.5-turbo-16k': // 16,385 tokens; Will point to gpt-3.5-turbo-1106 starting Dec 11, 2023
			tokens = 16385;
			break;
		case 'gpt-3.5-turbo': // Will point to gpt-3.5-turbo-1106 starting Dec 11, 2023
			tokens = 4096;
			break;
		case 'claude-2.1': // 200,000 tokens
			tokens = 200000;
			break;
		case 'claude-2': // 100,000 tokens
		case 'claude-instant-1':
			tokens = 100000;
			break;
		default: // 4,096 tokens
			tokens = 4096;
			break;
	}

	const max = tokens * tokensPerCharacter - outputLength / tokensPerCharacter;
	return Math.floor(max - max * 0.1);
}
