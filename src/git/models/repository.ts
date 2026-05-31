/* eslint-disable @typescript-eslint/no-restricted-imports -- TODO need to deal with sharing rich class shapes to webviews */
import type { ConfigurationChangeEvent, Uri, WorkspaceFolder } from 'vscode';
import { Disposable } from 'vscode';
import type { GitDir, RepositoryChange, RepositoryWorkingTreeChangeEvent } from '@gitlens/git/models/repository.js';
import { Repository } from '@gitlens/git/models/repository.js';
import { RepositoryChangeEvent } from '@gitlens/git/models/repositoryChangeEvent.js';
import type { GitProviderDescriptor } from '@gitlens/git/providers/types.js';
import { getRepositoryOrWorktreePath } from '@gitlens/git/utils/repository.utils.js';
import { debug, loggable, logName } from '@gitlens/utils/decorators/log.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
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
	private _opened: boolean;
	private _watchSubscription: UnifiedDisposable | undefined;

	constructor(
		private readonly container: Container,
		provider: GitProviderDescriptor,
		public readonly folder: WorkspaceFolder | undefined,
		uri: Uri,
		gitDir: GitDir | undefined,
		root: boolean,
		opened: boolean,
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
			id: asRepoComparisonKey(uri),
			index: folder?.index ?? container.git.repositoryCount,
			gitDir: gitDir,
			name: name,
			path: getRepositoryOrWorktreePath(uri),
			provider: provider,
			root: root,
			uri: uri,
			watchService: container.git.watchService,
		});

		this._opened = opened;
		// Caller owns the watch lifecycle: hold a watch lease while open (see the `opened` setter)
		if (opened) {
			this._watchSubscription = this.watch();
		}

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

		// Track initial access when repository is opened
		if (opened) {
			queueMicrotask(() => void this.git.branches.onCurrentBranchAccessed?.());
		}
	}

	override dispose(): void {
		this._watchSubscription?.dispose();
		this._watchSubscription = undefined;
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

	/** Whether the repository is open (visible) in the current VS Code window. The model is watched while open. */
	get opened(): boolean {
		return this._opened;
	}
	set opened(value: boolean) {
		if (this._opened === value) return;

		this._opened = value;

		using scope = maybeStartScopedLogger(`${getLoggableName(this)}.opened`);
		scope?.trace(`setting opened=${value}`);

		if (value) {
			// Opening — acquire a watch lease (no-op if already held), notify, clear close intent, track access
			this._watchSubscription ??= this.watch();
			// Force-fire (bypasses the watch session debounce) so the open is delivered immediately and is
			// observable even for gitDir-less/virtual repos that have no session — symmetric with the close path.
			this.fireChange('opened', true);
			// Repo is open — clear any prior user-close intent so the flag never lingers (only meaningful while closed).
			this._closedByScm = false;
			queueMicrotask(() => void this.git.branches.onCurrentBranchAccessed?.());
		} else {
			// Closing — notify immediately (force-fire bypasses the watch session) then release the watch lease
			this.fireChange('closed', true);
			this._watchSubscription?.dispose();
			this._watchSubscription = undefined;
		}
	}

	private _closedByScm = false;
	/** Whether the user closed this repository in VS Code's built-in SCM (mirrored from its `onDidCloseRepository`). */
	get closedByScm(): boolean {
		return this._closedByScm;
	}
	set closedByScm(value: boolean) {
		this._closedByScm = value;
	}

	get starred(): boolean {
		const starred = this.container.storage.getWorkspace('starred:repositories');
		return starred?.[this.id] === true;
	}

	async getLastFetched(): Promise<number> {
		const lastFetched = await this.git.getLastFetched();
		// `Math.max` so an in-memory bump from `markFetched()` isn't clobbered by a stale FETCH_HEAD
		// mtime (git skips the rewrite when all refs are up-to-date); FS still wins when newer.
		if (lastFetched != null) {
			this._lastFetched = Math.max(this._lastFetched ?? 0, lastFetched);
		}

		return this._lastFetched ?? 0;
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
