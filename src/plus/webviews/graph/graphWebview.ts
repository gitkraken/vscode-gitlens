import type {
	ColorTheme,
	ConfigurationChangeEvent,
	Disposable,
	Event,
	StatusBarItem,
	WebviewOptions,
	WebviewPanelOptions,
} from 'vscode';
import { CancellationTokenSource, EventEmitter, MarkdownString, StatusBarAlignment, ViewColumn, window } from 'vscode';
import type { CreatePullRequestActionContext } from '../../../api/gitlens';
import { getAvatarUri } from '../../../avatars';
import type {
	CopyMessageToClipboardCommandArgs,
	CopyShaToClipboardCommandArgs,
	OpenBranchOnRemoteCommandArgs,
	OpenCommitOnRemoteCommandArgs,
} from '../../../commands';
import { parseCommandContext } from '../../../commands/base';
import { GitActions } from '../../../commands/gitCommands.actions';
import { configuration } from '../../../configuration';
import { Commands, ContextKeys, CoreGitCommands } from '../../../constants';
import type { Container } from '../../../container';
import { setContext } from '../../../context';
import { PlusFeatures } from '../../../features';
import type { GitCommit } from '../../../git/models/commit';
import { GitGraphRowType } from '../../../git/models/graph';
import type { GitGraph } from '../../../git/models/graph';
import type {
	GitBranchReference,
	GitRevisionReference,
	GitStashReference,
	GitTagReference,
} from '../../../git/models/reference';
import { GitReference, GitRevision } from '../../../git/models/reference';
import type { Repository, RepositoryChangeEvent } from '../../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository';
import type { GitSearch } from '../../../git/search';
import { getSearchQueryComparisonKey } from '../../../git/search';
import { executeActionCommand, executeCommand, executeCoreGitCommand, registerCommand } from '../../../system/command';
import { gate } from '../../../system/decorators/gate';
import { debug } from '../../../system/decorators/log';
import type { Deferrable } from '../../../system/function';
import { debounce } from '../../../system/function';
import { first, last } from '../../../system/iterable';
import { updateRecordValue } from '../../../system/object';
import { isDarkTheme, isLightTheme } from '../../../system/utils';
import type { WebviewItemContext } from '../../../system/webview';
import { isWebviewItemContext, serializeWebviewItemContext } from '../../../system/webview';
import type { BranchNode } from '../../../views/nodes/branchNode';
import type { CommitFileNode } from '../../../views/nodes/commitFileNode';
import type { CommitNode } from '../../../views/nodes/commitNode';
import type { StashNode } from '../../../views/nodes/stashNode';
import type { TagNode } from '../../../views/nodes/tagNode';
import { RepositoryFolderNode } from '../../../views/nodes/viewNode';
import { onIpc } from '../../../webviews/protocol';
import type { IpcMessage, IpcMessageParams, IpcNotificationType } from '../../../webviews/protocol';
import { WebviewBase } from '../../../webviews/webviewBase';
import type { SubscriptionChangeEvent } from '../../subscription/subscriptionService';
import { ensurePlusFeaturesEnabled } from '../../subscription/utils';
import type {
	DismissBannerParams,
	EnsureCommitParams,
	GetMissingAvatarsParams,
	GetMoreCommitsParams,
	GraphColumnConfig,
	GraphColumnName,
	GraphColumnsSettings,
	GraphComponentConfig,
	GraphRepository,
	SearchCommitsParams,
	SearchOpenInViewParams,
	State,
	UpdateColumnParams,
	UpdateSelectedRepositoryParams,
	UpdateSelectionParams,
} from './protocol';
import {
	DidChangeAvatarsNotificationType,
	DidChangeColumnsNotificationType,
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
	SearchOpenInViewCommandType,
	UpdateColumnCommandType,
	UpdateSelectedRepositoryCommandType,
	UpdateSelectionCommandType,
} from './protocol';

export interface ShowInCommitGraphCommandArgs {
	ref: GitReference;
	preserveFocus?: boolean;
}

export interface GraphSelectionChangeEvent {
	readonly selection: GitCommit[];
}

