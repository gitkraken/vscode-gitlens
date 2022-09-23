import type { ColorTheme, ConfigurationChangeEvent, Disposable, Event, StatusBarItem } from 'vscode';
import { CancellationTokenSource, EventEmitter, MarkdownString, StatusBarAlignment, ViewColumn, window } from 'vscode';
import { getAvatarUri } from '../../../avatars';
import { parseCommandContext } from '../../../commands/base';
import { GitActions } from '../../../commands/gitCommands.actions';
import { configuration } from '../../../configuration';
import { Commands, ContextKeys } from '../../../constants';
import type { Container } from '../../../container';
import { setContext } from '../../../context';
import { PlusFeatures } from '../../../features';
import type { GitCommit } from '../../../git/models/commit';
import { GitGraphRowType } from '../../../git/models/graph';
import type { GitGraph } from '../../../git/models/graph';
import type { Repository, RepositoryChangeEvent } from '../../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository';
import type { GitSearch } from '../../../git/search';
import { getSearchPatternComparisonKey } from '../../../git/search';
import { registerCommand } from '../../../system/command';
import { gate } from '../../../system/decorators/gate';
import { debug } from '../../../system/decorators/log';
import type { Deferrable } from '../../../system/function';
import { debounce } from '../../../system/function';
import { first } from '../../../system/iterable';
import { updateRecordValue } from '../../../system/object';
import { isDarkTheme, isLightTheme } from '../../../system/utils';
import { RepositoryFolderNode } from '../../../views/nodes/viewNode';
import type { IpcMessage } from '../../../webviews/protocol';
import { onIpc } from '../../../webviews/protocol';
import { WebviewBase } from '../../../webviews/webviewBase';
import type { SubscriptionChangeEvent } from '../../subscription/subscriptionService';
import { ensurePlusFeaturesEnabled } from '../../subscription/utils';
import type {
	DismissBannerParams,
	EnsureCommitParams,
	GetMissingAvatarsParams,
	GetMoreCommitsParams,
	GraphComponentConfig,
	GraphRepository,
	SearchCommitsParams,
	State,
	UpdateColumnParams,
	UpdateSelectedRepositoryParams,
	UpdateSelectionParams,
} from './protocol';
import {
	DidChangeAvatarsNotificationType,
	DidChangeCommitsNotificationType,
	DidChangeGraphConfigurationNotificationType,
	DidChangeNotificationType,
	DidChangeSelectionNotificationType,
	DidChangeSubscriptionNotificationType,
	DidEnsureCommitNotificationType,
	DidSearchCommitsNotificationType,
	DismissBannerCommandType,
	EnsureCommitCommandType,
	GetMissingAvatarsCommandType,
	GetMoreCommitsCommandType,
	SearchCommitsCommandType,
	UpdateColumnCommandType,
	UpdateSelectedRepositoryCommandType,
	UpdateSelectionCommandType,
} from './protocol';

export interface ShowCommitInGraphCommandArgs {
	repoPath: string;
	sha: string;
	preserveFocus?: boolean;
}

export interface GraphSelectionChangeEvent {
	readonly selection: GitCommit[];
}

export class GraphWebview extends WebviewBase<State> {
	private _onDidChangeSelection = new EventEmitter<GraphSelectionChangeEvent>();
	get onDidChangeSelection(): Event<GraphSelectionChangeEvent> {
		return this._onDidChangeSelection.event;
	}

	private _repository?: Repository;
	get repository(): Repository | undefined {
		return this._repository;
	}

	set repository(value: Repository | undefined) {
		if (this._repository === value) return;

		this._repositoryEventsDisposable?.dispose();
		this._repository = value;
		this.resetRepositoryState();

		if (value != null) {
			this._repositoryEventsDisposable = value.onDidChange(this.onRepositoryChanged, this);
		}

		this.updateState();
	}

	private _selection: readonly GitCommit[] | undefined;
	get selection(): readonly GitCommit[] | undefined {
		return this._selection;
	}

