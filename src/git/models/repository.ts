/* eslint-disable @typescript-eslint/no-restricted-imports -- TODO need to deal with sharing rich class shapes to webviews */
import type { ConfigurationChangeEvent, Uri, WorkspaceFolder } from 'vscode';
import { Disposable } from 'vscode';
import type { GitDir, RepositoryChange, RepositoryWorkingTreeChangeEvent } from '@gitlens/git/models/repository.js';
import { Repository } from '@gitlens/git/models/repository.js';
import { RepositoryChangeEvent } from '@gitlens/git/models/repositoryChangeEvent.js';
import type { GitProviderDescriptor } from '@gitlens/git/providers/types.js';
import { getRepositoryOrWorktreePath } from '@gitlens/git/utils/repository.utils.js';
import { debug, loggable, logName } from '@gitlens/utils/decorators/log.js';
import { getLoggableName } from '@gitlens/utils/logger.js';
import { maybeStartScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { updateRecordValue } from '@gitlens/utils/object.js';
import { basename } from '@gitlens/utils/path.js';
import type { Container } from '../../container.js';
import type { RepoComparisonKey } from '../../repositories.js';
import { asRepoComparisonKey } from '../../repositories.js';
import { configuration } from '../../system/-webview/configuration.js';
import type { GitRepositoryService } from '../gitRepositoryService.js';

export { RepositoryChangeEvent };
export type { RepositoryChange, RepositoryWorkingTreeChangeEvent };

@logName(r => `GlRepository(${r.id}|${r.instance})`)
@loggable()
export class GlRepository extends Repository implements Disposable {
	declare readonly id: RepoComparisonKey;

	private readonly _disposable: Disposable;

	constructor(
		private readonly container: Container,
		provider: GitProviderDescriptor,
		public readonly folder: WorkspaceFolder | undefined,
		uri: Uri,
		gitDir: GitDir | undefined,
		root: boolean,
		closed: boolean = false,
		suspended: boolean = false,
	) {
		// Compute name
		let name: string;
		if (folder != null) {
			if (root) {
				name = folder.name;
			} else {
				const relativePath = container.git.getRelativePath(uri, folder.uri);
				name = relativePath ? relativePath : folder.name;
			}
		} else {
			name = basename(uri.path);
		}

		super({
			closed: closed,
			id: asRepoComparisonKey(uri),
			index: folder?.index ?? container.git.repositoryCount,
			gitDir: gitDir,
			name: name,
			path: getRepositoryOrWorktreePath(uri),
			provider: provider,
			root: root,
			suspended: suspended,
			uri: uri,
			watchService: container.git.watchService,
		});

		// Extension-only disposables
		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			this.container.events.on('git:cache:reset', e => {
				if (!e.data.repoPath || e.data.repoPath === this.path) {
					if (e.data.types?.includes('providers')) {
						this.fireChange('remoteProviders');
					}
				}
			}),
			this.container.events.on('git:repo:change', e => {
				if (e.data.repoPath === this.path) {
					this.fireChange(...e.data.changes);
				}
			}),
		);

		this.onConfigurationChanged();
		if (this._orderByLastFetched) {
			void this.getLastFetched();
		}

		// Track initial access when repository is opened (not closed)
		if (!closed) {
			queueMicrotask(() => void this.git.branches.onCurrentBranchAccessed?.());
		}
	}

	override dispose(): void {
		super.dispose();
		this._disposable.dispose();
	}

	get git(): GitRepositoryService {
		return this.container.git.getRepositoryService(this.uri);
	}

	private _orderByLastFetched = false;
	get orderByLastFetched(): boolean {
		return this._orderByLastFetched;
	}

	get starred(): boolean {
		const starred = this.container.storage.getWorkspace('starred:repositories');
		return starred?.[this.id] === true;
	}

	async getLastFetched(): Promise<number> {
		const lastFetched = await this.git.getLastFetchedTimestamp();
		// If we don't get a number, assume the fetch failed, and don't update the timestamp
		if (lastFetched != null) {
			this._lastFetched = lastFetched;
		}

		return this._lastFetched ?? 0;
	}

	protected override onClosedChanged(closed: boolean): void {
		using scope = maybeStartScopedLogger(`${getLoggableName(this)}.closed`);
		scope?.trace(`setting closed=${closed}`);

		if (!closed) {
			// Track access when repository is reopened
			queueMicrotask(() => void this.git.branches.onCurrentBranchAccessed?.());
		}
		super.onClosedChanged(closed);
	}

	protected override onFetchHeadChanged(): void {
		if (this._orderByLastFetched) {
			setTimeout(() => void this.getLastFetched(), 1);
		}
		super.onFetchHeadChanged();
	}

	protected override onWorkingTreeChanged(paths: ReadonlySet<string>): void {
		queueMicrotask(() => this.git.branches.onCurrentBranchModified?.());
		super.onWorkingTreeChanged(paths);
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'sortRepositoriesBy')) {
			this._orderByLastFetched = configuration.get('sortRepositoriesBy')?.startsWith('lastFetched:') ?? false;
		}

		if (e != null && configuration.changed(e, 'remotes', this.folder?.uri)) {
			this.fireChange('remotes');
		}
	}

	static override is(repository: unknown): repository is GlRepository {
		return repository instanceof GlRepository;
	}

	@debug()
	static starRepository(container: Container, repository: GlRepository): Promise<void> {
		return this.updateStarred(container, repository, true);
	}

	@debug()
	static unstarRepository(container: Container, repository: GlRepository): Promise<void> {
		return this.updateStarred(container, repository, false);
	}

	private static async updateStarred(container: Container, repository: GlRepository, star: boolean) {
		let starred = container.storage.getWorkspace('starred:repositories');
		starred = updateRecordValue(starred, repository.id, star);
		await container.storage.storeWorkspace('starred:repositories', starred);

		repository.fireChange('starred');
	}
}