const defaultGraphColumnsSettings: GraphColumnsSettings = {
	ref: { width: 150, isHidden: false },
	graph: { width: 150, isHidden: false },
	message: { width: 300, isHidden: false },
	author: { width: 130, isHidden: false },
	datetime: { width: 130, isHidden: false },
	sha: { width: 130, isHidden: false },
};

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
	private _pendingIpcNotifications = new Map<IpcNotificationType, IpcMessage | (() => Promise<boolean>)>();
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
			{ dispose: () => this._statusBarItem?.dispose() },
			registerCommand(
				Commands.ShowInCommitGraph,
				async (
					args: ShowInCommitGraphCommandArgs | BranchNode | CommitNode | CommitFileNode | StashNode | TagNode,
				) => {
					this.repository = this.container.git.getRepository(args.ref.repoPath);
					let sha = args.ref.ref;
					if (!GitRevision.isSha(sha)) {
						sha = await this.container.git.resolveReference(args.ref.repoPath, sha, undefined, {
							force: true,
						});
					}
					this.setSelectedRows(sha);

					const preserveFocus = 'preserveFocus' in args ? args.preserveFocus ?? false : false;
					if (this._panel == null) {
						void this.show({ preserveFocus: preserveFocus });
					} else {
						this._panel.reveal(this._panel.viewColumn ?? ViewColumn.Active, preserveFocus ?? false);
						if (this._graph?.ids.has(sha)) {
							void this.notifyDidChangeSelection();
							return;
						}

						this.setSelectedRows(sha);
						void this.onGetMoreCommits({ sha: sha });
					}
				},
			),
		);

		this.onConfigurationChanged();
	}

	protected override get options(): WebviewPanelOptions & WebviewOptions {
		return {
			retainContextWhenHidden: true,
			enableFindWidget: false,
			enableCommandUris: true,
			enableScripts: true,
		};
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
		return [
			registerCommand(Commands.RefreshGraphPage, () => this.refresh(true)),
			registerCommand('gitlens.graph.createBranch', this.createBranch, this),
			registerCommand('gitlens.graph.deleteBranch', this.deleteBranch, this),
			registerCommand('gitlens.graph.copyRemoteBranchUrl', item => this.openBranchOnRemote(item, true), this),
			registerCommand('gitlens.graph.openBranchOnRemote', this.openBranchOnRemote, this),
			registerCommand('gitlens.graph.mergeBranchInto', this.mergeBranchInto, this),
			registerCommand('gitlens.graph.rebaseOntoBranch', this.rebase, this),
			registerCommand('gitlens.graph.rebaseOntoUpstream', this.rebaseToRemote, this),
			registerCommand('gitlens.graph.renameBranch', this.renameBranch, this),

			registerCommand('gitlens.graph.switchToAnotherBranch', this.switchToAnother, this),
			registerCommand('gitlens.graph.switchToBranch', this.switchTo, this),

			registerCommand('gitlens.graph.cherryPick', this.cherryPick, this),
			registerCommand('gitlens.graph.copyRemoteCommitUrl', item => this.openCommitOnRemote(item, true), this),
			registerCommand('gitlens.graph.openCommitOnRemote', this.openCommitOnRemote, this),
			registerCommand('gitlens.graph.rebaseOntoCommit', this.rebase, this),
			registerCommand('gitlens.graph.resetCommit', this.resetCommit, this),
			registerCommand('gitlens.graph.resetToCommit', this.resetToCommit, this),
			registerCommand('gitlens.graph.revert', this.revertCommit, this),
			registerCommand('gitlens.graph.switchToCommit', this.switchTo, this),
			registerCommand('gitlens.graph.undoCommit', this.undoCommit, this),

			registerCommand('gitlens.graph.applyStash', this.applyStash, this),
			registerCommand('gitlens.graph.deleteStash', this.deleteStash, this),

			registerCommand('gitlens.graph.createTag', this.createTag, this),
			registerCommand('gitlens.graph.deleteTag', this.deleteTag, this),
			registerCommand('gitlens.graph.switchToTag', this.switchTo, this),

			registerCommand('gitlens.graph.createWorktree', this.createWorktree, this),

			registerCommand('gitlens.graph.createPullRequest', this.createPullRequest, this),

			registerCommand('gitlens.graph.copyMessage', this.copyMessage, this),
			registerCommand('gitlens.graph.copySha', this.copySha, this),

			registerCommand('gitlens.graph.columnAuthorOn', () => this.toggleColumn('author', true)),
			registerCommand('gitlens.graph.columnAuthorOff', () => this.toggleColumn('author', false)),
			registerCommand('gitlens.graph.columnDateTimeOn', () => this.toggleColumn('datetime', true)),
			registerCommand('gitlens.graph.columnDateTimeOff', () => this.toggleColumn('datetime', false)),
			registerCommand('gitlens.graph.columnShaOn', () => this.toggleColumn('sha', true)),
			registerCommand('gitlens.graph.columnShaOff', () => this.toggleColumn('sha', false)),
		];
	}

	protected override onInitializing(): Disposable[] | undefined {
		this._theme = window.activeColorTheme;
		return [
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			window.onDidChangeActiveColorTheme(this.onThemeChanged, this),
			{ dispose: () => void this._repositoryEventsDisposable?.dispose() },
		];
	}

	protected override onReady(): void {
		this.sendPendingIpcNotifications();
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
			case SearchOpenInViewCommandType.method:
				onIpc(SearchOpenInViewCommandType, e, params => this.onSearchOpenInView(params));
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
			return;
		}

		this.sendPendingIpcNotifications();
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

		// If we don't have an open webview ignore the rest
		if (this._panel == null) return;

		if (e != null && configuration.changed(e, 'graph.commitOrdering')) {
			this.updateState();

			return;
		}

		if (
			(e != null && configuration.changed(e, 'defaultDateFormat')) ||
			configuration.changed(e, 'defaultDateStyle') ||
			configuration.changed(e, 'advanced.abbreviatedShaLength') ||
			configuration.changed(e, 'graph.avatars') ||
			configuration.changed(e, 'graph.dateFormat') ||
			configuration.changed(e, 'graph.dateStyle') ||
			configuration.changed(e, 'graph.highlightRowsOnRefHover') ||
			configuration.changed(e, 'graph.showGhostRefsOnRowHover')
		) {
			void this.notifyDidChangeConfiguration();
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
		this.updateColumn(e.name, e.config);
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
		if (e.search == null) {
			this.resetSearchState();

			// This shouldn't happen, but just in case
			if (completionId != null) {
				debugger;
			}
			return;
		}

		let search: GitSearch | undefined = this._search;

		if (e.more && search?.more != null && search.comparisonKey === getSearchQueryComparisonKey(e.search)) {
			search = await search.more(e.limit ?? configuration.get('graph.searchItemLimit') ?? 100);
			if (search != null) {
				this._search = search;

				void this.notify(
					DidSearchCommitsNotificationType,
					{
						results: {
							ids: Object.fromEntries(search.results),
							paging: { hasMore: search.paging?.hasMore ?? false },
						},
						selectedRows: this._selectedRows,
					},
					completionId,
				);
			}

			return;
		}

		if (search == null || search.comparisonKey !== getSearchQueryComparisonKey(e.search)) {
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

			search = await this._repository.searchCommits(e.search, {
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
			this.setSelectedRows(first(search.results)![0]);
		}

		void this.notify(
			DidSearchCommitsNotificationType,
			{
				results: {
					ids: Object.fromEntries(search.results),
					paging: { hasMore: search.paging?.hasMore ?? false },
				},
				selectedRows: this._selectedRows,
			},
			completionId,
		);
	}

	private onSearchOpenInView(e: SearchOpenInViewParams) {
		if (this.repository == null) return;

		void this.container.searchAndCompareView.search(this.repository.path, e.search, {
			label: { label: `for ${e.search.query}` },
			reveal: {
				select: true,
				focus: false,
				expand: true,
			},
		});
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
		this._pendingIpcNotifications.clear();

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
	private async notifyDidChangeAvatars() {
		if (this._graph == null) return;

		const data = this._graph;
		return this.notify(DidChangeAvatarsNotificationType, {
			avatars: Object.fromEntries(data.avatars),
		});
	}

	@debug()
	private async notifyDidChangeColumns() {
		if (!this.isReady || !this.visible) {
			this.addPendingIpcNotification(DidChangeColumnsNotificationType);
			return false;
		}

		const columns = this.getColumns();
		return this.notify(DidChangeColumnsNotificationType, {
			columns: this.getColumnSettings(columns),
			context: this.getColumnHeaderContext(columns),
		});
	}

	@debug()
	private async notifyDidChangeConfiguration() {
		if (!this.isReady || !this.visible) {
			this.addPendingIpcNotification(DidChangeGraphConfigurationNotificationType);
			return false;
		}

		return this.notify(DidChangeGraphConfigurationNotificationType, {
			config: this.getComponentConfig(),
		});
	}

	@debug()
	private async notifyDidChangeCommits(completionId?: string) {
		if (this._graph == null) return;

		const data = this._graph;
		return this.notify(
			DidChangeCommitsNotificationType,
			{
				rows: data.rows,
				avatars: Object.fromEntries(data.avatars),
				selectedRows: this._selectedRows,
				paging: {
					startingCursor: data.paging?.startingCursor,
					hasMore: data.paging?.hasMore ?? false,
				},
			},
			completionId,
		);
	}

	@debug()
	private async notifyDidChangeSelection() {
		if (!this.isReady || !this.visible) {
			this.addPendingIpcNotification(DidChangeSelectionNotificationType);
			return false;
		}

		return this.notify(DidChangeSelectionNotificationType, {
			selection: this._selectedRows,
		});
	}

	@debug()
	private async notifyDidChangeSubscription() {
		if (!this.isReady || !this.visible) {
			this.addPendingIpcNotification(DidChangeSubscriptionNotificationType);
			return false;
		}

		const access = await this.getGraphAccess();
		return this.notify(DidChangeSubscriptionNotificationType, {
			subscription: access.subscription.current,
			allowed: access.allowed,
		});
	}

	@debug()
	private async notifyDidChangeState() {
		if (!this.isReady || !this.visible) {
			this.addPendingIpcNotification(DidChangeNotificationType);
			return false;
		}

		return this.notify(DidChangeNotificationType, { state: await this.getState() });
	}

	protected override async notify<T extends IpcNotificationType<any>>(
		type: T,
		params: IpcMessageParams<T>,
		completionId?: string,
	): Promise<boolean> {
		const msg: IpcMessage = {
			id: this.nextIpcId(),
			method: type.method,
			params: params,
			completionId: completionId,
		};
		const success = await this.postMessage(msg);
		if (success) {
			this._pendingIpcNotifications.clear();
		} else {
			this.addPendingIpcNotification(type, msg);
		}
		return success;
	}

	private readonly _ipcNotificationMap = new Map<IpcNotificationType<any>, () => Promise<boolean>>([
		[DidChangeColumnsNotificationType, this.notifyDidChangeColumns],
		[DidChangeGraphConfigurationNotificationType, this.notifyDidChangeConfiguration],
		[DidChangeNotificationType, this.notifyDidChangeState],
		[DidChangeSelectionNotificationType, this.notifyDidChangeSelection],
		[DidChangeSubscriptionNotificationType, this.notifyDidChangeSubscription],
	]);

	private addPendingIpcNotification(type: IpcNotificationType<any>, msg?: IpcMessage) {
		if (type === DidChangeNotificationType) {
			this._pendingIpcNotifications.clear();
		} else if (type.overwriteable) {
			this._pendingIpcNotifications.delete(type);
		}

		let msgOrFn: IpcMessage | (() => Promise<boolean>) | undefined;
		if (msg == null) {
			msgOrFn = this._ipcNotificationMap.get(type)?.bind(this);
			if (msgOrFn == null) {
				debugger;
				return;
			}
		} else {
			msgOrFn = msg;
		}
		this._pendingIpcNotifications.set(type, msgOrFn);
	}

	private sendPendingIpcNotifications() {
		if (this._pendingIpcNotifications.size === 0) return;

		const ipcs = new Map(this._pendingIpcNotifications);
		this._pendingIpcNotifications.clear();
		for (const msgOrFn of ipcs.values()) {
			if (typeof msgOrFn === 'function') {
				void msgOrFn();
			} else {
				void this.postMessage(msgOrFn);
			}
		}
	}

	private getColumns(): Record<GraphColumnName, GraphColumnConfig> | undefined {
		return this.container.storage.getWorkspace('graph:columns');
	}

	private getColumnSettings(
		columns: Record<GraphColumnName, GraphColumnConfig> | undefined,
	): GraphColumnsSettings | undefined {
		if (columns == null) return undefined;

		const columnsSettings: GraphColumnsSettings = {
			...defaultGraphColumnsSettings,
		};
		if (columns != null) {
			for (const [column, columnCfg] of Object.entries(columns) as [GraphColumnName, GraphColumnConfig][]) {
				columnsSettings[column] = {
					...defaultGraphColumnsSettings[column],
					...columnCfg,
				};
			}
		}

		return columnsSettings;
	}

	private getColumnHeaderContext(columns: Record<GraphColumnName, GraphColumnConfig> | undefined): string {
		const hidden: string[] = [];
		if (columns != null) {
			for (const [name, cfg] of Object.entries(columns)) {
				if (cfg.isHidden) {
					hidden.push(name);
				}
			}
		}
		return serializeWebviewItemContext<GraphItemContext>({
			webviewItem: 'gitlens:graph:columns',
			webviewItemValue: hidden.join(','),
		});
	}

	private getComponentConfig(): GraphComponentConfig {
		const config: GraphComponentConfig = {
			avatars: configuration.get('graph.avatars'),
			dateFormat:
				configuration.get('graph.dateFormat') ?? configuration.get('defaultDateFormat') ?? 'short+short',
			dateStyle: configuration.get('graph.dateStyle') ?? configuration.get('defaultDateStyle'),
			enableMultiSelection: false,
			highlightRowsOnRefHover: configuration.get('graph.highlightRowsOnRefHover'),
			showGhostRefsOnRowHover: configuration.get('graph.showGhostRefsOnRowHover'),
			shaLength: configuration.get('advanced.abbreviatedShaLength'),
		};
		return config;
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

		const columns = this.getColumns();

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
							hasMore: data.paging?.hasMore ?? false,
					  }
					: undefined,
			columns: this.getColumnSettings(columns),
			config: this.getComponentConfig(),
			context: {
				header: this.getColumnHeaderContext(columns),
			},
			nonce: this.cspNonce,
		};
	}

	private updateColumn(name: GraphColumnName, cfg: GraphColumnConfig) {
		let columns = this.container.storage.getWorkspace('graph:columns');
		columns = updateRecordValue(columns, name, cfg);
		void this.container.storage.storeWorkspace('graph:columns', columns);
		void this.notifyDidChangeColumns();
	}

	private resetRepositoryState() {
		this.setGraph(undefined);
		this.setSelectedRows(undefined);
	}

	private resetSearchState() {
		this._search = undefined;
		this._searchCancellation?.dispose();
		this._searchCancellation = undefined;
	}

	private setGraph(graph: GitGraph | undefined) {
		this._graph = graph;
		if (graph == null) {
			this.resetSearchState();
		}
	}

	private async updateGraphWithMoreCommits(graph: GitGraph, sha?: string) {
		const { defaultItemLimit, pageItemLimit } = configuration.get('graph');
		const updatedGraph = await graph.more?.(pageItemLimit ?? defaultItemLimit, sha);
		if (updatedGraph != null) {
			this.setGraph(updatedGraph);

			if (this._search != null) {
				const search = this._search;
				const lastId = last(search.results)?.[0];
				if (lastId != null && updatedGraph.ids.has(lastId)) {
					queueMicrotask(() => void this.onSearchCommits({ search: search.query, more: true }));
				}
			}
		} else {
			debugger;
		}
	}

	private setSelectedRows(sha: string | undefined) {
		if (this._selectedSha === sha) return;

		this._selectedSha = sha;
		this._selectedRows = sha != null ? { [sha]: true } : {};
	}

	@debug()
	private createBranch(item: GraphItemContext) {
		if (isGraphItemRefContext(item)) {
			const { ref } = item.webviewItemValue;
			return GitActions.Branch.create(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private deleteBranch(item: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return GitActions.Branch.remove(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private mergeBranchInto(item: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return GitActions.merge(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private openBranchOnRemote(item: GraphItemContext, clipboard?: boolean) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<OpenBranchOnRemoteCommandArgs>(Commands.OpenBranchOnRemote, {
				branch: ref.name,
				remote: ref.upstream?.name,
				clipboard: clipboard,
			});
		}

		return Promise.resolve();
	}

	@debug()
	private rebase(item: GraphItemContext) {
		if (isGraphItemRefContext(item)) {
			const { ref } = item.webviewItemValue;
			return GitActions.rebase(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private rebaseToRemote(item: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (ref.upstream != null) {
				return GitActions.rebase(
					ref.repoPath,
					GitReference.create(ref.upstream.name, ref.repoPath, {
						refType: 'branch',
						name: ref.upstream.name,
						remote: true,
					}),
				);
			}
		}

		return Promise.resolve();
	}

	@debug()
	private renameBranch(item: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return GitActions.Branch.rename(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private cherryPick(item: GraphItemContext) {
		if (isGraphItemRefContext(item, 'revision')) {
			const { ref } = item.webviewItemValue;
			return GitActions.cherryPick(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private copyMessage(item: GraphItemContext) {
		if (isGraphItemRefContext(item)) {
			const { ref } = item.webviewItemValue;
			return executeCommand<CopyMessageToClipboardCommandArgs>(Commands.CopyMessageToClipboard, {
				repoPath: ref.repoPath,
				sha: ref.ref,
				message: 'message' in ref ? ref.message : undefined,
			});
		}

		return Promise.resolve();
	}

	@debug()
	private async copySha(item: GraphItemContext) {
		if (isGraphItemRefContext(item)) {
			const { ref } = item.webviewItemValue;

			let sha = ref.ref;
			if (!GitRevision.isSha(sha)) {
				sha = await this.container.git.resolveReference(ref.repoPath, sha, undefined, { force: true });
			}

			return executeCommand<CopyShaToClipboardCommandArgs>(Commands.CopyShaToClipboard, {
				sha: sha,
			});
		}

		return Promise.resolve();
	}

	@debug()
	private openCommitOnRemote(item: GraphItemContext, clipboard?: boolean) {
		if (isGraphItemRefContext(item, 'revision')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<OpenCommitOnRemoteCommandArgs>(Commands.OpenCommitOnRemote, {
				sha: ref.ref,
				clipboard: clipboard,
			});
		}

		return Promise.resolve();
	}

	@debug()
	private resetCommit(item: GraphItemContext) {
		if (isGraphItemRefContext(item, 'revision')) {
			const { ref } = item.webviewItemValue;
			return GitActions.reset(
				ref.repoPath,
				GitReference.create(`${ref.ref}^`, ref.repoPath, {
					refType: 'revision',
					name: `${ref.name}^`,
					message: ref.message,
				}),
			);
		}

		return Promise.resolve();
	}

	@debug()
	private resetToCommit(item: GraphItemContext) {
		if (isGraphItemRefContext(item, 'revision')) {
			const { ref } = item.webviewItemValue;
			return GitActions.reset(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private revertCommit(item: GraphItemContext) {
		if (isGraphItemRefContext(item, 'revision')) {
			const { ref } = item.webviewItemValue;
			return GitActions.revert(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private switchTo(item: GraphItemContext) {
		if (isGraphItemRefContext(item)) {
			const { ref } = item.webviewItemValue;
			return GitActions.switchTo(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private switchToAnother(item: GraphItemContext) {
		if (isGraphItemRefContext(item)) {
			const { ref } = item.webviewItemValue;
			return GitActions.switchTo(ref.repoPath);
		}

		return Promise.resolve();
	}

	@debug()
	private async undoCommit(item: GraphItemContext) {
		if (isGraphItemRefContext(item, 'revision')) {
			const { ref } = item.webviewItemValue;
			const repo = await this.container.git.getOrOpenScmRepository(ref.repoPath);
			const commit = await repo?.getCommit('HEAD');

			if (commit?.hash !== ref.ref) {
				void window.showWarningMessage(
					`Commit ${GitReference.toString(ref, {
						capitalize: true,
						icon: false,
					})} cannot be undone, because it is no longer the most recent commit.`,
				);

				return;
			}

			return void executeCoreGitCommand(CoreGitCommands.UndoCommit, ref.repoPath);
		}

		return Promise.resolve();
	}

	@debug()
	private applyStash(item: GraphItemContext) {
		if (isGraphItemRefContext(item, 'stash')) {
			const { ref } = item.webviewItemValue;
			return GitActions.Stash.apply(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private deleteStash(item: GraphItemContext) {
		if (isGraphItemRefContext(item, 'stash')) {
			const { ref } = item.webviewItemValue;
			return GitActions.Stash.drop(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private async createTag(item: GraphItemContext) {
		if (isGraphItemRefContext(item)) {
			const { ref } = item.webviewItemValue;
			return GitActions.Tag.create(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private deleteTag(item: GraphItemContext) {
		if (isGraphItemRefContext(item, 'tag')) {
			const { ref } = item.webviewItemValue;
			return GitActions.Tag.remove(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private async createWorktree(item: GraphItemContext) {
		if (isGraphItemRefContext(item)) {
			const { ref } = item.webviewItemValue;
			return GitActions.Worktree.create(ref.repoPath, undefined, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private async createPullRequest(item: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;

			const repo = this.container.git.getRepository(ref.repoPath);
			const branch = await repo?.getBranch(ref.name);
			const remote = await branch?.getRemote();

			return executeActionCommand<CreatePullRequestActionContext>('createPullRequest', {
				repoPath: ref.repoPath,
				remote:
					remote != null
						? {
								name: remote.name,
								provider:
									remote.provider != null
										? {
												id: remote.provider.id,
												name: remote.provider.name,
												domain: remote.provider.domain,
										  }
										: undefined,
								url: remote.url,
						  }
						: undefined,
				branch: {
					name: ref.name,
					upstream: ref.upstream?.name,
					isRemote: ref.remote,
				},
			});
		}

		return Promise.resolve();
	}

	@debug()
	private async toggleColumn(name: GraphColumnName, visible: boolean) {
		let columns = this.container.storage.getWorkspace('graph:columns');
		let column = columns?.[name];
		if (column != null) {
			column.isHidden = !visible;
		} else {
			column = { isHidden: !visible };
		}

		columns = updateRecordValue(columns, name, column);
		await this.container.storage.storeWorkspace('graph:columns', columns);

		void this.notifyDidChangeColumns();
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

export type GraphItemContext = WebviewItemContext<GraphItemContextValue>;
export type GraphItemRefContext<T = GraphItemRefContextValue> = WebviewItemContext<T>;
export type GraphItemRefContextValue =
	| GraphBranchContextValue
	| GraphCommitContextValue
	| GraphStashContextValue
	| GraphTagContextValue;
export type GraphItemContextValue = GraphAvatarContextValue | GraphColumnsContextValue | GraphItemRefContextValue;

export interface GraphAvatarContextValue {
	type: 'avatar';
	email: string;
}

export type GraphColumnsContextValue = string;

export interface GraphBranchContextValue {
	type: 'branch';
	ref: GitBranchReference;
}

export interface GraphCommitContextValue {
	type: 'commit';
	ref: GitRevisionReference;
}

export interface GraphStashContextValue {
	type: 'stash';
	ref: GitStashReference;
}

export interface GraphTagContextValue {
	type: 'tag';
	ref: GitTagReference;
}

function isGraphItemContext(item: unknown): item is GraphItemContext {
	if (item == null) return false;

	return isWebviewItemContext(item) && item.webview === 'gitlens.graph';
}

function isGraphItemRefContext(item: unknown): item is GraphItemRefContext;
function isGraphItemRefContext(item: unknown, refType: 'branch'): item is GraphItemRefContext<GraphBranchContextValue>;
function isGraphItemRefContext(
	item: unknown,
	refType: 'revision',
): item is GraphItemRefContext<GraphCommitContextValue>;
function isGraphItemRefContext(item: unknown, refType: 'stash'): item is GraphItemRefContext<GraphStashContextValue>;
function isGraphItemRefContext(item: unknown, refType: 'tag'): item is GraphItemRefContext<GraphTagContextValue>;
function isGraphItemRefContext(item: unknown, refType?: GitReference['refType']): item is GraphItemRefContext {
	if (item == null) return false;

	return (
		isGraphItemContext(item) &&
		typeof item.webviewItemValue === 'object' &&
		'ref' in item.webviewItemValue &&
		(refType == null || item.webviewItemValue.ref.refType === refType)
	);
}
