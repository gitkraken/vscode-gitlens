import type { CancellationToken, ColorTheme, ConfigurationChangeEvent } from 'vscode';
import { CancellationTokenSource, Disposable, env, Uri, window } from 'vscode';
import type { CreatePullRequestActionContext, OpenPullRequestActionContext } from '../../../api/gitlens';
import { getAvatarUri } from '../../../avatars';
import { parseCommandContext } from '../../../commands/commandContext.utils';
import type { ComposeCommandArgs } from '../../../commands/composer';
import type { CopyDeepLinkCommandArgs } from '../../../commands/copyDeepLink';
import type { CopyMessageToClipboardCommandArgs } from '../../../commands/copyMessageToClipboard';
import type { CopyShaToClipboardCommandArgs } from '../../../commands/copyShaToClipboard';
import type { ExplainBranchCommandArgs } from '../../../commands/explainBranch';
import type { ExplainCommitCommandArgs } from '../../../commands/explainCommit';
import type { ExplainStashCommandArgs } from '../../../commands/explainStash';
import type { ExplainWipCommandArgs } from '../../../commands/explainWip';
import type { GenerateChangelogCommandArgs } from '../../../commands/generateChangelog';
import type { GenerateCommitMessageCommandArgs } from '../../../commands/generateCommitMessage';
import type { GenerateCommitsCommandArgs, GenerateRebaseCommandArgs } from '../../../commands/generateRebase';
import type { InspectCommandArgs } from '../../../commands/inspect';
import type { OpenOnRemoteCommandArgs } from '../../../commands/openOnRemote';
import type { OpenPullRequestOnRemoteCommandArgs } from '../../../commands/openPullRequestOnRemote';
import type { CreatePatchCommandArgs } from '../../../commands/patches';
import type {
	Config,
	GraphBranchesVisibility,
	GraphMinimapMarkersAdditionalTypes,
	GraphScrollMarkersAdditionalTypes,
} from '../../../config';
import { GlyphChars } from '../../../constants';
import type { ContextKeys } from '../../../constants.context';
import type { StoredGraphFilters, StoredGraphRefType } from '../../../constants.storage';
import type { GraphShownTelemetryContext, GraphTelemetryContext, TelemetryEvents } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import { CancellationError, isCancellationError } from '../../../errors';
import type { CommitSelectedEvent } from '../../../eventBus';
import type { FeaturePreview } from '../../../features';
import { getFeaturePreviewStatus } from '../../../features';
import { executeGitCommand } from '../../../git/actions';
import * as BranchActions from '../../../git/actions/branch';
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
} from '../../../git/actions/commit';
import * as ContributorActions from '../../../git/actions/contributor';
import {
	abortPausedOperation,
	continuePausedOperation,
	skipPausedOperation,
} from '../../../git/actions/pausedOperation';
import * as RepoActions from '../../../git/actions/repository';
import * as StashActions from '../../../git/actions/stash';
import * as TagActions from '../../../git/actions/tag';
import * as WorktreeActions from '../../../git/actions/worktree';
import { GitSearchError } from '../../../git/errors';
import { CommitFormatter } from '../../../git/formatters/commitFormatter';
import type { GitBranch } from '../../../git/models/branch';
import type { GitCommit } from '../../../git/models/commit';
import { isStash } from '../../../git/models/commit';
import { GitContributor } from '../../../git/models/contributor';
import type { GitGraph, GitGraphRowType } from '../../../git/models/graph';
import type { IssueShape } from '../../../git/models/issue';
import type { PullRequest } from '../../../git/models/pullRequest';
import type {
	GitBranchReference,
	GitReference,
	GitRevisionReference,
	GitStashReference,
	GitTagReference,
} from '../../../git/models/reference';
import { RemoteResourceType } from '../../../git/models/remoteResource';
import type {
	Repository,
	RepositoryChangeEvent,
	RepositoryFileSystemChangeEvent,
} from '../../../git/models/repository';
import { isRepository, RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository';
import { uncommitted } from '../../../git/models/revision';
import type { GitGraphSearch } from '../../../git/search';
import {
	getSearchQueryComparisonKey,
	parseSearchQuery,
	processNaturalLanguageToSearchQuery,
} from '../../../git/search';
import { getAssociatedIssuesForBranch } from '../../../git/utils/-webview/branch.issue.utils';
import { getBranchMergeTargetInfo, getStarredBranchIds } from '../../../git/utils/-webview/branch.utils';
import { getRemoteIconUri } from '../../../git/utils/-webview/icons';
import { getReferenceFromBranch } from '../../../git/utils/-webview/reference.utils';
import { getWorktreesByBranch } from '../../../git/utils/-webview/worktree.utils';
import {
	getBranchId,
	getBranchNameWithoutRemote,
	getLocalBranchByUpstream,
	getRemoteNameFromBranchName,
} from '../../../git/utils/branch.utils';
import { splitCommitMessage } from '../../../git/utils/commit.utils';
import { getLastFetchedUpdateInterval } from '../../../git/utils/fetch.utils';
import {
	getComparisonRefsForPullRequest,
	getRepositoryIdentityForPullRequest,
	serializePullRequest,
} from '../../../git/utils/pullRequest.utils';
import { createReference } from '../../../git/utils/reference.utils';
import { isSha, shortenRevision } from '../../../git/utils/revision.utils';
import type { FeaturePreviewChangeEvent, SubscriptionChangeEvent } from '../../../plus/gk/subscriptionService';
import type { ConnectionStateChangeEvent } from '../../../plus/integrations/integrationService';
import { getPullRequestBranchDeepLink } from '../../../plus/launchpad/launchpadProvider';
import type { AssociateIssueWithBranchCommandArgs } from '../../../plus/startWork/startWork';
import { ReferencesQuickPickIncludes, showReferencePicker } from '../../../quickpicks/referencePicker';
import { showRepositoryPicker } from '../../../quickpicks/repositoryPicker';
import {
	executeActionCommand,
	executeCommand,
	executeCoreCommand,
	registerCommand,
} from '../../../system/-webview/command';
import { configuration } from '../../../system/-webview/configuration';
import { getContext, onDidChangeContext } from '../../../system/-webview/context';
import { isDarkTheme, isLightTheme } from '../../../system/-webview/vscode';
import { openUrl } from '../../../system/-webview/vscode/uris';
import type { OpenWorkspaceLocation } from '../../../system/-webview/vscode/workspaces';
import { openWorkspace } from '../../../system/-webview/vscode/workspaces';
import { debug, log } from '../../../system/decorators/log';
import { disposableInterval } from '../../../system/function';
import type { Deferrable } from '../../../system/function/debounce';
import { debounce } from '../../../system/function/debounce';
import { count, find, join, last } from '../../../system/iterable';
import { flatten, updateRecordValue } from '../../../system/object';
import {
	getSettledValue,
	pauseOnCancelOrTimeout,
	pauseOnCancelOrTimeoutMapTuplePromise,
} from '../../../system/promise';
import { Stopwatch } from '../../../system/stopwatch';
import { serializeWebviewItemContext } from '../../../system/webview';
import { DeepLinkActionType } from '../../../uris/deepLinks/deepLink';
import { RepositoryFolderNode } from '../../../views/nodes/abstract/repositoryFolderNode';
import type { IpcCallMessageType, IpcMessage, IpcNotification } from '../../protocol';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../../webviewProvider';
import type { WebviewPanelShowCommandArgs, WebviewShowOptions } from '../../webviewsController';
import { isSerializedState } from '../../webviewsController';
import type { TimelineCommandArgs } from '../timeline/registration';
import {
	formatRepositories,
	hasGitReference,
	isGraphItemRefContext,
	isGraphItemRefGroupContext,
	isGraphItemTypedContext,
	toGraphHostingServiceType,
	toGraphIssueTrackerType,
} from './graphWebview.utils';
import type {
	BranchState,
	DidChangeRefsVisibilityParams,
	DidGetCountParams,
	DidGetRowHoverParams,
	DidSearchParams,
	DoubleClickedParams,
	GetMissingAvatarsParams,
	GetMissingRefsMetadataParams,
	GetMoreRowsParams,
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
	GraphRepository,
	GraphScrollMarkerTypes,
	GraphSearchResults,
	GraphSelectedRows,
	GraphWorkingTreeStats,
	OpenPullRequestDetailsParams,
	SearchOpenInViewParams,
	SearchParams,
	State,
	UpdateColumnsParams,
	UpdateExcludeTypesParams,
	UpdateGraphConfigurationParams,
	UpdateGraphSearchModeParams,
	UpdateIncludedRefsParams,
	UpdateRefsVisibilityParams,
	UpdateSelectionParams,
} from './protocol';
import {
	ChooseRefRequest,
	ChooseRepositoryCommand,
	DidChangeAvatarsNotification,
	DidChangeBranchStateNotification,
	DidChangeColumnsNotification,
	DidChangeGraphConfigurationNotification,
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
	DoubleClickedCommandType,
	EnsureRowRequest,
	GetCountsRequest,
	GetMissingAvatarsCommand,
	GetMissingRefsMetadataCommand,
	GetMoreRowsCommand,
	GetRowHoverRequest,
	OpenPullRequestDetailsCommand,
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
} from './protocol';
import type { GraphWebviewShowingArgs } from './registration';

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
	private _refsMetadata: Map<string, GraphRefMetadata | null> | null | undefined;
	private _search: GitGraphSearch | undefined;
	private _selectedId?: string;
	private _selectedRows: GraphSelectedRows | undefined;
	private _showDetailsView: Config['graph']['showDetailsView'];
	private _theme: ColorTheme | undefined;
	private _repositoryEventsDisposable: Disposable | undefined;
	private _lastFetchedDisposable: Disposable | undefined;

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
			onDidChangeContext(this.onContextChanged, this),
			this.container.subscription.onDidChangeFeaturePreview(this.onFeaturePreviewChanged, this),
			this.container.git.onDidChangeRepositories(async () => {
				if (this._etag !== this.container.git.etag) {
					if (this._discovering != null) {
						this._etag = await this._discovering;
						if (this._etag === this.container.git.etag) return;
					}

					void this.host.refresh(true);
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

			this.setSelectedRows(id);

			if (this._graph != null) {
				if (this._graph?.ids.has(id)) {
					void this.notifyDidChangeSelection();
					return [true, this.getShownTelemetryContext()];
				}

				void this.onGetMoreRows({ id: id }, true);
			}
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

	includeBootstrap(): Promise<State> {
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
						void executeCommand<WebviewPanelShowCommandArgs>(
							'gitlens.showGraphPage',
							undefined,
							this.repository,
						),
				),
			);
		}

		commands.push(
			this.host.registerWebviewCommand('gitlens.graph.push', this.push),
			this.host.registerWebviewCommand('gitlens.graph.pull', this.pull),
			this.host.registerWebviewCommand('gitlens.graph.fetch', this.fetch),
			this.host.registerWebviewCommand('gitlens.graph.pushWithForce', this.forcePush),
			this.host.registerWebviewCommand('gitlens.graph.publishBranch', this.publishBranch),
			this.host.registerWebviewCommand('gitlens.graph.switchToAnotherBranch', this.switchToAnother),

			this.host.registerWebviewCommand('gitlens.graph.createBranch', this.createBranch),
			this.host.registerWebviewCommand('gitlens.graph.deleteBranch', this.deleteBranch),
			this.host.registerWebviewCommand('gitlens.star.branch:graph', this.star),
			this.host.registerWebviewCommand('gitlens.unstar.branch:graph', this.unstar),
			this.host.registerWebviewCommand<GraphItemContext>('gitlens.graph.copyRemoteBranchUrl', item =>
				this.openBranchOnRemote(item, true),
			),
			this.host.registerWebviewCommand('gitlens.graph.openBranchOnRemote', this.openBranchOnRemote),
			this.host.registerWebviewCommand('gitlens.graph.mergeBranchInto', this.mergeBranchInto),
			this.host.registerWebviewCommand('gitlens.graph.rebaseOntoBranch', this.rebase),
			this.host.registerWebviewCommand('gitlens.graph.rebaseOntoUpstream', this.rebaseToRemote),
			this.host.registerWebviewCommand('gitlens.graph.renameBranch', this.renameBranch),
			this.host.registerWebviewCommand('gitlens.graph.associateIssueWithBranch', this.associateIssueWithBranch),

			this.host.registerWebviewCommand('gitlens.graph.switchToBranch', this.switchTo),

			this.host.registerWebviewCommand('gitlens.graph.hideLocalBranch', this.hideRef),
			this.host.registerWebviewCommand('gitlens.graph.hideRemoteBranch', this.hideRef),
			this.host.registerWebviewCommand<GraphItemContext>('gitlens.graph.hideRemote', item =>
				this.hideRef(item, { remote: true }),
			),
			this.host.registerWebviewCommand<GraphItemContext>('gitlens.graph.hideRefGroup', item =>
				this.hideRef(item, { group: true }),
			),
			this.host.registerWebviewCommand('gitlens.graph.hideTag', this.hideRef),

			this.host.registerWebviewCommand('gitlens.graph.cherryPick', this.cherryPick),
			this.host.registerWebviewCommand('gitlens.graph.cherryPick.multi', this.cherryPick),
			this.host.registerWebviewCommand<GraphItemContext>('gitlens.graph.copyRemoteCommitUrl', item =>
				this.openCommitOnRemote(item, true),
			),
			this.host.registerWebviewCommand<GraphItemContext>('gitlens.graph.copyRemoteCommitUrl.multi', item =>
				this.openCommitOnRemote(item, true),
			),
			this.host.registerWebviewCommand('gitlens.graph.openCommitOnRemote', this.openCommitOnRemote),
			this.host.registerWebviewCommand('gitlens.graph.openCommitOnRemote.multi', this.openCommitOnRemote),
			this.host.registerWebviewCommand('gitlens.graph.commitViaSCM', this.commitViaSCM),
			this.host.registerWebviewCommand('gitlens.graph.rebaseOntoCommit', this.rebase),
			this.host.registerWebviewCommand('gitlens.graph.resetCommit', this.resetCommit),
			this.host.registerWebviewCommand('gitlens.graph.resetToCommit', this.resetToCommit),
			this.host.registerWebviewCommand('gitlens.graph.resetToTip', this.resetToTip),
			this.host.registerWebviewCommand('gitlens.graph.revert', this.revertCommit),
			this.host.registerWebviewCommand('gitlens.graph.showInDetailsView', this.openInDetailsView),
			this.host.registerWebviewCommand('gitlens.graph.switchToCommit', this.switchTo),
			this.host.registerWebviewCommand('gitlens.graph.undoCommit', this.undoCommit),

			this.host.registerWebviewCommand('gitlens.stashSave:graph', this.saveStash),
			this.host.registerWebviewCommand('gitlens.stashApply:graph', this.applyStash),
			this.host.registerWebviewCommand('gitlens.stashDelete:graph', this.deleteStash),
			this.host.registerWebviewCommand('gitlens.stashRename:graph', this.renameStash),

			this.host.registerWebviewCommand('gitlens.graph.createTag', this.createTag),
			this.host.registerWebviewCommand('gitlens.graph.deleteTag', this.deleteTag),
			this.host.registerWebviewCommand('gitlens.graph.switchToTag', this.switchTo),
			this.host.registerWebviewCommand('gitlens.graph.resetToTag', this.resetToTag),

			this.host.registerWebviewCommand('gitlens.graph.createWorktree', this.createWorktree),

			this.host.registerWebviewCommand('gitlens.graph.createPullRequest', this.createPullRequest),
			this.host.registerWebviewCommand('gitlens.graph.openPullRequest', this.openPullRequest),
			this.host.registerWebviewCommand('gitlens.graph.openPullRequestChanges', this.openPullRequestChanges),
			this.host.registerWebviewCommand('gitlens.graph.openPullRequestComparison', this.openPullRequestComparison),
			this.host.registerWebviewCommand('gitlens.graph.openPullRequestOnRemote', this.openPullRequestOnRemote),

			this.host.registerWebviewCommand(
				'gitlens.graph.openChangedFileDiffsWithMergeBase',
				this.openChangedFileDiffsWithMergeBase,
			),

			this.host.registerWebviewCommand('gitlens.graph.compareWithUpstream', this.compareWithUpstream),
			this.host.registerWebviewCommand('gitlens.graph.compareWithHead', this.compareHeadWith),
			this.host.registerWebviewCommand('gitlens.graph.compareBranchWithHead', this.compareBranchWithHead),
			this.host.registerWebviewCommand('gitlens.graph.compareWithWorking', this.compareWorkingWith),
			this.host.registerWebviewCommand('gitlens.graph.compareWithMergeBase', this.compareWithMergeBase),
			this.host.registerWebviewCommand(
				'gitlens.graph.compareAncestryWithWorking',
				this.compareAncestryWithWorking,
			),

			this.host.registerWebviewCommand('gitlens.graph.copy', this.copy),
			this.host.registerWebviewCommand('gitlens.graph.copyMessage', this.copyMessage),
			this.host.registerWebviewCommand('gitlens.graph.copySha', this.copySha),

			this.host.registerWebviewCommand('gitlens.graph.addAuthor', this.addAuthor),

			this.host.registerWebviewCommand('gitlens.graph.columnAuthorOn', () => this.toggleColumn('author', true)),
			this.host.registerWebviewCommand('gitlens.graph.columnAuthorOff', () => this.toggleColumn('author', false)),
			this.host.registerWebviewCommand('gitlens.graph.columnDateTimeOn', () =>
				this.toggleColumn('datetime', true),
			),
			this.host.registerWebviewCommand('gitlens.graph.columnDateTimeOff', () =>
				this.toggleColumn('datetime', false),
			),
			this.host.registerWebviewCommand('gitlens.graph.columnShaOn', () => this.toggleColumn('sha', true)),
			this.host.registerWebviewCommand('gitlens.graph.columnShaOff', () => this.toggleColumn('sha', false)),
			this.host.registerWebviewCommand('gitlens.graph.columnChangesOn', () => this.toggleColumn('changes', true)),
			this.host.registerWebviewCommand('gitlens.graph.columnChangesOff', () =>
				this.toggleColumn('changes', false),
			),
			this.host.registerWebviewCommand('gitlens.graph.columnGraphOn', () => this.toggleColumn('graph', true)),
			this.host.registerWebviewCommand('gitlens.graph.columnGraphOff', () => this.toggleColumn('graph', false)),
			this.host.registerWebviewCommand('gitlens.graph.columnMessageOn', () => this.toggleColumn('message', true)),
			this.host.registerWebviewCommand('gitlens.graph.columnMessageOff', () =>
				this.toggleColumn('message', false),
			),
			this.host.registerWebviewCommand('gitlens.graph.columnRefOn', () => this.toggleColumn('ref', true)),
			this.host.registerWebviewCommand('gitlens.graph.columnRefOff', () => this.toggleColumn('ref', false)),
			this.host.registerWebviewCommand('gitlens.graph.columnGraphCompact', () =>
				this.setColumnMode('graph', 'compact'),
			),
			this.host.registerWebviewCommand('gitlens.graph.columnGraphDefault', () =>
				this.setColumnMode('graph', undefined),
			),
			this.host.registerWebviewCommand('gitlens.graph.scrollMarkerLocalBranchOn', () =>
				this.toggleScrollMarker('localBranches', true),
			),
			this.host.registerWebviewCommand('gitlens.graph.scrollMarkerLocalBranchOff', () =>
				this.toggleScrollMarker('localBranches', false),
			),
			this.host.registerWebviewCommand('gitlens.graph.scrollMarkerRemoteBranchOn', () =>
				this.toggleScrollMarker('remoteBranches', true),
			),
			this.host.registerWebviewCommand('gitlens.graph.scrollMarkerRemoteBranchOff', () =>
				this.toggleScrollMarker('remoteBranches', false),
			),
			this.host.registerWebviewCommand('gitlens.graph.scrollMarkerStashOn', () =>
				this.toggleScrollMarker('stashes', true),
			),
			this.host.registerWebviewCommand('gitlens.graph.scrollMarkerStashOff', () =>
				this.toggleScrollMarker('stashes', false),
			),
			this.host.registerWebviewCommand('gitlens.graph.scrollMarkerTagOn', () =>
				this.toggleScrollMarker('tags', true),
			),
			this.host.registerWebviewCommand('gitlens.graph.scrollMarkerTagOff', () =>
				this.toggleScrollMarker('tags', false),
			),
			this.host.registerWebviewCommand('gitlens.graph.scrollMarkerPullRequestOn', () =>
				this.toggleScrollMarker('pullRequests', true),
			),
			this.host.registerWebviewCommand('gitlens.graph.scrollMarkerPullRequestOff', () =>
				this.toggleScrollMarker('pullRequests', false),
			),

			this.host.registerWebviewCommand('gitlens.graph.copyDeepLinkToBranch', this.copyDeepLinkToBranch),
			this.host.registerWebviewCommand('gitlens.graph.copyDeepLinkToCommit', this.copyDeepLinkToCommit),
			this.host.registerWebviewCommand('gitlens.graph.copyDeepLinkToRepo', this.copyDeepLinkToRepo),
			this.host.registerWebviewCommand('gitlens.graph.copyDeepLinkToTag', this.copyDeepLinkToTag),
			this.host.registerWebviewCommand('gitlens.graph.shareAsCloudPatch', this.shareAsCloudPatch),
			this.host.registerWebviewCommand('gitlens.graph.createPatch', this.shareAsCloudPatch),
			this.host.registerWebviewCommand('gitlens.graph.createCloudPatch', this.shareAsCloudPatch),

			this.host.registerWebviewCommand('gitlens.graph.openChangedFiles', this.openFiles),
			this.host.registerWebviewCommand('gitlens.graph.openOnlyChangedFiles', this.openOnlyChangedFiles),
			this.host.registerWebviewCommand<GraphItemContext>('gitlens.graph.openChangedFileDiffs', item =>
				this.openAllChanges(item),
			),
			this.host.registerWebviewCommand<GraphItemContext>('gitlens.graph.openChangedFileDiffsWithWorking', item =>
				this.openAllChangesWithWorking(item),
			),
			this.host.registerWebviewCommand<GraphItemContext>('gitlens.graph.openChangedFileDiffsIndividually', item =>
				this.openAllChanges(item, true),
			),
			this.host.registerWebviewCommand<GraphItemContext>(
				'gitlens.graph.openChangedFileDiffsWithWorkingIndividually',
				item => this.openAllChangesWithWorking(item, true),
			),
			this.host.registerWebviewCommand('gitlens.graph.openChangedFileRevisions', this.openRevisions),

			this.host.registerWebviewCommand('gitlens.graph.resetColumnsDefault', () =>
				this.updateColumns(defaultGraphColumnsSettings),
			),
			this.host.registerWebviewCommand('gitlens.graph.resetColumnsCompact', () =>
				this.updateColumns(compactGraphColumnsSettings),
			),

			this.host.registerWebviewCommand('gitlens.graph.openInWorktree', this.openInWorktree),
			this.host.registerWebviewCommand('gitlens.graph.openWorktree', this.openWorktree),
			this.host.registerWebviewCommand<GraphItemContext>('gitlens.graph.openWorktreeInNewWindow', item =>
				this.openWorktree(item, { location: 'newWindow' }),
			),
			this.host.registerWebviewCommand(
				'gitlens.graph.copyWorkingChangesToWorktree',
				this.copyWorkingChangesToWorktree,
			),
			this.host.registerWebviewCommand('gitlens.ai.generateCommitMessage:graph', this.generateCommitMessage),
			this.host.registerWebviewCommand('gitlens.ai.explainBranch:graph', this.explainBranch),
			this.host.registerWebviewCommand('gitlens.ai.explainCommit:graph', this.explainCommit),
			this.host.registerWebviewCommand('gitlens.ai.explainStash:graph', this.explainStash),
			this.host.registerWebviewCommand('gitlens.ai.explainWip:graph', this.explainWip),

			this.host.registerWebviewCommand('gitlens.graph.compareSelectedCommits.multi', this.compareSelectedCommits),
			this.host.registerWebviewCommand('gitlens.graph.abortPausedOperation', this.abortPausedOperation),
			this.host.registerWebviewCommand('gitlens.graph.continuePausedOperation', this.continuePausedOperation),
			this.host.registerWebviewCommand('gitlens.graph.openRebaseEditor', this.openRebaseEditor),
			this.host.registerWebviewCommand('gitlens.graph.skipPausedOperation', this.skipPausedOperation),

			this.host.registerWebviewCommand('gitlens.ai.generateChangelogFrom:graph', this.generateChangelogFrom),
			this.host.registerWebviewCommand('gitlens.ai.generateCommits:graph', this.generateCommits),
			this.host.registerWebviewCommand('gitlens.ai.composeCommits:graph', this.composeCommits),
			this.host.registerWebviewCommand('gitlens.ai.rebaseOntoCommit:graph', this.rebaseOntoCommit),
			this.host.registerWebviewCommand('gitlens.visualizeHistory.repo:graph', this.visualizeHistoryRepo),
		);

		return commands;
	}
	onWindowFocusChanged(focused: boolean): void {
		this.isWindowFocused = focused;
	}

	onFocusChanged(focused: boolean): void {
		this._showActiveSelectionDetailsDebounced?.cancel();

		if (!focused || this.activeSelection == null || !this.container.views.commitDetails.visible) {
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
			this.host.sendPendingIpcNotifications();

			const { activeSelection } = this;
			if (activeSelection == null) return;

			this.showActiveSelectionDetails();
		}
	}

	onMessageReceived(e: IpcMessage): void {
		switch (true) {
			case ChooseRepositoryCommand.is(e):
				void this.onChooseRepository();
				break;
			case ChooseRefRequest.is(e):
				void this.onChooseRef(ChooseRefRequest, e);
				break;
			case DoubleClickedCommandType.is(e):
				void this.onDoubleClick(e.params);
				break;
			case EnsureRowRequest.is(e):
				void this.onEnsureRowRequest(EnsureRowRequest, e);
				break;
			case GetCountsRequest.is(e):
				void this.onGetCounts(GetCountsRequest, e);
				break;
			case GetMissingAvatarsCommand.is(e):
				void this.onGetMissingAvatars(e.params);
				break;
			case GetMissingRefsMetadataCommand.is(e):
				void this.onGetMissingRefMetadata(e.params);
				break;
			case GetMoreRowsCommand.is(e):
				void this.onGetMoreRows(e.params);
				break;
			case GetRowHoverRequest.is(e):
				void this.onHoverRowRequest(GetRowHoverRequest, e);
				break;
			case OpenPullRequestDetailsCommand.is(e):
				void this.onOpenPullRequestDetails(e.params);
				break;
			case SearchRequest.is(e):
				void this.onSearchRequest(SearchRequest, e);
				break;
			case SearchOpenInViewCommand.is(e):
				this.onSearchOpenInView(e.params);
				break;
			case UpdateColumnsCommand.is(e):
				this.onColumnsChanged(e.params);
				break;
			case UpdateGraphConfigurationCommand.is(e):
				this.updateGraphConfig(e.params);
				break;
			case UpdateGraphSearchModeCommand.is(e):
				this.updateGraphSearchMode(e.params);
				break;
			case UpdateExcludeTypesCommand.is(e):
				this.updateExcludedTypes(this._graph?.repoPath, e.params);
				break;
			case UpdateIncludedRefsCommand.is(e):
				this.updateIncludeOnlyRefs(this._graph?.repoPath, e.params);
				break;
			case UpdateRefsVisibilityCommand.is(e):
				this.onRefsVisibilityChanged(e.params);
				break;
			case UpdateSelectionCommand.is(e):
				this.onSelectionChanged(e.params);
				break;
		}
	}
	private async onGetCounts<T extends typeof GetCountsRequest>(requestType: T, msg: IpcCallMessageType<T>) {
		let counts: DidGetCountParams;
		if (this._graph != null) {
			const tags = await this.container.git.getRepositoryService(this._graph.repoPath).tags.getTags();
			counts = {
				branches: count(this._graph.branches?.values(), b => !b.remote),
				remotes: this._graph.remotes.size,
				stashes: this._graph.stashes?.size,
				// Subtract the default worktree
				worktrees: this._graph.worktrees != null ? this._graph.worktrees.length - 1 : undefined,
				tags: tags.values.length,
			};
		} else {
			counts = undefined;
		}

		void this.host.respond(requestType, msg, counts);
	}

	private updateGraphConfig(params: UpdateGraphConfigurationParams) {
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

	private updateGraphSearchMode(params: UpdateGraphSearchModeParams) {
		void this.container.storage.store('graph:searchMode', params.searchMode).catch();
		void this.container.storage.store('graph:useNaturalLanguageSearch', params.useNaturalLanguage).catch();
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
		if (activeSelection == null || !this.host.active) return;

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

	@debug({ args: false })
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

	@debug({ args: false })
	private onFeaturePreviewChanged(e: FeaturePreviewChangeEvent) {
		if (e.feature !== 'graph') return;

		void this.notifyDidStartFeaturePreview(e);
	}

	private getFeaturePreview(): FeaturePreview {
		return this.container.subscription.getFeaturePreview('graph');
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
				RepositoryChange.Starred,
				RepositoryChange.Stash,
				RepositoryChange.PausedOperationStatus,
				RepositoryChange.Tags,
				RepositoryChange.Unknown,
				RepositoryChangeComparisonMode.Any,
			)
		) {
			this._etagRepository = e.repository.etag;
			return;
		}

		if (e.changed(RepositoryChange.Config, RepositoryChangeComparisonMode.Any)) {
			if (this._refsMetadata != null) {
				// Clear out any associated issue metadata
				for (const [, value] of this._refsMetadata) {
					if (value == null) continue;
					value.issue = undefined;
				}
			}
		}

		if (e.changed(RepositoryChange.Head, RepositoryChangeComparisonMode.Any)) {
			this.setSelectedRows(undefined);
		}

		// Unless we don't know what changed, update the state immediately
		this.updateState(!e.changed(RepositoryChange.Unknown, RepositoryChangeComparisonMode.Exclusive));
	}

	@debug({ args: false })
	private onRepositoryFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
		if (e.repository.id !== this.repository?.id) return;
		void this.notifyDidChangeWorkingTree();
	}

	@debug({ args: false })
	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		if (e.etag === this._etagSubscription) return;

		this._etagSubscription = e.etag;
		void this.notifyDidChangeSubscription();
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

	private onColumnsChanged(e: UpdateColumnsParams) {
		this.updateColumns(e.config);

		const sendEvent: TelemetryEvents['graph/columns/changed'] = { ...this.getTelemetryContext() };
		for (const [name, config] of Object.entries(e.config)) {
			for (const [prop, value] of Object.entries(config)) {
				sendEvent[`column.${name}.${prop as keyof GraphColumnConfig}`] = value;
			}
		}
		this.container.telemetry.sendEvent('graph/columns/changed', sendEvent);
	}

	private onRefsVisibilityChanged(e: UpdateRefsVisibilityParams) {
		this.updateExcludedRefs(this._graph?.repoPath, e.refs, e.visible);
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
					} else if (e.metadata.type === 'issue' && isGraphItemTypedContext(item, 'issue')) {
						return void this.openIssueOnRemote(item);
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
			this._showActiveSelectionDetailsDebounced?.cancel();

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

				const details = this.host.is('editor')
					? this.container.views.commitDetails
					: this.container.views.graphDetails;
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

	private async onHoverRowRequest<T extends typeof GetRowHoverRequest>(requestType: T, msg: IpcCallMessageType<T>) {
		const hover: DidGetRowHoverParams = {
			id: msg.params.id,
			markdown: undefined!,
		};

		this.cancelOperation('hover');

		if (this._graph != null) {
			const id = msg.params.id;

			let markdown = this._hoverCache.get(id);
			if (markdown == null) {
				const cancellation = this.createCancellation('hover');

				let cache = true;
				let commit;
				try {
					const svc = this.container.git.getRepositoryService(this._graph.repoPath);
					switch (msg.params.type) {
						case 'work-dir-changes':
							cache = false;
							commit = await svc.commits.getCommit(uncommitted, cancellation.token);
							break;
						case 'stash-node': {
							const stash = await svc.stash?.getStash(undefined, cancellation.token);
							commit = stash?.stashes.get(msg.params.id);
							break;
						}
						default: {
							commit = await svc.commits.getCommit(msg.params.id, cancellation.token);
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
		void this.host.respond(requestType, msg, hover);
	}

	private async getCommitTooltip(commit: GitCommit, cancellation: CancellationToken) {
		const svc = this.container.git.getRepositoryService(commit.repoPath);
		const [remotesResult, _] = await Promise.allSettled([
			svc.remotes.getBestRemotesWithProviders(),
			commit.ensureFullDetails({ include: { stats: true } }),
		]);

		if (cancellation.isCancellationRequested) throw new CancellationError();

		const remotes = getSettledValue(remotesResult, []);
		const [remote] = remotes;

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

		let template;
		if (isStash(commit)) {
			template = configuration.get('views.formats.stashes.tooltip');
		} else {
			template = configuration.get('views.formats.commits.tooltip');
		}

		this._getBranchesAndTagsTips ??= await svc.getBranchesAndTagsTipsLookup();

		const tooltip = await CommitFormatter.fromTemplateAsync(template, commit, {
			enrichedAutolinks: enrichedAutolinks,
			dateFormat: configuration.get('defaultDateFormat'),
			getBranchAndTagTips: this._getBranchesAndTagsTips,
			messageAutolinks: true,
			messageIndent: 4,
			pullRequest: pr,
			outputFormat: 'markdown',
			remotes: remotes,
			// unpublished: this.unpublished,
		});

		return tooltip;
	}

	@debug()
	private async onEnsureRowRequest<T extends typeof EnsureRowRequest>(requestType: T, msg: IpcCallMessageType<T>) {
		if (this._graph == null) return;

		const e = msg.params;

		let id: string | undefined;
		if (this._graph.ids.has(e.id)) {
			id = e.id;
		} else {
			await this.updateGraphWithMoreRows(this._graph, e.id, this._search);
			void this.notifyDidChangeRows();
			if (this._graph.ids.has(e.id)) {
				id = e.id;
			}
		}

		void this.host.respond(requestType, msg, { id: id });
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
		if (
			this._graph == null ||
			this._refsMetadata === null ||
			!getContext('gitlens:repos:withHostingIntegrationsConnected')?.includes(this._graph.repoPath)
		) {
			return;
		}

		const repoPath = this._graph.repoPath;

		async function getRefMetadata(
			this: GraphWebviewProvider,
			id: string,
			missingTypes: GraphMissingRefsMetadataType[],
		) {
			if (this._refsMetadata == null) {
				this._refsMetadata = new Map();
			}

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
									[...enrichedAutolinks.values()].map(async ([issueOrPullRequestPromise]) =>
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

		for (const id of Object.keys(e.metadata)) {
			promises.push(getRefMetadata.call(this, id, e.metadata[id]));
		}

		if (promises.length) {
			await Promise.allSettled(promises);
		}
		this.updateRefsMetadata();
	}

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

	@log()
	private async onOpenPullRequestDetails(_params: OpenPullRequestDetailsParams) {
		// TODO: a hack for now, since we aren't using the params at all right now and always opening the current branch's PR
		const repo = this.repository;
		if (repo == null) return undefined;

		const branch = await repo.git.branches.getBranch();
		if (branch == null) return undefined;

		const pr = await branch.getAssociatedPullRequest();
		if (pr == null) return undefined;

		return this.container.views.pullRequest.showPullRequest(pr, branch);
	}

	@debug()
	private async onSearchRequest<T extends typeof SearchRequest>(requestType: T, msg: IpcCallMessageType<T>) {
		using sw = new Stopwatch(`GraphWebviewProvider.onSearchRequest(${this.host.id})`);

		if (msg.params.search?.naturalLanguage) {
			msg.params.search = await processNaturalLanguageToSearchQuery(this.container, msg.params.search, {
				source: 'graph',
			});
		}

		const query = msg.params.search ? parseSearchQuery(msg.params.search) : undefined;
		const types = query != null ? join(query?.keys(), ',') : '';

		let results;
		let exception: (Error & { original?: Error }) | undefined;

		try {
			results = await this.getSearchResults(msg.params);
			void this.host.respond(requestType, msg, results);
		} catch (ex) {
			exception = ex;
			void this.host.respond(requestType, msg, {
				search: msg.params.search,
				results: isCancellationError(ex)
					? undefined
					: { error: ex instanceof GitSearchError ? 'Invalid search pattern' : 'Unexpected error' },
			});
		} finally {
			const cancelled = isCancellationError(exception);

			this.container.telemetry.sendEvent('graph/searched', {
				...this.getTelemetryContext(),
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

	private async getSearchResults(e: SearchParams): Promise<DidSearchParams> {
		if (e.search == null) {
			this.resetSearchState();
			return { search: e.search, results: undefined };
		}

		let search: GitGraphSearch | undefined = this._search;

		const graph = this._graph!;

		if (e.more && search?.more != null && search.comparisonKey === getSearchQueryComparisonKey(e.search)) {
			search = await search.more(e.limit ?? configuration.get('graph.searchItemLimit') ?? 100);
			if (search != null) {
				this._search = search;
				void (await this.ensureSearchStartsInRange(graph, search));

				return {
					search: e.search,
					results: search.results.size
						? {
								ids: Object.fromEntries(search.results),
								count: search.results.size,
								paging: { hasMore: search.paging?.hasMore ?? false },
							}
						: undefined,
				};
			}

			return { search: e.search, results: undefined };
		}

		if (search == null || search.comparisonKey !== getSearchQueryComparisonKey(e.search)) {
			if (this.repository == null) return { search: e.search, results: { error: 'No repository' } };

			if (this.repository.etag !== this._etagRepository) {
				this.updateState(true);
			}

			const cancellation = this.createCancellation('search');

			try {
				search = await this.repository.git.graph.searchGraph(
					e.search,
					{
						limit: configuration.get('graph.searchItemLimit') ?? 100,
						ordering: configuration.get('graph.commitOrdering'),
					},
					cancellation.token,
				);
			} catch (ex) {
				this._search = undefined;
				throw ex;
			}

			if (cancellation.token.isCancellationRequested) throw new CancellationError();

			this._search = search;
		} else {
			search = this._search!;
		}

		const firstResult = await this.ensureSearchStartsInRange(graph, search);

		let sendSelectedRows = false;
		if (firstResult != null) {
			sendSelectedRows = true;
			this.setSelectedRows(firstResult);
		}

		// Check if all search results are visible and we have more available
		// If so, proactively load more search results to ensure pagination works
		while (
			search.paging?.hasMore &&
			search.more != null &&
			search.results.size &&
			graph.ids.has(last(search.results.keys())!)
		) {
			// Automatically load more search results since all current ones are visible
			const searchMore = await search.more(configuration.get('graph.searchItemLimit') ?? 100);
			if (searchMore != null) {
				this._search = search = searchMore;
				// Ensure the new results are visible if needed
				void (await this.ensureSearchStartsInRange(graph, search));
			}
		}

		return {
			search: e.search,
			results: search.results.size
				? {
						ids: Object.fromEntries(search.results),
						count: search.results.size,
						paging: { hasMore: search.paging?.hasMore ?? false },
					}
				: { count: 0 },
			selectedRows: sendSelectedRows ? this._selectedRows : undefined,
		};
	}

	private onSearchOpenInView(e: SearchOpenInViewParams) {
		if (this.repository == null) return;

		void this.container.views.searchAndCompare.search(this.repository.path, e.search, {
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

		this.repository = pick;
		this.container.telemetry.sendEvent('graph/repository/changed', {
			...this.getTelemetryContext(),
			'repository.id': this.repository?.idHash,
			'repository.scheme': this.repository?.uri.scheme,
			'repository.closed': this.repository?.closed,
			'repository.folder.scheme': this.repository?.folder?.uri.scheme,
			'repository.provider.id': this.repository?.provider.id,
		});
	}

	private async onChooseRef<T extends typeof ChooseRefRequest>(requestType: T, msg: IpcCallMessageType<T>) {
		if (this.repository == null) {
			return this.host.respond(requestType, msg, undefined);
		}

		let pick;
		// If not alt, then jump directly to HEAD
		if (!msg.params.alt) {
			let branch = find(this._graph!.branches.values(), b => b.current);
			if (branch == null) {
				branch = await this.repository.git.branches.getBranch();
			}
			if (branch != null) {
				pick = branch;
			}
		} else {
			pick = await showReferencePicker(
				this.repository.path,
				`Jump to Reference ${GlyphChars.Dot} ${this.repository?.name}`,
				'Choose a reference to jump to',
				{ include: ReferencesQuickPickIncludes.BranchesAndTags },
			);
		}

		return this.host.respond(requestType, msg, pick?.sha != null ? { name: pick.name, sha: pick.sha } : undefined);
	}

	private _fireSelectionChangedDebounced: Deferrable<GraphWebviewProvider['fireSelectionChanged']> | undefined =
		undefined;

	private onSelectionChanged(e: UpdateSelectionParams) {
		this._showActiveSelectionDetailsDebounced?.cancel();

		const item = e.selection[0];
		this.setSelectedRows(item?.id);

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

	@debug()
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
		return this.host.notify(DidChangeAvatarsNotification, {
			avatars: Object.fromEntries(data.avatars),
		});
	}

	@debug()
	private async notifyDidChangeBranchState(branchState: BranchState) {
		return this.host.notify(DidChangeBranchStateNotification, {
			branchState: branchState,
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
		return this.host.notify(DidChangeRefsMetadataNotification, {
			metadata: this._refsMetadata != null ? Object.fromEntries(this._refsMetadata) : this._refsMetadata,
		});
	}

	@debug()
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

	@debug()
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

	@debug()
	private async notifyDidChangeRefsVisibility(params?: DidChangeRefsVisibilityParams) {
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

	@debug()
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

	@debug()
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

	@debug()
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

				selectedRows: sendSelectedRows ? this._selectedRows : undefined,
				paging: {
					startingCursor: graph.paging?.startingCursor,
					hasMore: graph.paging?.hasMore ?? false,
				},
			},
			completionId,
		);
	}

	@debug({ args: false })
	private async notifyDidChangeRowsStats(graph: GitGraph) {
		if (graph.rowsStats == null) return;

		return this.host.notify(DidChangeRowsStatsNotification, {
			rowsStats: Object.fromEntries(graph.rowsStats),
			rowsStatsLoading: graph.rowsStatsDeferred?.isLoaded != null ? !graph.rowsStatsDeferred.isLoaded() : false,
		});
	}

	@debug()
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

	@debug()
	private async notifyDidChangeWorkingTree() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeWorkingTreeNotification, this._ipcNotificationMap, this);
			return false;
		}

		return this.host.notify(DidChangeWorkingTreeNotification, {
			stats: (await this.getWorkingTreeStats()) ?? { added: 0, deleted: 0, modified: 0 },
		});
	}

	@debug()
	private async notifyDidChangeSelection() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeSelectionNotification, this._ipcNotificationMap, this);
			return false;
		}

		return this.host.notify(DidChangeSelectionNotification, {
			selection: this._selectedRows ?? {},
		});
	}

	@debug()
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

	@debug()
	private notifyDidChangeOrgSettings() {
		void this.host.notify(DidChangeOrgSettings, { orgSettings: this.getOrgSettings() });
	}

	@debug()
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

	private onIntegrationConnectionChanged(_e: ConnectionStateChangeEvent) {
		void this.notifyDidChangeRepoConnection();
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

		let interval = getLastFetchedUpdateInterval(lastFetched);
		if (lastFetched !== 0 && interval > 0) {
			this._lastFetchedDisposable = disposableInterval(() => {
				// Check if the interval should change, and if so, reset it
				const checkInterval = getLastFetchedUpdateInterval(lastFetched);
				if (interval !== getLastFetchedUpdateInterval(lastFetched)) {
					interval = checkInterval;
				}

				void this.notifyDidFetch();
			}, interval);
		}
	}

	private async ensureSearchStartsInRange(graph: GitGraph, search: GitGraphSearch) {
		if (search.results.size === 0) return undefined;

		let firstResult: string | undefined;
		for (const id of search.results.keys()) {
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
		if (storedExcludeRefs == null || Object.keys(storedExcludeRefs).length === 0) return undefined;

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
				if (!starredBranchIds.size) return { refs: {}, continuation: continuation };

				refs = new Map();
				for (const branch of graph.branches.values()) {
					if (branch.current || starredBranchIds.has(branch.id)) {
						refs.set(branch.id, convertBranchToIncludeOnlyRef(branch));
					}
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
			aiEnabled: configuration.get('ai.enabled'),
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

	private async getWorkingTreeStats(cancellation?: CancellationToken): Promise<GraphWorkingTreeStats | undefined> {
		if (this.repository == null || !this.container.git.repositoryCount) return undefined;

		const svc = this.container.git.getRepositoryService(this.repository.path);

		const [statusResult, pausedOpStatusResult] = await Promise.allSettled([
			svc.status.getStatus(cancellation),
			svc.status.getPausedOperationStatus?.(cancellation),
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

		const selectedId = this._selectedId;
		const rev = selectedId == null || selectedId === uncommitted ? 'HEAD' : selectedId;

		const columns = this.getColumns();
		const columnSettings = this.getColumnSettings(columns);

		const dataPromise = this.repository.git.graph.getGraph(
			rev,
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
			this.getWorkingTreeStats(cancellation.token),
			this.repository.git.branches.getBranch(undefined, cancellation.token),
			this.repository.getLastFetched(),
		]);

		let data;
		if (deferRows) {
			queueMicrotask(async () => {
				try {
					const data = await dataPromise;
					this.setGraph(data);
					if (selectedId !== uncommitted) {
						this.setSelectedRows(data.id);
					}

					void this.notifyDidChangeRefsVisibility();
					void this.notifyDidChangeRows(true);
				} catch {}
			});
		} else {
			data = await dataPromise;
			this.setGraph(data);
			if (selectedId !== uncommitted) {
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
		const refsVisibility: DidChangeRefsVisibilityParams = {
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

		const defaultSearchMode = this.container.storage.get('graph:searchMode', 'normal');
		const useNaturalLanguageSearch = this.container.storage.get('graph:useNaturalLanguageSearch', true);
		const featurePreview = this.getFeaturePreview();

		return {
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
			selectedRows: this._selectedRows,
			subscription: access?.subscription.current,
			allowed: this.isGraphAccessAllowed(access, featurePreview), //(access?.allowed ?? false) !== false,
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
				settings: this.getGraphSettingsIconContext(columnSettings),
			},
			excludeRefs: refsVisibility.excludeRefs,
			excludeTypes: refsVisibility.excludeTypes,
			includeOnlyRefs: refsVisibility.includeOnlyRefs,
			nonce: this.host.cspNonce,
			workingTreeStats: getSettledValue(workingStatsResult) ?? { added: 0, deleted: 0, modified: 0 },
			defaultSearchMode: defaultSearchMode,
			useNaturalLanguageSearch: useNaturalLanguageSearch,
			featurePreview: featurePreview,
			orgSettings: this.getOrgSettings(),
		};
	}

	private updateColumns(columnsCfg: GraphColumnsConfig) {
		let columns = this.container.storage.getWorkspace('graph:columns');
		for (const [key, value] of Object.entries(columnsCfg)) {
			columns = updateRecordValue(columns, key, value);
		}
		void this.container.storage.storeWorkspace('graph:columns', columns).catch();
		void this.notifyDidChangeColumns();
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

	private updateIncludeOnlyRefs(
		repoPath: string | undefined,
		{ branchesVisibility, refs }: UpdateIncludedRefsParams,
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

			this.container.telemetry.sendEvent('graph/branchesVisibility/changed', {
				...this.getTelemetryContext(),
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

	private updateExcludedTypes(repoPath: string | undefined, { key, value }: UpdateExcludeTypesParams) {
		if (repoPath == null) return;

		let excludeTypes = this.getFiltersByRepo(repoPath)?.excludeTypes;
		if ((excludeTypes == null || !Object.keys(excludeTypes).length) && value === false) {
			return;
		}

		excludeTypes = updateRecordValue(excludeTypes, key, value);

		this.container.telemetry.sendEvent('graph/filters/changed', {
			...this.getTelemetryContext(),
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
		this._refsMetadata = getContext('gitlens:repos:withHostingIntegrationsConnected') ? undefined : null;
		return this._refsMetadata;
	}

	private resetRepositoryState() {
		this._getBranchesAndTagsTips = undefined;
		this.setGraph(undefined);
		this.setSelectedRows(undefined);
	}

	private resetSearchState() {
		this._search = undefined;
		this.cancelOperation('search');
	}

	private setSelectedRows(id: string | undefined) {
		if (this._selectedId === id) return;

		this._selectedId = id;
		if (id === uncommitted) {
			id = 'work-dir-changes' satisfies GitGraphRowType;
		}
		this._selectedRows = id != null ? { [id]: true } : undefined;
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

			this.container.telemetry.sendEvent('graph/rows/loaded', {
				...this.getTelemetryContext(),
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
		const updatedGraph = await graph.more?.(pageItemLimit ?? defaultItemLimit, id ?? undefined, cancellation);
		if (updatedGraph != null) {
			this.setGraph(updatedGraph);

			if (!search?.paging?.hasMore) return;

			const lastId = last(search.results)?.[0];
			if (lastId == null) return;

			if (updatedGraph.ids.has(lastId)) {
				queueMicrotask(async () => {
					try {
						const results = await this.getSearchResults({ search: search.query, more: true });
						void this.host.notify(DidSearchNotification, results);
					} catch (ex) {
						if (ex instanceof CancellationError) return;

						void this.host.notify(DidSearchNotification, {
							search: search.query,
							results: {
								error: ex instanceof GitSearchError ? 'Invalid search pattern' : 'Unexpected error',
							},
						});
					}
				});
			}
		} else {
			debugger;
		}
	}

	@log()
	private fetch(item?: GraphItemContext) {
		const ref = item != null ? this.getGraphItemRef(item, 'branch') : undefined;
		void RepoActions.fetch(this.repository, ref);
	}

	@log()
	private forcePush(item?: GraphItemContext) {
		this.push(item, true);
	}

	@log()
	private pull(item?: GraphItemContext) {
		const ref = item != null ? this.getGraphItemRef(item, 'branch') : undefined;
		void RepoActions.pull(this.repository, ref);
	}

	@log()
	private push(item?: GraphItemContext, force?: boolean) {
		const ref = item != null ? this.getGraphItemRef(item) : undefined;
		void RepoActions.push(this.repository, force, ref);
	}

	@log()
	private createBranch(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return BranchActions.create(ref.repoPath, ref);
	}

	@log()
	private deleteBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return BranchActions.remove(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@log()
	private async star(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			const branch = await this.container.git.getRepositoryService(ref.repoPath).branches.getBranch(ref.name);
			if (branch != null) return branch.star();
		}

		return Promise.resolve();
	}

	@log()
	private async unstar(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			const branch = await this.container.git.getRepositoryService(ref.repoPath).branches.getBranch(ref.name);
			if (branch != null) return branch.unstar();
		}

		return Promise.resolve();
	}

	@log()
	private mergeBranchInto(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return RepoActions.merge(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@log()
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

	@log()
	private publishBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return RepoActions.push(ref.repoPath, undefined, ref);
		}

		return Promise.resolve();
	}

	@log()
	private rebase(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return RepoActions.rebase(ref.repoPath, ref);
	}

	@log()
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

	@log()
	private renameBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return BranchActions.rename(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@log()
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

	@log()
	private cherryPick(item?: GraphItemContext) {
		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection == null) return Promise.resolve();

		return RepoActions.cherryPick(selection[0].repoPath, selection);
	}

	@log()
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

	@log()
	private copyMessage(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return executeCommand<CopyMessageToClipboardCommandArgs>('gitlens.copyMessageToClipboard', {
			repoPath: ref.repoPath,
			sha: ref.ref,
			message: 'message' in ref ? ref.message : undefined,
		});
	}

	@log()
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

	@log()
	private openInDetailsView(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		if (this.host.is('view')) {
			return void showCommitInGraphDetailsView(ref, { preserveFocus: true, preserveVisibility: false });
		}

		return executeCommand<InspectCommandArgs>('gitlens.showInDetailsView', { ref: ref });
	}

	@log()
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

	@log()
	private openCommitOnRemote(item?: GraphItemContext, clipboard?: boolean) {
		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection == null) return Promise.resolve();

		return executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
			repoPath: selection[0].repoPath,
			resource: selection.map(r => ({ type: RemoteResourceType.Commit, sha: r.ref })),
			clipboard: clipboard,
		});
	}

	@log()
	private async compareSelectedCommits(item?: GraphItemContext) {
		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection == null || selection.length !== 2) return Promise.resolve();

		const [commit1, commit2] = selection;
		const [ref1, ref2] = await getOrderedComparisonRefs(this.container, commit1.repoPath, commit1.ref, commit2.ref);

		return this.container.views.searchAndCompare.compare(commit1.repoPath, ref1, ref2);
	}

	@log()
	private async abortPausedOperation(_item?: GraphItemContext) {
		if (this.repository == null) return;

		await abortPausedOperation(this.repository.git);
	}

	@log()
	private async continuePausedOperation(_item?: GraphItemContext) {
		if (this.repository == null) return;

		const status = await this.repository.git.status.getPausedOperationStatus?.();
		if (status == null || status.type === 'revert') return;

		await continuePausedOperation(this.repository.git);
	}

	@log()
	private async openRebaseEditor(_item?: GraphItemContext) {
		if (this.repository == null) return;

		const status = await this.repository.git.status.getPausedOperationStatus?.();
		if (status == null || status.type !== 'rebase') return;

		const gitDir = await this.repository.git.config.getGitDir?.();
		if (gitDir == null) return;

		const rebaseTodoUri = Uri.joinPath(gitDir.uri, 'rebase-merge', 'git-rebase-todo');
		void executeCoreCommand('vscode.openWith', rebaseTodoUri, 'gitlens.rebase', {
			preview: false,
		});
	}

	@log()
	private async skipPausedOperation(_item?: GraphItemContext) {
		if (this.repository == null) return;

		await skipPausedOperation(this.repository.git);
	}

	@log()
	private copyDeepLinkToBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToBranch', { refOrRepoPath: ref });
		}

		return Promise.resolve();
	}

	@log()
	private copyDeepLinkToCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToCommit', { refOrRepoPath: ref });
	}

	@log()
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

	@log()
	private copyDeepLinkToTag(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'tag')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToTag', { refOrRepoPath: ref });
		}

		return Promise.resolve();
	}

	@log()
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

	@log()
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

	@log()
	private resetToCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return RepoActions.reset(ref.repoPath, ref);
	}

	@log()
	private resetToTip(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'branch');
		if (ref == null) return Promise.resolve();

		return RepoActions.reset(
			ref.repoPath,
			createReference(ref.ref, ref.repoPath, { refType: 'revision', name: ref.name }),
		);
	}

	@log()
	private revertCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return RepoActions.revert(ref.repoPath, ref);
	}

	@log()
	private switchTo(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return RepoActions.switchTo(ref.repoPath, ref);
	}

	@log()
	private resetToTag(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'tag');
		if (ref == null) return Promise.resolve();
		return RepoActions.reset(ref.repoPath, ref);
	}

	@log()
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

	@log()
	private switchToAnother(item?: GraphItemContext | unknown) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return RepoActions.switchTo(this.repository?.path);

		return RepoActions.switchTo(ref.repoPath);
	}

	@log()
	private async undoCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		await undoCommit(this.container, ref);
	}

	@log()
	private saveStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return StashActions.push(ref.repoPath);
	}

	@log()
	private applyStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return StashActions.apply(ref.repoPath, ref);
	}

	@log()
	private deleteStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return StashActions.drop(ref.repoPath, [ref]);
	}

	@log()
	private renameStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return StashActions.rename(ref.repoPath, ref);
	}

	@log()
	private async createTag(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return TagActions.create(ref.repoPath, ref);
	}

	@log()
	private deleteTag(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'tag')) {
			const { ref } = item.webviewItemValue;
			return TagActions.remove(ref.repoPath, ref);
		}

		return Promise.resolve();
	}

	@log()
	private async createWorktree(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return WorktreeActions.create(ref.repoPath, undefined, ref);
	}

	@log()
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

	@log()
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
			});
		}

		return Promise.resolve();
	}

	@log()
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

	@log()
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

	@log()
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

	@log()
	private openIssueOnRemote(item?: GraphItemContext) {
		if (isGraphItemTypedContext(item, 'issue')) {
			const { url } = item.webviewItemValue;
			// TODO: Add a command for this. See openPullRequestOnRemote above.
			void openUrl(url);
		}

		return Promise.resolve();
	}

	@log()
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

	@log()
	private async compareHeadWith(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		const [ref1, ref2] = await getOrderedComparisonRefs(this.container, ref.repoPath, 'HEAD', ref.ref);
		return this.container.views.searchAndCompare.compare(ref.repoPath, ref1, ref2);
	}

	@log()
	private compareBranchWithHead(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return this.container.views.searchAndCompare.compare(ref.repoPath, ref.ref, 'HEAD');
	}

	@log()
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

	@log()
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

	@log()
	private compareWithUpstream(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			if (ref.upstream != null) {
				return this.container.views.searchAndCompare.compare(ref.repoPath, ref.ref, ref.upstream.name);
			}
		}

		return Promise.resolve();
	}

	@log()
	private compareWorkingWith(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return this.container.views.searchAndCompare.compare(ref.repoPath, '', ref.ref);
	}

	@log()
	private copyWorkingChangesToWorktree(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return WorktreeActions.copyChangesToWorktree('working-tree', ref.repoPath);
	}

	@log()
	private generateCommitMessage(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return executeCommand<GenerateCommitMessageCommandArgs>('gitlens.ai.generateCommitMessage', {
			repoPath: ref.repoPath,
			source: 'graph',
		});
	}

	@log()
	private explainBranch(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'branch');
		if (ref == null) return Promise.resolve();

		return executeCommand<ExplainBranchCommandArgs>('gitlens.ai.explainBranch', {
			repoPath: ref.repoPath,
			ref: ref.ref,
			source: { source: 'graph', type: 'branch' },
		});
	}
	@log()
	private explainCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return executeCommand<ExplainCommitCommandArgs>('gitlens.ai.explainCommit', {
			repoPath: ref.repoPath,
			rev: ref.ref,
			source: { source: 'graph', type: 'commit' },
		});
	}

	@log()
	private explainStash(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return executeCommand<ExplainStashCommandArgs>('gitlens.ai.explainStash', {
			repoPath: ref.repoPath,
			rev: ref.ref,
			source: { source: 'graph', type: 'stash' },
		});
	}

	@log()
	private explainWip(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return executeCommand<ExplainWipCommandArgs>('gitlens.ai.explainWip', {
			repoPath: ref.repoPath,
			source: { source: 'graph', type: 'wip' },
		});
	}

	@log()
	private async openFiles(item?: GraphItemContext) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openFiles(commit);
	}

	@log()
	private async openAllChanges(item?: GraphItemContext, individually?: boolean) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openCommitChanges(this.container, commit, individually);
	}

	@log()
	private async openAllChangesWithWorking(item?: GraphItemContext, individually?: boolean) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openCommitChangesWithWorking(this.container, commit, individually);
	}

	@log()
	private async openRevisions(item?: GraphItemContext) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openFilesAtRevision(commit);
	}

	@log()
	private async openOnlyChangedFiles(item?: GraphItemContext) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		return openOnlyChangedFiles(this.container, commit);
	}

	@log()
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

	@log()
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

	@log()
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

	@log()
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

	@log()
	private async toggleScrollMarker(type: GraphScrollMarkersAdditionalTypes, enabled: boolean) {
		let scrollMarkers = configuration.get('graph.scrollMarkers.additionalTypes');
		let updated = false;
		if (enabled && !scrollMarkers.includes(type)) {
			scrollMarkers = scrollMarkers.concat(type);
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

	@log()
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

	@log()
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

	@log()
	private async generateCommits(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'revision')) {
			const { ref } = item.webviewItemValue;

			await executeCommand<GenerateCommitsCommandArgs>('gitlens.ai.generateCommits', {
				repoPath: ref.repoPath,
				source: { source: 'graph' },
			});
		}
		return Promise.resolve();
	}

	@log()
	private async composeCommits(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'revision')) {
			const { ref } = item.webviewItemValue;

			await executeCommand<ComposeCommandArgs>('gitlens.ai.composeCommits', {
				repoPath: ref.repoPath,
				source: 'graph',
			});
		}
		return Promise.resolve();
	}

	@log()
	private async rebaseOntoCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		await executeCommand<GenerateRebaseCommandArgs>('gitlens.ai.generateRebase', {
			repoPath: ref.repoPath,
			base: ref,
			head: createReference('HEAD', ref.repoPath, { refType: 'revision', name: 'HEAD' }),
			source: { source: 'graph' },
		});
	}

	@log()
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