	private _etagSubscription?: number;
	private _etagRepository?: number;
	private _graph?: GitGraph;
	private _pendingNotifyCommits: boolean = false;
	private _search: GitSearch | undefined;
	private _searchCancellation: CancellationTokenSource | undefined;
	private _selectedSha?: string;
	private _selectedRows: { [sha: string]: true } = {};
	private _repositoryEventsDisposable: Disposable | undefined;

	private _statusBarItem: StatusBarItem | undefined;
	private _theme: ColorTheme | undefined;

	private previewBanner?: boolean;
	private trialBanner?: boolean;

	constructor(container: Container) {
		super(
			container,
			'gitlens.graph',
			'graph.html',
			'images/gitlens-icon.png',
			'Commit Graph',
			'graphWebview',
			Commands.ShowGraphPage,
		);
		this.disposables.push(
			configuration.onDidChange(this.onConfigurationChanged, this),
			{
				dispose: () => {
					this._statusBarItem?.dispose();
					void this._repositoryEventsDisposable?.dispose();
				},
			},
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			registerCommand(Commands.ShowCommitInGraph, (args: ShowCommitInGraphCommandArgs) => {
				this.repository = this.container.git.getRepository(args.repoPath);
				this.setSelectedRows(args.sha);

				if (this._panel == null) {
					void this.show({ preserveFocus: args.preserveFocus });
				} else {
					if (this._graph?.ids.has(args.sha)) {
						void this.notifyDidChangeSelection();
						return;
					}

					this.setSelectedRows(args.sha);
					void this.onGetMoreCommits({ sha: args.sha });
				}
			}),
		);

		this.onConfigurationChanged();
	}

	override async show(options?: { column?: ViewColumn; preserveFocus?: boolean }, ...args: unknown[]): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;

		if (this.container.git.repositoryCount > 1) {
			const [contexts] = parseCommandContext(Commands.ShowGraphPage, undefined, ...args);
			const context = Array.isArray(contexts) ? contexts[0] : contexts;

			if (context.type === 'scm' && context.scm.rootUri != null) {
				const repository = this.container.git.getRepository(context.scm.rootUri);
				if (repository != null) {
					this.repository = repository;
				}
			} else if (context.type === 'viewItem' && context.node instanceof RepositoryFolderNode) {
				this.repository = context.node.repo;
			}

			if (this.repository != null) {
				this.updateState();
			}
		}

