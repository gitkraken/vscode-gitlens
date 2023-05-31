import type { ColorTheme, ConfigurationChangeEvent, Uri, ViewColumn } from 'vscode';
import { CancellationTokenSource, Disposable, env, window } from 'vscode';
import type { CreatePullRequestActionContext } from '../../../api/gitlens';
import { getAvatarUri } from '../../../avatars';
import type {
	CopyDeepLinkCommandArgs,
	CopyMessageToClipboardCommandArgs,
	CopyShaToClipboardCommandArgs,
	OpenOnRemoteCommandArgs,
	OpenPullRequestOnRemoteCommandArgs,
	ShowCommitsInViewCommandArgs,
} from '../../../commands';
import { parseCommandContext } from '../../../commands/base';
import type { Config, GraphMinimapMarkersAdditionalTypes } from '../../../config';
import type { StoredGraphFilters, StoredGraphIncludeOnlyRef, StoredGraphRefType } from '../../../constants';
import { Commands, GlyphChars } from '../../../constants';
import type { Container } from '../../../container';
import type { CommitSelectedEvent } from '../../../eventBus';
import { PlusFeatures } from '../../../features';
import * as BranchActions from '../../../git/actions/branch';
import {
	openAllChanges,
	openAllChangesWithWorking,
	openFiles,
	openFilesAtRevision,
	showGraphDetailsView,
} from '../../../git/actions/commit';
import * as ContributorActions from '../../../git/actions/contributor';
import * as RepoActions from '../../../git/actions/repository';
import * as StashActions from '../../../git/actions/stash';
import * as TagActions from '../../../git/actions/tag';
import * as WorktreeActions from '../../../git/actions/worktree';
import { GitSearchError } from '../../../git/errors';
import { getBranchId, getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '../../../git/models/branch';
import type { GitCommit } from '../../../git/models/commit';
import { uncommitted } from '../../../git/models/constants';
import { GitContributor } from '../../../git/models/contributor';
import type { GitGraph } from '../../../git/models/graph';
import { GitGraphRowType } from '../../../git/models/graph';
import type {
	GitBranchReference,
	GitReference,
	GitRevisionReference,
	GitStashReference,
	GitTagReference,
} from '../../../git/models/reference';
import {
	createReference,
	getReferenceFromBranch,
	getReferenceLabel,
	isGitReference,
	isSha,
	shortenRevision,
} from '../../../git/models/reference';
import { getRemoteIconUri } from '../../../git/models/remote';
import { RemoteResourceType } from '../../../git/models/remoteResource';
import type { RepositoryChangeEvent, RepositoryFileSystemChangeEvent } from '../../../git/models/repository';
import {
	isRepository,
	Repository,
	RepositoryChange,
	RepositoryChangeComparisonMode,
} from '../../../git/models/repository';
import type { GitSearch } from '../../../git/search';
import { getSearchQueryComparisonKey } from '../../../git/search';
import { showRepositoryPicker } from '../../../quickpicks/repositoryPicker';
import {
	executeActionCommand,
	executeCommand,
	executeCoreCommand,
	executeCoreGitCommand,
	registerCommand,
} from '../../../system/command';
import { configuration } from '../../../system/configuration';
import { getContext, onDidChangeContext } from '../../../system/context';
import { gate } from '../../../system/decorators/gate';
import { debug } from '../../../system/decorators/log';
import type { Deferrable } from '../../../system/function';
import { debounce, disposableInterval } from '../../../system/function';
import { find, last, map } from '../../../system/iterable';
import { updateRecordValue } from '../../../system/object';
import { getSettledValue } from '../../../system/promise';
import { isDarkTheme, isLightTheme } from '../../../system/utils';
import { isWebviewItemContext, isWebviewItemGroupContext, serializeWebviewItemContext } from '../../../system/webview';
import { RepositoryFolderNode } from '../../../views/nodes/viewNode';
import type { IpcMessage, IpcNotificationType } from '../../../webviews/protocol';
import { onIpc } from '../../../webviews/protocol';
import type { WebviewController, WebviewProvider } from '../../../webviews/webviewController';
import { isSerializedState } from '../../../webviews/webviewsController';
import type { SubscriptionChangeEvent } from '../../subscription/subscriptionService';
import type {
	BranchState,
	DimMergeCommitsParams,
	DismissBannerParams,
	DoubleClickedParams,
	EnsureRowParams,
	GetMissingAvatarsParams,
	GetMissingRefsMetadataParams,
	GetMoreRowsParams,
	GraphBranchContextValue,
	GraphColumnConfig,
	GraphColumnName,
	GraphColumnsConfig,
	GraphColumnsSettings,
	GraphCommitContextValue,
	GraphComponentConfig,
	GraphContributorContextValue,
	GraphExcludedRef,
	GraphExcludeRefs,
	GraphExcludeTypes,
	GraphHostingServiceType,
	GraphIncludeOnlyRef,
	GraphItemContext,
	GraphItemGroupContext,
	GraphItemRefContext,
	GraphItemRefGroupContext,
	GraphItemTypedContext,
	GraphItemTypedContextValue,
	GraphMinimapMarkerTypes,
	GraphMissingRefsMetadataType,
	GraphPullRequestContextValue,
	GraphPullRequestMetadata,
	GraphRefMetadata,
	GraphRefMetadataType,
	GraphRepository,
	GraphScrollMarkerTypes,
	GraphSelectedRows,
	GraphStashContextValue,
	GraphTagContextValue,
	GraphUpstreamMetadata,
	GraphUpstreamStatusContextValue,
	GraphWorkingTreeStats,
	SearchOpenInViewParams,
	SearchParams,
	State,
	UpdateColumnsParams,
	UpdateExcludeTypeParams,
	UpdateGraphConfigurationParams,
	UpdateRefsVisibilityParams,
	UpdateSelectionParams,
} from './protocol';
import {
	ChooseRepositoryCommandType,
	DidChangeAvatarsNotificationType,
	DidChangeColumnsNotificationType,
	DidChangeFocusNotificationType,
	DidChangeGraphConfigurationNotificationType,
	DidChangeNotificationType,
	DidChangeRefsMetadataNotificationType,
	DidChangeRefsVisibilityNotificationType,
	DidChangeRowsNotificationType,
	DidChangeRowsStatsNotificationType,
	DidChangeSelectionNotificationType,
	DidChangeSubscriptionNotificationType,
	DidChangeWindowFocusNotificationType,
	DidChangeWorkingTreeNotificationType,
	DidEnsureRowNotificationType,
	DidFetchNotificationType,
	DidSearchNotificationType,
	DimMergeCommitsCommandType,
	DismissBannerCommandType,
	DoubleClickedCommandType,
	EnsureRowCommandType,
	GetMissingAvatarsCommandType,
	GetMissingRefsMetadataCommandType,
	GetMoreRowsCommandType,
	GraphRefMetadataTypes,
	SearchCommandType,
	SearchOpenInViewCommandType,
	supportedRefMetadataTypes,
	UpdateColumnsCommandType,
	UpdateExcludeTypeCommandType,
	UpdateGraphConfigurationCommandType,
	UpdateIncludeOnlyRefsCommandType,
	UpdateRefsVisibilityCommandType,
	UpdateSelectionCommandType,
} from './protocol';

const defaultGraphColumnsSettings: GraphColumnsSettings = {
	ref: { width: 150, isHidden: false },
	graph: { width: 150, isHidden: false },
	message: { width: 300, isHidden: false },
	author: { width: 130, isHidden: false },
	datetime: { width: 130, isHidden: false },
	sha: { width: 130, isHidden: false },
	changes: { width: 130, isHidden: true },
};

export class GraphWebviewProvider implements WebviewProvider<State> {
	private _repository?: Repository;
	private get repository(): Repository | undefined {
		return this._repository;
	}
	private set repository(value: Repository | undefined) {
		if (this._repository === value) {
			this.ensureRepositorySubscriptions();
			return;
		}

		this._repository = value;
		this.resetRepositoryState();
		this.ensureRepositorySubscriptions(true);

		if (this.host.ready) {
			this.updateState();
		}
	}

	private _selection: readonly GitRevisionReference[] | undefined;
	private get activeSelection(): GitRevisionReference | undefined {
		return this._selection?.[0];
	}

	private readonly _disposable: Disposable;
	private _etagSubscription?: number;
	private _etagRepository?: number;
	private _firstSelection = true;
	private _graph?: GitGraph;
	private readonly _ipcNotificationMap = new Map<IpcNotificationType<any>, () => Promise<boolean>>([
		[DidChangeColumnsNotificationType, this.notifyDidChangeColumns],
		[DidChangeGraphConfigurationNotificationType, this.notifyDidChangeConfiguration],
		[DidChangeNotificationType, this.notifyDidChangeState],
		[DidChangeRefsVisibilityNotificationType, this.notifyDidChangeRefsVisibility],
		[DidChangeSelectionNotificationType, this.notifyDidChangeSelection],
		[DidChangeSubscriptionNotificationType, this.notifyDidChangeSubscription],
		[DidChangeWorkingTreeNotificationType, this.notifyDidChangeWorkingTree],
		[DidChangeWindowFocusNotificationType, this.notifyDidChangeWindowFocus],
		[DidFetchNotificationType, this.notifyDidFetch],
	]);
	private _refsMetadata: Map<string, GraphRefMetadata | null> | null | undefined;
	private _search: GitSearch | undefined;
	private _searchCancellation: CancellationTokenSource | undefined;
	private _selectedId?: string;
	private _selectedRows: GraphSelectedRows | undefined;
	private _showDetailsView: Config['graph']['showDetailsView'];
	private _theme: ColorTheme | undefined;
	private _repositoryEventsDisposable: Disposable | undefined;
	private _lastFetchedDisposable: Disposable | undefined;

	private trialBanner?: boolean;
	private isWindowFocused: boolean = true;

	constructor(private readonly container: Container, private readonly host: WebviewController<State>) {
		this._showDetailsView = configuration.get('graph.showDetailsView');
		this._theme = window.activeColorTheme;
		this.ensureRepositorySubscriptions();

		if (this.host.isView()) {
			this.host.description = '✨';
		}

		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			this.container.git.onDidChangeRepositories(() => void this.host.refresh(true)),
			window.onDidChangeActiveColorTheme(this.onThemeChanged, this),
			{
				dispose: () => {
					if (this._repositoryEventsDisposable == null) return;
					this._repositoryEventsDisposable.dispose();
					this._repositoryEventsDisposable = undefined;
				},
			},
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	async onShowing(
		loading: boolean,
		_options: { column?: ViewColumn; preserveFocus?: boolean },
		...args: [Repository, { ref: GitReference }, { state: Partial<State> }] | unknown[]
	): Promise<boolean> {
		this._firstSelection = true;

		const [arg] = args;
		if (isRepository(arg)) {
			this.repository = arg;
		} else if (hasGitReference(arg)) {
			this.repository = this.container.git.getRepository(arg.ref.repoPath);

			let id = arg.ref.ref;
			if (!isSha(id)) {
				id = await this.container.git.resolveReference(arg.ref.repoPath, id, undefined, {
					force: true,
				});
			}

			this.setSelectedRows(id);

			if (this._graph != null) {
				if (this._graph?.ids.has(id)) {
					void this.notifyDidChangeSelection();
					return true;
				}

				void this.onGetMoreRows({ id: id }, true);
			}
		} else {
			if (isSerializedState<State>(arg) && arg.state.selectedRepository != null) {
				this.repository = this.container.git.getRepository(arg.state.selectedRepository);
			}

			if (this.repository == null && this.container.git.repositoryCount > 1) {
				const [contexts] = parseCommandContext(Commands.ShowGraph, undefined, ...args);
				const context = Array.isArray(contexts) ? contexts[0] : contexts;

				if (context.type === 'scm' && context.scm.rootUri != null) {
					this.repository = this.container.git.getRepository(context.scm.rootUri);
				} else if (context.type === 'viewItem' && context.node instanceof RepositoryFolderNode) {
					this.repository = context.node.repo;
				}

				if (this.repository != null && !loading && this.host.ready) {
					this.updateState();
				}
			}
		}

		return true;
	}

	onRefresh(force?: boolean) {
		if (force) {
			this.resetRepositoryState();
		}
	}

	includeBootstrap(): Promise<State> {
		return this.getState(true);
	}

	registerCommands(): Disposable[] {
		return [
			registerCommand(Commands.RefreshGraph, () => this.host.refresh(true)),

			registerCommand('gitlens.graph.push', this.push, this),
			registerCommand('gitlens.graph.pull', this.pull, this),
			registerCommand('gitlens.graph.fetch', this.fetch, this),
			registerCommand('gitlens.graph.publishBranch', this.publishBranch, this),
			registerCommand('gitlens.graph.switchToAnotherBranch', this.switchToAnother, this),

			registerCommand('gitlens.graph.createBranch', this.createBranch, this),
			registerCommand('gitlens.graph.deleteBranch', this.deleteBranch, this),
			registerCommand('gitlens.graph.copyRemoteBranchUrl', item => this.openBranchOnRemote(item, true), this),
			registerCommand('gitlens.graph.openBranchOnRemote', this.openBranchOnRemote, this),
			registerCommand('gitlens.graph.mergeBranchInto', this.mergeBranchInto, this),
			registerCommand('gitlens.graph.rebaseOntoBranch', this.rebase, this),
			registerCommand('gitlens.graph.rebaseOntoUpstream', this.rebaseToRemote, this),
			registerCommand('gitlens.graph.renameBranch', this.renameBranch, this),

			registerCommand('gitlens.graph.switchToBranch', this.switchTo, this),

			registerCommand('gitlens.graph.hideLocalBranch', this.hideRef, this),
			registerCommand('gitlens.graph.hideRemoteBranch', this.hideRef, this),
			registerCommand('gitlens.graph.hideRemote', item => this.hideRef(item, { remote: true }), this),
			registerCommand('gitlens.graph.hideRefGroup', item => this.hideRef(item, { group: true }), this),
			registerCommand('gitlens.graph.hideTag', this.hideRef, this),

			registerCommand('gitlens.graph.cherryPick', this.cherryPick, this),
			registerCommand('gitlens.graph.copyRemoteCommitUrl', item => this.openCommitOnRemote(item, true), this),
			registerCommand('gitlens.graph.showInDetailsView', this.openInDetailsView, this),
			registerCommand('gitlens.graph.openCommitOnRemote', this.openCommitOnRemote, this),
			registerCommand('gitlens.graph.openSCM', this.openSCM, this),
			registerCommand('gitlens.graph.rebaseOntoCommit', this.rebase, this),
			registerCommand('gitlens.graph.resetCommit', this.resetCommit, this),
			registerCommand('gitlens.graph.resetToCommit', this.resetToCommit, this),
			registerCommand('gitlens.graph.revert', this.revertCommit, this),
			registerCommand('gitlens.graph.switchToCommit', this.switchTo, this),
			registerCommand('gitlens.graph.undoCommit', this.undoCommit, this),

			registerCommand('gitlens.graph.saveStash', this.saveStash, this),
			registerCommand('gitlens.graph.applyStash', this.applyStash, this),
			registerCommand('gitlens.graph.stash.delete', this.deleteStash, this),
			registerCommand('gitlens.graph.stash.rename', this.renameStash, this),

			registerCommand('gitlens.graph.createTag', this.createTag, this),
			registerCommand('gitlens.graph.deleteTag', this.deleteTag, this),
			registerCommand('gitlens.graph.switchToTag', this.switchTo, this),

			registerCommand('gitlens.graph.createWorktree', this.createWorktree, this),

			registerCommand('gitlens.graph.createPullRequest', this.createPullRequest, this),
			registerCommand('gitlens.graph.openPullRequestOnRemote', this.openPullRequestOnRemote, this),

			registerCommand('gitlens.graph.compareWithUpstream', this.compareWithUpstream, this),
			registerCommand('gitlens.graph.compareWithHead', this.compareHeadWith, this),
			registerCommand('gitlens.graph.compareWithWorking', this.compareWorkingWith, this),
			registerCommand('gitlens.graph.compareAncestryWithWorking', this.compareAncestryWithWorking, this),

			registerCommand('gitlens.graph.copy', this.copy, this),
			registerCommand('gitlens.graph.copyMessage', this.copyMessage, this),
			registerCommand('gitlens.graph.copySha', this.copySha, this),

			registerCommand('gitlens.graph.addAuthor', this.addAuthor, this),

			registerCommand('gitlens.graph.columnAuthorOn', () => this.toggleColumn('author', true)),
			registerCommand('gitlens.graph.columnAuthorOff', () => this.toggleColumn('author', false)),
			registerCommand('gitlens.graph.columnDateTimeOn', () => this.toggleColumn('datetime', true)),
			registerCommand('gitlens.graph.columnDateTimeOff', () => this.toggleColumn('datetime', false)),
			registerCommand('gitlens.graph.columnShaOn', () => this.toggleColumn('sha', true)),
			registerCommand('gitlens.graph.columnShaOff', () => this.toggleColumn('sha', false)),
			registerCommand('gitlens.graph.columnChangesOn', () => this.toggleColumn('changes', true)),
			registerCommand('gitlens.graph.columnChangesOff', () => this.toggleColumn('changes', false)),
			registerCommand('gitlens.graph.columnGraphOn', () => this.toggleColumn('graph', true)),
			registerCommand('gitlens.graph.columnGraphOff', () => this.toggleColumn('graph', false)),
			registerCommand('gitlens.graph.columnMessageOn', () => this.toggleColumn('message', true)),
			registerCommand('gitlens.graph.columnMessageOff', () => this.toggleColumn('message', false)),
			registerCommand('gitlens.graph.columnRefOn', () => this.toggleColumn('ref', true)),
			registerCommand('gitlens.graph.columnRefOff', () => this.toggleColumn('ref', false)),
			registerCommand('gitlens.graph.columnGraphCompact', () => this.setColumnMode('graph', 'compact')),
			registerCommand('gitlens.graph.columnGraphDefault', () => this.setColumnMode('graph', undefined)),

			registerCommand('gitlens.graph.copyDeepLinkToBranch', this.copyDeepLinkToBranch, this),
			registerCommand('gitlens.graph.copyDeepLinkToCommit', this.copyDeepLinkToCommit, this),
			registerCommand('gitlens.graph.copyDeepLinkToRepo', this.copyDeepLinkToRepo, this),
			registerCommand('gitlens.graph.copyDeepLinkToTag', this.copyDeepLinkToTag, this),

			registerCommand('gitlens.graph.openChangedFiles', this.openFiles, this),
			registerCommand('gitlens.graph.openChangedFileDiffs', this.openAllChanges, this),
			registerCommand('gitlens.graph.openChangedFileDiffsWithWorking', this.openAllChangesWithWorking, this),
			registerCommand('gitlens.graph.openChangedFileRevisions', this.openRevisions, this),
		];
	}

	onWindowFocusChanged(focused: boolean): void {
		this.isWindowFocused = focused;
		void this.notifyDidChangeWindowFocus();
	}

	onFocusChanged(focused: boolean): void {
		void this.notifyDidChangeFocus(focused);

		if (!focused || this.activeSelection == null || !this.container.commitDetailsView.visible) {
			this._showActiveSelectionDetailsDebounced?.cancel();
			return;
		}

		this.showActiveSelectionDetails();
	}

	onVisibilityChanged(visible: boolean): void {
		if (!visible) {
			this._showActiveSelectionDetailsDebounced?.cancel();
		}

		if (
			visible &&
			((this.repository != null && this.repository.etag !== this._etagRepository) ||
				this.container.subscription.etag !== this._etagSubscription)
		) {
			this.updateState(true);
			return;
		}

		if (visible) {
			if (this.host.ready) {
				this.host.sendPendingIpcNotifications();
			}

			const { activeSelection } = this;
			if (activeSelection == null) return;

			this.showActiveSelectionDetails();
		}
	}

	onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case ChooseRepositoryCommandType.method:
				onIpc(ChooseRepositoryCommandType, e, () => this.onChooseRepository());
				break;
			case DimMergeCommitsCommandType.method:
				onIpc(DimMergeCommitsCommandType, e, params => this.dimMergeCommits(params));
				break;
			case DismissBannerCommandType.method:
				onIpc(DismissBannerCommandType, e, params => this.dismissBanner(params));
				break;
			case DoubleClickedCommandType.method:
				onIpc(DoubleClickedCommandType, e, params => this.onDoubleClick(params));
				break;
			case EnsureRowCommandType.method:
				onIpc(EnsureRowCommandType, e, params => this.onEnsureRow(params, e.completionId));
				break;
			case GetMissingAvatarsCommandType.method:
				onIpc(GetMissingAvatarsCommandType, e, params => this.onGetMissingAvatars(params));
				break;
			case GetMissingRefsMetadataCommandType.method:
				onIpc(GetMissingRefsMetadataCommandType, e, params => this.onGetMissingRefMetadata(params));
				break;
			case GetMoreRowsCommandType.method:
				onIpc(GetMoreRowsCommandType, e, params => this.onGetMoreRows(params));
				break;
			case SearchCommandType.method:
				onIpc(SearchCommandType, e, params => this.onSearch(params, e.completionId));
				break;
			case SearchOpenInViewCommandType.method:
				onIpc(SearchOpenInViewCommandType, e, params => this.onSearchOpenInView(params));
				break;
			case UpdateColumnsCommandType.method:
				onIpc(UpdateColumnsCommandType, e, params => this.onColumnsChanged(params));
				break;
			case UpdateGraphConfigurationCommandType.method:
				onIpc(UpdateGraphConfigurationCommandType, e, params => this.updateGraphConfig(params));
				break;
			case UpdateRefsVisibilityCommandType.method:
				onIpc(UpdateRefsVisibilityCommandType, e, params => this.onRefsVisibilityChanged(params));
				break;
			case UpdateSelectionCommandType.method:
				onIpc(UpdateSelectionCommandType, e, this.onSelectionChanged.bind(this));
				break;
			case UpdateExcludeTypeCommandType.method:
				onIpc(UpdateExcludeTypeCommandType, e, params => this.updateExcludedType(this._graph, params));
				break;
			case UpdateIncludeOnlyRefsCommandType.method:
				onIpc(UpdateIncludeOnlyRefsCommandType, e, params =>
					this.updateIncludeOnlyRefs(this._graph, params.refs),
				);
				break;
		}
	}
	updateGraphConfig(params: UpdateGraphConfigurationParams) {
		const config = this.getComponentConfig();

		let key: keyof UpdateGraphConfigurationParams['changes'];
		for (key in params.changes) {
			if (config[key] !== params.changes[key]) {
				switch (key) {
					case 'minimap':
						void configuration.updateEffective('graph.minimap.enabled', params.changes[key]);
						break;
					case 'minimapDataType':
						void configuration.updateEffective('graph.minimap.dataType', params.changes[key]);
						break;
					case 'minimapMarkerTypes': {
						const additionalTypes: GraphMinimapMarkersAdditionalTypes[] = [];

						const markers = params.changes[key] ?? [];
						for (const marker of markers) {
							switch (marker) {
								case 'localBranches':
								case 'remoteBranches':
								case 'stashes':
								case 'tags':
									additionalTypes.push(marker);
									break;
							}
						}
						void configuration.updateEffective('graph.minimap.additionalTypes', additionalTypes);
						break;
					}
					default:
						// TODO:@eamodio add more config options as needed
						debugger;
						break;
				}
			}
		}
	}

	private _showActiveSelectionDetailsDebounced:
		| Deferrable<GraphWebviewProvider['showActiveSelectionDetails']>
		| undefined = undefined;

	private showActiveSelectionDetails() {
		if (this._showActiveSelectionDetailsDebounced == null) {
			this._showActiveSelectionDetailsDebounced = debounce(this.showActiveSelectionDetailsCore.bind(this), 250);
		}

		this._showActiveSelectionDetailsDebounced();
	}

	private showActiveSelectionDetailsCore() {
		const { activeSelection } = this;
		if (activeSelection == null) return;

		this.container.events.fire(
			'commit:selected',
			{
				commit: activeSelection,
				interaction: 'passive',
				preserveFocus: true,
				preserveVisibility: this._showDetailsView === false,
			},
			{
				source: this.host.id,
			},
		);
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'graph.showDetailsView')) {
			this._showDetailsView = configuration.get('graph.showDetailsView');
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
			configuration.changed(e, 'graph.dimMergeCommits') ||
			configuration.changed(e, 'graph.highlightRowsOnRefHover') ||
			configuration.changed(e, 'graph.scrollRowPadding') ||
			configuration.changed(e, 'graph.scrollMarkers.enabled') ||
			configuration.changed(e, 'graph.scrollMarkers.additionalTypes') ||
			configuration.changed(e, 'graph.showGhostRefsOnRowHover') ||
			configuration.changed(e, 'graph.pullRequests.enabled') ||
			configuration.changed(e, 'graph.showRemoteNames') ||
			configuration.changed(e, 'graph.showUpstreamStatus') ||
			configuration.changed(e, 'graph.minimap.enabled') ||
			configuration.changed(e, 'graph.minimap.dataType') ||
			configuration.changed(e, 'graph.minimap.additionalTypes')
		) {
			void this.notifyDidChangeConfiguration();

			if (
				(configuration.changed(e, 'graph.minimap.enabled') ||
					configuration.changed(e, 'graph.minimap.dataType')) &&
				configuration.get('graph.minimap.enabled') &&
				configuration.get('graph.minimap.dataType') === 'lines' &&
				!this._graph?.includes?.stats
			) {
				this.updateState();
			}
		}
	}

	@debug<GraphWebviewProvider['onRepositoryChanged']>({ args: { 0: e => e.toString() } })
	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (
			!e.changed(
				RepositoryChange.Config,
				RepositoryChange.Head,
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

		if (e.changed(RepositoryChange.Head, RepositoryChangeComparisonMode.Any)) {
			this.setSelectedRows(undefined);
		}

		// Unless we don't know what changed, update the state immediately
		this.updateState(!e.changed(RepositoryChange.Unknown, RepositoryChangeComparisonMode.Exclusive));
	}

	@debug({ args: false })
	private onRepositoryFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
		if (e.repository?.path !== this.repository?.path) return;
		void this.notifyDidChangeWorkingTree();
	}

	@debug({ args: false })
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

	private dimMergeCommits(e: DimMergeCommitsParams) {
		void configuration.updateEffective('graph.dimMergeCommits', e.dim);
	}

	private dismissBanner(e: DismissBannerParams) {
		if (e.key === 'trial') {
			this.trialBanner = false;
		}

		let banners = this.container.storage.getWorkspace('graph:banners:dismissed');
		banners = updateRecordValue(banners, e.key, true);
		void this.container.storage.storeWorkspace('graph:banners:dismissed', banners);
	}

	private onColumnsChanged(e: UpdateColumnsParams) {
		this.updateColumns(e.config);
	}

	private onRefsVisibilityChanged(e: UpdateRefsVisibilityParams) {
		this.updateExcludedRefs(this._graph, e.refs, e.visible);
	}

	private onDoubleClick(e: DoubleClickedParams) {
		if (e.type === 'ref' && e.ref.context) {
			let item = this.getGraphItemContext(e.ref.context);
			if (isGraphItemRefContext(item)) {
				if (e.metadata != null) {
					item = this.getGraphItemContext(e.metadata.data.context);
					if (e.metadata.type === 'upstream' && isGraphItemTypedContext(item, 'upstreamStatus')) {
						const { ahead, behind, ref } = item.webviewItemValue;
						if (behind > 0) {
							return void RepoActions.pull(ref.repoPath, ref);
						}
						if (ahead > 0) {
							return void RepoActions.push(ref.repoPath, false, ref);
						}
					} else if (e.metadata.type === 'pullRequest' && isGraphItemTypedContext(item, 'pullrequest')) {
						return void this.openPullRequestOnRemote(item);
					}

					return;
				}

				const { ref } = item.webviewItemValue;
				if (e.ref.refType === 'head' && e.ref.isCurrentHead) {
					return RepoActions.switchTo(ref.repoPath);
				}

				// Override the default confirmation if the setting is unset
				return RepoActions.switchTo(
					ref.repoPath,
					ref,
					configuration.isUnset('gitCommands.skipConfirmations') ? true : undefined,
				);
			}
		} else if (e.type === 'row' && e.row) {
			const commit = this.getRevisionReference(this.repository?.path, e.row.id, e.row.type);
			if (commit != null) {
				this.container.events.fire(
					'commit:selected',
					{
						commit: commit,
						interaction: 'active',
						preserveFocus: e.preserveFocus,
						preserveVisibility: false,
					},
					{
						source: this.host.id,
					},
				);

				const details =
					configuration.get('graph.layout') === 'panel'
						? this.container.graphDetailsView
						: this.container.commitDetailsView;
				if (!details.ready) {
					void details.show({ preserveFocus: e.preserveFocus }, {
						commit: commit,
						interaction: 'active',
						preserveVisibility: false,
					} satisfies CommitSelectedEvent['data']);
				}
			}
		}

		return Promise.resolve();
	}

	@debug()
	private async onEnsureRow(e: EnsureRowParams, completionId?: string) {
		if (this._graph == null) return;

		const ensureId = this._graph.remappedIds?.get(e.id) ?? e.id;

		let id: string | undefined;
		let remapped: string | undefined;
		if (this._graph.ids.has(ensureId)) {
			id = e.id;
			remapped = e.id !== ensureId ? ensureId : undefined;
		} else {
			await this.updateGraphWithMoreRows(this._graph, ensureId, this._search);
			void this.notifyDidChangeRows();
			if (this._graph.ids.has(ensureId)) {
				id = e.id;
				remapped = e.id !== ensureId ? ensureId : undefined;
			}
		}

		void this.host.notify(DidEnsureRowNotificationType, { id: id, remapped: remapped }, completionId);
	}

	private async onGetMissingAvatars(e: GetMissingAvatarsParams) {
		if (this._graph == null) return;

		const repoPath = this._graph.repoPath;

		async function getAvatar(this: GraphWebviewProvider, email: string, id: string) {
			const uri = await getAvatarUri(email, { ref: id, repoPath: repoPath });
			this._graph!.avatars.set(email, uri.toString(true));
		}

		const promises: Promise<void>[] = [];

		for (const [email, id] of Object.entries(e.emails)) {
			if (this._graph.avatars.has(email)) continue;

			promises.push(getAvatar.call(this, email, id));
		}

		if (promises.length) {
			await Promise.allSettled(promises);
			this.updateAvatars();
		}
	}

	private async onGetMissingRefMetadata(e: GetMissingRefsMetadataParams) {
		if (this._graph == null || this._refsMetadata === null || !getContext('gitlens:hasConnectedRemotes')) return;

		const repoPath = this._graph.repoPath;

		async function getRefMetadata(
			this: GraphWebviewProvider,
			id: string,
			missingTypes: GraphMissingRefsMetadataType[],
		) {
			if (this._refsMetadata == null) {
				this._refsMetadata = new Map();
			}

			const branch = (await this.container.git.getBranches(repoPath, { filter: b => b.id === id }))?.values?.[0];
			const metadata = { ...this._refsMetadata.get(id) };

			if (branch == null) {
				for (const type of missingTypes) {
					(metadata as any)[type] = null;
					this._refsMetadata.set(id, metadata);
				}

				return;
			}

			for (const type of missingTypes) {
				if (!supportedRefMetadataTypes.includes(type)) {
					(metadata as any)[type] = null;
					this._refsMetadata.set(id, metadata);

					continue;
				}

				if (type === GraphRefMetadataTypes.PullRequest) {
					const pr = await branch?.getAssociatedPullRequest();

					if (pr == null) {
						if (metadata.pullRequest === undefined || metadata.pullRequest?.length === 0) {
							metadata.pullRequest = null;
						}

						this._refsMetadata.set(id, metadata);
						continue;
					}

					const prMetadata: GraphPullRequestMetadata = {
						// TODO@eamodio: This is iffy, but works right now since `github` and `gitlab` are the only values possible currently
						hostingServiceType: pr.provider.id as GraphHostingServiceType,
						id: Number.parseInt(pr.id) || 0,
						title: pr.title,
						author: pr.author.name,
						date: (pr.mergedDate ?? pr.closedDate ?? pr.date)?.getTime(),
						state: pr.state,
						url: pr.url,
						context: serializeWebviewItemContext<GraphItemContext>({
							webviewItem: 'gitlens:pullrequest',
							webviewItemValue: {
								type: 'pullrequest',
								id: pr.id,
								url: pr.url,
							},
						}),
					};

					metadata.pullRequest = [prMetadata];

					this._refsMetadata.set(id, metadata);
					continue;
				}

				if (type === GraphRefMetadataTypes.Upstream) {
					const upstream = branch?.upstream;

					if (upstream == null || upstream == undefined || upstream.missing) {
						metadata.upstream = null;
						this._refsMetadata.set(id, metadata);
						continue;
					}

					const upstreamMetadata: GraphUpstreamMetadata = {
						name: getBranchNameWithoutRemote(upstream.name),
						owner: getRemoteNameFromBranchName(upstream.name),
						ahead: branch.state.ahead,
						behind: branch.state.behind,
						context: serializeWebviewItemContext<GraphItemContext>({
							webviewItem: 'gitlens:upstreamStatus',
							webviewItemValue: {
								type: 'upstreamStatus',
								ref: getReferenceFromBranch(branch),
								ahead: branch.state.ahead,
								behind: branch.state.behind,
							},
						}),
					};

					metadata.upstream = upstreamMetadata;

					this._refsMetadata.set(id, metadata);
				}
			}
		}

		const promises: Promise<void>[] = [];

		for (const id of Object.keys(e.metadata)) {
			promises.push(getRefMetadata.call(this, id, e.metadata[id]));
		}

		if (promises.length) {
			await Promise.allSettled(promises);
		}
		this.updateRefsMetadata();
	}

	@gate()
	@debug()
	private async onGetMoreRows(e: GetMoreRowsParams, sendSelectedRows: boolean = false) {
		if (this._graph?.paging == null) return;
		if (this._graph?.more == null || this.repository?.etag !== this._etagRepository) {
			this.updateState(true);

			return;
		}

		await this.updateGraphWithMoreRows(this._graph, e.id, this._search);
		void this.notifyDidChangeRows(sendSelectedRows);
	}

	@debug()
	private async onSearch(e: SearchParams, completionId?: string) {
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
				void (await this.ensureSearchStartsInRange(this._graph!, search));

				void this.host.notify(
					DidSearchNotificationType,
					{
						results:
							search.results.size > 0
								? {
										ids: Object.fromEntries(
											map(search.results, ([k, v]) => [this._graph?.remappedIds?.get(k) ?? k, v]),
										),
										count: search.results.size,
										paging: { hasMore: search.paging?.hasMore ?? false },
								  }
								: undefined,
					},
					completionId,
				);
			}

			return;
		}

		if (search == null || search.comparisonKey !== getSearchQueryComparisonKey(e.search)) {
			if (this.repository == null) return;

			if (this.repository.etag !== this._etagRepository) {
				this.updateState(true);
			}

			if (this._searchCancellation != null) {
				this._searchCancellation.cancel();
				this._searchCancellation.dispose();
			}

			const cancellation = new CancellationTokenSource();
			this._searchCancellation = cancellation;

			try {
				search = await this.repository.searchCommits(e.search, {
					limit: configuration.get('graph.searchItemLimit') ?? 100,
					ordering: configuration.get('graph.commitOrdering'),
					cancellation: cancellation.token,
				});
			} catch (ex) {
				this._search = undefined;

				void this.host.notify(
					DidSearchNotificationType,
					{
						results: {
							error: ex instanceof GitSearchError ? 'Invalid search pattern' : 'Unexpected error',
						},
					},
					completionId,
				);
				return;
			}

			if (cancellation.token.isCancellationRequested) {
				if (completionId != null) {
					void this.host.notify(DidSearchNotificationType, { results: undefined }, completionId);
				}
				return;
			}

			this._search = search;
		} else {
			search = this._search!;
		}

		const firstResult = await this.ensureSearchStartsInRange(this._graph!, search);

		let sendSelectedRows = false;
		if (firstResult != null) {
			sendSelectedRows = true;
			this.setSelectedRows(firstResult);
		}

		void this.host.notify(
			DidSearchNotificationType,
			{
				results:
					search.results.size === 0
						? { count: 0 }
						: {
								ids: Object.fromEntries(
									map(search.results, ([k, v]) => [this._graph?.remappedIds?.get(k) ?? k, v]),
								),
								count: search.results.size,
								paging: { hasMore: search.paging?.hasMore ?? false },
						  },
				selectedRows: sendSelectedRows ? this._selectedRows : undefined,
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

	private async onChooseRepository() {
		// Ensure that the current repository is always last
		const repositories = this.container.git.openRepositories.sort(
			(a, b) =>
				(a === this.repository ? 1 : -1) - (b === this.repository ? 1 : -1) ||
				(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
				a.index - b.index,
		);

		const pick = await showRepositoryPicker(
			`Switch Repository ${GlyphChars.Dot} ${this.repository?.name}`,
			'Choose a repository to switch to',
			repositories,
		);
		if (pick == null) return;

		this.repository = pick.item;
	}

	private _fireSelectionChangedDebounced: Deferrable<GraphWebviewProvider['fireSelectionChanged']> | undefined =
		undefined;

	private onSelectionChanged(e: UpdateSelectionParams) {
		const item = e.selection[0];
		this.setSelectedRows(item?.id);

		if (this._fireSelectionChangedDebounced == null) {
			this._fireSelectionChangedDebounced = debounce(this.fireSelectionChanged.bind(this), 250);
		}

		this._fireSelectionChangedDebounced(item?.id, item?.type);
	}

	private fireSelectionChanged(id: string | undefined, type: GitGraphRowType | undefined) {
		if (this.repository == null) return;

		const commit = this.getRevisionReference(this.repository.path, id, type);
		const commits = commit != null ? [commit] : undefined;

		this._selection = commits;

		if (commits == null) return;

		this.container.events.fire(
			'commit:selected',
			{
				commit: commits[0],
				interaction: 'passive',
				preserveFocus: true,
				preserveVisibility: this._firstSelection
					? this._showDetailsView === false
					: this._showDetailsView !== 'selection',
			},
			{
				source: this.host.id,
			},
		);
		this._firstSelection = false;
	}

	private _notifyDidChangeStateDebounced: Deferrable<GraphWebviewProvider['notifyDidChangeState']> | undefined =
		undefined;

	private getRevisionReference(
		repoPath: string | undefined,
		id: string | undefined,
		type: GitGraphRowType | undefined,
	): GitStashReference | GitRevisionReference | undefined {
		if (repoPath == null || id == null) return undefined;

		switch (type) {
			case GitGraphRowType.Stash:
				return createReference(id, repoPath, {
					refType: 'stash',
					name: id,
					number: undefined,
				});

			case GitGraphRowType.Working:
				return createReference(uncommitted, repoPath, { refType: 'revision' });

			default:
				return createReference(id, repoPath, { refType: 'revision' });
		}
	}

	@debug()
	private updateState(immediate: boolean = false) {
		this.host.clearPendingIpcNotifications();

		if (immediate) {
			void this.notifyDidChangeState();
			return;
		}

		if (this._notifyDidChangeStateDebounced == null) {
			this._notifyDidChangeStateDebounced = debounce(this.notifyDidChangeState.bind(this), 250);
		}

		void this._notifyDidChangeStateDebounced();
	}

	@debug()
	private async notifyDidChangeFocus(focused: boolean): Promise<boolean> {
		if (!this.host.ready || !this.host.visible) return false;

		return this.host.notify(DidChangeFocusNotificationType, {
			focused: focused,
		});
	}

	@debug()
	private async notifyDidChangeWindowFocus(): Promise<boolean> {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeWindowFocusNotificationType, this._ipcNotificationMap, this);
			return false;
		}

		return this.host.notify(DidChangeWindowFocusNotificationType, {
			focused: this.isWindowFocused,
		});
	}

	private _notifyDidChangeAvatarsDebounced: Deferrable<GraphWebviewProvider['notifyDidChangeAvatars']> | undefined =
		undefined;

	@debug()
	private updateAvatars(immediate: boolean = false) {
		if (immediate) {
			void this.notifyDidChangeAvatars();
			return;
		}

		if (this._notifyDidChangeAvatarsDebounced == null) {
			this._notifyDidChangeAvatarsDebounced = debounce(this.notifyDidChangeAvatars.bind(this), 100);
		}

		void this._notifyDidChangeAvatarsDebounced();
	}

	@debug()
	private async notifyDidChangeAvatars() {
		if (this._graph == null) return;

		const data = this._graph;
		return this.host.notify(DidChangeAvatarsNotificationType, {
			avatars: Object.fromEntries(data.avatars),
		});
	}

	private _notifyDidChangeRefsMetadataDebounced:
		| Deferrable<GraphWebviewProvider['notifyDidChangeRefsMetadata']>
		| undefined = undefined;

	@debug()
	private updateRefsMetadata(immediate: boolean = false) {
		if (immediate) {
			void this.notifyDidChangeRefsMetadata();
			return;
		}

		if (this._notifyDidChangeRefsMetadataDebounced == null) {
			this._notifyDidChangeRefsMetadataDebounced = debounce(this.notifyDidChangeRefsMetadata.bind(this), 100);
		}

		void this._notifyDidChangeRefsMetadataDebounced();
	}

	@debug()
	private async notifyDidChangeRefsMetadata() {
		return this.host.notify(DidChangeRefsMetadataNotificationType, {
			metadata: this._refsMetadata != null ? Object.fromEntries(this._refsMetadata) : this._refsMetadata,
		});
	}

	@debug()
	private async notifyDidChangeColumns() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeColumnsNotificationType, this._ipcNotificationMap, this);
			return false;
		}

		const columns = this.getColumns();
		const columnSettings = this.getColumnSettings(columns);
		return this.host.notify(DidChangeColumnsNotificationType, {
			columns: columnSettings,
			context: this.getColumnHeaderContext(columnSettings),
		});
	}

	@debug()
	private async notifyDidChangeRefsVisibility() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(
				DidChangeRefsVisibilityNotificationType,
				this._ipcNotificationMap,
				this,
			);
			return false;
		}

		return this.host.notify(DidChangeRefsVisibilityNotificationType, {
			excludeRefs: this.getExcludedRefs(this._graph),
			excludeTypes: this.getExcludedTypes(this._graph),
			includeOnlyRefs: this.getIncludeOnlyRefs(this._graph),
		});
	}

	@debug()
	private async notifyDidChangeConfiguration() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(
				DidChangeGraphConfigurationNotificationType,
				this._ipcNotificationMap,
				this,
			);
			return false;
		}

		return this.host.notify(DidChangeGraphConfigurationNotificationType, {
			config: this.getComponentConfig(),
		});
	}

	@debug()
	private async notifyDidFetch() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidFetchNotificationType, this._ipcNotificationMap, this);
			return false;
		}

		const lastFetched = await this.repository!.getLastFetched();
		return this.host.notify(DidFetchNotificationType, {
			lastFetched: new Date(lastFetched),
		});
	}

	@debug()
	private async notifyDidChangeRows(sendSelectedRows: boolean = false, completionId?: string) {
		if (this._graph == null) return;

		const graph = this._graph;
		return this.host.notify(
			DidChangeRowsNotificationType,
			{
				rows: graph.rows,
				avatars: Object.fromEntries(graph.avatars),
				downstreams: Object.fromEntries(graph.downstreams),
				refsMetadata: this._refsMetadata != null ? Object.fromEntries(this._refsMetadata) : this._refsMetadata,
				rowsStats: graph.rowsStats?.size ? Object.fromEntries(graph.rowsStats) : undefined,
				rowsStatsLoading:
					graph.rowsStatsDeferred?.isLoaded != null ? !graph.rowsStatsDeferred.isLoaded() : false,
				selectedRows: sendSelectedRows ? this._selectedRows : undefined,
				paging: {
					startingCursor: graph.paging?.startingCursor,
					hasMore: graph.paging?.hasMore ?? false,
				},
			},
			completionId,
		);
	}

	@debug()
	private async notifyDidChangeRowsStats(graph: GitGraph) {
		if (graph.rowsStats == null) return;

		return this.host.notify(DidChangeRowsStatsNotificationType, {
			rowsStats: Object.fromEntries(graph.rowsStats),
			rowsStatsLoading: graph.rowsStatsDeferred?.isLoaded != null ? !graph.rowsStatsDeferred.isLoaded() : false,
		});
	}

	@debug()
	private async notifyDidChangeWorkingTree() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeWorkingTreeNotificationType, this._ipcNotificationMap, this);
			return false;
		}

		return this.host.notify(DidChangeWorkingTreeNotificationType, {
			stats: (await this.getWorkingTreeStats()) ?? { added: 0, deleted: 0, modified: 0 },
		});
	}

	@debug()
	private async notifyDidChangeSelection() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeSelectionNotificationType, this._ipcNotificationMap, this);
			return false;
		}

		return this.host.notify(DidChangeSelectionNotificationType, {
			selection: this._selectedRows ?? {},
		});
	}

	@debug()
	private async notifyDidChangeSubscription() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeSubscriptionNotificationType, this._ipcNotificationMap, this);
			return false;
		}

		const [access] = await this.getGraphAccess();
		return this.host.notify(DidChangeSubscriptionNotificationType, {
			subscription: access.subscription.current,
			allowed: access.allowed !== false,
		});
	}

	@debug()
	private async notifyDidChangeState() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeNotificationType, this._ipcNotificationMap, this);
			return false;
		}

		return this.host.notify(DidChangeNotificationType, { state: await this.getState() });
	}

	private ensureRepositorySubscriptions(force?: boolean) {
		void this.ensureLastFetchedSubscription(force);
		if (!force && this._repositoryEventsDisposable != null) return;

		if (this._repositoryEventsDisposable != null) {
			this._repositoryEventsDisposable.dispose();
			this._repositoryEventsDisposable = undefined;
		}

		const repo = this.repository;
		if (repo == null) return;

		this._repositoryEventsDisposable = Disposable.from(
			repo.onDidChange(this.onRepositoryChanged, this),
			repo.startWatchingFileSystem(),
			repo.onDidChangeFileSystem(this.onRepositoryFileSystemChanged, this),
			onDidChangeContext(key => {
				if (key !== 'gitlens:hasConnectedRemotes') return;

				this.resetRefsMetadata();
				this.updateRefsMetadata();
			}),
		);
	}

	private async ensureLastFetchedSubscription(force?: boolean) {
		if (!force && this._lastFetchedDisposable != null) return;

		if (this._lastFetchedDisposable != null) {
			this._lastFetchedDisposable.dispose();
			this._lastFetchedDisposable = undefined;
		}

		const repo = this.repository;
		if (repo == null) return;

		const lastFetched = (await repo.getLastFetched()) ?? 0;

		let interval = Repository.getLastFetchedUpdateInterval(lastFetched);
		if (lastFetched !== 0 && interval > 0) {
			this._lastFetchedDisposable = disposableInterval(() => {
				// Check if the interval should change, and if so, reset it
				const checkInterval = Repository.getLastFetchedUpdateInterval(lastFetched);
				if (interval !== Repository.getLastFetchedUpdateInterval(lastFetched)) {
					interval = checkInterval;
				}

				void this.notifyDidFetch();
			}, interval);
		}
	}

	private async ensureSearchStartsInRange(graph: GitGraph, search: GitSearch) {
		if (search.results.size === 0) return undefined;

		let firstResult: string | undefined;
		for (const id of search.results.keys()) {
			const remapped = graph.remappedIds?.get(id) ?? id;
			if (graph.ids.has(remapped)) return remapped;

			firstResult = remapped;
			break;
		}

		if (firstResult == null) return undefined;

		await this.updateGraphWithMoreRows(graph, firstResult);
		void this.notifyDidChangeRows();

		return graph.ids.has(firstResult) ? firstResult : undefined;
	}

	private getColumns(): Record<GraphColumnName, GraphColumnConfig> | undefined {
		return this.container.storage.getWorkspace('graph:columns');
	}

	private getExcludedTypes(graph: GitGraph | undefined): GraphExcludeTypes | undefined {
		if (graph == null) return undefined;

		return this.getFiltersByRepo(graph)?.excludeTypes;
	}

	private getExcludedRefs(graph: GitGraph | undefined): Record<string, GraphExcludedRef> | undefined {
		if (graph == null) return undefined;

		let filtersByRepo: Record<string, StoredGraphFilters> | undefined;

		const storedHiddenRefs = this.container.storage.getWorkspace('graph:hiddenRefs');
		if (storedHiddenRefs != null && Object.keys(storedHiddenRefs).length !== 0) {
			// Migrate hidden refs to exclude refs
			filtersByRepo = this.container.storage.getWorkspace('graph:filtersByRepo') ?? {};

			for (const id in storedHiddenRefs) {
				const repoPath = getRepoPathFromBranchOrTagId(id);

				filtersByRepo[repoPath] = filtersByRepo[repoPath] ?? {};
				filtersByRepo[repoPath].excludeRefs = updateRecordValue(
					filtersByRepo[repoPath].excludeRefs,
					id,
					storedHiddenRefs[id],
				);
			}

			void this.container.storage.storeWorkspace('graph:filtersByRepo', filtersByRepo);
			void this.container.storage.deleteWorkspace('graph:hiddenRefs');
		}

		const storedExcludeRefs = (filtersByRepo?.[graph.repoPath] ?? this.getFiltersByRepo(graph))?.excludeRefs;
		if (storedExcludeRefs == null || Object.keys(storedExcludeRefs).length === 0) return undefined;

		const useAvatars = configuration.get('graph.avatars', undefined, true);

		const excludeRefs: GraphExcludeRefs = {};

		const asWebviewUri = (uri: Uri) => this.host.asWebviewUri(uri);
		for (const id in storedExcludeRefs) {
			const ref: GraphExcludedRef = { ...storedExcludeRefs[id] };
			if (ref.type === 'remote' && ref.owner) {
				const remote = graph.remotes.get(ref.owner);
				if (remote != null) {
					ref.avatarUrl = (
						(useAvatars ? remote.provider?.avatarUri : undefined) ??
						getRemoteIconUri(this.container, remote, asWebviewUri)
					)?.toString(true);
				}
			}

			excludeRefs[id] = ref;
		}

		// For v13, we return directly the hidden refs without validating them

		// This validation has too much performance impact. So we decided to comment those lines
		// for v13 and have it as tech debt to solve after we launch.
		// See: https://github.com/gitkraken/vscode-gitlens/pull/2211#discussion_r990117432
		// if (this.repository == null) {
		// 	this.repository = this.container.git.getBestRepositoryOrFirst();
		// 	if (this.repository == null) return undefined;
		// }

		// const [hiddenBranches, hiddenTags] = await Promise.all([
		// 	this.repository.getBranches({
		// 		filter: b => !b.current && excludeRefs[b.id] != undefined,
		// 	}),
		// 	this.repository.getTags({
		// 		filter: t => excludeRefs[t.id] != undefined,
		// 	}),
		// ]);

		// const filteredHiddenRefsById: GraphHiddenRefs = {};

		// for (const hiddenBranch of hiddenBranches.values) {
		// 	filteredHiddenRefsById[hiddenBranch.id] = excludeRefs[hiddenBranch.id];
		// }

		// for (const hiddenTag of hiddenTags.values) {
		// 	filteredHiddenRefsById[hiddenTag.id] = excludeRefs[hiddenTag.id];
		// }

		// return filteredHiddenRefsById;

		return excludeRefs;
	}

	private getIncludeOnlyRefs(graph: GitGraph | undefined): Record<string, GraphIncludeOnlyRef> | undefined {
		if (graph == null) return undefined;

		const storedFilters = this.getFiltersByRepo(graph);
		const storedIncludeOnlyRefs = storedFilters?.includeOnlyRefs;
		if (storedIncludeOnlyRefs == null || Object.keys(storedIncludeOnlyRefs).length === 0) return undefined;

		const includeOnlyRefs: Record<string, StoredGraphIncludeOnlyRef> = {};

		for (const [key, value] of Object.entries(storedIncludeOnlyRefs)) {
			let branch;
			if (value.id === 'HEAD') {
				branch = find(graph.branches.values(), b => b.current);
				if (branch == null) continue;

				includeOnlyRefs[branch.id] = { ...value, id: branch.id, name: branch.name };
			} else {
				includeOnlyRefs[key] = value;
			}

			// Add the upstream branches for any local branches if there are any
			if (value.type === 'head') {
				branch = branch ?? graph.branches.get(value.name);
				if (branch?.upstream != null && !branch.upstream.missing) {
					const id = getBranchId(graph.repoPath, true, branch.upstream.name);
					includeOnlyRefs[id] = {
						id: id,
						type: 'remote',
						name: getBranchNameWithoutRemote(branch.upstream.name),
						owner: getRemoteNameFromBranchName(branch.upstream.name),
					};
				}
			}
		}

		return includeOnlyRefs;
	}

	private getFiltersByRepo(graph: GitGraph | undefined): StoredGraphFilters | undefined {
		if (graph == null) return undefined;

		const filters = this.container.storage.getWorkspace('graph:filtersByRepo');
		return filters?.[graph.repoPath];
	}

	private getColumnSettings(columns: Record<GraphColumnName, GraphColumnConfig> | undefined): GraphColumnsSettings {
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

	private getColumnHeaderContext(columnSettings: GraphColumnsSettings): string {
		const contextItems: string[] = [];
		// Old column settings that didn't get cleaned up can mess with calculation of only visible column.
		// All currently used ones are listed here.
		const validColumns = ['author', 'changes', 'datetime', 'graph', 'message', 'ref', 'sha'];

		let visibleColumns = 0;
		for (const [name, settings] of Object.entries(columnSettings)) {
			if (!validColumns.includes(name)) continue;

			if (!settings.isHidden) {
				visibleColumns++;
			}
			contextItems.push(
				`${name}:${settings.isHidden ? 'hidden' : 'visible'}${settings.mode ? `+${settings.mode}` : ''}`,
			);
		}

		if (visibleColumns > 1) {
			contextItems.push('columns:canHide');
		}

		return serializeWebviewItemContext<GraphItemContext>({
			webviewItem: 'gitlens:graph:columns',
			webviewItemValue: contextItems.join(','),
		});
	}

	private getComponentConfig(): GraphComponentConfig {
		const config: GraphComponentConfig = {
			avatars: configuration.get('graph.avatars'),
			dateFormat:
				configuration.get('graph.dateFormat') ?? configuration.get('defaultDateFormat') ?? 'short+short',
			dateStyle: configuration.get('graph.dateStyle') ?? configuration.get('defaultDateStyle'),
			enabledRefMetadataTypes: this.getEnabledRefMetadataTypes(),
			dimMergeCommits: configuration.get('graph.dimMergeCommits'),
			enableMultiSelection: false,
			highlightRowsOnRefHover: configuration.get('graph.highlightRowsOnRefHover'),
			minimap: configuration.get('graph.minimap.enabled'),
			minimapDataType: configuration.get('graph.minimap.dataType'),
			minimapMarkerTypes: this.getMinimapMarkerTypes(),
			scrollRowPadding: configuration.get('graph.scrollRowPadding'),
			scrollMarkerTypes: this.getScrollMarkerTypes(),
			showGhostRefsOnRowHover: configuration.get('graph.showGhostRefsOnRowHover'),
			showRemoteNamesOnRefs: configuration.get('graph.showRemoteNames'),
			idLength: configuration.get('advanced.abbreviatedShaLength'),
		};
		return config;
	}

	private getScrollMarkerTypes(): GraphScrollMarkerTypes[] {
		if (!configuration.get('graph.scrollMarkers.enabled')) return [];

		const markers: GraphScrollMarkerTypes[] = [
			'selection',
			'highlights',
			'head',
			'upstream',
			...configuration.get('graph.scrollMarkers.additionalTypes'),
		];

		return markers;
	}

	private getMinimapMarkerTypes(): GraphMinimapMarkerTypes[] {
		if (!configuration.get('graph.minimap.enabled')) return [];

		const markers: GraphMinimapMarkerTypes[] = [
			'selection',
			'highlights',
			'head',
			'upstream',
			...configuration.get('graph.minimap.additionalTypes'),
		];

		return markers;
	}

	private getEnabledRefMetadataTypes(): GraphRefMetadataType[] {
		const types: GraphRefMetadataType[] = [];
		if (configuration.get('graph.pullRequests.enabled')) {
			types.push(GraphRefMetadataTypes.PullRequest as GraphRefMetadataType);
		}

		if (configuration.get('graph.showUpstreamStatus')) {
			types.push(GraphRefMetadataTypes.Upstream as GraphRefMetadataType);
		}

		return types;
	}

	private async getGraphAccess() {
		let access = await this.container.git.access(PlusFeatures.Graph, this.repository?.path);
		this._etagSubscription = this.container.subscription.etag;

		// If we don't have access to GitLens+, but the preview trial hasn't been started, auto-start it
		if (access.allowed === false && access.subscription.current.previewTrial == null) {
			await this.container.subscription.startPreviewTrial(true);
			access = await this.container.git.access(PlusFeatures.Graph, this.repository?.path);
		}

		let visibility = access?.visibility;
		if (visibility == null && this.repository != null) {
			visibility = await this.container.git.visibility(this.repository?.path);
		}

		return [access, visibility] as const;
	}

	private getGraphItemContext(context: unknown): unknown | undefined {
		const item = typeof context === 'string' ? JSON.parse(context) : context;
		// Add the `webview` prop to the context if its missing (e.g. when this context doesn't come through via the context menus)
		if (item != null && !('webview' in item)) {
			item.webview = this.host.id;
		}
		return item;
	}

	private async getWorkingTreeStats(): Promise<GraphWorkingTreeStats | undefined> {
		if (this.repository == null || this.container.git.repositoryCount === 0) return undefined;

		const status = await this.container.git.getStatusForRepo(this.repository.path);
		const workingTreeStatus = status?.getDiffStatus();
		return {
			added: workingTreeStatus?.added ?? 0,
			deleted: workingTreeStatus?.deleted ?? 0,
			modified: workingTreeStatus?.changed ?? 0,
			context: serializeWebviewItemContext<GraphItemContext>({
				webviewItem: 'gitlens:wip',
				webviewItemValue: {
					type: 'commit',
					ref: this.getRevisionReference(this.repository.path, uncommitted, GitGraphRowType.Working)!,
				},
			}),
		};
	}

	private async getState(deferRows?: boolean): Promise<State> {
		if (this.container.git.repositoryCount === 0) {
			return { timestamp: Date.now(), allowed: true, repositories: [] };
		}

		if (this.trialBanner == null) {
			const banners = this.container.storage.getWorkspace('graph:banners:dismissed');
			if (this.trialBanner == null) {
				this.trialBanner = !banners?.['trial'];
			}
		}

		if (this.repository == null) {
			this.repository = this.container.git.getBestRepositoryOrFirst();
			if (this.repository == null) {
				return { timestamp: Date.now(), allowed: true, repositories: [] };
			}
		}

		this._etagRepository = this.repository?.etag;
		this.host.title = `${this.host.originalTitle}: ${this.repository.formattedName}`;

		const { defaultItemLimit } = configuration.get('graph');

		// If we have a set of data refresh to the same set
		const limit = Math.max(defaultItemLimit, this._graph?.ids.size ?? defaultItemLimit);

		const ref = this._selectedId == null || this._selectedId === uncommitted ? 'HEAD' : this._selectedId;

		const columns = this.getColumns();
		const columnSettings = this.getColumnSettings(columns);

		const dataPromise = this.container.git.getCommitsForGraph(
			this.repository.path,
			uri => this.host.asWebviewUri(uri),
			{
				include: {
					stats:
						(configuration.get('graph.minimap.enabled') &&
							configuration.get('graph.minimap.dataType') === 'lines') ||
						!columnSettings.changes.isHidden,
				},
				limit: limit,
				ref: ref,
			},
		);

		// Check for GitLens+ access and working tree stats
		const promises = Promise.allSettled([
			this.getGraphAccess(),
			this.getWorkingTreeStats(),
			this.repository.getBranch(),
			this.repository.getLastFetched(),
		]);

		let data;
		if (deferRows) {
			queueMicrotask(async () => {
				const data = await dataPromise;
				this.setGraph(data);
				this.setSelectedRows(data.id);

				void this.notifyDidChangeRefsVisibility();
				void this.notifyDidChangeRows(true);
			});
		} else {
			data = await dataPromise;
			this.setGraph(data);
			this.setSelectedRows(data.id);
		}

		const [accessResult, workingStatsResult, branchResult, lastFetchedResult] = await promises;
		const [access, visibility] = getSettledValue(accessResult) ?? [];

		let branchState: BranchState | undefined;

		const branch = getSettledValue(branchResult);
		if (branch != null) {
			branchState = { ...branch.state };

			if (branch.upstream != null) {
				branchState.upstream = branch.upstream.name;

				const remote = await branch.getRemote();
				if (remote?.provider != null) {
					branchState.provider = {
						name: remote.provider.name,
						icon: remote.provider.icon === 'remote' ? 'cloud' : remote.provider.icon,
						url: remote.provider.url({ type: RemoteResourceType.Repo }),
					};
				}
			}
		}

		return {
			timestamp: Date.now(),
			windowFocused: this.isWindowFocused,
			trialBanner: this.trialBanner,
			repositories: formatRepositories(this.container.git.openRepositories),
			selectedRepository: this.repository.path,
			selectedRepositoryVisibility: visibility,
			branchName: branch?.name,
			branchState: branchState,
			lastFetched: new Date(getSettledValue(lastFetchedResult)!),
			selectedRows: this._selectedRows,
			subscription: access?.subscription.current,
			allowed: (access?.allowed ?? false) !== false,
			avatars: data != null ? Object.fromEntries(data.avatars) : undefined,
			refsMetadata: this.resetRefsMetadata() === null ? null : {},
			loading: deferRows,
			rowsStatsLoading: data?.rowsStatsDeferred?.isLoaded != null ? !data.rowsStatsDeferred.isLoaded() : false,
			rows: data?.rows,
			downstreams: data != null ? Object.fromEntries(data.downstreams) : undefined,
			paging:
				data != null
					? {
							startingCursor: data.paging?.startingCursor,
							hasMore: data.paging?.hasMore ?? false,
					  }
					: undefined,
			columns: columnSettings,
			config: this.getComponentConfig(),
			context: {
				header: this.getColumnHeaderContext(columnSettings),
			},
			excludeRefs: data != null ? this.getExcludedRefs(data) ?? {} : {},
			excludeTypes: this.getExcludedTypes(data) ?? {},
			includeOnlyRefs: data != null ? this.getIncludeOnlyRefs(data) ?? {} : {},
			nonce: this.host.cspNonce,
			workingTreeStats: getSettledValue(workingStatsResult) ?? { added: 0, deleted: 0, modified: 0 },
		};
	}

	private updateColumns(columnsCfg: GraphColumnsConfig) {
		let columns = this.container.storage.getWorkspace('graph:columns');
		for (const [key, value] of Object.entries(columnsCfg)) {
			columns = updateRecordValue(columns, key, value);
		}
		void this.container.storage.storeWorkspace('graph:columns', columns);
		void this.notifyDidChangeColumns();
	}

	private updateExcludedRefs(graph: GitGraph | undefined, refs: GraphExcludedRef[], visible: boolean) {
		if (refs == null || refs.length === 0) return;

		let storedExcludeRefs: StoredGraphFilters['excludeRefs'] = this.getFiltersByRepo(graph)?.excludeRefs ?? {};
		for (const ref of refs) {
			storedExcludeRefs = updateRecordValue(
				storedExcludeRefs,
				ref.id,
				visible
					? undefined
					: { id: ref.id, type: ref.type as StoredGraphRefType, name: ref.name, owner: ref.owner },
			);
		}

		void this.updateFiltersByRepo(graph, { excludeRefs: storedExcludeRefs });
		void this.notifyDidChangeRefsVisibility();
	}

	private updateFiltersByRepo(graph: GitGraph | undefined, updates: Partial<StoredGraphFilters>) {
		if (graph == null) throw new Error('Cannot save repository filters since Graph is undefined');

		const filtersByRepo = this.container.storage.getWorkspace('graph:filtersByRepo');
		return this.container.storage.storeWorkspace(
			'graph:filtersByRepo',
			updateRecordValue(filtersByRepo, graph.repoPath, { ...filtersByRepo?.[graph.repoPath], ...updates }),
		);
	}

	private updateIncludeOnlyRefs(graph: GitGraph | undefined, refs: GraphIncludeOnlyRef[] | undefined) {
		let storedIncludeOnlyRefs: StoredGraphFilters['includeOnlyRefs'];

		if (refs == null || refs.length === 0) {
			if (this.getFiltersByRepo(graph)?.includeOnlyRefs == null) return;

			storedIncludeOnlyRefs = undefined;
		} else {
			storedIncludeOnlyRefs = {};
			for (const ref of refs) {
				storedIncludeOnlyRefs[ref.id] = {
					id: ref.id,
					type: ref.type as StoredGraphRefType,
					name: ref.name,
					owner: ref.owner,
				};
			}
		}

		void this.updateFiltersByRepo(graph, { includeOnlyRefs: storedIncludeOnlyRefs });
		void this.notifyDidChangeRefsVisibility();
	}

	private updateExcludedType(graph: GitGraph | undefined, { key, value }: UpdateExcludeTypeParams) {
		let excludeTypes = this.getFiltersByRepo(graph)?.excludeTypes;
		if ((excludeTypes == null || Object.keys(excludeTypes).length === 0) && value === false) {
			return;
		}

		excludeTypes = updateRecordValue(excludeTypes, key, value);

		void this.updateFiltersByRepo(graph, { excludeTypes: excludeTypes });
		void this.notifyDidChangeRefsVisibility();
	}

	private resetRefsMetadata(): null | undefined {
		this._refsMetadata = getContext('gitlens:hasConnectedRemotes') ? undefined : null;
		return this._refsMetadata;
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

	private setSelectedRows(id: string | undefined) {
		if (this._selectedId === id) return;

		this._selectedId = id;
		if (id === uncommitted) {
			id = GitGraphRowType.Working;
		}
		this._selectedRows = id != null ? { [id]: true } : undefined;
	}

	private setGraph(graph: GitGraph | undefined) {
		this._graph = graph;
		if (graph == null) {
			this.resetRefsMetadata();
			this.resetSearchState();
		} else {
			void graph.rowsStatsDeferred?.promise.then(() => void this.notifyDidChangeRowsStats(graph));
		}
	}

	private async updateGraphWithMoreRows(graph: GitGraph, id: string | undefined, search?: GitSearch) {
		const { defaultItemLimit, pageItemLimit } = configuration.get('graph');
		const updatedGraph = await graph.more?.(pageItemLimit ?? defaultItemLimit, id);
		if (updatedGraph != null) {
			this.setGraph(updatedGraph);

			if (!search?.paging?.hasMore) return;

			const lastId = last(search.results)?.[0];
			if (lastId == null) return;

			const remapped = updatedGraph.remappedIds?.get(lastId) ?? lastId;
			if (updatedGraph.ids.has(remapped)) {
				queueMicrotask(() => void this.onSearch({ search: search.query, more: true }));
			}
		} else {
			debugger;
		}
	}

	@debug()
	private fetch(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'branch');
		void RepoActions.fetch(this.repository, ref);
	}

	@debug()
	private pull(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'branch');
		void RepoActions.pull(this.repository, ref);
	}

	@debug()
	private push(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		void RepoActions.push(this.repository, undefined, ref);
	}

	@debug()
	private createBranch(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return BranchActions.create(ref.repoPath, ref);
	}

	@debug()
	private deleteBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return BranchActions.remove(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private mergeBranchInto(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return RepoActions.merge(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private openBranchOnRemote(item?: GraphItemContext, clipboard?: boolean) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
				repoPath: ref.repoPath,
				resource: {
					type: RemoteResourceType.Branch,
					branch: ref.name,
				},
				remote: ref.upstream?.name,
				clipboard: clipboard,
			});
		}

		return Promise.resolve();
	}

	@debug()
	private publishBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return RepoActions.push(ref.repoPath, undefined, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private rebase(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return RepoActions.rebase(ref.repoPath, ref);
	}

	@debug()
	private rebaseToRemote(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (ref.upstream != null) {
				return RepoActions.rebase(
					ref.repoPath,
					createReference(ref.upstream.name, ref.repoPath, {
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
	private renameBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return BranchActions.rename(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private cherryPick(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return RepoActions.cherryPick(ref.repoPath, ref);
	}

	@debug()
	private async copy(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref != null) {
			await env.clipboard.writeText(
				ref.refType === 'revision' && ref.message ? `${ref.name}: ${ref.message}` : ref.name,
			);
		} else if (isGraphItemTypedContext(item, 'contributor')) {
			const { name, email } = item.webviewItemValue;
			await env.clipboard.writeText(`${name}${email ? ` <${email}>` : ''}`);
		} else if (isGraphItemTypedContext(item, 'pullrequest')) {
			const { url } = item.webviewItemValue;
			await env.clipboard.writeText(url);
		}

		return Promise.resolve();
	}

	@debug()
	private copyMessage(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return executeCommand<CopyMessageToClipboardCommandArgs>(Commands.CopyMessageToClipboard, {
			repoPath: ref.repoPath,
			sha: ref.ref,
			message: 'message' in ref ? ref.message : undefined,
		});
	}

	@debug()
	private async copySha(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		let sha = ref.ref;
		if (!isSha(sha)) {
			sha = await this.container.git.resolveReference(ref.repoPath, sha, undefined, { force: true });
		}

		return executeCommand<CopyShaToClipboardCommandArgs>(Commands.CopyShaToClipboard, {
			sha: sha,
		});
	}

	@debug()
	private openInDetailsView(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		if (this.host.isView()) {
			return void showGraphDetailsView(ref, { preserveFocus: true, preserveVisibility: false });
		}

		return executeCommand<ShowCommitsInViewCommandArgs>(Commands.ShowInDetailsView, {
			repoPath: ref.repoPath,
			refs: [ref.ref],
		});
	}

	@debug()
	private openSCM(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return executeCoreCommand('workbench.view.scm');
	}

	@debug()
	private openCommitOnRemote(item?: GraphItemContext, clipboard?: boolean) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
			repoPath: ref.repoPath,
			resource: {
				type: RemoteResourceType.Commit,
				sha: ref.ref,
			},
			clipboard: clipboard,
		});
	}

	@debug()
	private copyDeepLinkToBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<CopyDeepLinkCommandArgs>(Commands.CopyDeepLinkToBranch, { refOrRepoPath: ref });
		}

		return Promise.resolve();
	}

	@debug()
	private copyDeepLinkToCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return executeCommand<CopyDeepLinkCommandArgs>(Commands.CopyDeepLinkToCommit, { refOrRepoPath: ref });
	}

	@debug()
	private copyDeepLinkToRepo(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (!ref.remote) return Promise.resolve();

			return executeCommand<CopyDeepLinkCommandArgs>(Commands.CopyDeepLinkToRepo, {
				refOrRepoPath: ref.repoPath,
				remote: getRemoteNameFromBranchName(ref.name),
			});
		}

		return Promise.resolve();
	}

	@debug()
	private copyDeepLinkToTag(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'tag')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<CopyDeepLinkCommandArgs>(Commands.CopyDeepLinkToTag, { refOrRepoPath: ref });
		}

		return Promise.resolve();
	}

	@debug()
	private resetCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return RepoActions.reset(
			ref.repoPath,
			createReference(`${ref.ref}^`, ref.repoPath, {
				refType: 'revision',
				name: `${ref.name}^`,
				message: ref.message,
			}),
		);
	}

	@debug()
	private resetToCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return RepoActions.reset(ref.repoPath, ref);
	}

	@debug()
	private revertCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return RepoActions.revert(ref.repoPath, ref);
	}

	@debug()
	private switchTo(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return RepoActions.switchTo(ref.repoPath, ref);
	}

	@debug()
	private hideRef(item?: GraphItemContext, options?: { group?: boolean; remote?: boolean }) {
		let refs;
		if (options?.group && isGraphItemRefGroupContext(item)) {
			({ refs } = item.webviewItemGroupValue);
		} else if (!options?.group && isGraphItemRefContext(item)) {
			const { ref } = item.webviewItemValue;
			if (ref.id != null) {
				refs = [ref];
			}
		}

		if (refs != null) {
			this.updateExcludedRefs(
				this._graph,
				refs.map(r => {
					const remoteBranch = r.refType === 'branch' && r.remote;
					return {
						id: r.id!,
						name: remoteBranch ? (options?.remote ? '*' : getBranchNameWithoutRemote(r.name)) : r.name,
						owner: remoteBranch ? getRemoteNameFromBranchName(r.name) : undefined,
						type: r.refType === 'branch' ? (r.remote ? 'remote' : 'head') : 'tag',
					};
				}),
				false,
			);
		}

		return Promise.resolve();
	}

	@debug()
	private switchToAnother(item?: GraphItemContext | unknown) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return RepoActions.switchTo(this.repository?.path);

		return RepoActions.switchTo(ref.repoPath);
	}

	@debug()
	private async undoCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		const repo = await this.container.git.getOrOpenScmRepository(ref.repoPath);
		const commit = await repo?.getCommit('HEAD');

		if (commit?.hash !== ref.ref) {
			void window.showWarningMessage(
				`Commit ${getReferenceLabel(ref, {
					capitalize: true,
					icon: false,
				})} cannot be undone, because it is no longer the most recent commit.`,
			);

			return;
		}

		return void executeCoreGitCommand('git.undoCommit', ref.repoPath);
	}

	@debug()
	private saveStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return StashActions.push(ref.repoPath);
	}

	@debug()
	private applyStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return StashActions.apply(ref.repoPath, ref);
	}

	@debug()
	private deleteStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return StashActions.drop(ref.repoPath, ref);
	}

	@debug()
	private renameStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return StashActions.rename(ref.repoPath, ref);
	}

	@debug()
	private async createTag(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return TagActions.create(ref.repoPath, ref);
	}

	@debug()
	private deleteTag(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'tag')) {
			const { ref } = item.webviewItemValue;
			return TagActions.remove(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@debug()
	private async createWorktree(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return WorktreeActions.create(ref.repoPath, undefined, ref);
	}

	@debug()
	private async createPullRequest(item?: GraphItemContext) {
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
	private openPullRequestOnRemote(item?: GraphItemContext, clipboard?: boolean) {
		if (
			isGraphItemContext(item) &&
			typeof item.webviewItemValue === 'object' &&
			item.webviewItemValue.type === 'pullrequest'
		) {
			const { url } = item.webviewItemValue;
			return executeCommand<OpenPullRequestOnRemoteCommandArgs>(Commands.OpenPullRequestOnRemote, {
				pr: { url: url },
				clipboard: clipboard,
			});
		}

		return Promise.resolve();
	}

	@debug()
	private async compareAncestryWithWorking(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		const branch = await this.container.git.getBranch(ref.repoPath);
		if (branch == null) return undefined;

		const commonAncestor = await this.container.git.getMergeBase(ref.repoPath, branch.ref, ref.ref);
		if (commonAncestor == null) return undefined;

		return this.container.searchAndCompareView.compare(
			ref.repoPath,
			{
				ref: commonAncestor,
				label: `ancestry with ${ref.ref} (${shortenRevision(commonAncestor)})`,
			},
			'',
		);
	}

	@debug()
	private compareHeadWith(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return this.container.searchAndCompareView.compare(ref.repoPath, 'HEAD', ref.ref);
	}

	@debug()
	private compareWithUpstream(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (ref.upstream != null) {
				return this.container.searchAndCompareView.compare(ref.repoPath, ref.ref, ref.upstream.name);
			}
		}

		return Promise.resolve();
	}

	@debug()
	private compareWorkingWith(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return this.container.searchAndCompareView.compare(ref.repoPath, '', ref.ref);
	}

	@debug()
	private async openFiles(item?: GraphItemContext) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openFiles(commit);
	}

	@debug()
	private async openAllChanges(item?: GraphItemContext) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openAllChanges(commit);
	}

	@debug()
	private async openAllChangesWithWorking(item?: GraphItemContext) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openAllChangesWithWorking(commit);
	}

	@debug()
	private async openRevisions(item?: GraphItemContext) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openFilesAtRevision(commit);
	}

	@debug()
	private addAuthor(item?: GraphItemContext) {
		if (isGraphItemTypedContext(item, 'contributor')) {
			const { repoPath, name, email, current } = item.webviewItemValue;
			return ContributorActions.addAuthors(
				repoPath,
				new GitContributor(repoPath, name, email, 0, undefined, current),
			);
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

		if (name === 'changes' && !column.isHidden && !this._graph?.includes?.stats) {
			this.updateState();
		}
	}

	@debug()
	private async setColumnMode(name: GraphColumnName, mode?: string) {
		let columns = this.container.storage.getWorkspace('graph:columns');
		let column = columns?.[name];
		if (column != null) {
			column.mode = mode;
		} else {
			column = { mode: mode };
		}

		columns = updateRecordValue(columns, name, column);
		await this.container.storage.storeWorkspace('graph:columns', columns);

		void this.notifyDidChangeColumns();
	}

	private getCommitFromGraphItemRef(item?: GraphItemContext): Promise<GitCommit | undefined> {
		let ref: GitRevisionReference | GitStashReference | undefined = this.getGraphItemRef(item, 'revision');
		if (ref != null) return this.container.git.getCommit(ref.repoPath, ref.ref);

		ref = this.getGraphItemRef(item, 'stash');
		if (ref != null) return this.container.git.getCommit(ref.repoPath, ref.ref);

		return Promise.resolve(undefined);
	}

	private getGraphItemRef(item?: GraphItemContext | unknown | undefined): GitReference | undefined;
	private getGraphItemRef(
		item: GraphItemContext | unknown | undefined,
		refType: 'branch',
	): GitBranchReference | undefined;
	private getGraphItemRef(
		item: GraphItemContext | unknown | undefined,
		refType: 'revision',
	): GitRevisionReference | undefined;
	private getGraphItemRef(
		item: GraphItemContext | unknown | undefined,
		refType: 'stash',
	): GitStashReference | undefined;
	private getGraphItemRef(item: GraphItemContext | unknown | undefined, refType: 'tag'): GitTagReference | undefined;
	private getGraphItemRef(
		item?: GraphItemContext | unknown,
		refType?: 'branch' | 'revision' | 'stash' | 'tag',
	): GitReference | undefined {
		if (item == null) {
			const ref = this.activeSelection;
			return ref != null && (refType == null || refType === ref.refType) ? ref : undefined;
		}

		switch (refType) {
			case 'branch':
				return isGraphItemRefContext(item, 'branch') || isGraphItemTypedContext(item, 'upstreamStatus')
					? item.webviewItemValue.ref
					: undefined;
			case 'revision':
				return isGraphItemRefContext(item, 'revision') ? item.webviewItemValue.ref : undefined;
			case 'stash':
				return isGraphItemRefContext(item, 'stash') ? item.webviewItemValue.ref : undefined;
			case 'tag':
				return isGraphItemRefContext(item, 'tag') ? item.webviewItemValue.ref : undefined;
			default:
				return isGraphItemRefContext(item) ? item.webviewItemValue.ref : undefined;
		}
	}
}

