import type { emptySetMarker, GraphRefOptData, GraphSearchMode } from '@gitkraken/gitkraken-components';
import type { CancellationToken, ColorTheme, ConfigurationChangeEvent } from 'vscode';
import { CancellationTokenSource, Disposable, env, Uri, window } from 'vscode';
import type { CreatePullRequestActionContext, OpenPullRequestActionContext } from '../../../api/gitlens.d.js';
import { getAvatarUri } from '../../../avatars.js';
import { parseCommandContext } from '../../../commands/commandContext.utils.js';
import type { CopyDeepLinkCommandArgs } from '../../../commands/copyDeepLink.js';
import type { CopyMessageToClipboardCommandArgs } from '../../../commands/copyMessageToClipboard.js';
import type { CopyShaToClipboardCommandArgs } from '../../../commands/copyShaToClipboard.js';
import type { ExplainBranchCommandArgs } from '../../../commands/explainBranch.js';
import type { ExplainCommitCommandArgs } from '../../../commands/explainCommit.js';
import type { ExplainStashCommandArgs } from '../../../commands/explainStash.js';
import type { ExplainWipCommandArgs } from '../../../commands/explainWip.js';
import type { GenerateChangelogCommandArgs } from '../../../commands/generateChangelog.js';
import type { GenerateCommitMessageCommandArgs } from '../../../commands/generateCommitMessage.js';
import type { InspectCommandArgs } from '../../../commands/inspect.js';
import type { OpenIssueOnRemoteCommandArgs } from '../../../commands/openIssueOnRemote.js';
import type { OpenOnRemoteCommandArgs } from '../../../commands/openOnRemote.js';
import type { OpenPullRequestOnRemoteCommandArgs } from '../../../commands/openPullRequestOnRemote.js';
import type { CreatePatchCommandArgs } from '../../../commands/patches.js';
import type { RecomposeBranchCommandArgs } from '../../../commands/recomposeBranch.js';
import type { RecomposeFromCommitCommandArgs } from '../../../commands/recomposeFromCommit.js';
import type {
	Config,
	GraphBranchesVisibility,
	GraphMinimapMarkersAdditionalTypes,
	GraphScrollMarkersAdditionalTypes,
} from '../../../config.js';
import type { GlWebviewCommandsOrCommandsWithSuffix } from '../../../constants.commands.js';
import type { ContextKeys } from '../../../constants.context.js';
import type { IssuesCloudHostIntegrationId } from '../../../constants.integrations.js';
import { supportedOrderedCloudIssuesIntegrationIds } from '../../../constants.integrations.js';
import { GlyphChars } from '../../../constants.js';
import type { SearchQuery } from '../../../constants.search.js';
import type { StoredGraphFilters, StoredGraphRefType } from '../../../constants.storage.js';
import type {
	GraphShownTelemetryContext,
	GraphTelemetryContext,
	WebviewTelemetryEvents,
} from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import { CancellationError, isCancellationError } from '../../../errors.js';
import type { CommitSelectedEvent } from '../../../eventBus.js';
import type { FeaturePreview } from '../../../features.js';
import { getFeaturePreviewStatus } from '../../../features.js';
import * as BranchActions from '../../../git/actions/branch.js';
import {
	getOrderedComparisonRefs,
	openCommitChanges,
	openCommitChangesWithWorking,
	openComparisonChanges,
	openFiles,
	openFilesAtRevision,
	openOnlyChangedFiles,
	showCommitInGraphDetailsView,
	undoCommit,
} from '../../../git/actions/commit.js';
import * as ContributorActions from '../../../git/actions/contributor.js';
import {
	abortPausedOperation,
	continuePausedOperation,
	showPausedOperationStatus,
	skipPausedOperation,
} from '../../../git/actions/pausedOperation.js';
import * as RepoActions from '../../../git/actions/repository.js';
import * as StashActions from '../../../git/actions/stash.js';
import * as TagActions from '../../../git/actions/tag.js';
import * as WorktreeActions from '../../../git/actions/worktree.js';
import { executeGitCommand } from '../../../git/actions.js';
import { GitSearchError } from '../../../git/errors.js';
import { CommitFormatter } from '../../../git/formatters/commitFormatter.js';
import type { GitBranch } from '../../../git/models/branch.js';
import type { GitCommit } from '../../../git/models/commit.js';
import { isStash } from '../../../git/models/commit.js';
import { GitContributor } from '../../../git/models/contributor.js';
import type { GitGraph, GitGraphRowType } from '../../../git/models/graph.js';
import type { IssueShape } from '../../../git/models/issue.js';
import type { GitPausedOperationStatus } from '../../../git/models/pausedOperationStatus.js';
import type { PullRequest } from '../../../git/models/pullRequest.js';
import type {
	GitBranchReference,
	GitReference,
	GitRevisionReference,
	GitStashReference,
	GitTagReference,
} from '../../../git/models/reference.js';
import { RemoteResourceType } from '../../../git/models/remoteResource.js';
import type {
	Repository,
	RepositoryChangeEvent,
	RepositoryFileSystemChangeEvent,
} from '../../../git/models/repository.js';
import { isRepository } from '../../../git/models/repository.js';
import { uncommitted } from '../../../git/models/revision.js';
import type {
	GitCommitSearchContext,
	GitGraphSearch,
	GitGraphSearchProgress,
	GitGraphSearchResults,
} from '../../../git/search.js';
import { getSearchQueryComparisonKey, parseSearchQuery } from '../../../git/search.js';
import { processNaturalLanguageToSearchQuery } from '../../../git/search.naturalLanguage.js';
import { getAssociatedIssuesForBranch } from '../../../git/utils/-webview/branch.issue.utils.js';
import { getBranchMergeTargetInfo, getStarredBranchIds } from '../../../git/utils/-webview/branch.utils.js';
import { getRemoteIconUri } from '../../../git/utils/-webview/icons.js';
import { getReferenceFromBranch } from '../../../git/utils/-webview/reference.utils.js';
import { getWorktreesByBranch } from '../../../git/utils/-webview/worktree.utils.js';
import {
	getBranchId,
	getBranchNameWithoutRemote,
	getLocalBranchByUpstream,
	getRemoteNameFromBranchName,
} from '../../../git/utils/branch.utils.js';
import { splitCommitMessage } from '../../../git/utils/commit.utils.js';
import { getLastFetchedUpdateInterval } from '../../../git/utils/fetch.utils.js';
import {
	getComparisonRefsForPullRequest,
	getRepositoryIdentityForPullRequest,
	serializePullRequest,
} from '../../../git/utils/pullRequest.utils.js';
import { createReference } from '../../../git/utils/reference.utils.js';
import { isSha, shortenRevision } from '../../../git/utils/revision.utils.js';
import type { FeaturePreviewChangeEvent, SubscriptionChangeEvent } from '../../../plus/gk/subscriptionService.js';
import { isMcpBannerEnabled } from '../../../plus/gk/utils/-webview/mcp.utils.js';
import type { ConnectionStateChangeEvent } from '../../../plus/integrations/integrationService.js';
import { getPullRequestBranchDeepLink } from '../../../plus/launchpad/launchpadProvider.js';
import type { AssociateIssueWithBranchCommandArgs } from '../../../plus/startWork/associateIssueWithBranch.js';
import { showComparisonPicker } from '../../../quickpicks/comparisonPicker.js';
import { showContributorsPicker } from '../../../quickpicks/contributorsPicker.js';
import { showReferencePicker2 } from '../../../quickpicks/referencePicker.js';
import { getRepositoryPickerTitleAndPlaceholder, showRepositoryPicker } from '../../../quickpicks/repositoryPicker.js';
import {
	executeActionCommand,
	executeCommand,
	executeCoreCommand,
	registerCommand,
} from '../../../system/-webview/command.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { getContext, onDidChangeContext, setContext } from '../../../system/-webview/context.js';
import type { StorageChangeEvent } from '../../../system/-webview/storage.js';
import type { OpenWorkspaceLocation } from '../../../system/-webview/vscode/workspaces.js';
import { openWorkspace } from '../../../system/-webview/vscode/workspaces.js';
import { isDarkTheme, isLightTheme } from '../../../system/-webview/vscode.js';
import { filterMap } from '../../../system/array.js';
import { getScopedCounter } from '../../../system/counter.js';
import { createCommandDecorator, getWebviewCommand } from '../../../system/decorators/command.js';
import { debug, trace } from '../../../system/decorators/log.js';
import type { Deferrable } from '../../../system/function/debounce.js';
import { debounce } from '../../../system/function/debounce.js';
import { disposableInterval } from '../../../system/function.js';
import { count, find, join, last } from '../../../system/iterable.js';
import { filterMap as filterMapObject, flatten, hasKeys, updateRecordValue } from '../../../system/object.js';
import {
	getSettledValue,
	pauseOnCancelOrTimeout,
	pauseOnCancelOrTimeoutMapTuplePromise,
} from '../../../system/promise.js';
import { Stopwatch } from '../../../system/stopwatch.js';
import { createDisposable } from '../../../system/unifiedDisposable.js';
import { serializeWebviewItemContext } from '../../../system/webview.js';
import { DeepLinkActionType } from '../../../uris/deepLinks/deepLink.js';
import { RepositoryFolderNode } from '../../../views/nodes/abstract/repositoryFolderNode.js';
import type { IpcParams, IpcResponse } from '../../ipc/handlerRegistry.js';
import { ipcCommand, ipcRequest } from '../../ipc/handlerRegistry.js';
import type { IpcNotification } from '../../ipc/models/ipc.js';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../../webviewProvider.js';
import type { WebviewPanelShowCommandArgs, WebviewShowOptions } from '../../webviewsController.js';
import { isSerializedState } from '../../webviewsController.js';
import type { ComposerCommandArgs } from '../composer/registration.js';
import type { TimelineCommandArgs } from '../timeline/registration.js';
import {
	formatRepositories,
	hasGitReference,
	isGraphItemRefContext,
	isGraphItemRefGroupContext,
	isGraphItemTypedContext,
	toGraphHostingServiceType,
	toGraphIssueTrackerType,
} from './graphWebview.utils.js';
import type {
	BranchState,
	GraphColumnConfig,
	GraphColumnName,
	GraphColumnsConfig,
	GraphColumnsSettings,
	GraphComponentConfig,
	GraphExcludedRef,
	GraphExcludeRefs,
	GraphExcludeTypes,
	GraphIncludeOnlyRef,
	GraphIncludeOnlyRefs,
	GraphItemContext,
	GraphMinimapMarkerTypes,
	GraphMissingRefsMetadataType,
	GraphRefMetadata,
	GraphRefMetadataType,
	GraphRefType,
	GraphRepository,
	GraphScrollMarkerTypes,
	GraphSearchResults,
	GraphSelectedRows,
	GraphSelection,
	GraphWorkingTreeStats,
	State,
} from './protocol.js';
import {
	ChooseAuthorRequest,
	ChooseComparisonRequest,
	ChooseFileRequest,
	ChooseRefRequest,
	ChooseRepositoryCommand,
	DidChangeAvatarsNotification,
	DidChangeBranchStateNotification,
	DidChangeColumnsNotification,
	DidChangeGraphConfigurationNotification,
	DidChangeMcpBanner,
	DidChangeNotification,
	DidChangeOrgSettings,
	DidChangeRefsMetadataNotification,
	DidChangeRefsVisibilityNotification,
	DidChangeRepoConnectionNotification,
	DidChangeRowsNotification,
	DidChangeRowsStatsNotification,
	DidChangeScrollMarkersNotification,
	DidChangeSelectionNotification,
	DidChangeSubscriptionNotification,
	DidChangeWorkingTreeNotification,
	DidFetchNotification,
	DidSearchNotification,
	DidStartFeaturePreviewNotification,
	DoubleClickedCommand,
	EnsureRowRequest,
	GetCountsRequest,
	GetMissingAvatarsCommand,
	GetMissingRefsMetadataCommand,
	GetMoreRowsCommand,
	GetRowHoverRequest,
	JumpToHeadRequest,
	OpenPullRequestDetailsCommand,
	RowActionCommand,
	SearchCancelCommand,
	SearchHistoryDeleteRequest,
	SearchHistoryGetRequest,
	SearchHistoryStoreRequest,
	SearchOpenInViewCommand,
	SearchRequest,
	supportedRefMetadataTypes,
	UpdateColumnsCommand,
	UpdateExcludeTypesCommand,
	UpdateGraphConfigurationCommand,
	UpdateGraphSearchModeCommand,
	UpdateIncludedRefsCommand,
	UpdateRefsVisibilityCommand,
	UpdateSelectionCommand,
} from './protocol.js';
import type { GraphWebviewShowingArgs, ShowInCommitGraphCommandArgs } from './registration.js';
import { SearchHistory } from './searchHistory.js';

interface SelectedRowState {
	selected: boolean;
	hidden?: boolean;
}

function hasSearchQuery(arg: any): arg is { repository: Repository; search: SearchQuery } {
	return arg?.repository != null && arg?.search != null;
}

const defaultGraphColumnsSettings: GraphColumnsSettings = {
	ref: { width: 130, isHidden: false, order: 0 },
	graph: { width: 150, mode: undefined, isHidden: false, order: 1 },
	message: { width: 300, isHidden: false, order: 2 },
	author: { width: 130, isHidden: false, order: 3 },
	changes: { width: 200, isHidden: false, order: 4 },
	datetime: { width: 130, isHidden: false, order: 5 },
	sha: { width: 130, isHidden: false, order: 6 },
};

const compactGraphColumnsSettings: GraphColumnsSettings = {
	ref: { width: 32, isHidden: false },
	graph: { width: 150, mode: 'compact', isHidden: false },
	author: { width: 32, isHidden: false, order: 2 },
	message: { width: 500, isHidden: false, order: 3 },
	changes: { width: 200, isHidden: false, order: 4 },
	datetime: { width: 130, isHidden: true, order: 5 },
	sha: { width: 130, isHidden: false, order: 6 },
};

type CancellableOperations = 'branchState' | 'hover' | 'computeIncludedRefs' | 'search' | 'state';

const { command, getCommands } = createCommandDecorator<GlWebviewCommandsOrCommandsWithSuffix<'graph'>>();

export class GraphWebviewProvider implements WebviewProvider<State, State, GraphWebviewShowingArgs> {
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

	private _cancellations = new Map<CancellableOperations, CancellationTokenSource>();
	private _discovering: Promise<number | undefined> | undefined;
	private readonly _disposable: Disposable;
	private _etag?: number;
	private _etagSubscription?: number;
	private _etagRepository?: number;
	private _firstSelection = true;
	private _getBranchesAndTagsTips:
		| ((sha: string, options?: { compact?: boolean; icons?: boolean }) => string | undefined)
		| undefined;
	private _graph?: GitGraph;
	private _hoverCache = new Map<string, Promise<string>>();

	private readonly _ipcNotificationMap = new Map<IpcNotification<any>, () => Promise<boolean>>([
		[DidChangeColumnsNotification, this.notifyDidChangeColumns],
		[DidChangeGraphConfigurationNotification, this.notifyDidChangeConfiguration],
		[DidChangeNotification, this.notifyDidChangeState],
		[DidChangeRefsVisibilityNotification, this.notifyDidChangeRefsVisibility],
		[DidChangeScrollMarkersNotification, this.notifyDidChangeScrollMarkers],
		[DidChangeSelectionNotification, this.notifyDidChangeSelection],
		[DidChangeSubscriptionNotification, this.notifyDidChangeSubscription],
		[DidChangeWorkingTreeNotification, this.notifyDidChangeWorkingTree],
		[DidFetchNotification, this.notifyDidFetch],
		[DidStartFeaturePreviewNotification, this.notifyDidStartFeaturePreview],
	]);
	private _issueIntegrationConnectionState: 'connected' | 'not-connected' | 'not-checked' = 'not-checked';
	private _refsMetadata: Map<string, GraphRefMetadata | null> | null | undefined;
	private _search: GitGraphSearch | undefined;
	private _searchIdCounter = getScopedCounter();
	private _selectedId?: string;
	private _honorSelectedId = false;
	private _selectedRows: Record<string, SelectedRowState> | undefined;
	private _showDetailsView: Config['graph']['showDetailsView'];
	private _theme: ColorTheme | undefined;
	private _repositoryEventsDisposable: Disposable | undefined;
	private _lastFetchedDisposable: Disposable | undefined;
	private _searchHistory: SearchHistory | undefined;