		return super.show({ column: ViewColumn.Active, ...options }, ...args);
	}

	protected override refresh(force?: boolean): Promise<void> {
		this.resetRepositoryState();
		return super.refresh(force);
	}

	protected override async includeBootstrap(): Promise<State> {
		return this.getState(true);
	}

	protected override registerCommands(): Disposable[] {
		return [registerCommand(Commands.RefreshGraphPage, () => this.refresh(true))];
	}

	protected override onInitializing(): Disposable[] | undefined {
		this._theme = window.activeColorTheme;
		return [window.onDidChangeActiveColorTheme(this.onThemeChanged, this)];
	}

	protected override onReady(): void {
		if (this._pendingNotifyCommits) {
			void this.notifyDidChangeCommits();
		}
	}

	protected override onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case DismissBannerCommandType.method:
				onIpc(DismissBannerCommandType, e, params => this.dismissBanner(params));
				break;
			case EnsureCommitCommandType.method:
				onIpc(EnsureCommitCommandType, e, params => this.onEnsureCommit(params, e.completionId));
				break;
			case GetMissingAvatarsCommandType.method:
				onIpc(GetMissingAvatarsCommandType, e, params => this.onGetMissingAvatars(params));
				break;
			case GetMoreCommitsCommandType.method:
				onIpc(GetMoreCommitsCommandType, e, params => this.onGetMoreCommits(params));
				break;
			case SearchCommitsCommandType.method:
				onIpc(SearchCommitsCommandType, e, params => this.onSearchCommits(params, e.completionId));
				break;
			case UpdateColumnCommandType.method:
				onIpc(UpdateColumnCommandType, e, params => this.onColumnUpdated(params));
				break;
			case UpdateSelectedRepositoryCommandType.method:
				onIpc(UpdateSelectedRepositoryCommandType, e, params => this.onRepositorySelectionChanged(params));
				break;
			case UpdateSelectionCommandType.method:
				onIpc(UpdateSelectionCommandType, e, debounce(this.onSelectionChanged.bind(this), 100));
				break;
		}
	}

	protected override onFocusChanged(focused: boolean): void {
		if (focused) {
			// If we are becoming focused, delay it a bit to give the UI time to update
			setTimeout(() => void setContext(ContextKeys.GraphPageFocused, focused), 0);

			if (this.selection != null) {
				void GitActions.Commit.showDetailsView(this.selection[0], { pin: true, preserveFocus: true });
			}

			return;
		}

		void setContext(ContextKeys.GraphPageFocused, focused);
	}

	protected override onVisibilityChanged(visible: boolean): void {
		if (visible && this.repository != null && this.repository.etag !== this._etagRepository) {
			this.updateState(true);
		}
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'graph.statusBar.enabled') || configuration.changed(e, 'plusFeatures.enabled')) {
			const enabled = configuration.get('graph.statusBar.enabled') && configuration.get('plusFeatures.enabled');
			if (enabled) {
				if (this._statusBarItem == null) {
					this._statusBarItem = window.createStatusBarItem(
						'gitlens.graph',
						StatusBarAlignment.Left,
						10000 - 3,
					);
					this._statusBarItem.name = 'GitLens Commit Graph';
					this._statusBarItem.command = Commands.ShowGraphPage;
					this._statusBarItem.text = '$(gitlens-graph)';
					this._statusBarItem.tooltip = new MarkdownString(
						'Visualize commits on the all-new Commit Graph ✨',
					);
					this._statusBarItem.accessibilityInformation = {
						label: `Show the GitLens Commit Graph`,
					};
				}
				this._statusBarItem.show();
			} else {
				this._statusBarItem?.dispose();
				this._statusBarItem = undefined;
			}
		}

		if (configuration.changed(e, 'graph.commitOrdering')) {
			this.updateState();

			return;
		}

		if (
			configuration.changed(e, 'defaultDateFormat') ||
			configuration.changed(e, 'defaultDateStyle') ||
			configuration.changed(e, 'advanced.abbreviatedShaLength') ||
			configuration.changed(e, 'graph.avatars') ||
			configuration.changed(e, 'graph.dateFormat') ||
			configuration.changed(e, 'graph.dateStyle') ||
			configuration.changed(e, 'graph.highlightRowsOnRefHover')
		) {
			void this.notifyDidChangeGraphConfiguration();
		}
	}

	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (
			!e.changed(
				RepositoryChange.Config,
				RepositoryChange.Heads,
				// RepositoryChange.Index,
				RepositoryChange.Remotes,
				// RepositoryChange.RemoteProviders,
				RepositoryChange.Stash,
				RepositoryChange.Status,
				RepositoryChange.Tags,
				RepositoryChange.Unknown,
				RepositoryChangeComparisonMode.Any,
			)
		) {
			this._etagRepository = e.repository.etag;
			return;
		}

		this.updateState();
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		if (e.etag === this._etagSubscription) return;

		this._etagSubscription = e.etag;
		void this.notifyDidChangeSubscription();
	}

	private onThemeChanged(theme: ColorTheme) {
		if (this._theme != null) {
			if (
				(isDarkTheme(theme) && isDarkTheme(this._theme)) ||
				(isLightTheme(theme) && isLightTheme(this._theme))
			) {
				return;
			}
		}

		this._theme = theme;
		this.updateState();
	}

	private dismissBanner(e: DismissBannerParams) {
		if (e.key === 'preview') {
			this.previewBanner = false;
		} else if (e.key === 'trial') {
			this.trialBanner = false;
		}

		let banners = this.container.storage.getWorkspace('graph:banners:dismissed');
		banners = updateRecordValue(banners, e.key, true);
		void this.container.storage.storeWorkspace('graph:banners:dismissed', banners);
	}

	private onColumnUpdated(e: UpdateColumnParams) {
		let columns = this.container.storage.getWorkspace('graph:columns');
		columns = updateRecordValue(columns, e.name, e.config);
		void this.container.storage.storeWorkspace('graph:columns', columns);

		void this.notifyDidChangeGraphConfiguration();
	}

	@debug()
	private async onEnsureCommit(e: EnsureCommitParams, completionId?: string) {
		if (this._graph?.more == null || this._repository?.etag !== this._etagRepository) {
			this.updateState(true);

			if (completionId != null) {
				void this.notify(DidEnsureCommitNotificationType, {}, completionId);
			}
			return;
		}

		let selected: boolean | undefined;
		if (!this._graph.ids.has(e.id)) {
			await this.updateGraphWithMoreCommits(this._graph, e.id);
			if (e.select && this._graph.ids.has(e.id)) {
				selected = true;
				this.setSelectedRows(e.id);
			}
			void this.notifyDidChangeCommits();
		} else if (e.select) {
			selected = true;
			this.setSelectedRows(e.id);
		}

		void this.notify(DidEnsureCommitNotificationType, { id: e.id, selected: selected }, completionId);
	}

	private async onGetMissingAvatars(e: GetMissingAvatarsParams) {
		if (this._graph == null) return;

		const repoPath = this._graph.repoPath;

		async function getAvatar(this: GraphWebview, email: string, sha: string) {
			const uri = await getAvatarUri(email, { ref: sha, repoPath: repoPath });
			this._graph!.avatars.set(email, uri.toString(true));
		}

		const promises: Promise<void>[] = [];

		for (const [email, sha] of Object.entries(e.emails)) {
			if (this._graph.avatars.has(email)) continue;

			promises.push(getAvatar.call(this, email, sha));
		}

		if (promises.length) {
			await Promise.allSettled(promises);
			this.updateAvatars();
		}
	}

	@gate()
	@debug()
	private async onGetMoreCommits(e: GetMoreCommitsParams) {
		if (this._graph?.more == null || this._repository?.etag !== this._etagRepository) {
			this.updateState(true);

			return;
		}

		await this.updateGraphWithMoreCommits(this._graph, e.sha);
		void this.notifyDidChangeCommits();
	}

	@debug()
	private async onSearchCommits(e: SearchCommitsParams, completionId?: string) {
		let search: GitSearch | undefined = this._search;

		if (search?.more != null && e.more && search.comparisonKey === getSearchPatternComparisonKey(e.search)) {
			const limit = typeof e.more !== 'boolean' ? e.more.limit : undefined;
			search = await search.more(limit ?? configuration.get('graph.searchItemLimit') ?? 100);
			if (search != null) {
				this._search = search;

				void this.notify(
					DidSearchCommitsNotificationType,
					{
						results: {
							ids: [...search.results.values()],
							paging: {
								startingCursor: search.paging?.startingCursor,
								more: search.paging?.more ?? false,
							},
						},
						selectedRows: this._selectedRows,
					},
					completionId,
				);
			}

			return;
		}

		if (search == null || search.comparisonKey !== getSearchPatternComparisonKey(e.search)) {
			if (this._repository == null) return;

			if (this._repository.etag !== this._etagRepository) {
				this.updateState(true);
			}

			if (this._searchCancellation != null) {
				this._searchCancellation.cancel();
				this._searchCancellation.dispose();
			}

			const cancellation = new CancellationTokenSource();
			this._searchCancellation = cancellation;

			search = await this._repository.searchForCommitsSimple(e.search, {
				limit: configuration.get('graph.searchItemLimit') ?? 100,
				ordering: configuration.get('graph.commitOrdering'),
				cancellation: cancellation.token,
			});

			if (cancellation.token.isCancellationRequested) {
				if (completionId != null) {
					void this.notify(DidSearchCommitsNotificationType, { results: undefined }, completionId);
				}
				return;
			}

			this._search = search;
		} else {
			search = this._search!;
		}

		if (search.results.size > 0) {
			this.setSelectedRows(first(search.results));
		}

		void this.notify(
			DidSearchCommitsNotificationType,
			{
				results: {
					ids: [...search.results.values()],
					paging: {
						startingCursor: search.paging?.startingCursor,
						more: search.paging?.more ?? false,
					},
				},
				selectedRows: this._selectedRows,
			},
			completionId,
		);
	}

	private onRepositorySelectionChanged(e: UpdateSelectedRepositoryParams) {
		this.repository = this.container.git.getRepository(e.path);
	}

	private async onSelectionChanged(e: UpdateSelectionParams) {
		const item = e.selection[0];
		this.setSelectedRows(item?.id);

		let commits: GitCommit[] | undefined;
		if (item?.id != null) {
			let commit;
			if (item.type === GitGraphRowType.Stash) {
				const stash = await this.repository?.getStash();
				commit = stash?.commits.get(item.id);
			} else {
				commit = await this.repository?.getCommit(item?.id);
			}
			if (commit != null) {
				commits = [commit];
			}
		}

		this._selection = commits;
		this._onDidChangeSelection.fire({ selection: commits ?? [] });

		if (commits == null) return;

		void GitActions.Commit.showDetailsView(commits[0], { pin: true, preserveFocus: true });
	}

	private _notifyDidChangeStateDebounced: Deferrable<() => void> | undefined = undefined;

	@debug()
	private updateState(immediate: boolean = false) {
		if (!this.isReady || !this.visible) return;

		if (immediate) {
			void this.notifyDidChangeState();
			return;
		}

		if (this._notifyDidChangeStateDebounced == null) {
			this._notifyDidChangeStateDebounced = debounce(this.notifyDidChangeState.bind(this), 500);
		}

		this._notifyDidChangeStateDebounced();
	}

	private _notifyDidChangeAvatarsDebounced: Deferrable<() => void> | undefined = undefined;

	@debug()
	private updateAvatars(immediate: boolean = false) {
		if (!this.isReady || !this.visible) return;

		if (immediate) {
			void this.notifyDidChangeAvatars();
			return;
		}

		if (this._notifyDidChangeAvatarsDebounced == null) {
			this._notifyDidChangeAvatarsDebounced = debounce(this.notifyDidChangeAvatars.bind(this), 100);
		}

		this._notifyDidChangeAvatarsDebounced();
	}

	@debug()
	private async notifyDidChangeState() {
		if (!this.isReady || !this.visible) return false;

		return this.notify(DidChangeNotificationType, { state: await this.getState() });
	}

	@debug()
	private async notifyDidChangeGraphConfiguration() {
		if (!this.isReady || !this.visible) return false;

		return this.notify(DidChangeGraphConfigurationNotificationType, {
			config: this.getComponentConfig(),
		});
	}

	@debug()
	private async notifyDidChangeSelection() {
		if (!this.isReady || !this.visible) return false;

		return this.notify(DidChangeSelectionNotificationType, {
			selection: this._selectedRows,
		});
	}

	@debug()
	private async notifyDidChangeSubscription() {
		if (!this.isReady || !this.visible) return false;

		const access = await this.getGraphAccess();
		return this.notify(DidChangeSubscriptionNotificationType, {
			subscription: access.subscription.current,
			allowed: access.allowed,
		});
	}

	@debug()
	private async notifyDidChangeAvatars() {
		if (!this.isReady || !this.visible) return false;

		const data = this._graph!;
		return this.notify(DidChangeAvatarsNotificationType, {
			avatars: Object.fromEntries(data.avatars),
		});
	}

	@debug()
	private async notifyDidChangeCommits(completionId?: string) {
		let success = false;

		if (this.isReady && this.visible) {
			const data = this._graph!;
			success = await this.notify(
				DidChangeCommitsNotificationType,
				{
					rows: data.rows,
					avatars: Object.fromEntries(data.avatars),
					selectedRows: this._selectedRows,
					paging: {
						startingCursor: data.paging?.startingCursor,
						more: data.paging?.more ?? false,
					},
				},
				completionId,
			);
		}

		this._pendingNotifyCommits = !success;
		return success;
	}

	private getComponentConfig(): GraphComponentConfig {
		const config: GraphComponentConfig = {
			avatars: configuration.get('graph.avatars'),
			columns: this.container.storage.getWorkspace('graph:columns'),
			dateFormat:
				configuration.get('graph.dateFormat') ?? configuration.get('defaultDateFormat') ?? 'short+short',
			dateStyle: configuration.get('graph.dateStyle') ?? configuration.get('defaultDateStyle'),
			enableMultiSelection: false,
			highlightRowsOnRefHover: configuration.get('graph.highlightRowsOnRefHover'),
			shaLength: configuration.get('advanced.abbreviatedShaLength'),
		};
		return config;
	}

	private async getState(deferRows?: boolean): Promise<State> {
		if (this.container.git.repositoryCount === 0) return { allowed: true, repositories: [] };

		if (this.previewBanner == null || this.trialBanner == null) {
			const banners = this.container.storage.getWorkspace('graph:banners:dismissed');
			if (this.previewBanner == null) {
				this.previewBanner = !banners?.['preview'];
			}
			if (this.trialBanner == null) {
				this.trialBanner = !banners?.['trial'];
			}
		}

		if (this.repository == null) {
			this.repository = this.container.git.getBestRepositoryOrFirst();
			if (this.repository == null) return { allowed: true, repositories: [] };
		}

		this._etagRepository = this.repository?.etag;
		this.title = `${this.originalTitle}: ${this.repository.formattedName}`;

		const { defaultItemLimit } = configuration.get('graph');

		// If we have a set of data refresh to the same set
		const limit = Math.max(defaultItemLimit, this._graph?.ids.size ?? defaultItemLimit);

		// Check for GitLens+ access
		const access = await this.getGraphAccess();
		const visibility = access.visibility ?? (await this.container.git.visibility(this.repository.path));

		const dataPromise = this.container.git.getCommitsForGraph(
			this.repository.path,
			this._panel!.webview.asWebviewUri.bind(this._panel!.webview),
			{ limit: limit, ref: this._selectedSha ?? 'HEAD' },
		);

		let data;

		if (deferRows) {
			queueMicrotask(async () => {
				const data = await dataPromise;
				this.setGraph(data);
				this.setSelectedRows(data.sha);

				void this.notifyDidChangeCommits();
			});
		} else {
			data = await dataPromise;
			this.setGraph(data);
			this.setSelectedRows(data.sha);
		}

		return {
			previewBanner: this.previewBanner,
			trialBanner: this.trialBanner,
			repositories: formatRepositories(this.container.git.openRepositories),
			selectedRepository: this.repository.path,
			selectedRepositoryVisibility: visibility,
			selectedRows: this._selectedRows,
			subscription: access.subscription.current,
			allowed: access.allowed,
			avatars: data != null ? Object.fromEntries(data.avatars) : undefined,
			loading: deferRows,
			rows: data?.rows,
			paging:
				data != null
					? {
							startingCursor: data.paging?.startingCursor,
							more: data.paging?.more ?? false,
					  }
					: undefined,
			config: this.getComponentConfig(),
			nonce: this.cspNonce,
		};
	}

	private async getGraphAccess() {
		let access = await this.container.git.access(PlusFeatures.Graph, this.repository?.path);
		this._etagSubscription = this.container.subscription.etag;

		// If we don't have access to GitLens+, but the preview trial hasn't been started, auto-start it
		if (!access.allowed && access.subscription.current.previewTrial == null) {
			await this.container.subscription.startPreviewTrial(true);
			access = await this.container.git.access(PlusFeatures.Graph, this.repository?.path);
		}
		return access;
	}

	private resetRepositoryState() {
		this.setGraph(undefined);
		this.setSelectedRows(undefined);
	}

	private setGraph(graph: GitGraph | undefined) {
		this._graph = graph;
		if (graph == null) {
			this._search = undefined;
			this._searchCancellation?.dispose();
			this._searchCancellation = undefined;
		}
	}

	private async updateGraphWithMoreCommits(graph: GitGraph, sha?: string) {
		const { defaultItemLimit, pageItemLimit } = configuration.get('graph');
		const updatedGraph = await graph.more?.(pageItemLimit ?? defaultItemLimit, sha);
		if (updatedGraph != null) {
			this.setGraph(updatedGraph);
		} else {
			debugger;
		}
	}

	private setSelectedRows(sha: string | undefined) {
		if (this._selectedSha === sha) return;

		this._selectedSha = sha;
		this._selectedRows = sha != null ? { [sha]: true } : {};
	}
}

function formatRepositories(repositories: Repository[]): GraphRepository[] {
	if (repositories.length === 0) return repositories;

	return repositories.map(r => ({
		formattedName: r.formattedName,
		id: r.id,
		name: r.name,
		path: r.path,
	}));
}
