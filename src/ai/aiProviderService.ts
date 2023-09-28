import type { Disposable, MessageItem, ProgressOptions } from 'vscode';
import { Uri, window } from 'vscode';
import type { AIProviders } from '../constants';
import type { Container } from '../container';
import type { GitCommit } from '../git/models/commit';
import { assertsCommitHasFullDetails, isCommit } from '../git/models/commit';
import { uncommittedStaged } from '../git/models/constants';
import type { GitRevisionReference } from '../git/models/reference';
import type { Repository } from '../git/models/repository';
import { isRepository } from '../git/models/repository';
import { configuration } from '../system/configuration';
import type { Storage } from '../system/storage';
import { AnthropicProvider } from './anthropicProvider';
import { OpenAIProvider } from './openaiProvider';

export interface AIProvider extends Disposable {
	readonly id: AIProviders;
	readonly name: string;

	generateCommitMessage(diff: string, options?: { context?: string }): Promise<string | undefined>;
	explainChanges(message: string, diff: string): Promise<string | undefined>;
}

export class AIProviderService implements Disposable {
	private _provider: AIProvider | undefined;

	private get provider() {
		const providerId = configuration.get('ai.experimental.provider');
		if (providerId === this._provider?.id) return this._provider;

		this._provider?.dispose();

		if (providerId === 'anthropic') {
			this._provider = new AnthropicProvider(this.container);
		} else {
			this._provider = new OpenAIProvider(this.container);
		}

		return this._provider;
	}

	constructor(private readonly container: Container) {}

	dispose() {
		this._provider?.dispose();
	}

	get providerId() {
		return this.provider?.id;
	}

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

		const diff = await this.container.git.getDiff(repository.uri, uncommittedStaged);
		if (diff == null) throw new Error('No staged changes to generate a commit message from.');

		const provider = this.provider;

		const confirmed = await confirmAIProviderToS(provider, this.container.storage);
		if (!confirmed) return undefined;

		if (options?.progress != null) {
			return window.withProgress(options.progress, async () =>
				provider.generateCommitMessage(diff.contents, { context: options?.context }),
			);
		}
		return provider.generateCommitMessage(diff.contents, { context: options?.context });
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
		if (diff == null) throw new Error('No changes found to explain.');

		const provider = this.provider;

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