function formatRepositories(repositories: Repository[]): GraphRepository[] {
	if (repositories.length === 0) return [];

	return repositories.map(r => ({
		formattedName: r.formattedName,
		id: r.id,
		name: r.name,
		path: r.path,
		isVirtual: r.provider.virtual,
	}));
}

function isGraphItemContext(item: unknown): item is GraphItemContext {
	if (item == null) return false;

	return isWebviewItemContext(item) && (item.webview === 'gitlens.graph' || item.webview === 'gitlens.views.graph');
}

function isGraphItemGroupContext(item: unknown): item is GraphItemGroupContext {
	if (item == null) return false;

	return (
		isWebviewItemGroupContext(item) && (item.webview === 'gitlens.graph' || item.webview === 'gitlens.views.graph')
	);
}

function isGraphItemTypedContext(
	item: unknown,
	type: 'contributor',
): item is GraphItemTypedContext<GraphContributorContextValue>;
function isGraphItemTypedContext(
	item: unknown,
	type: 'pullrequest',
): item is GraphItemTypedContext<GraphPullRequestContextValue>;
function isGraphItemTypedContext(
	item: unknown,
	type: 'upstreamStatus',
): item is GraphItemTypedContext<GraphUpstreamStatusContextValue>;
function isGraphItemTypedContext(
	item: unknown,
	type: GraphItemTypedContextValue['type'],
): item is GraphItemTypedContext {
	if (item == null) return false;

	return isGraphItemContext(item) && typeof item.webviewItemValue === 'object' && item.webviewItemValue.type === type;
}

function isGraphItemRefGroupContext(item: unknown): item is GraphItemRefGroupContext {
	if (item == null) return false;

	return (
		isGraphItemGroupContext(item) &&
		typeof item.webviewItemGroupValue === 'object' &&
		item.webviewItemGroupValue.type === 'refGroup'
	);
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

function getRepoPathFromBranchOrTagId(id: string): string {
	return id.split('|', 1)[0];
}

export function hasGitReference(o: unknown): o is { ref: GitReference } {
	if (o == null || typeof o !== 'object') return false;
	if (!('ref' in o)) return false;

	return isGitReference(o.ref);
}