	private isWindowFocused: boolean = true;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.views.graph' | 'gitlens.graph'>,
	) {
		this._showDetailsView = configuration.get('graph.showDetailsView');
		this._theme = window.activeColorTheme;
		this.ensureRepositorySubscriptions();

		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			this.container.storage.onDidChange(this.onStorageChanged, this),
			onDidChangeContext(this.onContextChanged, this),
			this.container.subscription.onDidChangeFeaturePreview(this.onFeaturePreviewChanged, this),
			this.container.git.onDidChangeRepositories(async () => {
				if (this._etag !== this.container.git.etag) {
					if (this._discovering != null) {
						this._etag = await this._discovering;
						if (this._etag === this.container.git.etag) return;
					}

					this.updateState();
				}
			}),
			window.onDidChangeActiveColorTheme(this.onThemeChanged, this),
			{
				dispose: () => {
					if (this._repositoryEventsDisposable == null) return;
					this._repositoryEventsDisposable.dispose();
					this._repositoryEventsDisposable = undefined;
				},
			},
			this.container.integrations.onDidChangeConnectionState(this.onIntegrationConnectionChanged, this),
		);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	canReuseInstance(...args: WebviewShowingArgs<GraphWebviewShowingArgs, State>): boolean | undefined {
		if (this.container.git.openRepositoryCount === 1) return true;

		const [arg] = args;

		let repository: Repository | undefined;
		if (isRepository(arg)) {
			repository = arg;
		} else if (hasGitReference(arg)) {
			repository = this.container.git.getRepository(arg.ref.repoPath);
		} else if (isSerializedState<State>(arg) && arg.state.selectedRepository != null) {
			repository = this.container.git.getRepository(arg.state.selectedRepository);
		}

		return repository?.uri.toString() === this.repository?.uri.toString() ? true : undefined;
	}

	getSplitArgs(): WebviewShowingArgs<GraphWebviewShowingArgs, State> {
		return this.repository != null ? [this.repository] : [];
	}

	getTelemetryContext(): GraphTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
			'context.repository.id': this.repository?.idHash,
			'context.repository.scheme': this.repository?.uri.scheme,
			'context.repository.closed': this.repository?.closed,
			'context.repository.folder.scheme': this.repository?.folder?.uri.scheme,
			'context.repository.provider.id': this.repository?.provider.id,
		};
	}

	getShownTelemetryContext(): GraphShownTelemetryContext {
		const columnContext: Partial<{
			[K in Extract<keyof GraphShownTelemetryContext, `context.column.${string}`>]: GraphShownTelemetryContext[K];
		}> = {};
		const columns = this.getColumns();
		if (columns != null) {
			for (const [name, config] of Object.entries(columns)) {
				if (!config.isHidden) {
					columnContext[`context.column.${name}.visible`] = true;
				}
				if (config.mode != null) {
					columnContext[`context.column.${name}.mode`] = config.mode;
				}
			}
		}

		const cfg = flatten(configuration.get('graph'), 'context.config', { joinArrays: true });
		const context: GraphShownTelemetryContext = {
			...this.getTelemetryContext(),
			...columnContext,
			...cfg,
		};

		return context;
	}

	private _searchRequest: SearchQuery | undefined;

	async onShowing(
		loading: boolean,
		_options?: WebviewShowOptions,
		...args: WebviewShowingArgs<GraphWebviewShowingArgs, State>
	): Promise<[boolean, GraphShownTelemetryContext]> {
		this._firstSelection = true;

		this._etag = this.container.git.etag;
		if (this.container.git.isDiscoveringRepositories) {
			this._discovering = this.container.git.isDiscoveringRepositories.then(r => {
				this._discovering = undefined;
				return r;
			});
			this._etag = await this._discovering;
		}

		const [arg] = args;
		if (isRepository(arg)) {
			this.repository = arg;
		} else if (hasGitReference(arg)) {
			this.repository = this.container.git.getRepository(arg.ref.repoPath);

			let id = arg.ref.ref;
			if (!isSha(id)) {
				id = (await this.container.git.getRepositoryService(arg.ref.repoPath).revision.resolveRevision(id)).sha;
			}

			// Make sure we honor the selection to ensure we won't override it with the default selection
			this._honorSelectedId = true;
			this.setSelectedRows(id);

			if (this._graph != null) {
				if (this._graph?.ids.has(id)) {
					void this.notifyDidChangeSelection();
					return [true, this.getShownTelemetryContext()];
				}

				void this.onGetMoreRows({ id: id }, true);
			}
		} else if (hasSearchQuery(arg)) {
			this.repository = arg.repository;
			this._searchRequest = arg.search;
			this.updateState();
		} else {
			if (isSerializedState<State>(arg) && arg.state.selectedRepository != null) {
				this.repository = this.container.git.getRepository(arg.state.selectedRepository);
			}

			if (this.repository == null && this.container.git.repositoryCount > 1) {
				const [context] = parseCommandContext('gitlens.showGraph', undefined, ...args);

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

		return [true, this.getShownTelemetryContext()];
	}

	onRefresh(force?: boolean): void {
		if (force) {
			this.resetRepositoryState();
		}
	}

	includeBootstrap(_deferrable?: boolean): Promise<State> {
		return this.getState(true);
	}

	registerCommands(): Disposable[] {
		const commands: Disposable[] = [];

		if (this.host.is('view')) {
			commands.push(
				registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true)),
				registerCommand(
					`${this.host.id}.openInTab`,
					() =>
						void executeCommand<WebviewPanelShowCommandArgs<GraphWebviewShowingArgs>>(
							'gitlens.showGraphPage',
							undefined,
							this.repository,
						),
				),
			);
		}

		// Register commands from @command decorators
		for (const c of getCommands()) {
			commands.push(
				this.host.registerWebviewCommand(getWebviewCommand(c.command, this.host.type), c.handler.bind(this)),
			);
		}

		return commands;
	}
	onWindowFocusChanged(focused: boolean): void {
		this.isWindowFocused = focused;
	}

	onFocusChanged(focused: boolean): void {
		this._showActiveSelectionDetailsDebounced?.cancel();

		if (
			!focused ||
			this.activeSelection == null ||
			(!this.container.views.commitDetails.visible && !this.container.views.graphDetails.visible)
		) {
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
			if (this.host.ready) {
				this.updateState(true);
			}
			return;
		}

		if (visible) {
			this.host.sendPendingIpcNotifications();

			const { activeSelection } = this;
			if (activeSelection == null) return;

			this.showActiveSelectionDetails();
		}
	}

	@ipcRequest(GetCountsRequest)
	private async onGetCounts() {
		if (this._graph == null) return undefined;

		const tags = await this.container.git.getRepositoryService(this._graph.repoPath).tags.getTags();
		return {
			branches: count(this._graph.branches?.values(), b => !b.remote),
			remotes: this._graph.remotes.size,
			stashes: this._graph.stashes?.size,
			// Subtract the default worktree
			worktrees: this._graph.worktrees != null ? this._graph.worktrees.length - 1 : undefined,
			tags: tags.values.length,
		};
	}

	@ipcCommand(UpdateGraphConfigurationCommand)
	private onUpdateGraphConfig(params: IpcParams<typeof UpdateGraphConfigurationCommand>) {
		const config = this.getComponentConfig();

		let key: keyof IpcParams<typeof UpdateGraphConfigurationCommand>['changes'];
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
								case 'pullRequests':
									additionalTypes.push(marker);
									break;
							}
						}
						void configuration.updateEffective('graph.minimap.additionalTypes', additionalTypes);
						break;
					}
					case 'dimMergeCommits':
						void configuration.updateEffective('graph.dimMergeCommits', params.changes[key]);
						break;
					case 'onlyFollowFirstParent':
						void configuration.updateEffective('graph.onlyFollowFirstParent', params.changes[key]);
						break;
					default:
						// TODO:@eamodio add more config options as needed
						debugger;
						break;
				}
			}
		}
	}

	@ipcCommand(UpdateGraphSearchModeCommand)
	private onUpdateGraphSearchMode(params: IpcParams<typeof UpdateGraphSearchModeCommand>) {
		void this.container.storage.store('graph:searchMode', params.searchMode).catch();
		void this.container.storage.store('graph:useNaturalLanguageSearch', params.useNaturalLanguage).catch();

		// Update the active search query's filter property to match the new mode
		updateSearchMode(this.container, this._search, params.searchMode);
	}

	private _showActiveSelectionDetailsDebounced:
		| Deferrable<GraphWebviewProvider['showActiveSelectionDetails']>
		| undefined = undefined;

	private showActiveSelectionDetails() {
		this._showActiveSelectionDetailsDebounced ??= debounce(this.showActiveSelectionDetailsCore.bind(this), 250);
		this._showActiveSelectionDetailsDebounced();
	}

	private showActiveSelectionDetailsCore() {
		const { activeSelection } = this;
		if (activeSelection == null || !this.host.active) return;

		this.container.events.fire(
			'commit:selected',
			{
				commit: activeSelection,
				interaction: 'passive',
				preserveFocus: true,
				preserveVisibility: this._showDetailsView === false,
				searchContext: this.getSearchContext(activeSelection.ref),
			},
			{ source: this.host.id },
		);
	}

	private getSearchContext(id: string | undefined): GitCommitSearchContext | undefined {
		if (!this._search?.queryFilters.files || id == null) return undefined;

		const result = this._search.results.get(id);
		return {
			query: this._search.query,
			queryFilters: this._search.queryFilters,
			matchedFiles: result?.files ?? [],
			hiddenFromGraph: this._selectedRows?.[id]?.hidden ?? false,
		};
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
			configuration.changed(e, 'advanced.abbreviatedShaLength') ||
			configuration.changed(e, 'ai.enabled') ||
			configuration.changed(e, 'defaultDateFormat') ||
			configuration.changed(e, 'defaultDateStyle') ||
			configuration.changed(e, 'graph')
		) {
			void this.notifyDidChangeConfiguration();

			if (
				configuration.changed(e, 'graph.onlyFollowFirstParent') ||
				((configuration.changed(e, 'graph.minimap.enabled') ||
					configuration.changed(e, 'graph.minimap.dataType')) &&
					configuration.get('graph.minimap.enabled') &&
					configuration.get('graph.minimap.dataType') === 'lines' &&
					!this._graph?.includes?.stats)
			) {
				this.updateState();
			}
		}
	}

	@trace({ args: false })
	private onContextChanged(key: keyof ContextKeys) {
		if (['gitlens:gk:organization:ai:enabled', 'gitlens:gk:organization:drafts:enabled'].includes(key)) {
			this.notifyDidChangeOrgSettings();
		}
	}

	private getOrgSettings(): State['orgSettings'] {
		return {
			ai: getContext('gitlens:gk:organization:ai:enabled', true),
			drafts: getContext('gitlens:gk:organization:drafts:enabled', false),
		};
	}

	@trace({ args: false })
	private onFeaturePreviewChanged(e: FeaturePreviewChangeEvent) {
		if (e.feature !== 'graph') return;

		void this.notifyDidStartFeaturePreview(e);
	}

	private getFeaturePreview(): FeaturePreview {
		return this.container.subscription.getFeaturePreview('graph');
	}

	@trace()
	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (
			!e.changed(
				'config',
				'head',
				'heads',
				// 'index',
				'remotes',
				// 'remoteProviders',
				'starred',
				'stash',
				'pausedOp',
				'tags',
				'unknown',
			)
		) {
			this._etagRepository = e.repository.etag;
			return;
		}

		if (e.changed('config')) {
			if (this._refsMetadata != null) {
				// Clear out any associated issue metadata
				for (const [, value] of this._refsMetadata) {
					if (value == null) continue;
					value.issue = undefined;
				}
			}
		}

		if (e.changed('head')) {
			this.setSelectedRows(undefined);
		}

		// Unless we don't know what changed, update the state immediately
		this.updateState(!e.changedExclusive('unknown'));
	}

	@trace({ args: false })
	private onRepositoryFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
		if (e.repository.id !== this.repository?.id) return;
		void this.notifyDidChangeWorkingTree();
	}

	@trace({ args: false })
	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		if (e.etag === this._etagSubscription) return;

		this._etagSubscription = e.etag;
		void this.notifyDidChangeSubscription();
	}

	private onStorageChanged(e: StorageChangeEvent) {
		if (e.type === 'global' && e.keys.includes('mcp:banner:dismissed')) {
			this.onMcpBannerChanged();
		}
	}

	private onMcpBannerChanged() {
		if (!this.host.visible) return;

		void this.host.notify(DidChangeMcpBanner, this.getMcpBannerCollapsed());
	}

	private getMcpBannerCollapsed() {
		return !isMcpBannerEnabled(this.container);
	}

	private onThemeChanged(theme: ColorTheme) {
		if (
			this._theme != null &&
			((isDarkTheme(theme) && isDarkTheme(this._theme)) || (isLightTheme(theme) && isLightTheme(this._theme)))
		) {
			return;
		}

		this._theme = theme;
		this.updateState();
	}

	@ipcCommand(UpdateColumnsCommand)
	private onColumnsChanged(params: IpcParams<typeof UpdateColumnsCommand>) {
		this.updateColumns(params.config);

		const eventData: WebviewTelemetryEvents['graph/columns/changed'] = {};
		for (const [name, config] of Object.entries(params.config)) {
			for (const [prop, value] of Object.entries(config)) {
				eventData[`column.${name}.${prop as keyof GraphColumnConfig}`] = value;
			}
		}
		this.host.sendTelemetryEvent('graph/columns/changed', eventData);
	}

	@ipcCommand(UpdateRefsVisibilityCommand)
	private onRefsVisibilityChanged(params: IpcParams<typeof UpdateRefsVisibilityCommand>) {
		this.updateExcludedRefs(this._graph?.repoPath, params.refs, params.visible);
	}

	@ipcCommand(DoubleClickedCommand)
	private onDoubleClick(params: IpcParams<typeof DoubleClickedCommand>) {
		if (params.type === 'ref' && params.ref.context) {
			let item = this.getGraphItemContext(params.ref.context);
			if (isGraphItemRefContext(item)) {
				if (params.metadata != null) {
					item = this.getGraphItemContext(params.metadata.data.context);
					if (params.metadata.type === 'upstream' && isGraphItemTypedContext(item, 'upstreamStatus')) {
						const { ahead, behind, ref } = item.webviewItemValue;
						if (behind > 0) {
							return void RepoActions.pull(ref.repoPath, ref);
						}
						if (ahead > 0) {
							return void RepoActions.push(ref.repoPath, false, ref);
						}
					} else if (params.metadata.type === 'pullRequest' && isGraphItemTypedContext(item, 'pullrequest')) {
						return void this.openPullRequestOnRemote(item);
					} else if (params.metadata.type === 'issue' && isGraphItemTypedContext(item, 'issue')) {
						return void this.openIssueOnRemote(item);
					}

					return;
				}

				const { ref } = item.webviewItemValue;
				if (params.ref.refType === 'head' && params.ref.isCurrentHead) {
					return RepoActions.switchTo(ref.repoPath);
				}

				// Override the default confirmation if the setting is unset
				return RepoActions.switchTo(
					ref.repoPath,
					ref,
					configuration.isUnset('gitCommands.skipConfirmations') ? true : undefined,
				);
			}
		} else if (params.type === 'row' && params.row) {
			this._showActiveSelectionDetailsDebounced?.cancel();

			const commit = this.getRevisionReference(this.repository?.path, params.row.id, params.row.type);
			if (commit != null) {
				const searchContext = this.getSearchContext(params.row.id);
				this.container.events.fire(
					'commit:selected',
					{
						commit: commit,
						interaction: 'active',
						preserveFocus: params.preserveFocus,
						preserveVisibility: false,
						searchContext: searchContext,
					},
					{ source: this.host.id },
				);

				const details = this.host.is('editor')
					? this.container.views.commitDetails
					: this.container.views.graphDetails;
				if (!details.ready) {
					void details.show({ preserveFocus: params.preserveFocus }, {
						commit: commit,
						interaction: 'active',
						preserveVisibility: false,
						searchContext: searchContext,
					} satisfies CommitSelectedEvent['data']);
				}
			}
		}

		return Promise.resolve();
	}

	@ipcRequest(GetRowHoverRequest)
	private async onHoverRowRequest(params: IpcParams<typeof GetRowHoverRequest>) {
		const hover: IpcResponse<typeof GetRowHoverRequest> = {
			id: params.id,
			markdown: undefined!,
		};

		this.cancelOperation('hover');

		if (this._graph != null) {
			const id = params.id;

			let markdown = this._hoverCache.get(id);
			if (markdown == null) {
				const cancellation = this.createCancellation('hover');

				let cache = true;
				let commit;
				try {
					const svc = this.container.git.getRepositoryService(this._graph.repoPath);
					switch (params.type) {
						case 'work-dir-changes':
							cache = false;
							commit = await svc.commits.getCommit(uncommitted, cancellation.token);
							break;
						case 'stash-node': {
							const stash = await svc.stash?.getStash(undefined, cancellation.token);
							commit = stash?.stashes.get(params.id);
							break;
						}
						default: {
							commit = await svc.commits.getCommit(params.id, cancellation.token);
							break;
						}
					}
				} catch (ex) {
					if (!(ex instanceof CancellationError)) throw ex;
				}

				if (commit != null && !cancellation.token.isCancellationRequested) {
					// Check if we have calculated stats for the row and if so apply it to the commit
					const stats = this._graph.rowsStats?.get(commit.sha);
					if (stats != null) {
						commit = commit.with({
							stats: {
								...commit.stats,
								additions: stats.additions,
								deletions: stats.deletions,
								// If `changedFiles` already exists, then use it, otherwise use the files count
								files: commit.stats?.files ? commit.stats.files : stats.files,
							},
						});
					}

					markdown = this.getCommitTooltip(commit, cancellation.token).catch((ex: unknown) => {
						this._hoverCache.delete(id);
						throw ex;
					});
					if (cache) {
						this._hoverCache.set(id, markdown);
					}
				}
			}

			if (markdown != null) {
				try {
					hover.markdown = {
						status: 'fulfilled' as const,
						value: await markdown,
					};
				} catch (ex) {
					hover.markdown = { status: 'rejected' as const, reason: ex };
				}
			}
		}

		hover.markdown ??= { status: 'rejected' as const, reason: new CancellationError() };
		return hover;
	}

	private async getCommitTooltip(commit: GitCommit, cancellation: CancellationToken) {
		const template = configuration.get(`views.formats.${isStash(commit) ? 'stashes' : 'commits'}.tooltip`);

		const showSignature =
			configuration.get('signing.showSignatureBadges') &&
			!commit.isUncommitted &&
			CommitFormatter.has(template, 'signature');

		const svc = this.container.git.getRepositoryService(commit.repoPath);
		const [remotesResult, _, signedResult] = await Promise.allSettled([
			svc.remotes.getBestRemotesWithProviders(),
			commit.ensureFullDetails({ include: { stats: true } }),
			showSignature ? commit.isSigned() : undefined,
		]);

		if (cancellation.isCancellationRequested) throw new CancellationError();

		const remotes = getSettledValue(remotesResult, []);
		const [remote] = remotes;
		const signed = getSettledValue(signedResult);

		let enrichedAutolinks;
		let pr;

		if (remote?.supportsIntegration()) {
			const [enrichedAutolinksResult, prResult] = await Promise.allSettled([
				pauseOnCancelOrTimeoutMapTuplePromise(commit.getEnrichedAutolinks(remote), cancellation),
				commit.getAssociatedPullRequest(remote),
			]);

			if (cancellation.isCancellationRequested) throw new CancellationError();

			const enrichedAutolinksMaybeResult = getSettledValue(enrichedAutolinksResult);
			if (!enrichedAutolinksMaybeResult?.paused) {
				enrichedAutolinks = enrichedAutolinksMaybeResult?.value;
			}
			pr = getSettledValue(prResult);
		}

		this._getBranchesAndTagsTips ??= await svc.getBranchesAndTagsTipsLookup();

		const tooltip = await CommitFormatter.fromTemplateAsync(
			template,
			commit,
			{ source: 'graph' },
			{
				enrichedAutolinks: enrichedAutolinks,
				dateFormat: configuration.get('defaultDateFormat'),
				getBranchAndTagTips: this._getBranchesAndTagsTips,
				messageAutolinks: true,
				messageIndent: 4,
				pullRequest: pr,
				outputFormat: 'markdown',
				remotes: remotes,
				signed: signed,
				// unpublished: this.unpublished,
			},
		);

		return tooltip;
	}

	@ipcRequest(EnsureRowRequest)
	@trace()
	private async onEnsureRowRequest(params: IpcParams<typeof EnsureRowRequest>) {
		if (this._graph == null) return { id: undefined };

		let id: string | undefined;
		if (this._graph.ids.has(params.id)) {
			id = params.id;
		} else {
			await this.updateGraphWithMoreRows(this._graph, params.id, this._search);
			void this.notifyDidChangeRows();
			if (this._graph.ids.has(params.id)) {
				id = params.id;
			}
		}

		return { id: id };
	}

	@ipcCommand(GetMissingAvatarsCommand)
	private async onGetMissingAvatars(params: IpcParams<typeof GetMissingAvatarsCommand>) {
		if (this._graph == null) return;

		const repoPath = this._graph.repoPath;

		async function getAvatar(this: GraphWebviewProvider, email: string, id: string) {
			const uri = await getAvatarUri(email, { ref: id, repoPath: repoPath });
			this._graph!.avatars.set(email, uri.toString(true));
		}

		const promises: Promise<void>[] = [];

		for (const [email, id] of Object.entries(params.emails)) {
			if (this._graph.avatars.has(email)) continue;

			promises.push(getAvatar.call(this, email, id));
		}

		if (promises.length) {
			await Promise.allSettled(promises);
			this.updateAvatars();
		}
	}

	@ipcCommand(GetMissingRefsMetadataCommand)
	private async onGetMissingRefMetadata(params: IpcParams<typeof GetMissingRefsMetadataCommand>) {
		if (this._graph == null || this._refsMetadata === null) {
			return;
		}

		// Check if we have connected integrations that can provide the requested metadata
		const hasHostingIntegration = getContext('gitlens:repos:withHostingIntegrationsConnected')?.includes(
			this._graph.repoPath,
		);

		if (!hasHostingIntegration) {
			// If no hosting integration, check if we at least have issue integrations connected
			const hasIssueIntegration =
				this._issueIntegrationConnectionState !== 'not-checked'
					? this._issueIntegrationConnectionState === 'connected'
					: await this.checkIssueIntegrations();
			if (!hasIssueIntegration) return;
		}

		const repoPath = this._graph.repoPath;

		async function getRefMetadata(
			this: GraphWebviewProvider,
			id: string,
			missingTypes: GraphMissingRefsMetadataType[],
		) {
			this._refsMetadata ??= new Map();

			const branch = (
				await this.container.git
					.getRepositoryService(repoPath)
					.branches.getBranches({ filter: b => b.id === id })
			)?.values?.[0];
			const metadata = { ...this._refsMetadata.get(id) };

			if (branch == null) {
				for (const type of missingTypes) {
					metadata[type] = null;
					this._refsMetadata.set(id, metadata);
				}

				return;
			}

			for (const type of missingTypes) {
				if (!supportedRefMetadataTypes.includes(type)) {
					metadata[type] = null;
					this._refsMetadata.set(id, metadata);

					continue;
				}

				if (type === 'pullRequest') {
					const pr = await branch?.getAssociatedPullRequest();

					if (pr == null) {
						if (metadata.pullRequest === undefined || metadata.pullRequest?.length === 0) {
							metadata.pullRequest = null;
						}

						this._refsMetadata.set(id, metadata);
						continue;
					}

					const hostingService = toGraphHostingServiceType(pr.provider.id);
					if (hostingService == null) {
						debugger;
						continue;
					}

					const prMetadata: NonNullable<NonNullable<GraphRefMetadata>['pullRequest']>[number] = {
						hostingServiceType: hostingService,
						id: Number.parseInt(pr.id) || 0,
						title: pr.title,
						author: pr.author.name,
						date: (pr.mergedDate ?? pr.closedDate ?? pr.updatedDate)?.getTime(),
						state: pr.state,
						url: pr.url,
						context: serializeWebviewItemContext<GraphItemContext>({
							webviewItem: `gitlens:pullrequest${pr.refs ? '+refs' : ''}`,
							webviewItemValue: {
								type: 'pullrequest',
								id: pr.id,
								url: pr.url,
								repoPath: repoPath,
								refs: pr.refs,
								provider: {
									id: pr.provider.id,
									name: pr.provider.name,
									domain: pr.provider.domain,
									icon: pr.provider.icon,
								},
							},
						}),
					};

					metadata.pullRequest = [prMetadata];

					this._refsMetadata.set(id, metadata);
					if (branch?.upstream?.missing) {
						this._refsMetadata.set(getBranchId(repoPath, true, branch.upstream.name), metadata);
					}
					continue;
				}

				if (type === 'upstream') {
					const upstream = branch?.upstream;

					if (upstream == null || upstream.missing) {
						metadata.upstream = null;
						this._refsMetadata.set(id, metadata);
						continue;
					}

					const upstreamMetadata: NonNullable<GraphRefMetadata>['upstream'] = {
						name: getBranchNameWithoutRemote(upstream.name),
						owner: getRemoteNameFromBranchName(upstream.name),
						ahead: branch.upstream?.state.ahead ?? 0,
						behind: branch.upstream?.state.behind ?? 0,
						context: serializeWebviewItemContext<GraphItemContext>({
							webviewItem: 'gitlens:upstreamStatus',
							webviewItemValue: {
								type: 'upstreamStatus',
								ref: getReferenceFromBranch(branch),
								ahead: branch.upstream?.state.ahead ?? 0,
								behind: branch.upstream?.state.behind ?? 0,
							},
						}),
					};

					metadata.upstream = upstreamMetadata;

					this._refsMetadata.set(id, metadata);
					continue;
				}

				// TODO: Issue metadata needs to update for a branch whenever we add an associated issue for it, so that we don't
				// have to completely refresh the component to see the new issue
				if (type === 'issue') {
					let issues: IssueShape[] | undefined = await getAssociatedIssuesForBranch(
						this.container,
						branch,
					).then(issues => issues.value);
					if (!issues?.length) {
						issues = await branch.getEnrichedAutolinks().then(async enrichedAutolinks => {
							if (enrichedAutolinks == null) return undefined;

							return (
								await Promise.all(
									Array.from(enrichedAutolinks.values(), async ([issueOrPullRequestPromise]) =>
										// eslint-disable-next-line no-return-await
										issueOrPullRequestPromise != null ? await issueOrPullRequestPromise : undefined,
									),
								)
							).filter<IssueShape>(
								(a?: unknown): a is IssueShape =>
									a != null && a instanceof Object && 'type' in a && a.type === 'issue',
							);
						});

						if (!issues?.length) {
							metadata.issue = null;
							this._refsMetadata.set(id, metadata);
							continue;
						}
					}

					const issuesMetadata: NonNullable<NonNullable<GraphRefMetadata>['issue']>[number][] = [];
					for (const issue of issues) {
						const issueTracker = toGraphIssueTrackerType(issue.provider.id);
						if (issueTracker == null) {
							debugger;
							continue;
						}

						issuesMetadata.push({
							issueTrackerType: issueTracker,
							displayId: issue.id,
							id: issue.nodeId ?? issue.id,
							// TODO: This is a hack/workaround because the graph component doesn't support this in the tooltip.
							// Update this once that is fixed.
							title: `${issue.title}\nDouble-click to open issue on ${issue.provider.name}`,
							context: serializeWebviewItemContext<GraphItemContext>({
								webviewItem: 'gitlens:issue',
								webviewItemValue: {
									type: 'issue',
									id: issue.id,
									url: issue.url,
									provider: {
										id: issue.provider.id,
										name: issue.provider.name,
										domain: issue.provider.domain,
										icon: issue.provider.icon,
									},
								},
							}),
						});
					}

					metadata.issue = issuesMetadata;
					this._refsMetadata.set(id, metadata);
				}
			}
		}

		const promises: Promise<void>[] = [];

		for (const id of Object.keys(params.metadata)) {
			promises.push(getRefMetadata.call(this, id, params.metadata[id]));
		}

		if (promises.length) {
			await Promise.allSettled(promises);
		}
		this.updateRefsMetadata();
	}

	@ipcCommand(GetMoreRowsCommand)
	@trace()
	private async onGetMoreRows(params: IpcParams<typeof GetMoreRowsCommand>, sendSelectedRows: boolean = false) {
		if (this._graph?.paging == null) return;
		if (this._graph?.more == null || this.repository?.etag !== this._etagRepository) {
			this.updateState(true);

			return;
		}

		await this.updateGraphWithMoreRows(this._graph, params.id, this._search);
		void this.notifyDidChangeRows(sendSelectedRows);
	}

	@ipcCommand(OpenPullRequestDetailsCommand)
	@debug()
	private async onOpenPullRequestDetails(_params: IpcParams<typeof OpenPullRequestDetailsCommand>) {
		// TODO: a hack for now, since we aren't using the params at all right now and always opening the current branch's PR
		const repo = this.repository;
		if (repo == null) return undefined;

		const branch = await repo.git.branches.getBranch();
		if (branch == null) return undefined;

		const pr = await branch.getAssociatedPullRequest();
		if (pr == null) return undefined;

		return this.container.views.pullRequest.showPullRequest(pr, branch);
	}

	@ipcCommand(RowActionCommand)
	@debug()
	private async onRowAction(params: IpcParams<typeof RowActionCommand>) {
		const repoPath = this._graph?.repoPath;
		if (repoPath == null) return;

		switch (params.action) {
			case 'compose-commits':
				await executeCommand<ComposerCommandArgs>('gitlens.composeCommits', {
					repoPath: repoPath,
					source: 'graph',
				});
				break;
			case 'generate-commit-message':
				await executeCommand<GenerateCommitMessageCommandArgs>('gitlens.ai.generateCommitMessage', {
					repoPath: repoPath,
					source: 'graph',
				});
				break;
			case 'stash-save':
				await StashActions.push(repoPath);
				break;
			// case 'recompose-branch': {
			// 	const row = this._graph?.rows.find(r => r.sha === params.row.id);
			// 	const branchName = row?.heads?.[0]?.name;
			// 	if (branchName != null) {
			// 		await executeCommand<RecomposeBranchCommandArgs>('gitlens.recomposeBranch', {
			// 			repoPath: repoPath,
			// 			branchName: branchName,
			// 			source: 'graph',
			// 		});
			// 	}
			// 	break;
			// }
			// case 'stash-pop': {
			// 	const ref = createReference(params.row.id, repoPath, {
			// 		refType: 'stash',
			// 		name: params.row.id,
			// 		number: undefined,
			// 	});
			// 	await StashActions.pop(repoPath, ref);
			// 	break;
			// }
			// case 'stash-drop': {
			// 	const ref = createReference(params.row.id, repoPath, {
			// 		refType: 'stash',
			// 		name: params.row.id,
			// 		number: undefined,
			// 	});
			// 	await StashActions.drop(repoPath, [ref]);
			// 	break;
			// }
		}
	}

	@ipcRequest(SearchHistoryGetRequest)
	@trace()
	private onSearchHistoryGetRequest(): IpcResponse<typeof SearchHistoryGetRequest> {
		this._searchHistory ??= new SearchHistory(this.container.storage, this.repository?.path);
		try {
			return { history: this._searchHistory.get() };
		} catch {
			return { history: [] };
		}
	}

	@ipcRequest(SearchHistoryStoreRequest)
	@trace()
	private async onSearchHistoryStoreRequest(params: IpcParams<typeof SearchHistoryStoreRequest>) {
		this._searchHistory ??= new SearchHistory(this.container.storage, this.repository?.path);

		try {
			await this._searchHistory.store(params.search);
		} finally {
			// eslint-disable-next-line no-unsafe-finally
			return { history: this._searchHistory.get() };
		}
	}

	@ipcRequest(SearchHistoryDeleteRequest)
	@trace()
	private async onSearchHistoryDeleteRequest(params: IpcParams<typeof SearchHistoryDeleteRequest>) {
		this._searchHistory ??= new SearchHistory(this.container.storage, this.repository?.path);
		try {
			await this._searchHistory.delete(params.query);
		} finally {
			// eslint-disable-next-line no-unsafe-finally
			return { history: this._searchHistory.get() };
		}
	}

	@ipcCommand(SearchCancelCommand)
	@trace()
	private onSearchCancel(params: { preserveResults: boolean }) {
		this.cancelOperation('search');

		// For pause (preserveResults: true), the generator will handle cancellation gracefully and return results collected so far

		if (!params.preserveResults) {
			this._searchIdCounter.next();
			this.resetSearchState();

			// Send clear notification to webview
			void this.host.notify(DidSearchNotification, {
				search: undefined,
				results: undefined,
				partial: false,
				searchId: this._searchIdCounter.current,
			});
		}
	}

	@ipcRequest(SearchRequest)
	@trace()
	private async onSearchRequest(params: IpcParams<typeof SearchRequest>) {
		using sw = new Stopwatch(`GraphWebviewProvider.onSearchRequest(${this.host.id})`);

		if (params.search?.naturalLanguage) {
			params.search = await processNaturalLanguageToSearchQuery(this.container, params.search, {
				source: 'graph',
			});
		}

		const query = params.search ? parseSearchQuery(params.search) : undefined;
		const types = query != null ? join(query.operations.keys(), ',') : '';

		let results: IpcResponse<typeof SearchRequest> | undefined;
		let exception: (Error & { original?: Error }) | undefined;

		try {
			results = await this.searchGraphOrContinue(params, true);
			return results;
		} catch (ex) {
			exception = ex;
			return {
				search: params.search,
				results: isCancellationError(ex)
					? undefined
					: { error: ex instanceof GitSearchError ? 'Invalid search pattern' : 'Unexpected error' },
				partial: false,
				searchId: this._searchIdCounter.current,
			};
		} finally {
			const cancelled = isCancellationError(exception);

			this.host.sendTelemetryEvent('graph/searched', {
				types: types,
				duration: sw.elapsed(),
				matches: (results?.results as GraphSearchResults)?.count ?? 0,
				failed: exception != null,
				'failed.reason': exception != null ? (cancelled ? 'cancelled' : 'error') : undefined,
				'failed.error': !cancelled && exception != null ? String(exception) : undefined,
				'failed.error.detail':
					!cancelled && exception?.original != null ? String(exception?.original) : undefined,
			});
		}
	}

	private async searchGraphOrContinue(
		e: IpcParams<typeof SearchRequest>,
		progressive: boolean = true,
	): Promise<IpcResponse<typeof SearchRequest>> {
		let search = this._search;

		const graph = this._graph!;

		if (
			e.more &&
			search?.paging?.cursor != null &&
			search.comparisonKey === getSearchQueryComparisonKey(e.search)
		) {
			if (this.repository == null) {
				return {
					search: e.search,
					results: { error: 'No repository' },
					partial: false,
					searchId: this._searchIdCounter.current,
				};
			}

			const searchId = this._searchIdCounter.current;
			const cancellation = this.createCancellation('search');

			try {
				// Continue search from cursor, passing existing results
				const searchStream = this.repository.git.graph.continueSearchGraph(
					search.paging.cursor,
					search.results,
					{
						limit: e.limit ?? configuration.get('graph.searchItemLimit') ?? 0,
					},
					cancellation.token,
				);
				using _streamDisposer = createDisposable(() => void searchStream.return?.(undefined!));

				search = await this.processSearchStream(searchStream, searchId, progressive, graph);

				if (search != null) {
					return {
						search: e.search,
						results: this.getSearchResultsData(search),
						partial: false,
						searchId: this._searchIdCounter.current,
					};
				}

				return {
					search: e.search,
					results: undefined,
					partial: false,
					searchId: this._searchIdCounter.current,
				};
			} finally {
				cancellation.dispose();
			}
		}

		let firstResultSelected = false;

		if (search?.comparisonKey !== getSearchQueryComparisonKey(e.search)) {
			if (this.repository == null) {
				return {
					search: e.search,
					results: { error: 'No repository' },
					partial: false,
					searchId: this._searchIdCounter.current,
				};
			}

			if (this.repository.etag !== this._etagRepository) {
				this.updateState(true);
			}

			// Increment search ID for new search
			const searchId = this._searchIdCounter.next();
			this._search = undefined;

			// Clear previous search results immediately
			void this.host.notify(DidSearchNotification, {
				search: e.search,
				results: undefined,
				partial: false,
				searchId: searchId,
			});

			const cancellation = this.createCancellation('search');

			try {
				const searchStream = this.repository.git.graph.searchGraph(
					e.search,
					{
						limit: configuration.get('graph.searchItemLimit') ?? 0,
						ordering: configuration.get('graph.commitOrdering'),
					},
					cancellation.token,
				);
				using _streamDisposer = createDisposable(() => void searchStream.return?.(undefined!));

				search = await this.processSearchStream(searchStream, searchId, progressive, graph, {
					selectFirstResult: true,
				});

				if (search == null) {
					throw new Error('Search generator completed without returning a result');
				}
			} catch (ex) {
				this._search = undefined;
				throw ex;
			}

			// At this point, search is guaranteed to be defined (either from generator or we threw an error)
			this._search = updateSearchMode(this.container, search);
		} else {
			search = this._search!;

			// Select first result if not already selected (for cached searches)
			if (!firstResultSelected) {
				const firstResult = await this.ensureSearchStartsInRange(graph, search.results);
				if (firstResult != null) {
					this.setSelectedRows(firstResult);
					firstResultSelected = true;
				}
			}

			// Send notification with cached results (only if not superseded and not resuming)
			// When resuming (e.more), don't send cached results - let progressive notifications handle it
			if (this._searchIdCounter.current != null && progressive && !e.more) {
				// Use search.query to include any mode changes (filter toggle) that happened during the search
				void this.host.notify(DidSearchNotification, {
					search: search.query,
					results: this.getSearchResultsData(search) ?? {
						count: 0,
						hasMore: false,
						commitsLoaded: { count: 0 },
					},
					selectedRows: firstResultSelected ? convertSelectedRows(this._selectedRows) : undefined,
					partial: false,
					searchId: this._searchIdCounter.current,
				});
			}
		}

		return {
			search: search.query,
			results: this.getSearchResultsData(search) ?? { count: 0, hasMore: false, commitsLoaded: { count: 0 } },
			selectedRows: firstResultSelected ? convertSelectedRows(this._selectedRows) : undefined,
			partial: false, // Final results
			searchId: this._searchIdCounter.current,
		};
	}

	private async processSearchStream(
		searchStream: AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void>,
		searchId: number,
		progressive: boolean,
		graph: GitGraph,
		options?: { selectFirstResult?: boolean },
	): Promise<GitGraphSearch | undefined> {
		let search: GitGraphSearch | undefined;
		let firstResultSelected = false;

		let result: IteratorResult<GitGraphSearchProgress, GitGraphSearch> | undefined;
		while (!(result = await searchStream.next()).done) {
			// Break out if search was cancelled or a new search started
			if (searchId !== this._searchIdCounter.current) break;

			const progress = result.value;
			if (!progress.results.size) continue;

			// Accumulate results from progressive batches
			if (search?.results != null) {
				for (const [sha, data] of progress.results) {
					search.results.set(sha, data);
				}

				search = {
					repoPath: search.repoPath,
					query: search.query,
					queryFilters: search.queryFilters,
					comparisonKey: search.comparisonKey,
					results: search.results,
					hasMore: progress.hasMore,
				};
			} else {
				search = {
					repoPath: progress.repoPath,
					query: progress.query,
					queryFilters: progress.queryFilters,
					comparisonKey: progress.comparisonKey,
					results: new Map(progress.results),
					hasMore: progress.hasMore,
				};
			}
			this._search = updateSearchMode(this.container, search);

			// Select first result as soon as we find one (only once)
			let selectedRows: GraphSelectedRows | undefined;
			if (options?.selectFirstResult && !firstResultSelected) {
				const firstResult = await this.ensureSearchStartsInRange(graph, progress.results);
				if (firstResult != null) {
					this.setSelectedRows(firstResult);
					selectedRows = convertSelectedRows(this._selectedRows);
					firstResultSelected = true;
				}
			}

			if (progressive) {
				// Send only the incremental batch to frontend (not all accumulated results)
				void this.host.notify(DidSearchNotification, {
					search: this._search.query,
					results: this.getSearchResultsData(progress),
					selectedRows: selectedRows,
					partial: true,
					searchId: searchId,
				});
			}
		}

		// Get final result from generator
		if (result?.value != null) {
			search = result.value;
			this._search = updateSearchMode(this.container, search);
			void (await this.ensureSearchStartsInRange(graph, search.results));

			// Send final notification with complete results (only if not superseded)
			if (searchId === this._searchIdCounter.current && progressive) {
				void this.host.notify(DidSearchNotification, {
					search: this._search.query,
					results: this.getSearchResultsData(search) ?? {
						count: 0,
						hasMore: false,
						commitsLoaded: { count: 0 },
					},
					selectedRows:
						options?.selectFirstResult && firstResultSelected
							? convertSelectedRows(this._selectedRows)
							: undefined,
					partial: false,
					searchId: searchId,
				});
			}
		}

		return search;
	}

	@ipcCommand(SearchOpenInViewCommand)
	private onSearchOpenInView(params: IpcParams<typeof SearchOpenInViewCommand>) {
		if (this.repository == null) return;

		void this.container.views.searchAndCompare.search(this.repository.path, params.search, {
			label: { label: `for ${params.search.query}` },
			reveal: { select: true, focus: false, expand: true },
		});
	}

	@ipcCommand(ChooseRepositoryCommand)
	private async onChooseRepository() {
		// // Ensure that the current repository is always last
		// const repositories = this.container.git.openRepositories.sort(
		// 	(a, b) =>
		// 		(a === this.repository ? 1 : -1) - (b === this.repository ? 1 : -1) ||
		// 		(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
		// 		a.index - b.index,
		// );

		const { title, placeholder } = getRepositoryPickerTitleAndPlaceholder(
			this.container.git.openRepositories,
			'Switch',
			this.repository?.name,
		);
		const pick = await showRepositoryPicker(
			this.container,
			title,
			placeholder,
			this.container.git.openRepositories,
			{ picked: this.repository },
		);
		if (pick == null) return;

		this.repository = pick;
		this.host.sendTelemetryEvent('graph/repository/changed', {
			'repository.id': this.repository?.idHash,
			'repository.scheme': this.repository?.uri.scheme,
			'repository.closed': this.repository?.closed,
			'repository.folder.scheme': this.repository?.folder?.uri.scheme,
			'repository.provider.id': this.repository?.provider.id,
		});
	}

	@ipcRequest(ChooseRefRequest)
	private async onChooseRef(params: IpcParams<typeof ChooseRefRequest>) {
		if (this.repository == null) return undefined;

		const result = await showReferencePicker2(this.repository.path, params.title, params.placeholder, {
			allowedAdditionalInput: params.allowedAdditionalInput,
			include: params.include ?? ['branches', 'tags'],
			picked: params.picked,
		});
		const pick = result?.value;

		return pick?.sha != null
			? {
					id: pick.id,
					name: pick.name,
					sha: pick.sha,
					refType: pick.refType,
					graphRefType: convertRefToGraphRefType(pick),
				}
			: undefined;
	}

	@ipcRequest(ChooseComparisonRequest)
	private async onChooseComparison(params: IpcParams<typeof ChooseComparisonRequest>) {
		if (this.repository == null) return { range: undefined };

		const result = await showComparisonPicker(this.container, this.repository.path, {
			getTitleAndPlaceholder: step => {
				switch (step) {
					case 1:
						return {
							title: params.title,
							placeholder: 'Choose a branch or tag to show commits from',
						};
					case 2:
						return {
							title: params.title,
							placeholder: 'Choose a base to compare against (e.g., main)',
						};
				}
			},
		});

		return { range: result != null ? `${result.base.ref}..${result.head.ref}` : undefined };
	}

	@ipcRequest(ChooseAuthorRequest)
	private async onChooseAuthor(params: IpcParams<typeof ChooseAuthorRequest>) {
		if (this.repository == null) return { authors: undefined };

		const authors = params.picked != null ? new Set(params.picked) : undefined;
		const contributors = await showContributorsPicker(
			this.container,
			this.repository,
			params.title,
			params.placeholder,
			{
				appendReposToTitle: true,
				clearButton: true,
				multiselect: true,
				picked: c =>
					authors != null &&
					((c.email != null && authors.has(c.email)) ||
						(c.name != null && authors.has(c.name)) ||
						(c.username != null && authors.has(c.username))),
			},
		);

		return { authors: contributors != null ? filterMap(contributors, c => c.email) : undefined };
	}

	@ipcRequest(ChooseFileRequest)
	private async onChooseFile(params: IpcParams<typeof ChooseFileRequest>) {
		if (this.repository == null) return { files: undefined };

		const uris = await window.showOpenDialog({
			canSelectFiles: params.type === 'file',
			canSelectFolders: params.type === 'folder',
			canSelectMany: params.type === 'file',
			title: params.title,
			openLabel: params.openLabel,
			defaultUri: this.repository.folder?.uri,
		});

		if (!uris?.length) return { files: undefined };

		// Convert URIs to relative paths from the repository root
		const files = uris.map(uri => this.container.git.getRelativePath(uri, this.repository!.path));
		return { files: files };
	}

	@ipcRequest(JumpToHeadRequest)
	private async onJumpToHead(): Promise<IpcResponse<typeof JumpToHeadRequest>> {
		if (this.repository == null) return undefined;

		let branch = find(this._graph!.branches.values(), b => b.current);
		branch ??= await this.repository.git.branches.getBranch();

		return branch?.sha != null
			? {
					id: branch.id,
					name: branch.name,
					sha: branch.sha,
					refType: branch.refType as 'branch',
					graphRefType: convertRefToGraphRefType(branch),
				}
			: undefined;
	}

	private _fireSelectionChangedDebounced: Deferrable<GraphWebviewProvider['fireSelectionChanged']> | undefined =
		undefined;
	private _lastUserSelectionTime: number = 0;

	@ipcCommand(UpdateSelectionCommand)
	private onSelectionChanged(params: IpcParams<typeof UpdateSelectionCommand>) {
		this._showActiveSelectionDetailsDebounced?.cancel();

		const item = params.selection.find(r => r.active) ?? params.selection[0];
		this.setSelectedRows(item?.id, params.selection, { selected: true, hidden: item?.hidden });

		// Track when user explicitly selects
		this._lastUserSelectionTime = Date.now();

		this._fireSelectionChangedDebounced ??= debounce(this.fireSelectionChanged.bind(this), 50);
		this._fireSelectionChangedDebounced(item?.id, item?.type);
	}

	private fireSelectionChanged(id: string | undefined, type: GitGraphRowType | undefined) {
		if (this.repository == null) return;

		const commit = this.getRevisionReference(this.repository.path, id, type);
		const commits = commit != null ? [commit] : undefined;

		this._selection = commits;

		if (commits == null) return;
		if (!this._firstSelection && this.host.is('editor') && !this.host.active) return;

		this.container.events.fire(
			'commit:selected',
			{
				commit: commits[0],
				interaction: 'passive',
				preserveFocus: true,
				preserveVisibility: this._firstSelection
					? this._showDetailsView === false
					: this._showDetailsView !== 'selection',
				searchContext: this.getSearchContext(id),
			},
			{ source: this.host.id },
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
			case 'stash-node':
				return createReference(id, repoPath, {
					refType: 'stash',
					name: id,
					number: undefined,
				});

			case 'work-dir-changes':
				return createReference(uncommitted, repoPath, { refType: 'revision' });

			default:
				return createReference(id, repoPath, { refType: 'revision' });
		}
	}

	@trace()
	private updateState(immediate: boolean = false) {
		this.host.clearPendingIpcNotifications();

		if (immediate) {
			void this.notifyDidChangeState();
			return;
		}

		this._notifyDidChangeStateDebounced ??= debounce(this.notifyDidChangeState.bind(this), 250);
		void this._notifyDidChangeStateDebounced();
	}

	private _notifyDidChangeAvatarsDebounced: Deferrable<GraphWebviewProvider['notifyDidChangeAvatars']> | undefined =
		undefined;

	@trace()
	private updateAvatars(immediate: boolean = false) {
		if (immediate) {
			void this.notifyDidChangeAvatars();
			return;
		}

		this._notifyDidChangeAvatarsDebounced ??= debounce(this.notifyDidChangeAvatars.bind(this), 100);
		void this._notifyDidChangeAvatarsDebounced();
	}

	@trace()
	private async notifyDidChangeAvatars() {
		if (this._graph == null) return;

		const data = this._graph;
		return this.host.notify(DidChangeAvatarsNotification, {
			avatars: Object.fromEntries(data.avatars),
		});
	}

	@trace()
	private async notifyDidChangeBranchState(branchState: BranchState) {
		return this.host.notify(DidChangeBranchStateNotification, {
			branchState: branchState,
		});
	}

	private _notifyDidChangeRefsMetadataDebounced:
		| Deferrable<GraphWebviewProvider['notifyDidChangeRefsMetadata']>
		| undefined = undefined;

	@trace()
	private updateRefsMetadata(immediate: boolean = false) {
		if (immediate) {
			void this.notifyDidChangeRefsMetadata();
			return;
		}

		this._notifyDidChangeRefsMetadataDebounced ??= debounce(this.notifyDidChangeRefsMetadata.bind(this), 100);
		void this._notifyDidChangeRefsMetadataDebounced();
	}

	@trace()
	private async notifyDidChangeRefsMetadata() {
		return this.host.notify(DidChangeRefsMetadataNotification, {
			metadata: this._refsMetadata != null ? Object.fromEntries(this._refsMetadata) : this._refsMetadata,
		});
	}

	@trace()
	private async notifyDidChangeColumns() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeColumnsNotification, this._ipcNotificationMap, this);
			return false;
		}

		const columns = this.getColumns();
		const columnSettings = this.getColumnSettings(columns);
		return this.host.notify(DidChangeColumnsNotification, {
			columns: columnSettings,
			context: this.getColumnHeaderContext(columnSettings),
			settingsContext: this.getGraphSettingsIconContext(columnSettings),
		});
	}

	@trace()
	private async notifyDidChangeScrollMarkers() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeScrollMarkersNotification, this._ipcNotificationMap, this);
			return false;
		}

		const columns = this.getColumns();
		const columnSettings = this.getColumnSettings(columns);
		return this.host.notify(DidChangeScrollMarkersNotification, {
			context: this.getGraphSettingsIconContext(columnSettings),
		});
	}

	@trace()
	private async notifyDidChangeRefsVisibility(params?: IpcParams<typeof DidChangeRefsVisibilityNotification>) {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeRefsVisibilityNotification, this._ipcNotificationMap, this);
			return false;
		}

		if (params == null) {
			const filters = this.getFiltersByRepo(this._graph?.repoPath);
			params = {
				branchesVisibility: this.getBranchesVisibility(filters),
				excludeRefs: this.getExcludedRefs(filters, this._graph) ?? {},
				excludeTypes: this.getExcludedTypes(filters) ?? {},
				includeOnlyRefs: undefined,
			};

			if (params?.includeOnlyRefs == null) {
				const includedRefsResult = await this.getIncludedRefs(filters, this._graph, { timeout: 100 });
				params.includeOnlyRefs = includedRefsResult.refs;
				void includedRefsResult.continuation?.then(refs => {
					if (refs == null) return;

					void this.notifyDidChangeRefsVisibility({ ...params!, includeOnlyRefs: refs });
				});
			}
		}

		return this.host.notify(DidChangeRefsVisibilityNotification, params);
	}

	@trace()
	private async notifyDidChangeConfiguration() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(
				DidChangeGraphConfigurationNotification,
				this._ipcNotificationMap,
				this,
			);
			return false;
		}

		return this.host.notify(DidChangeGraphConfigurationNotification, {
			config: this.getComponentConfig(),
		});
	}

	@trace()
	private async notifyDidFetch() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidFetchNotification, this._ipcNotificationMap, this);
			return false;
		}

		const lastFetched = await this.repository!.getLastFetched();
		return this.host.notify(DidFetchNotification, {
			lastFetched: new Date(lastFetched),
		});
	}

	private getSearchResultsData(
		search: GitGraphSearch | GitGraphSearchProgress | undefined,
	): GraphSearchResults | undefined {
		if (!search?.results?.size) return undefined;

		// Count the commits for these search results that are loaded in the graph
		const commitsLoaded: { count: number } = { count: 0 };
		if (this._graph?.ids != null) {
			for (const sha of search.results.keys()) {
				if (this._graph.ids.has(sha)) {
					commitsLoaded.count++;
				}
			}
		}

		return {
			ids: Object.fromEntries(search.results),
			count: search.results.size,
			hasMore: search.hasMore,
			commitsLoaded: commitsLoaded,
		};
	}

	@trace()
	private async notifyDidChangeRows(sendSelectedRows: boolean = false, completionId?: string) {
		if (this._graph == null) return;

		const graph = this._graph;

		return this.host.notify(
			DidChangeRowsNotification,
			{
				rows: graph.rows,
				avatars: Object.fromEntries(graph.avatars),
				downstreams: Object.fromEntries(graph.downstreams),
				refsMetadata: this._refsMetadata != null ? Object.fromEntries(this._refsMetadata) : this._refsMetadata,
				rowsStats: graph.rowsStats?.size ? Object.fromEntries(graph.rowsStats) : undefined,
				rowsStatsLoading:
					graph.rowsStatsDeferred?.isLoaded != null ? !graph.rowsStatsDeferred.isLoaded() : false,

				search: this._search?.results?.size
					? {
							search: this._search.query,
							results: this.getSearchResultsData(this._search),
							partial: false,
							searchId: this._searchIdCounter.current,
						}
					: undefined,
				selectedRows: sendSelectedRows ? convertSelectedRows(this._selectedRows) : undefined,
				paging: {
					startingCursor: graph.paging?.startingCursor,
					hasMore: graph.paging?.hasMore ?? false,
				},
			},
			completionId,
		);
	}

	@trace({ args: false })
	private async notifyDidChangeRowsStats(graph: GitGraph) {
		if (graph.rowsStats == null) return;

		return this.host.notify(DidChangeRowsStatsNotification, {
			rowsStats: Object.fromEntries(graph.rowsStats),
			rowsStatsLoading: graph.rowsStatsDeferred?.isLoaded != null ? !graph.rowsStatsDeferred.isLoaded() : false,
		});
	}

	@trace()
	private async notifyDidStartFeaturePreview(featurePreview?: FeaturePreview) {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidStartFeaturePreviewNotification, this._ipcNotificationMap, this);
			return false;
		}

		featurePreview ??= this.getFeaturePreview();
		const [access] = await this.getGraphAccess();
		return this.host.notify(DidStartFeaturePreviewNotification, {
			featurePreview: featurePreview,
			allowed: this.isGraphAccessAllowed(access, featurePreview),
		});
	}

	@trace()
	private async notifyDidChangeWorkingTree(hasWorkingChanges?: boolean) {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeWorkingTreeNotification, this._ipcNotificationMap, this);
			return false;
		}

		return this.host.notify(DidChangeWorkingTreeNotification, {
			stats: (await this.getWorkingTreeStatsAndPausedOperations(hasWorkingChanges)) ?? {
				added: 0,
				deleted: 0,
				modified: 0,
			},
		});
	}

	@trace()
	private async notifyDidChangeSelection() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeSelectionNotification, this._ipcNotificationMap, this);
			return false;
		}

		return this.host.notify(DidChangeSelectionNotification, {
			selection: convertSelectedRows(this._selectedRows) ?? {},
		});
	}

	@trace()
	private async notifyDidChangeSubscription() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeSubscriptionNotification, this._ipcNotificationMap, this);
			return false;
		}

		const [access] = await this.getGraphAccess();
		return this.host.notify(DidChangeSubscriptionNotification, {
			subscription: access.subscription.current,
			allowed: this.isGraphAccessAllowed(access, this.getFeaturePreview()),
		});
	}

	@trace()
	private notifyDidChangeOrgSettings() {
		void this.host.notify(DidChangeOrgSettings, { orgSettings: this.getOrgSettings() });
	}

	@trace()
	private async notifyDidChangeState() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeNotification, this._ipcNotificationMap, this);
			return false;
		}

		this._notifyDidChangeStateDebounced?.cancel();
		return this.host.notify(DidChangeNotification, { state: await this.getState() });
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
			repo.watchFileSystem(1000),
			repo.onDidChangeFileSystem(this.onRepositoryFileSystemChanged, this),
			onDidChangeContext(key => {
				if (key !== 'gitlens:repos:withHostingIntegrationsConnected') return;

				this.resetRefsMetadata();
				this.updateRefsMetadata();
			}),
		);
	}

	private onIntegrationConnectionChanged(e: ConnectionStateChangeEvent) {
		void this.notifyDidChangeRepoConnection();

		// If an issue integration connected/disconnected, update metadata state
		if (supportedOrderedCloudIssuesIntegrationIds.includes(e.key as IssuesCloudHostIntegrationId)) {
			void this.onIssueIntegrationConnectionChanged(e.reason === 'connected');
		}
	}

	private async onIssueIntegrationConnectionChanged(connected: boolean) {
		if (connected) {
			this._issueIntegrationConnectionState = 'connected';
		} else {
			// Recheck since another issue integration might still be connected
			await this.checkIssueIntegrations();
		}

		this.resetRefsMetadata();
		this.updateRefsMetadata();
	}

	private async checkIssueIntegrations(): Promise<boolean> {
		const results = await Promise.allSettled(
			supportedOrderedCloudIssuesIntegrationIds.map(async id => {
				const integration = await this.container.integrations.get(id);
				return integration?.maybeConnected ?? (await integration?.isConnected()) ?? false;
			}),
		);
		const connected = results.map(r => (r.status === 'fulfilled' ? r.value : false));
		this._issueIntegrationConnectionState = connected.some(Boolean) ? 'connected' : 'not-connected';
		return this._issueIntegrationConnectionState === 'connected';
	}

	private async notifyDidChangeRepoConnection() {
		void this.host.notify(DidChangeRepoConnectionNotification, {
			repositories: await this.getRepositoriesState(),
		});
	}

	private async getRepositoriesState(): Promise<GraphRepository[]> {
		return formatRepositories(this.container.git.openRepositories);
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

		const interval = getLastFetchedUpdateInterval(lastFetched);
		if (lastFetched !== 0 && interval > 0) {
			this._lastFetchedDisposable = disposableInterval(() => {
				// Skip update if webview is not visible to reduce unnecessary work
				if (!this.host.visible) return;

				// Check if the interval should change, and if so, reset it
				if (interval !== getLastFetchedUpdateInterval(lastFetched)) {
					void this.ensureLastFetchedSubscription(true);
					return;
				}

				void this.notifyDidFetch();
			}, interval);
		}
	}

	private async ensureSearchStartsInRange(graph: GitGraph, results: GitGraphSearchResults) {
		if (!results.size) return undefined;

		// If we have a selection and it is in the search results, keep it
		if (this._selectedId != null && results.has(this._selectedId)) {
			if (graph.ids.has(this._selectedId)) {
				return this._selectedId;
			}
		}

		// Find the first result that is in the graph
		let firstResult: string | undefined;
		for (const id of results.keys()) {
			if (graph.ids.has(id)) return id;

			firstResult = id;
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

	private getExcludedTypes(filters: StoredGraphFilters | undefined): GraphExcludeTypes | undefined {
		return filters?.excludeTypes;
	}

	private getExcludedRefs(
		filters: StoredGraphFilters | undefined,
		graph: GitGraph | undefined,
	): Record<string, GraphExcludedRef> | undefined {
		if (graph == null) return undefined;

		const storedExcludeRefs = filters?.excludeRefs;
		if (!hasKeys(storedExcludeRefs)) return undefined;

		const asWebviewUri = (uri: Uri) => this.host.asWebviewUri(uri);
		const useAvatars = configuration.get('graph.avatars', undefined, true);

		const excludeRefs: GraphExcludeRefs = {};

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
		// 	this.repository = this.container.git2.getBestRepositoryOrFirst;
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

	private async getIncludedRefs(
		filters: StoredGraphFilters | undefined,
		graph: GitGraph | undefined,
		options?: { timeout?: number },
	): Promise<{ refs: GraphIncludeOnlyRefs; continuation?: Promise<GraphIncludeOnlyRefs | undefined> }> {
		this.cancelOperation('computeIncludedRefs');

		if (graph == null) return { refs: {} };

		const branchesVisibility = this.getBranchesVisibility(filters);

		let refs: Map<string, GraphIncludeOnlyRef> | undefined;
		let continuation: Promise<GraphIncludeOnlyRefs | undefined> | undefined;

		switch (branchesVisibility) {
			case 'smart': {
				// Add the default branch and if the current branch has a PR associated with it then add the base of the PR
				const current = find(graph.branches.values(), b => b.current);
				if (current == null) return { refs: {}, continuation: continuation };

				const cancellation = this.createCancellation('computeIncludedRefs');

				const result = await getBranchMergeTargetInfo(this.container, current, {
					cancellation: cancellation.token,
					timeout: options?.timeout,
				});

				if (cancellation.token.isCancellationRequested) return { refs: {}, continuation: continuation };

				let targetBranchName: string | undefined;
				if (result.mergeTargetBranch?.paused) {
					continuation = result.mergeTargetBranch.value.then(async target => {
						if (target == null || cancellation?.token.isCancellationRequested) return undefined;

						const refs = await this.getVisibleRefs(graph, current, {
							baseOrTargetBranchName: target,
							defaultBranchName: result.defaultBranch,
						});
						return Object.fromEntries(refs);
					});
				} else {
					targetBranchName = result.mergeTargetBranch?.value;
				}

				refs = await this.getVisibleRefs(graph, current, {
					baseOrTargetBranchName: targetBranchName ?? result.baseBranch,
					defaultBranchName: result.defaultBranch,
				});

				break;
			}
			case 'current': {
				const current = find(graph.branches.values(), b => b.current);
				if (current == null) return { refs: {}, continuation: continuation };

				refs = await this.getVisibleRefs(graph, current);
				break;
			}
			case 'favorited': {
				const starredBranchIds = getStarredBranchIds(this.container);
				if (starredBranchIds.size) {
					refs = new Map();
					for (const branch of graph.branches.values()) {
						if (branch.current || starredBranchIds.has(branch.id)) {
							refs.set(branch.id, convertBranchToIncludeOnlyRef(branch));
						}
					}
				}

				if (!refs?.size) {
					return {
						// Create an empty set to say we want to include nothing
						refs: {
							['gk.empty-set-marker' satisfies typeof emptySetMarker]: {} as unknown as GraphRefOptData,
						},
						continuation: continuation,
					};
				}
				break;
			}
			default:
				break;
		}

		return { refs: refs == null ? {} : Object.fromEntries(refs), continuation: continuation };
	}

	private getFiltersByRepo(repoPath: string | undefined): StoredGraphFilters | undefined {
		if (repoPath == null) return undefined;

		const filters = this.container.storage.getWorkspace('graph:filtersByRepo');
		return filters?.[repoPath];
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
		return serializeWebviewItemContext<GraphItemContext>({
			webviewItem: 'gitlens:graph:columns',
			webviewItemValue: this.getColumnContextItems(columnSettings).join(','),
		});
	}

	private getGraphSettingsIconContext(columnsSettings?: GraphColumnsSettings): string {
		return serializeWebviewItemContext<GraphItemContext>({
			webviewItem: 'gitlens:graph:settings',
			webviewItemValue: this.getSettingsIconContextItems(columnsSettings).join(','),
		});
	}

	private getColumnContextItems(columnSettings: GraphColumnsSettings): string[] {
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
				`column:${name}:${settings.isHidden ? 'hidden' : 'visible'}${settings.mode ? `+${settings.mode}` : ''}`,
			);
		}

		if (visibleColumns > 1) {
			contextItems.push('columns:canHide');
		}

		return contextItems;
	}

	private getSettingsIconContextItems(columnSettings?: GraphColumnsSettings): string[] {
		const contextItems: string[] = columnSettings != null ? this.getColumnContextItems(columnSettings) : [];

		if (configuration.get('graph.scrollMarkers.enabled')) {
			const configurableScrollMarkerTypes: GraphScrollMarkersAdditionalTypes[] = [
				'localBranches',
				'remoteBranches',
				'stashes',
				'tags',
				'pullRequests',
			];
			const enabledScrollMarkerTypes = configuration.get('graph.scrollMarkers.additionalTypes');
			for (const type of configurableScrollMarkerTypes) {
				contextItems.push(
					`scrollMarker:${type}:${enabledScrollMarkerTypes.includes(type) ? 'enabled' : 'disabled'}`,
				);
			}
		}

		return contextItems;
	}

	private getBranchesVisibility(filters: StoredGraphFilters | undefined): GraphBranchesVisibility {
		// We can't currently support all, smart, or favorited branches on virtual repos
		if (this.repository?.virtual) return 'current';
		if (filters == null) return configuration.get('graph.branchesVisibility');

		let branchesVisibility: GraphBranchesVisibility;

		// Migrate `current` visibility from before `branchesVisibility` existed by looking to see if there is only one ref included
		if (
			filters != null &&
			filters.branchesVisibility == null &&
			filters.includeOnlyRefs != null &&
			Object.keys(filters.includeOnlyRefs).length === 1 &&
			Object.values(filters.includeOnlyRefs)[0].name === 'HEAD'
		) {
			branchesVisibility = 'current';
			if (this.repository != null) {
				void this.updateFiltersByRepo(this.repository.path, {
					branchesVisibility: branchesVisibility,
					includeOnlyRefs: undefined,
				});
			}
		} else {
			branchesVisibility = filters?.branchesVisibility ?? configuration.get('graph.branchesVisibility');
		}

		return branchesVisibility;
	}

	private getComponentConfig(): GraphComponentConfig {
		const config: GraphComponentConfig = {
			aiEnabled: this.container.ai.enabled,
			avatars: configuration.get('graph.avatars'),
			dateFormat:
				configuration.get('graph.dateFormat') ?? configuration.get('defaultDateFormat') ?? 'short+short',
			dateStyle: configuration.get('graph.dateStyle') ?? configuration.get('defaultDateStyle'),
			enabledRefMetadataTypes: this.getEnabledRefMetadataTypes(),
			dimMergeCommits: configuration.get('graph.dimMergeCommits'),
			highlightRowsOnRefHover: configuration.get('graph.highlightRowsOnRefHover'),
			idLength: configuration.get('advanced.abbreviatedShaLength'),
			minimap: configuration.get('graph.minimap.enabled'),
			minimapDataType: configuration.get('graph.minimap.dataType'),
			minimapMarkerTypes: this.getMinimapMarkerTypes(),
			multiSelectionMode: configuration.get('graph.multiselect'),
			onlyFollowFirstParent: configuration.get('graph.onlyFollowFirstParent'),
			scrollRowPadding: configuration.get('graph.scrollRowPadding'),
			scrollMarkerTypes: this.getScrollMarkerTypes(),
			showGhostRefsOnRowHover: configuration.get('graph.showGhostRefsOnRowHover'),
			showRemoteNamesOnRefs: configuration.get('graph.showRemoteNames'),
			sidebar: configuration.get('graph.sidebar.enabled') ?? true,
			stickyTimeline: configuration.get('graph.stickyTimeline'),
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

		if (configuration.get('graph.issues.enabled')) {
			types.push('issue');
		}

		if (configuration.get('graph.pullRequests.enabled')) {
			types.push('pullRequest');
		}

		if (configuration.get('graph.showUpstreamStatus')) {
			types.push('upstream');
		}

		return types;
	}

	private async getGraphAccess() {
		const access = await this.container.git.access('graph', this.repository?.path);
		this._etagSubscription = this.container.subscription.etag;

		let visibility = access?.visibility;
		if (visibility == null && this.repository != null) {
			visibility = await this.container.git.visibility(this.repository?.path);
		}

		return [access, visibility] as const;
	}

	private isGraphAccessAllowed(
		access: Awaited<ReturnType<GraphWebviewProvider['getGraphAccess']>>[0] | undefined,
		featurePreview: FeaturePreview,
	) {
		return (access?.allowed ?? false) !== false || getFeaturePreviewStatus(featurePreview) === 'active';
	}

	private getGraphItemContext(context: unknown): unknown | undefined {
		const item = typeof context === 'string' ? JSON.parse(context) : context;
		// Add the `webview` prop to the context if its missing (e.g. when this context doesn't come through via the context menus)
		if (item != null && !('webview' in item)) {
			item.webview = this.host.id;
		}
		return item;
	}

	private async getWorkingTreeStatsAndPausedOperations(
		hasWorkingChanges?: boolean,
		cancellation?: CancellationToken,
	): Promise<GraphWorkingTreeStats | undefined> {
		if (this.repository == null || !this.container.git.repositoryCount) return undefined;

		const svc = this.container.git.getRepositoryService(this.repository.path);

		hasWorkingChanges ??= await svc.status.hasWorkingChanges(
			{ staged: true, unstaged: true, untracked: true },
			cancellation,
		);

		const [statusResult, pausedOpStatusResult] = await Promise.allSettled([
			hasWorkingChanges ? svc.status.getStatus(cancellation) : undefined,
			svc.pausedOps?.getPausedOperationStatus?.(cancellation),
		]);

		const status = getSettledValue(statusResult);
		const workingTreeStatus = status?.getDiffStatus();
		const pausedOpStatus = getSettledValue(pausedOpStatusResult);

		return {
			added: workingTreeStatus?.added ?? 0,
			deleted: workingTreeStatus?.deleted ?? 0,
			modified: workingTreeStatus?.changed ?? 0,
			hasConflicts: status?.hasConflicts,
			pausedOpStatus: pausedOpStatus,
			context: serializeWebviewItemContext<GraphItemContext>({
				webviewItem: 'gitlens:wip',
				webviewItemValue: {
					type: 'commit',
					ref: this.getRevisionReference(this.repository.path, uncommitted, 'work-dir-changes')!,
				},
			}),
		};
	}

	private async getState(deferRows?: boolean): Promise<State> {
		this.cancelOperation('branchState');
		this.cancelOperation('state');

		const searchRequest = this._searchRequest;
		this._searchRequest = undefined;

		if (this.container.git.repositoryCount === 0) {
			return { ...this.host.baseWebviewState, allowed: true, repositories: [] };
		}

		if (this.repository == null) {
			this.repository = this.container.git.getBestRepositoryOrFirst();
			if (this.repository == null) {
				return { ...this.host.baseWebviewState, allowed: true, repositories: [] };
			}
		}

		const cancellation = this.createCancellation('state');

		this._etagRepository = this.repository?.etag;
		this.host.title = `${this.host.originalTitle}: ${this.repository.name}`;

		const { defaultItemLimit } = configuration.get('graph');

		// If we have a set of data refresh to the same set
		const limit = Math.max(defaultItemLimit, this._graph?.ids.size ?? defaultItemLimit);

		const hasWorkingChanges = await this.repository.git.status.hasWorkingChanges(
			{ staged: true, unstaged: true, untracked: true },
			cancellation.token,
		);

		let selectedId = this._selectedId;
		let selectionChanged = false;

		// Skip default row selection if we are honoring the selected id or we have a pending search request
		// to avoid overriding an honored selection or jumping to WIP/HEAD before the search is applied
		if (
			!this._honorSelectedId &&
			searchRequest == null &&
			selectedId !== uncommitted &&
			hasWorkingChanges &&
			configuration.get('graph.initialRowSelection') === 'wip'
		) {
			selectionChanged = true;

			this.setSelectedRows(uncommitted);
			selectedId = this._selectedId;
		}
		this._honorSelectedId = false;

		const columns = this.getColumns();
		const columnSettings = this.getColumnSettings(columns);

		const dataPromise = this.repository.git.graph.getGraph(
			selectedId,
			uri => this.host.asWebviewUri(uri),
			{
				include: {
					stats:
						(configuration.get('graph.minimap.enabled') &&
							configuration.get('graph.minimap.dataType') === 'lines') ||
						!columnSettings.changes.isHidden,
				},
				limit: limit,
			},
			cancellation.token,
		);

		// Check for access and working tree stats
		const promises = Promise.allSettled([
			this.getGraphAccess(),
			this.getWorkingTreeStatsAndPausedOperations(hasWorkingChanges, cancellation.token),
			this.repository.git.branches.getBranch(undefined, cancellation.token),
			this.repository.getLastFetched(),
		]);

		let data;
		if (deferRows) {
			queueMicrotask(async () => {
				try {
					const data = await dataPromise;
					this.setGraph(data);

					// Don't override selection if user selected something in the last 500ms
					const userRecentlySelected = Date.now() - this._lastUserSelectionTime < 500;
					if (!userRecentlySelected && this._selectedId !== data.id) {
						selectionChanged = true;
						this.setSelectedRows(data.id);
					}

					void this.notifyDidChangeRefsVisibility();
					void this.notifyDidChangeRows(selectionChanged);
				} catch {}
			});
		} else {
			data = await dataPromise;
			this.setGraph(data);

			if (selectedId !== data.id) {
				this.setSelectedRows(data.id);
			}
		}

		const [accessResult, workingStatsResult, branchResult, lastFetchedResult] = await promises;
		if (cancellation.token.isCancellationRequested) throw new CancellationError();

		const [access, visibility] = getSettledValue(accessResult) ?? [];

		let branchState: BranchState | undefined;

		const branch = getSettledValue(branchResult);
		if (branch != null) {
			branchState = { ...(branch.upstream?.state ?? { ahead: 0, behind: 0 }) };

			const worktreesByBranch =
				data?.worktreesByBranch ?? (await getWorktreesByBranch(this.repository, undefined, cancellation.token));
			branchState.worktree = worktreesByBranch?.has(branch.id) ?? false;

			if (branch.upstream != null) {
				branchState.upstream = branch.upstream.name;

				const branchStateCancellation = this.createCancellation('branchState');

				const [remoteResult, prResult] = await Promise.allSettled([
					branch.getRemote(),
					pauseOnCancelOrTimeout(branch.getAssociatedPullRequest(), branchStateCancellation.token, 100),
				]);

				const remote = getSettledValue(remoteResult);
				if (remote?.provider != null) {
					branchState.provider = {
						name: remote.provider.name,
						icon: remote.provider.icon === 'remote' ? 'cloud' : remote.provider.icon,
						url: await remote.provider.url({ type: RemoteResourceType.Repo }),
					};
				}

				const maybePr = getSettledValue(prResult);
				if (maybePr?.paused) {
					const updatedBranchState = { ...branchState };
					void maybePr.value.then(pr => {
						if (branchStateCancellation?.token.isCancellationRequested) return;

						if (pr != null) {
							updatedBranchState.pr = serializePullRequest(pr);
							void this.notifyDidChangeBranchState(updatedBranchState);
						}
					});
				} else {
					const pr = maybePr?.value;
					if (pr != null) {
						branchState.pr = serializePullRequest(pr);
					}
				}
			}
		}

		const filters = this.getFiltersByRepo(this.repository.path);
		const refsVisibility: IpcParams<typeof DidChangeRefsVisibilityNotification> = {
			branchesVisibility: this.getBranchesVisibility(filters),
			excludeRefs: this.getExcludedRefs(filters, data) ?? {},
			excludeTypes: this.getExcludedTypes(filters) ?? {},
			includeOnlyRefs: undefined,
		};
		if (data != null) {
			const includedRefsResult = await this.getIncludedRefs(filters, data, { timeout: 100 });
			refsVisibility.includeOnlyRefs = includedRefsResult.refs;
			void includedRefsResult.continuation?.then(refs => {
				if (refs == null) return;

				void this.notifyDidChangeRefsVisibility({ ...refsVisibility, includeOnlyRefs: refs });
			});
		}

		const searchMode = this.container.storage.get('graph:searchMode', 'normal');
		const useNaturalLanguageSearch = this.container.storage.get('graph:useNaturalLanguageSearch', true);
		const featurePreview = this.getFeaturePreview();

		const result: State = {
			...this.host.baseWebviewState,
			webroot: this.host.getWebRoot(),
			windowFocused: this.isWindowFocused,
			repositories: await formatRepositories(this.container.git.openRepositories),
			selectedRepository: this.repository.path,
			selectedRepositoryVisibility: visibility,
			branchesVisibility: refsVisibility.branchesVisibility,
			branch: branch && {
				name: branch.name,
				ref: branch.ref,
				refType: branch.refType,
				remote: branch.remote,
				repoPath: branch.repoPath,
				sha: branch.sha,
				id: branch.id,
				upstream: branch.upstream,
			},
			branchState: branchState,
			lastFetched: new Date(getSettledValue(lastFetchedResult)!),
			selectedRows: convertSelectedRows(this._selectedRows),
			subscription: access?.subscription.current,
			allowed: this.isGraphAccessAllowed(access, featurePreview), //(access?.allowed ?? false) !== false,
			avatars: data != null ? Object.fromEntries(data.avatars) : undefined,
			refsMetadata: this.resetRefsMetadata() === null ? null : {},
			loading: deferRows === true,
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
				settings: this.getGraphSettingsIconContext(columnSettings),
			},
			excludeRefs: refsVisibility.excludeRefs,
			excludeTypes: refsVisibility.excludeTypes,
			includeOnlyRefs: refsVisibility.includeOnlyRefs,
			nonce: this.host.cspNonce,
			workingTreeStats: getSettledValue(workingStatsResult) ?? { added: 0, deleted: 0, modified: 0 },
			searchMode: searchMode,
			useNaturalLanguageSearch: useNaturalLanguageSearch,
			featurePreview: featurePreview,
			orgSettings: this.getOrgSettings(),
			mcpBannerCollapsed: this.getMcpBannerCollapsed(),
			searchRequest: searchRequest,
		};
		return result;
	}

	private updateColumns(columnsCfg: GraphColumnsConfig) {
		let columns = this.container.storage.getWorkspace('graph:columns');
		for (const [key, value] of Object.entries(columnsCfg)) {
			columns = updateRecordValue(columns, key, value);
		}
		void this.container.storage.storeWorkspace('graph:columns', columns).catch();
		void this.notifyDidChangeColumns();
	}

	// Reset columns wrappers
	@command('gitlens.graph.resetColumnsDefault')
	private resetColumnsDefault() {
		this.updateColumns(defaultGraphColumnsSettings);
	}
	@command('gitlens.graph.resetColumnsCompact')
	private resetColumnsCompact() {
		this.updateColumns(compactGraphColumnsSettings);
	}

	private updateExcludedRefs(repoPath: string | undefined, refs: GraphExcludedRef[], visible: boolean) {
		if (repoPath == null || !refs?.length) return;

		let storedExcludeRefs: StoredGraphFilters['excludeRefs'] = this.getFiltersByRepo(repoPath)?.excludeRefs ?? {};
		for (const ref of refs) {
			storedExcludeRefs = updateRecordValue(
				storedExcludeRefs,
				ref.id,
				visible
					? undefined
					: { id: ref.id, type: ref.type as StoredGraphRefType, name: ref.name, owner: ref.owner },
			);
		}

		void this.updateFiltersByRepo(repoPath, { excludeRefs: storedExcludeRefs });
		void this.notifyDidChangeRefsVisibility();
	}

	private updateFiltersByRepo(repoPath: string | undefined, updates: Partial<StoredGraphFilters>) {
		if (repoPath == null) return;

		const filtersByRepo = this.container.storage.getWorkspace('graph:filtersByRepo');
		return this.container.storage.storeWorkspace(
			'graph:filtersByRepo',
			updateRecordValue(filtersByRepo, repoPath, { ...filtersByRepo?.[repoPath], ...updates }),
		);
	}

	private async getVisibleRefs(
		graph: GitGraph,
		currentBranch: GitBranch,
		options?: {
			defaultBranchName: string | undefined;
			baseOrTargetBranchName?: string | undefined;
			associatedPullRequest?: PullRequest | undefined;
		},
	): Promise<Map<string, GraphIncludeOnlyRef>> {
		const refs = new Map<string, GraphIncludeOnlyRef>([
			[currentBranch.id, convertBranchToIncludeOnlyRef(currentBranch)],
		]);

		const upstreamRef = convertBranchUpstreamToIncludeOnlyRef(currentBranch);
		if (upstreamRef != null && !refs.has(upstreamRef.id)) {
			refs.set(upstreamRef.id, upstreamRef);
		}

		let includeDefault = true;

		const baseBranchName = options?.baseOrTargetBranchName;
		if (baseBranchName != null && baseBranchName !== currentBranch?.name) {
			const baseBranch = graph.branches.get(baseBranchName);
			if (baseBranch != null) {
				includeDefault = false;

				if (baseBranch.remote) {
					if (!refs.has(baseBranch.id)) {
						refs.set(baseBranch.id, convertBranchToIncludeOnlyRef(baseBranch, true));
					}
				} else {
					const upstreamRef = convertBranchUpstreamToIncludeOnlyRef(baseBranch);
					if (upstreamRef != null && !refs.has(upstreamRef.id)) {
						refs.set(upstreamRef.id, upstreamRef);
					}
				}
			}
		}

		const pr = options?.associatedPullRequest;
		if (pr?.refs != null) {
			let prBranch;

			const remote = find(graph.remotes.values(), r => r.matches(pr.refs!.base.url));
			if (remote != null) {
				prBranch = graph.branches.get(`${remote.name}/${pr.refs.base.branch}`);
			}

			if (prBranch != null) {
				includeDefault = false;

				if (!refs.has(prBranch.id)) {
					refs.set(prBranch.id, convertBranchToIncludeOnlyRef(prBranch, true));
				}
			}
		}

		if (includeDefault) {
			const defaultBranchName = options?.defaultBranchName;
			if (defaultBranchName != null && defaultBranchName !== currentBranch?.name) {
				const defaultBranch = graph.branches.get(defaultBranchName);
				if (defaultBranch != null) {
					if (defaultBranch.remote) {
						if (!refs.has(defaultBranch.id)) {
							refs.set(defaultBranch.id, convertBranchToIncludeOnlyRef(defaultBranch, true));
						}

						const localDefault = await getLocalBranchByUpstream(defaultBranchName, graph.branches);
						if (localDefault != null) {
							if (!refs.has(localDefault.id)) {
								refs.set(localDefault.id, convertBranchToIncludeOnlyRef(localDefault, false));
							}
						}
					} else {
						if (!refs.has(defaultBranch.id)) {
							refs.set(defaultBranch.id, convertBranchToIncludeOnlyRef(defaultBranch, false));
						}

						const upstreamRef = convertBranchUpstreamToIncludeOnlyRef(defaultBranch);
						if (upstreamRef != null && !refs.has(upstreamRef.id)) {
							refs.set(upstreamRef.id, upstreamRef);
						}
					}
				}
			}
		}

		return refs;
	}

	@ipcCommand(UpdateIncludedRefsCommand)
	private onUpdateIncludeOnlyRefs(params: IpcParams<typeof UpdateIncludedRefsCommand>) {
		this.updateIncludeOnlyRefs(this._graph?.repoPath, params);
	}

	private updateIncludeOnlyRefs(
		repoPath: string | undefined,
		{ branchesVisibility, refs }: IpcParams<typeof UpdateIncludedRefsCommand>,
	) {
		if (repoPath == null) return;

		let storedIncludeOnlyRefs: StoredGraphFilters['includeOnlyRefs'];

		if (!refs?.length) {
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

		if (branchesVisibility != null) {
			const currentBranchesVisibility = this.getBranchesVisibility(this.getFiltersByRepo(repoPath));

			this.host.sendTelemetryEvent('graph/branchesVisibility/changed', {
				'branchesVisibility.old': currentBranchesVisibility,
				'branchesVisibility.new': branchesVisibility,
			});
		}

		void this.updateFiltersByRepo(repoPath, {
			branchesVisibility: branchesVisibility,
			includeOnlyRefs: storedIncludeOnlyRefs,
		});
		void this.notifyDidChangeRefsVisibility();
	}

	@ipcCommand(UpdateExcludeTypesCommand)
	private onUpdateExcludedTypes(params: IpcParams<typeof UpdateExcludeTypesCommand>) {
		this.updateExcludedTypes(this._graph?.repoPath, params);
	}

	private updateExcludedTypes(
		repoPath: string | undefined,
		{ key, value }: IpcParams<typeof UpdateExcludeTypesCommand>,
	) {
		if (repoPath == null) return;

		let excludeTypes = this.getFiltersByRepo(repoPath)?.excludeTypes;
		if (!hasKeys(excludeTypes) && value === false) {
			return;
		}

		excludeTypes = updateRecordValue(excludeTypes, key, value);

		this.host.sendTelemetryEvent('graph/filters/changed', {
			key: key,
			value: value,
		});

		void this.updateFiltersByRepo(repoPath, { excludeTypes: excludeTypes });
		void this.notifyDidChangeRefsVisibility();
	}

	private resetHoverCache() {
		this._hoverCache.clear();
		this.cancelOperation('hover');
	}

	private resetRefsMetadata(): null | undefined {
		this._refsMetadata =
			getContext('gitlens:repos:withHostingIntegrationsConnected') ||
			this._issueIntegrationConnectionState !== 'not-connected'
				? undefined
				: null;
		return this._refsMetadata;
	}

	private resetRepositoryState() {
		this._getBranchesAndTagsTips = undefined;
		this._searchHistory = undefined;
		this.setGraph(undefined);
		this.setSelectedRows(undefined);
	}

	private resetSearchState() {
		this._search = undefined;
		this.cancelOperation('search');
	}

	private setSelectedRows(id: string | undefined, selection?: GraphSelection[], state?: SelectedRowState) {
		// _selectedId should always be a "real" SHA
		let selectedId = id;
		if (id === ('work-dir-changes' satisfies GitGraphRowType)) {
			selectedId = uncommitted;
		}
		if (this._selectedId === selectedId) return;

		this._selectedId = selectedId;

		// _selectedRows should always be a "virtual" row type
		if (id === uncommitted) {
			id = 'work-dir-changes' satisfies GitGraphRowType;
		}

		if (selection != null) {
			this._selectedRows = Object.fromEntries(selection.map(r => [r.id, { selected: true, hidden: r.hidden }]));
			if (id != null && !selection.some(r => r.id === id)) {
				this._selectedRows[id] = state ?? { selected: true };
			}
		} else {
			this._selectedRows = id != null ? { [id]: state ?? { selected: true } } : undefined;
		}
	}

	private setGraph(graph: GitGraph | undefined) {
		this._graph = graph;
		if (graph == null) {
			this.resetHoverCache();
			this.resetRefsMetadata();
			this.resetSearchState();
			this.cancelOperation('computeIncludedRefs');
		} else {
			void graph.rowsStatsDeferred?.promise.then(() => void this.notifyDidChangeRowsStats(graph));
		}
	}

	private _pendingRowsQuery:
		| {
				promise: Promise<void>;
				cancellable: CancellationTokenSource;
				id?: string | undefined;
				search?: GitGraphSearch;
		  }
		| undefined;
	private async updateGraphWithMoreRows(graph: GitGraph, id: string | undefined, search?: GitGraphSearch) {
		if (this._pendingRowsQuery != null) {
			const { id: pendingId, search: pendingSearch } = this._pendingRowsQuery;
			if (pendingSearch === search && (pendingId === id || (pendingId != null && id == null))) {
				return this._pendingRowsQuery.promise;
			}

			this._pendingRowsQuery.cancellable.cancel();
			this._pendingRowsQuery.cancellable.dispose();
			this._pendingRowsQuery = undefined;
		}

		const sw = new Stopwatch(undefined);

		const cancellable = new CancellationTokenSource();
		const cancellation = cancellable.token;

		this._pendingRowsQuery = {
			promise: this.updateGraphWithMoreRowsCore(graph, id, search, cancellation).catch((ex: unknown) => {
				if (cancellation.isCancellationRequested) return;

				throw ex;
			}),
			cancellable: cancellable,
			id: id,
			search: search,
		};

		void this._pendingRowsQuery.promise.finally(() => {
			if (cancellation.isCancellationRequested) return;

			this.host.sendTelemetryEvent('graph/rows/loaded', {
				duration: sw.elapsed(),
				rows: graph.rows.length ?? 0,
			});
			sw.stop();

			this._pendingRowsQuery = undefined;
		});

		return this._pendingRowsQuery.promise;
	}

	private async updateGraphWithMoreRowsCore(
		graph: GitGraph,
		id: string | undefined,
		search?: GitGraphSearch,
		cancellation?: CancellationToken,
	) {
		const { defaultItemLimit, pageItemLimit } = configuration.get('graph');

		let limit = pageItemLimit ?? defaultItemLimit;
		let targetId = id;

		// Determine the last search result (for auto-loading more search results)
		const lastSearchResultId = search?.results.size ? last(search.results.keys()) : undefined;

		if (!id && search?.results.size) {
			// If there are a small number of results and we're filtering, load them all at once
			if (search.results.size < 50 && search.query.filter) {
				targetId = lastSearchResultId;
				limit = 0;
			} else {
				// Determine the next unloaded search result (if any)
				const nextUnloadedResultId = search?.results.size
					? find(search.results.keys(), sha => !graph.ids.has(sha))
					: undefined;
				targetId = nextUnloadedResultId;
			}
		}

		const updatedGraph = await graph.more?.(limit, targetId, cancellation);
		if (updatedGraph != null) {
			this.setGraph(updatedGraph);

			if (!search?.hasMore || lastSearchResultId == null) return;

			if (updatedGraph.ids.has(lastSearchResultId)) {
				// Auto-load more search results in the background
				// Suppress notifications - notifyDidChangeRows will send both
				// the search results AND the rows together to avoid race conditions
				try {
					await this.searchGraphOrContinue({ search: search.query, more: true }, false);
					// Search results are now updated in this._search
					// notifyDidChangeRows() will send them along with the rows
				} catch (ex) {
					if (ex instanceof CancellationError) return;

					// Only send error notifications immediately
					void this.host.notify(DidSearchNotification, {
						search: search.query,
						results: {
							error: ex instanceof GitSearchError ? 'Invalid search pattern' : 'Unexpected error',
						},
						partial: false,
						searchId: this._searchIdCounter.current,
					});
				}
			}
		} else {
			debugger;
		}
	}

	@command('gitlens.fetch:')
	@debug()
	private fetch(item?: GraphItemContext) {
		const ref = item != null ? this.getGraphItemRef(item, 'branch') : undefined;
		void RepoActions.fetch(this.repository, ref);
	}

	@command('gitlens.graph.pushWithForce')
	@debug()
	private forcePush(item?: GraphItemContext) {
		this.push(item, true);
	}

	@command('gitlens.graph.pull')
	@debug()
	private pull(item?: GraphItemContext) {
		const ref = item != null ? this.getGraphItemRef(item, 'branch') : undefined;
		void RepoActions.pull(this.repository, ref);
	}

	@command('gitlens.graph.push')
	@debug()
	private push(item?: GraphItemContext, force?: boolean) {
		const ref = item != null ? this.getGraphItemRef(item) : undefined;
		void RepoActions.push(this.repository, force, ref);
	}

	@command('gitlens.createBranch:')
	@debug()
	private createBranch(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return BranchActions.create(ref.repoPath, ref);
	}

	@command('gitlens.graph.deleteBranch')
	@debug()
	private deleteBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return BranchActions.remove(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@command('gitlens.star.branch:')
	@debug()
	private async star(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			const branch = await this.container.git.getRepositoryService(ref.repoPath).branches.getBranch(ref.name);
			if (branch != null) return branch.star();
		}

		return Promise.resolve();
	}

	@command('gitlens.unstar.branch:')
	@debug()
	private async unstar(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			const branch = await this.container.git.getRepositoryService(ref.repoPath).branches.getBranch(ref.name);
			if (branch != null) return branch.unstar();
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.mergeBranchInto')
	@debug()
	private mergeBranchInto(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return RepoActions.merge(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.openBranchOnRemote')
	@debug()
	private openBranchOnRemote(item?: GraphItemContext, clipboard?: boolean) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			let remote;
			if (ref.remote) {
				remote = getRemoteNameFromBranchName(ref.name);
			} else if (ref.upstream != null) {
				remote = getRemoteNameFromBranchName(ref.upstream.name);
			}

			return executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
				repoPath: ref.repoPath,
				resource: {
					type: RemoteResourceType.Branch,
					branch: ref.name,
				},
				remote: remote,
				clipboard: clipboard,
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.copyRemoteBranchUrl')
	private copyRemoteBranchUrl(item?: GraphItemContext) {
		return this.openBranchOnRemote(item, true);
	}

	@command('gitlens.publishBranch:graph')
	@debug()
	private publishBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return RepoActions.push(ref.repoPath, undefined, ref);
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.rebaseOntoBranch')
	@command('gitlens.graph.rebaseOntoCommit')
	@debug()
	private rebase(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return RepoActions.rebase(ref.repoPath, ref);
	}

	@command('gitlens.graph.rebaseOntoUpstream')
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

	@command('gitlens.graph.renameBranch')
	@debug()
	private renameBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return BranchActions.rename(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@command('gitlens.associateIssueWithBranch:graph')
	@debug()
	private associateIssueWithBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<AssociateIssueWithBranchCommandArgs>('gitlens.associateIssueWithBranch', {
				command: 'associateIssueWithBranch',
				branch: ref,
				source: 'graph',
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.cherryPick')
	@command('gitlens.graph.cherryPick.multi')
	@debug()
	private cherryPick(item?: GraphItemContext) {
		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection == null) return Promise.resolve();

		return RepoActions.cherryPick(selection[0].repoPath, selection);
	}

	@command('gitlens.graph.copy')
	@debug()
	private async copy(item?: GraphItemContext) {
		let data;

		const { selection } = this.getGraphItemRefs(item);
		if (selection.length) {
			data = selection
				.map(r => (r.refType === 'revision' && r.message ? `${r.name}: ${r.message.trim()}` : r.name))
				.join('\n');
		} else if (isGraphItemTypedContext(item, 'contributor')) {
			const { name, email } = item.webviewItemValue;
			data = `${name}${email ? ` <${email}>` : ''}`;
		} else if (isGraphItemTypedContext(item, 'pullrequest')) {
			const { url } = item.webviewItemValue;
			data = url;
		}

		if (data != null) {
			await env.clipboard.writeText(data);
		}
	}

	@command('gitlens.graph.copyMessage')
	@debug()
	private copyMessage(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return executeCommand<CopyMessageToClipboardCommandArgs>('gitlens.copyMessageToClipboard', {
			repoPath: ref.repoPath,
			sha: ref.ref,
			message: 'message' in ref ? ref.message : undefined,
		});
	}

	@command('gitlens.graph.copySha')
	@debug()
	private async copySha(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		let sha = ref.ref;
		if (!isSha(sha)) {
			sha = (await this.container.git.getRepositoryService(ref.repoPath).revision.resolveRevision(sha)).sha;
		}

		return executeCommand<CopyShaToClipboardCommandArgs, void>('gitlens.copyShaToClipboard', {
			sha: sha,
		});
	}

	@command('gitlens.graph.showInDetailsView')
	@debug()
	private openInDetailsView(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		if (this.host.is('view')) {
			return void showCommitInGraphDetailsView(ref, { preserveFocus: true, preserveVisibility: false });
		}

		return executeCommand<InspectCommandArgs>('gitlens.showInDetailsView', { ref: ref });
	}

	@command('gitlens.graph.commitViaSCM')
	@debug()
	private async commitViaSCM(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');

		await executeCoreCommand('workbench.view.scm');
		if (ref != null) {
			const scmRepo = await this.container.git.getRepositoryService(ref.repoPath).getScmRepository();
			if (scmRepo == null) return;

			// Update the input box to trigger the focus event
			// eslint-disable-next-line no-self-assign
			scmRepo.inputBox.value = scmRepo.inputBox.value;
		}
	}

	@command('gitlens.graph.openCommitOnRemote')
	@command('gitlens.graph.openCommitOnRemote.multi')
	@debug()
	private openCommitOnRemote(item?: GraphItemContext, clipboard?: boolean) {
		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection == null) return Promise.resolve();

		return executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
			repoPath: selection[0].repoPath,
			resource: selection.map(r => ({ type: RemoteResourceType.Commit, sha: r.ref })),
			clipboard: clipboard,
		});
	}

	@command('gitlens.graph.copyRemoteCommitUrl')
	@command('gitlens.graph.copyRemoteCommitUrl.multi')
	private copyRemoteCommitUrl(item?: GraphItemContext) {
		return this.openCommitOnRemote(item, true);
	}

	@command('gitlens.graph.compareSelectedCommits.multi')
	@debug()
	private async compareSelectedCommits(item?: GraphItemContext) {
		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection?.length !== 2) return Promise.resolve();

		const [commit1, commit2] = selection;
		const [ref1, ref2] = await getOrderedComparisonRefs(this.container, commit1.repoPath, commit1.ref, commit2.ref);

		return this.container.views.searchAndCompare.compare(commit1.repoPath, ref1, ref2);
	}

	@command('gitlens.pausedOperation.abort:')
	@debug()
	private async abortPausedOperation(_item?: GraphItemContext) {
		if (this.repository == null) return;

		await abortPausedOperation(this.repository.git);
	}

	@command('gitlens.pausedOperation.continue:')
	@debug()
	private async continuePausedOperation(_item?: GraphItemContext) {
		if (this.repository == null) return;

		const status = await this.repository.git.pausedOps?.getPausedOperationStatus?.();
		if (status == null || status.type === 'revert') return;

		await continuePausedOperation(this.repository.git);
	}

	@command('gitlens.pausedOperation.open:')
	@debug()
	private async openRebaseEditor(_item?: GraphItemContext) {
		if (this.repository == null) return;

		const status = await this.repository.git.pausedOps?.getPausedOperationStatus?.();
		if (status?.type !== 'rebase') return;

		const gitDir = await this.repository.git.config.getGitDir?.();
		if (gitDir == null) return;

		const rebaseTodoUri = Uri.joinPath(gitDir.uri, 'rebase-merge', 'git-rebase-todo');
		void executeCoreCommand('vscode.openWith', rebaseTodoUri, 'gitlens.rebase', {
			preview: false,
		});
	}

	@command('gitlens.pausedOperation.skip:')
	@debug()
	private async skipPausedOperation(_item?: GraphItemContext) {
		if (this.repository == null) return;

		await skipPausedOperation(this.repository.git);
	}

	@command('gitlens.pausedOperation.showConflicts:')
	@debug()
	private async showConflicts(pausedOpArgs: GitPausedOperationStatus) {
		await showPausedOperationStatus(this.container, pausedOpArgs.repoPath, { openRebaseEditor: true });
	}

	@command('gitlens.graph.copyDeepLinkToBranch')
	@debug()
	private copyDeepLinkToBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToBranch', { refOrRepoPath: ref });
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.copyDeepLinkToCommit')
	@debug()
	private copyDeepLinkToCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToCommit', { refOrRepoPath: ref });
	}

	@command('gitlens.graph.copyDeepLinkToRepo')
	@debug()
	private copyDeepLinkToRepo(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (!ref.remote) return Promise.resolve();

			return executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToRepo', {
				refOrRepoPath: ref.repoPath,
				remote: getRemoteNameFromBranchName(ref.name),
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.copyDeepLinkToTag')
	@debug()
	private copyDeepLinkToTag(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'tag')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToTag', { refOrRepoPath: ref });
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.shareAsCloudPatch')
	@command('gitlens.graph.createPatch')
	@command('gitlens.createCloudPatch:')
	@debug()
	private async shareAsCloudPatch(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision') ?? this.getGraphItemRef(item, 'stash');

		if (ref == null) return Promise.resolve();

		const { summary: title, body: description } = splitCommitMessage(ref.message);
		return executeCommand<CreatePatchCommandArgs, void>('gitlens.createCloudPatch', {
			to: ref.ref,
			repoPath: ref.repoPath,
			title: title,
			description: description,
		});
	}

	@command('gitlens.copyPatchToClipboard:')
	@debug()
	private async copyPatchToClipboard(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision') ?? this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		const { summary: title, body: description } = splitCommitMessage(ref.message);
		return executeCommand<CreatePatchCommandArgs, void>('gitlens.copyPatchToClipboard', {
			from: `${ref.ref}^`,
			to: ref.ref,
			repoPath: ref.repoPath,
			title: title,
			description: description,
		});
	}

	@command('gitlens.graph.resetCommit')
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

	@command('gitlens.graph.resetToCommit')
	@debug()
	private resetToCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return RepoActions.reset(ref.repoPath, ref);
	}

	@command('gitlens.graph.resetToTip')
	@debug()
	private resetToTip(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'branch');
		if (ref == null) return Promise.resolve();

		return RepoActions.reset(
			ref.repoPath,
			createReference(ref.ref, ref.repoPath, { refType: 'revision', name: ref.name }),
		);
	}

	@command('gitlens.graph.revert')
	@debug()
	private revertCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return RepoActions.revert(ref.repoPath, ref);
	}

	@command('gitlens.switchToBranch:')
	@command('gitlens.graph.switchToCommit')
	@command('gitlens.graph.switchToTag')
	@debug()
	private switchTo(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return RepoActions.switchTo(ref.repoPath, ref);
	}

	@command('gitlens.graph.resetToTag')
	@debug()
	private resetToTag(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'tag');
		if (ref == null) return Promise.resolve();
		return RepoActions.reset(ref.repoPath, ref);
	}

	@command('gitlens.graph.hideLocalBranch')
	@command('gitlens.graph.hideRemoteBranch')
	@command('gitlens.graph.hideTag')
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
				this._graph?.repoPath,
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

	@command('gitlens.graph.hideRemote')
	private hideRemote(item?: GraphItemContext) {
		return this.hideRef(item, { remote: true });
	}

	@command('gitlens.graph.hideRefGroup')
	private hideRefGroup(item?: GraphItemContext) {
		return this.hideRef(item, { group: true });
	}

	@command('gitlens.graph.soloBranch')
	@command('gitlens.graph.soloTag')
	@debug()
	private soloReference(item?: GraphItemContext) {
		if (!isGraphItemRefContext(item)) return;

		const { ref } = item.webviewItemValue;
		if (ref.id == null) return;

		const repo = this.container.git.getRepository(ref.repoPath);
		if (repo == null) return Promise.resolve();

		// Show the graph with a ref: search query to filter the graph to this branch
		return void executeCommand<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', {
			repository: repo,
			search: {
				query: `ref:${ref.name}`,
				filter: true,
				matchAll: false,
				matchCase: false,
				matchRegex: false,
			},
			source: { source: 'graph' },
		});
	}

	@command('gitlens.switchToAnotherBranch:graph')
	@debug()
	private switchToAnother(item?: GraphItemContext | unknown) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return RepoActions.switchTo(this.repository?.path);

		return RepoActions.switchTo(ref.repoPath);
	}

	@command('gitlens.graph.undoCommit')
	@debug()
	private async undoCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		await undoCommit(this.container, ref);
	}

	@command('gitlens.stashSave:')
	@debug()
	private saveStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return StashActions.push(ref.repoPath);
	}

	@command('gitlens.stashApply:')
	@debug()
	private applyStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return StashActions.apply(ref.repoPath, ref);
	}

	@command('gitlens.stashDelete:')
	@debug()
	private deleteStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return StashActions.drop(ref.repoPath, [ref]);
	}

	@command('gitlens.stashRename:')
	@debug()
	private renameStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return StashActions.rename(ref.repoPath, ref);
	}

	@command('gitlens.graph.createTag')
	@debug()
	private async createTag(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return TagActions.create(ref.repoPath, ref);
	}

	@command('gitlens.graph.deleteTag')
	@debug()
	private deleteTag(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'tag')) {
			const { ref } = item.webviewItemValue;
			return TagActions.remove(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.createWorktree')
	@debug()
	private async createWorktree(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return WorktreeActions.create(ref.repoPath, undefined, ref);
	}

	@command('gitlens.createPullRequest:')
	@debug()
	private async createPullRequest(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;

			const repo = this.container.git.getRepository(ref.repoPath);
			const branch = await repo?.git.branches.getBranch(ref.name);
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

	@command('gitlens.openPullRequest:')
	@debug()
	private openPullRequest(item?: GraphItemContext) {
		if (isGraphItemTypedContext(item, 'pullrequest')) {
			const pr = item.webviewItemValue;
			return executeActionCommand<OpenPullRequestActionContext>('openPullRequest', {
				repoPath: pr.repoPath,
				provider: {
					id: pr.provider.id,
					name: pr.provider.name,
					domain: pr.provider.domain,
				},
				pullRequest: {
					id: pr.id,
					url: pr.url,
				},
				source: { source: 'graph' },
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.openPullRequestChanges:')
	@debug()
	private openPullRequestChanges(item?: GraphItemContext) {
		if (isGraphItemTypedContext(item, 'pullrequest')) {
			const pr = item.webviewItemValue;
			if (pr.refs?.base != null && pr.refs.head != null) {
				const refs = getComparisonRefsForPullRequest(pr.repoPath, pr.refs);
				return openComparisonChanges(
					this.container,
					{
						repoPath: refs.repoPath,
						lhs: refs.base.ref,
						rhs: refs.head.ref,
					},
					{ title: `Changes in Pull Request #${pr.id}` },
				);
			}
		}

		return Promise.resolve();
	}

	@command('gitlens.openPullRequestComparison:')
	@debug()
	private openPullRequestComparison(item?: GraphItemContext) {
		if (isGraphItemTypedContext(item, 'pullrequest')) {
			const pr = item.webviewItemValue;
			if (pr.refs?.base != null && pr.refs.head != null) {
				const refs = getComparisonRefsForPullRequest(pr.repoPath, pr.refs);
				return this.container.views.searchAndCompare.compare(refs.repoPath, refs.head, refs.base);
			}
		}

		return Promise.resolve();
	}

	@command('gitlens.openPullRequestOnRemote:')
	@debug()
	private openPullRequestOnRemote(item?: GraphItemContext, clipboard?: boolean) {
		if (isGraphItemTypedContext(item, 'pullrequest')) {
			const { url } = item.webviewItemValue;
			return executeCommand<OpenPullRequestOnRemoteCommandArgs>('gitlens.openPullRequestOnRemote', {
				pr: { url: url },
				clipboard: clipboard,
			});
		}

		return Promise.resolve();
	}

	@debug()
	private openIssueOnRemote(item?: GraphItemContext) {
		if (isGraphItemTypedContext(item, 'issue')) {
			const { url } = item.webviewItemValue;
			void executeCommand<OpenIssueOnRemoteCommandArgs>('gitlens.openIssueOnRemote', {
				issue: { url: url },
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.graph.compareAncestryWithWorking')
	@debug()
	private async compareAncestryWithWorking(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		const branch = await this.container.git.getRepositoryService(ref.repoPath).branches.getBranch();
		if (branch == null) return undefined;

		const commonAncestor = await this.container.git
			.getRepositoryService(ref.repoPath)
			.refs.getMergeBase(branch.ref, ref.ref);
		if (commonAncestor == null) return undefined;

		return this.container.views.searchAndCompare.compare(ref.repoPath, '', {
			ref: commonAncestor,
			label: `${branch.ref} (${shortenRevision(commonAncestor)})`,
		});
	}

	@command('gitlens.graph.compareWithHead')
	@debug()
	private async compareHeadWith(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		const [ref1, ref2] = await getOrderedComparisonRefs(this.container, ref.repoPath, 'HEAD', ref.ref);
		return this.container.views.searchAndCompare.compare(ref.repoPath, ref1, ref2);
	}

	@command('gitlens.graph.compareBranchWithHead')
	@debug()
	private compareBranchWithHead(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return this.container.views.searchAndCompare.compare(ref.repoPath, ref.ref, 'HEAD');
	}

	@command('gitlens.graph.compareWithMergeBase')
	@debug()
	private async compareWithMergeBase(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		const branch = await this.container.git.getRepositoryService(ref.repoPath).branches.getBranch();
		if (branch == null) return undefined;

		const commonAncestor = await this.container.git
			.getRepositoryService(ref.repoPath)
			.refs.getMergeBase(branch.ref, ref.ref);
		if (commonAncestor == null) return undefined;

		return this.container.views.searchAndCompare.compare(ref.repoPath, ref.ref, {
			ref: commonAncestor,
			label: `${branch.ref} (${shortenRevision(commonAncestor)})`,
		});
	}

	@command('gitlens.graph.openChangedFileDiffsWithMergeBase')
	@debug()
	private async openChangedFileDiffsWithMergeBase(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		const branch = await this.container.git.getRepositoryService(ref.repoPath).branches.getBranch();
		if (branch == null) return undefined;

		const commonAncestor = await this.container.git
			.getRepositoryService(ref.repoPath)
			.refs.getMergeBase(branch.ref, ref.ref);
		if (commonAncestor == null) return undefined;

		return openComparisonChanges(
			this.container,
			{ repoPath: ref.repoPath, lhs: commonAncestor, rhs: ref.ref },
			{
				title: `Changes between ${branch.ref} (${shortenRevision(commonAncestor)}) ${
					GlyphChars.ArrowLeftRightLong
				} ${shortenRevision(ref.ref, { strings: { working: 'Working Tree' } })}`,
			},
		);
	}

	@command('gitlens.graph.compareWithUpstream')
	@debug()
	private compareWithUpstream(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (ref.upstream != null) {
				return this.container.views.searchAndCompare.compare(ref.repoPath, ref.ref, ref.upstream.name);
			}
		}

		return Promise.resolve();
	}

	@command('gitlens.changeUpstream:')
	@command('gitlens.setUpstream:')
	@debug()
	private changeUpstreamBranch(item?: GraphItemContext) {
		if (!isGraphItemRefContext(item, 'branch')) return Promise.resolve();
		const { ref } = item.webviewItemValue;
		return BranchActions.changeUpstream(ref.repoPath, ref);
	}

	@command('gitlens.graph.compareWithWorking')
	@debug()
	private compareWorkingWith(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return this.container.views.searchAndCompare.compare(ref.repoPath, '', ref.ref);
	}

	@command('gitlens.views.selectForCompare:')
	@debug()
	private selectForCompare(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return;

		void setContext('gitlens:views:canCompare', { label: ref.name, ref: ref.ref, repoPath: ref.repoPath });
	}

	@command('gitlens.views.compareWithSelected:')
	@debug()
	private compareWithSelected(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return;

		const selectedRef = getContext('gitlens:views:canCompare');
		if (selectedRef == null) return;

		void setContext('gitlens:views:canCompare', undefined);

		if (selectedRef.repoPath !== ref.repoPath) {
			this.selectForCompare(item);
			return;
		}

		void this.container.views.searchAndCompare.compare(ref.repoPath, selectedRef, {
			label: ref.name,
			ref: ref.ref,
		});
	}

	@command('gitlens.copyWorkingChangesToWorktree:')
	@debug()
	private copyWorkingChangesToWorktree(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return WorktreeActions.copyChangesToWorktree('working-tree', ref.repoPath);
	}

	@command('gitlens.ai.generateCommitMessage:')
	@debug()
	private generateCommitMessage(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return executeCommand<GenerateCommitMessageCommandArgs>('gitlens.ai.generateCommitMessage', {
			repoPath: ref.repoPath,
			source: 'graph',
		});
	}

	@command('gitlens.ai.explainUnpushed:')
	@debug()
	private aiExplainUnpushed(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;

			if (!ref.upstream) {
				return Promise.resolve();
			}

			return executeCommand<ExplainBranchCommandArgs>('gitlens.ai.explainBranch', {
				repoPath: ref.repoPath,
				ref: ref.ref,
				baseBranch: ref.upstream.name,
				source: { source: 'graph', context: { type: 'branch' } },
			});
		}

		return Promise.resolve();
	}

	@command('gitlens.ai.explainBranch:')
	@debug()
	private explainBranch(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'branch');
		if (ref == null) return Promise.resolve();

		return executeCommand<ExplainBranchCommandArgs>('gitlens.ai.explainBranch', {
			repoPath: ref.repoPath,
			ref: ref.ref,
			source: { source: 'graph', context: { type: 'branch' } },
		});
	}

	@debug()
	private async recomposeBranch(item?: GraphItemContext): Promise<void> {
		const ref = this.getGraphItemRef(item, 'branch');
		if (ref != null) {
			await executeCommand<RecomposeBranchCommandArgs>('gitlens.recomposeBranch', {
				repoPath: ref.repoPath,
				branchName: ref.name,
				source: 'graph',
			});
			return;
		}

		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection == null || selection.length < 2) return;

		const repoPath = selection[0].repoPath;
		const commitShas = selection.map(ref => ref.sha);

		const graph = this._graph;
		if (graph == null) return;

		// We need to make sure commit shas are sorted in the order of the commits they are based on
		commitShas.sort((a, b) => {
			const rowA = graph.rows.find(r => r.sha === a);
			const rowB = graph.rows.find(r => r.sha === b);
			return (rowA?.date ?? 0) - (rowB?.date ?? 0);
		});

		const branchCounts = new Map<string, number>();

		for (const sha of commitShas) {
			const row = graph.rows.find(r => r.sha === sha);
			if (row?.reachableFromBranches) {
				for (const branchName of row.reachableFromBranches) {
					branchCounts.set(branchName, (branchCounts.get(branchName) ?? 0) + 1);
				}
			}
		}

		const branchesReachingAll: string[] = [];
		for (const [branchName, count] of branchCounts) {
			if (count === commitShas.length) {
				branchesReachingAll.push(branchName);
			}
		}

		if (branchesReachingAll.length !== 1) {
			void window.showErrorMessage(
				branchesReachingAll.length === 0
					? 'The selected commits are not reachable from any single branch.'
					: 'The selected commits are reachable from multiple branches. Please select commits unique to a single branch.',
			);
			return;
		}

		const branchName = branchesReachingAll[0];

		await executeCommand<RecomposeBranchCommandArgs>('gitlens.recomposeSelectedCommits', {
			repoPath: repoPath,
			branchName: branchName,
			commitShas: commitShas,
			source: 'graph',
		});
	}

	@debug()
	private async recomposeFromCommit(item?: GraphItemContext): Promise<void> {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return;

		const graph = this._graph;
		if (graph == null) return;

		const row = graph.rows.find(r => r.sha === ref.ref);
		if (row?.reachableFromBranches?.length !== 1) {
			void window.showErrorMessage('Unable to recompose: commit must belong to exactly one local branch');
			return;
		}

		const branchName = row.reachableFromBranches[0];
		const branch = graph.branches.get(branchName);
		if (branch == null) {
			void window.showErrorMessage(`Branch '${branchName}' not found`);
			return;
		}

		const headCommitSha = branch.sha;
		if (headCommitSha == null) {
			void window.showErrorMessage(`Unable to determine head commit for branch '${branchName}'`);
			return;
		}

		const commit = await this.container.git.getRepositoryService(ref.repoPath).commits.getCommit(ref.ref);
		if (commit == null) {
			void window.showErrorMessage(`Commit '${ref.ref}' not found`);
			return;
		}

		const baseCommitSha = commit.parents.length > 0 ? commit.parents[0] : undefined;
		if (baseCommitSha == null) {
			void window.showErrorMessage('Unable to determine parent commit');
			return;
		}

		await executeCommand<RecomposeFromCommitCommandArgs>('gitlens.recomposeFromCommit', {
			repoPath: ref.repoPath,
			commitSha: ref.ref,
			branchName: branchName,
			source: 'graph',
		});
	}

	// Recompose wrappers
	@command('gitlens.recomposeBranch:')
	private recomposeBranchCommand(item?: GraphItemContext) {
		return this.recomposeBranch(item);
	}
	@command('gitlens.composeCommits:')
	private composeCommitsCommand(item?: GraphItemContext) {
		return this.composeCommits(item);
	}
	@command('gitlens.recomposeSelectedCommits:')
	private recomposeSelectedCommitsCommand(item?: GraphItemContext) {
		return this.recomposeBranch(item);
	}
	@command('gitlens.recomposeFromCommit:')
	private recomposeFromCommitCommand(item?: GraphItemContext) {
		return this.recomposeFromCommit(item);
	}

	@command('gitlens.ai.explainCommit:')
	@debug()
	private explainCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return executeCommand<ExplainCommitCommandArgs>('gitlens.ai.explainCommit', {
			repoPath: ref.repoPath,
			rev: ref.ref,
			source: { source: 'graph', context: { type: 'commit' } },
		});
	}

	@command('gitlens.ai.explainStash:')
	@debug()
	private explainStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return executeCommand<ExplainStashCommandArgs>('gitlens.ai.explainStash', {
			repoPath: ref.repoPath,
			rev: ref.ref,
			source: { source: 'graph', context: { type: 'stash' } },
		});
	}

	@command('gitlens.ai.explainWip:')
	@debug()
	private explainWip(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return executeCommand<ExplainWipCommandArgs>('gitlens.ai.explainWip', {
			repoPath: ref.repoPath,
			source: { source: 'graph', context: { type: 'wip' } },
		});
	}

	@command('gitlens.graph.openChangedFiles')
	@debug()
	private async openFiles(item?: GraphItemContext) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openFiles(commit);
	}

	@debug()
	private async openAllChanges(item?: GraphItemContext, individually?: boolean) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openCommitChanges(this.container, commit, individually);
	}

	@command('gitlens.graph.openChangedFileDiffs')
	private openChangedFileDiffs(item?: GraphItemContext) {
		return this.openAllChanges(item);
	}
	@command('gitlens.graph.openChangedFileDiffsIndividually')
	private openChangedFileDiffsIndividually(item?: GraphItemContext) {
		return this.openAllChanges(item, true);
	}

	@debug()
	private async openAllChangesWithWorking(item?: GraphItemContext, individually?: boolean) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openCommitChangesWithWorking(this.container, commit, individually);
	}

	@command('gitlens.graph.openChangedFileDiffsWithWorking')
	private openChangedFileDiffsWithWorking(item?: GraphItemContext) {
		return this.openAllChangesWithWorking(item);
	}
	@command('gitlens.graph.openChangedFileDiffsWithWorkingIndividually')
	private openChangedFileDiffsWithWorkingIndividually(item?: GraphItemContext) {
		return this.openAllChangesWithWorking(item, true);
	}

	@command('gitlens.graph.openChangedFileRevisions')
	@debug()
	private async openRevisions(item?: GraphItemContext) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openFilesAtRevision(commit);
	}

	@command('gitlens.graph.openOnlyChangedFiles')
	@debug()
	private async openOnlyChangedFiles(item?: GraphItemContext) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openOnlyChangedFiles(this.container, commit);
	}

	@command('gitlens.graph.openInWorktree')
	@debug()
	private async openInWorktree(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			const repo = this.container.git.getRepository(ref.repoPath);
			const branch = await repo?.git.branches.getBranch(ref.name);
			const pr = await branch?.getAssociatedPullRequest();
			if (branch != null && repo != null && pr != null) {
				const remoteUrl = (await branch.getRemote())?.url ?? getRepositoryIdentityForPullRequest(pr).remote.url;
				if (remoteUrl != null) {
					const deepLink = getPullRequestBranchDeepLink(
						this.container,
						pr,
						branch.getNameWithoutRemote(),
						remoteUrl,
						DeepLinkActionType.SwitchToPullRequestWorktree,
					);

					return this.container.deepLinks.processDeepLinkUri(deepLink, false, repo);
				}
			}

			await executeGitCommand({
				command: 'switch',
				state: {
					repos: ref.repoPath,
					reference: ref,
					worktreeDefaultOpen: 'new',
				},
			});
		}
	}

	@command('gitlens.openWorktree:')
	@debug()
	private async openWorktree(item?: GraphItemContext, options?: { location?: OpenWorkspaceLocation }) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (ref.id == null) return;

			let worktreesByBranch;
			if (ref.repoPath === this._graph?.repoPath) {
				worktreesByBranch = this._graph?.worktreesByBranch;
			} else {
				const repo = this.container.git.getRepository(ref.repoPath);
				if (repo == null) return;

				worktreesByBranch = await getWorktreesByBranch(repo);
			}

			const worktree = worktreesByBranch?.get(ref.id);
			if (worktree == null) return;

			openWorkspace(worktree.uri, options);
		}
	}

	@command('gitlens.openWorktreeInNewWindow:')
	private openWorktreeInNewWindow(item?: GraphItemContext) {
		return this.openWorktree(item, { location: 'newWindow' });
	}

	@command('gitlens.graph.addAuthor')
	@debug()
	private addAuthor(item?: GraphItemContext) {
		if (isGraphItemTypedContext(item, 'contributor')) {
			const { repoPath, name, email, current } = item.webviewItemValue;
			return ContributorActions.addAuthors(
				repoPath,
				new GitContributor(repoPath, name, email, current ?? false, 0),
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

	// Column toggle wrappers
	@command('gitlens.graph.columnAuthorOn')
	private columnAuthorOn() {
		return this.toggleColumn('author', true);
	}
	@command('gitlens.graph.columnAuthorOff')
	private columnAuthorOff() {
		return this.toggleColumn('author', false);
	}
	@command('gitlens.graph.columnDateTimeOn')
	private columnDateTimeOn() {
		return this.toggleColumn('datetime', true);
	}
	@command('gitlens.graph.columnDateTimeOff')
	private columnDateTimeOff() {
		return this.toggleColumn('datetime', false);
	}
	@command('gitlens.graph.columnShaOn')
	private columnShaOn() {
		return this.toggleColumn('sha', true);
	}
	@command('gitlens.graph.columnShaOff')
	private columnShaOff() {
		return this.toggleColumn('sha', false);
	}
	@command('gitlens.graph.columnChangesOn')
	private columnChangesOn() {
		return this.toggleColumn('changes', true);
	}
	@command('gitlens.graph.columnChangesOff')
	private columnChangesOff() {
		return this.toggleColumn('changes', false);
	}
	@command('gitlens.graph.columnGraphOn')
	private columnGraphOn() {
		return this.toggleColumn('graph', true);
	}
	@command('gitlens.graph.columnGraphOff')
	private columnGraphOff() {
		return this.toggleColumn('graph', false);
	}
	@command('gitlens.graph.columnMessageOn')
	private columnMessageOn() {
		return this.toggleColumn('message', true);
	}
	@command('gitlens.graph.columnMessageOff')
	private columnMessageOff() {
		return this.toggleColumn('message', false);
	}
	@command('gitlens.graph.columnRefOn')
	private columnRefOn() {
		return this.toggleColumn('ref', true);
	}
	@command('gitlens.graph.columnRefOff')
	private columnRefOff() {
		return this.toggleColumn('ref', false);
	}

	@debug()
	private async toggleScrollMarker(type: GraphScrollMarkersAdditionalTypes, enabled: boolean) {
		let scrollMarkers = configuration.get('graph.scrollMarkers.additionalTypes');
		let updated = false;
		if (enabled && !scrollMarkers.includes(type)) {
			scrollMarkers = [...scrollMarkers, type];
			updated = true;
		} else if (!enabled && scrollMarkers.includes(type)) {
			scrollMarkers = scrollMarkers.filter(marker => marker !== type);
			updated = true;
		}

		if (updated) {
			await configuration.updateEffective('graph.scrollMarkers.additionalTypes', scrollMarkers);
			void this.notifyDidChangeScrollMarkers();
		}
	}

	// Scroll marker toggle wrappers
	@command('gitlens.graph.scrollMarkerLocalBranchOn')
	private scrollMarkerLocalBranchOn() {
		return this.toggleScrollMarker('localBranches', true);
	}
	@command('gitlens.graph.scrollMarkerLocalBranchOff')
	private scrollMarkerLocalBranchOff() {
		return this.toggleScrollMarker('localBranches', false);
	}
	@command('gitlens.graph.scrollMarkerRemoteBranchOn')
	private scrollMarkerRemoteBranchOn() {
		return this.toggleScrollMarker('remoteBranches', true);
	}
	@command('gitlens.graph.scrollMarkerRemoteBranchOff')
	private scrollMarkerRemoteBranchOff() {
		return this.toggleScrollMarker('remoteBranches', false);
	}
	@command('gitlens.graph.scrollMarkerStashOn')
	private scrollMarkerStashOn() {
		return this.toggleScrollMarker('stashes', true);
	}
	@command('gitlens.graph.scrollMarkerStashOff')
	private scrollMarkerStashOff() {
		return this.toggleScrollMarker('stashes', false);
	}
	@command('gitlens.graph.scrollMarkerTagOn')
	private scrollMarkerTagOn() {
		return this.toggleScrollMarker('tags', true);
	}
	@command('gitlens.graph.scrollMarkerTagOff')
	private scrollMarkerTagOff() {
		return this.toggleScrollMarker('tags', false);
	}
	@command('gitlens.graph.scrollMarkerPullRequestOn')
	private scrollMarkerPullRequestOn() {
		return this.toggleScrollMarker('pullRequests', true);
	}
	@command('gitlens.graph.scrollMarkerPullRequestOff')
	private scrollMarkerPullRequestOff() {
		return this.toggleScrollMarker('pullRequests', false);
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

	// Column mode wrappers
	@command('gitlens.graph.columnGraphCompact')
	private columnGraphCompact() {
		return this.setColumnMode('graph', 'compact');
	}
	@command('gitlens.graph.columnGraphDefault')
	private columnGraphDefault() {
		return this.setColumnMode('graph', undefined);
	}

	@command('gitlens.ai.generateChangelogFrom:')
	@debug()
	private async generateChangelogFrom(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch') || isGraphItemRefContext(item, 'tag')) {
			const { ref } = item.webviewItemValue;

			await executeCommand<GenerateChangelogCommandArgs>('gitlens.ai.generateChangelog', {
				repoPath: ref.repoPath,
				head: ref,
				source: { source: 'graph', detail: isGraphItemRefContext(item, 'branch') ? 'branch' : 'tag' },
			});
		}

		return Promise.resolve();
	}

	@debug()
	private async composeCommits(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'revision')) {
			const { ref } = item.webviewItemValue;

			await executeCommand<ComposerCommandArgs>('gitlens.composeCommits', {
				repoPath: ref.repoPath,
				source: 'graph',
			});
		}
		return Promise.resolve();
	}

	@command('gitlens.visualizeHistory.repo:')
	@debug()
	private visualizeHistoryRepo() {
		void executeCommand<TimelineCommandArgs | undefined>(
			'gitlens.visualizeHistory',
			this.repository != null ? { type: 'repo', uri: this.repository.uri } : undefined,
		);
	}

	private getCommitFromGraphItemRef(item?: GraphItemContext): Promise<GitCommit | undefined> {
		let ref: GitRevisionReference | GitStashReference | undefined = this.getGraphItemRef(item, 'revision');
		if (ref != null) return this.container.git.getRepositoryService(ref.repoPath).commits.getCommit(ref.ref);

		ref = this.getGraphItemRef(item, 'stash');
		if (ref != null) return this.container.git.getRepositoryService(ref.repoPath).commits.getCommit(ref.ref);

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

	private getGraphItemRefs(
		item: GraphItemContext | unknown | undefined,
		refType: 'branch',
	): GraphItemRefs<GitBranchReference>;
	private getGraphItemRefs(
		item: GraphItemContext | unknown | undefined,
		refType: 'revision',
	): GraphItemRefs<GitRevisionReference>;
	private getGraphItemRefs(
		item: GraphItemContext | unknown | undefined,
		refType: 'stash',
	): GraphItemRefs<GitStashReference>;
	private getGraphItemRefs(
		item: GraphItemContext | unknown | undefined,
		refType: 'tag',
	): GraphItemRefs<GitTagReference>;
	private getGraphItemRefs(item: GraphItemContext | unknown | undefined): GraphItemRefs<GitReference>;
	private getGraphItemRefs(
		item: GraphItemContext | unknown,
		refType?: 'branch' | 'revision' | 'stash' | 'tag',
	): GraphItemRefs<GitReference> {
		if (item == null) return { active: undefined, selection: [] };

		switch (refType) {
			case 'branch':
				if (!isGraphItemRefContext(item, 'branch') && !isGraphItemTypedContext(item, 'upstreamStatus')) {
					return { active: undefined, selection: [] };
				}
				break;
			case 'revision':
				if (!isGraphItemRefContext(item, 'revision')) return { active: undefined, selection: [] };
				break;
			case 'stash':
				if (!isGraphItemRefContext(item, 'stash')) return { active: undefined, selection: [] };
				break;
			case 'tag':
				if (!isGraphItemRefContext(item, 'tag')) return { active: undefined, selection: [] };
				break;
			default:
				if (!isGraphItemRefContext(item)) return { active: undefined, selection: [] };
		}

		const selection = item.webviewItemsValues?.map(i => i.webviewItemValue.ref) ?? [];
		if (!selection.length) {
			selection.push(item.webviewItemValue.ref);
		}
		return { active: item.webviewItemValue.ref, selection: selection };
	}

	private createCancellation(op: CancellableOperations) {
		this.cancelOperation(op);

		const cancellation = new CancellationTokenSource();
		this._cancellations.set(op, cancellation);
		return cancellation;
	}

	private cancelOperation(op: CancellableOperations) {
		this._cancellations.get(op)?.cancel();
		this._cancellations.delete(op);
	}
}

type GraphItemRefs<T> = {
	active: T | undefined;
	selection: T[];
};

function convertBranchToIncludeOnlyRef(branch: GitBranch, remote?: boolean): GraphIncludeOnlyRef {
	return (remote ?? branch.remote)
		? { id: branch.id, type: 'remote', name: branch.getNameWithoutRemote(), owner: branch.getRemoteName() }
		: { id: branch.id, type: 'head', name: branch.name };
}

function convertBranchUpstreamToIncludeOnlyRef(branch: GitBranch): GraphIncludeOnlyRef | undefined {
	if (branch.upstream == null || branch.upstream.missing) return undefined;

	const id = getBranchId(branch.repoPath, true, branch.upstream.name);
	return {
		id: id,
		type: 'remote',
		name: getBranchNameWithoutRemote(branch.upstream.name),
		owner: branch.getRemoteName(),
	};
}

function convertRefToGraphRefType(ref: GitReference): GraphRefType | undefined {
	switch (ref.refType) {
		case 'branch':
			if (ref.remote) return 'remote';
			if (ref.worktree) return 'worktree';
			return 'head';
		case 'tag':
			return 'tag';
		default:
			return undefined;
	}
}

function convertSelectedRows(selectedRows: Record<string, SelectedRowState> | undefined): GraphSelectedRows {
	return filterMapObject(selectedRows, (_, v) => (v.selected ? true : undefined));
}

export function updateSearchMode<T extends GitGraphSearch | undefined>(
	container: Container,
	search: T,
	mode?: GraphSearchMode,
): T {
	if (search?.query != null) {
		mode ??= container.storage.get('graph:searchMode', 'normal');
		search.query.filter = mode === 'filter';
	}
	return search;
}
