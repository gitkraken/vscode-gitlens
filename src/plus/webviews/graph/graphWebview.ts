import type { ColorTheme, ConfigurationChangeEvent, Uri } from 'vscode';
import { CancellationTokenSource, Disposable, env, window } from 'vscode';
import type { CreatePullRequestActionContext, OpenPullRequestActionContext } from '../../../api/gitlens';
import { getAvatarUri } from '../../../avatars';
import { parseCommandContext } from '../../../commands/base';
import type { CopyDeepLinkCommandArgs } from '../../../commands/copyDeepLink';
import type { CopyMessageToClipboardCommandArgs } from '../../../commands/copyMessageToClipboard';
import type { CopyShaToClipboardCommandArgs } from '../../../commands/copyShaToClipboard';
import type { OpenOnRemoteCommandArgs } from '../../../commands/openOnRemote';
import type { OpenPullRequestOnRemoteCommandArgs } from '../../../commands/openPullRequestOnRemote';
import type { CreatePatchCommandArgs } from '../../../commands/patches';
import type { ShowCommitsInViewCommandArgs } from '../../../commands/showCommitsInView';
import type { Config, GraphMinimapMarkersAdditionalTypes, GraphScrollMarkersAdditionalTypes } from '../../../config';
import type { StoredGraphFilters, StoredGraphIncludeOnlyRef, StoredGraphRefType } from '../../../constants';
import { Commands, GlyphChars } from '../../../constants';
import type { Container } from '../../../container';
import { CancellationError } from '../../../errors';
import type { CommitSelectedEvent } from '../../../eventBus';
import { PlusFeatures } from '../../../features';
import * as BranchActions from '../../../git/actions/branch';
import {
	openAllChanges,
	openAllChangesIndividually,
	openAllChangesWithWorking,
	openAllChangesWithWorkingIndividually,
	openComparisonChanges,
	openFiles,
	openFilesAtRevision,
	openOnlyChangedFiles,
	showGraphDetailsView,
	undoCommit,
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
import type { GitGraph, GitGraphRowType } from '../../../git/models/graph';
import { getComparisonRefsForPullRequest } from '../../../git/models/pullRequest';
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
import { executeActionCommand, executeCommand, executeCoreCommand, registerCommand } from '../../../system/command';
import { configuration } from '../../../system/configuration';
import { getContext, onDidChangeContext } from '../../../system/context';
import { gate } from '../../../system/decorators/gate';
import { debug, log } from '../../../system/decorators/log';
import type { Deferrable } from '../../../system/function';
import { debounce, disposableInterval } from '../../../system/function';
import { find, last, map } from '../../../system/iterable';
import { updateRecordValue } from '../../../system/object';
import { getSettledValue } from '../../../system/promise';
import { isDarkTheme, isLightTheme } from '../../../system/utils';
import { isWebviewItemContext, isWebviewItemGroupContext, serializeWebviewItemContext } from '../../../system/webview';
import { RepositoryFolderNode } from '../../../views/nodes/abstract/repositoryFolderNode';
import type { IpcCallMessageType, IpcMessage, IpcNotification } from '../../../webviews/protocol';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../../../webviews/webviewProvider';
import type { WebviewPanelShowCommandArgs, WebviewShowOptions } from '../../../webviews/webviewsController';
import { isSerializedState } from '../../../webviews/webviewsController';
import type { SubscriptionChangeEvent } from '../../gk/account/subscriptionService';
import type {
	BranchState,
	DidSearchParams,
	DoubleClickedParams,
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
	UpdateDimMergeCommitsParams,
	UpdateExcludeTypeParams,
	UpdateGraphConfigurationParams,
	UpdateRefsVisibilityParams,
	UpdateSelectionParams,
} from './protocol';
import {
	ChooseRepositoryCommand,
	DidChangeAvatarsNotification,
	DidChangeColumnsNotification,
	DidChangeGraphConfigurationNotification,
	DidChangeNotification,
	DidChangeRefsMetadataNotification,
	DidChangeRefsVisibilityNotification,
	DidChangeRowsNotification,
	DidChangeRowsStatsNotification,
	DidChangeScrollMarkersNotification,
	DidChangeSelectionNotification,
	DidChangeSubscriptionNotification,
	DidChangeWorkingTreeNotification,
	DidFetchNotification,
	DidSearchNotification,
	DoubleClickedCommandType,
	EnsureRowRequest,
	GetMissingAvatarsCommand,
	GetMissingRefsMetadataCommand,
	GetMoreRowsCommand,
	SearchOpenInViewCommand,
	SearchRequest,
	supportedRefMetadataTypes,
	UpdateColumnsCommand,
	UpdateDimMergeCommitsCommand,
	UpdateExcludeTypeCommand,
	UpdateGraphConfigurationCommand,
	UpdateIncludeOnlyRefsCommand,
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

	private _discovering: Promise<number | undefined> | undefined;
	private readonly _disposable: Disposable;
	private _etag?: number;
	private _etagSubscription?: number;
	private _etagRepository?: number;
	private _firstSelection = true;
	private _graph?: GitGraph;
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

	private isWindowFocused: boolean = true;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost,
	) {
		this._showDetailsView = configuration.get('graph.showDetailsView');
		this._theme = window.activeColorTheme;
		this.ensureRepositorySubscriptions();

		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
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
		);
	}

	dispose() {
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

	async onShowing(
		loading: boolean,
		_options?: WebviewShowOptions,
		...args: WebviewShowingArgs<GraphWebviewShowingArgs, State>
	): Promise<boolean> {
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
		const commands: Disposable[] = [];

		if (this.host.isHost('view')) {
			commands.push(
				registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true)),
				registerCommand(
					`${this.host.id}.openInTab`,
					() =>
						void executeCommand<WebviewPanelShowCommandArgs>(
							Commands.ShowGraphPage,
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
			this.host.registerWebviewCommand('gitlens.graph.publishBranch', this.publishBranch),
			this.host.registerWebviewCommand('gitlens.graph.switchToAnotherBranch', this.switchToAnother),

			this.host.registerWebviewCommand('gitlens.graph.createBranch', this.createBranch),
			this.host.registerWebviewCommand('gitlens.graph.deleteBranch', this.deleteBranch),
			this.host.registerWebviewCommand<GraphItemContext>('gitlens.graph.copyRemoteBranchUrl', item =>
				this.openBranchOnRemote(item, true),
			),
			this.host.registerWebviewCommand('gitlens.graph.openBranchOnRemote', this.openBranchOnRemote),
			this.host.registerWebviewCommand('gitlens.graph.mergeBranchInto', this.mergeBranchInto),
			this.host.registerWebviewCommand('gitlens.graph.rebaseOntoBranch', this.rebase),
			this.host.registerWebviewCommand('gitlens.graph.rebaseOntoUpstream', this.rebaseToRemote),
			this.host.registerWebviewCommand('gitlens.graph.renameBranch', this.renameBranch),

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
			this.host.registerWebviewCommand<GraphItemContext>('gitlens.graph.copyRemoteCommitUrl', item =>
				this.openCommitOnRemote(item, true),
			),
			this.host.registerWebviewCommand<GraphItemContext>('gitlens.graph.copyRemoteCommitUrl.multi', item =>
				this.openCommitOnRemote(item, true),
			),
			this.host.registerWebviewCommand('gitlens.graph.openCommitOnRemote', this.openCommitOnRemote),
			this.host.registerWebviewCommand('gitlens.graph.openCommitOnRemote.multi', this.openCommitOnRemote),
			this.host.registerWebviewCommand('gitlens.graph.openSCM', this.openSCM),
			this.host.registerWebviewCommand('gitlens.graph.rebaseOntoCommit', this.rebase),
			this.host.registerWebviewCommand('gitlens.graph.resetCommit', this.resetCommit),
			this.host.registerWebviewCommand('gitlens.graph.resetToCommit', this.resetToCommit),
			this.host.registerWebviewCommand('gitlens.graph.resetToTip', this.resetToTip),
			this.host.registerWebviewCommand('gitlens.graph.revert', this.revertCommit),
			this.host.registerWebviewCommand('gitlens.graph.showInDetailsView', this.openInDetailsView),
			this.host.registerWebviewCommand('gitlens.graph.switchToCommit', this.switchTo),
			this.host.registerWebviewCommand('gitlens.graph.undoCommit', this.undoCommit),

			this.host.registerWebviewCommand('gitlens.graph.stash.save', this.saveStash),
			this.host.registerWebviewCommand('gitlens.graph.stash.apply', this.applyStash),
			this.host.registerWebviewCommand('gitlens.graph.stash.delete', this.deleteStash),
			this.host.registerWebviewCommand('gitlens.graph.stash.rename', this.renameStash),

			this.host.registerWebviewCommand('gitlens.graph.createTag', this.createTag),
			this.host.registerWebviewCommand('gitlens.graph.deleteTag', this.deleteTag),
			this.host.registerWebviewCommand('gitlens.graph.switchToTag', this.switchTo),

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

			this.host.registerWebviewCommand('gitlens.graph.copyDeepLinkToBranch', this.copyDeepLinkToBranch),
			this.host.registerWebviewCommand('gitlens.graph.copyDeepLinkToCommit', this.copyDeepLinkToCommit),
			this.host.registerWebviewCommand('gitlens.graph.copyDeepLinkToRepo', this.copyDeepLinkToRepo),
			this.host.registerWebviewCommand('gitlens.graph.copyDeepLinkToTag', this.copyDeepLinkToTag),
			this.host.registerWebviewCommand('gitlens.graph.shareAsCloudPatch', this.shareAsCloudPatch),

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

			this.host.registerWebviewCommand(
				'gitlens.graph.copyWorkingChangesToWorktree',
				this.copyWorkingChangesToWorktree,
			),
		);

		return commands;
	}

	onWindowFocusChanged(focused: boolean): void {
		this.isWindowFocused = focused;
	}

	onFocusChanged(focused: boolean): void {
		this._showActiveSelectionDetailsDebounced?.cancel();

		if (!focused || this.activeSelection == null || !this.container.commitDetailsView.visible) {
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

	onMessageReceived(e: IpcMessage) {
		switch (true) {
			case ChooseRepositoryCommand.is(e):
				void this.onChooseRepository();
				break;
			case UpdateDimMergeCommitsCommand.is(e):
				this.dimMergeCommits(e.params);
				break;
			case DoubleClickedCommandType.is(e):
				void this.onDoubleClick(e.params);
				break;
			case EnsureRowRequest.is(e):
				void this.onEnsureRowRequest(EnsureRowRequest, e);
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
			case UpdateRefsVisibilityCommand.is(e):
				this.onRefsVisibilityChanged(e.params);
				break;
			case UpdateSelectionCommand.is(e):
				this.onSelectionChanged(e.params);
				break;
			case UpdateExcludeTypeCommand.is(e):
				this.updateExcludedType(this._graph, e.params);
				break;
			case UpdateIncludeOnlyRefsCommand.is(e):
				this.updateIncludeOnlyRefs(this._graph, e.params.refs);
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
		if (
			this._theme != null &&
			((isDarkTheme(theme) && isDarkTheme(this._theme)) || (isLightTheme(theme) && isLightTheme(this._theme)))
		) {
			return;
		}

		this._theme = theme;
		this.updateState();
	}

	private dimMergeCommits(e: UpdateDimMergeCommitsParams) {
		void configuration.updateEffective('graph.dimMergeCommits', e.dim);
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

				const details = this.host.isHost('editor')
					? this.container.commitDetailsView
					: this.container.graphDetailsView;
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
	private async onEnsureRowRequest<T extends typeof EnsureRowRequest>(requestType: T, msg: IpcCallMessageType<T>) {
		if (this._graph == null) return;

		const e = msg.params;
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

		void this.host.respond(requestType, msg, { id: id, remapped: remapped });
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

				if (type === 'pullRequest') {
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
					continue;
				}

				if (type === 'upstream') {
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
	private async onSearchRequest<T extends typeof SearchRequest>(requestType: T, msg: IpcCallMessageType<T>) {
		try {
			const results = await this.getSearchResults(msg.params);
			void this.host.respond(requestType, msg, results);
		} catch (ex) {
			void this.host.respond(requestType, msg, {
				results:
					ex instanceof CancellationError
						? undefined
						: { error: ex instanceof GitSearchError ? 'Invalid search pattern' : 'Unexpected error' },
			});
		}
	}

	private async getSearchResults(e: SearchParams): Promise<DidSearchParams> {
		if (e.search == null) {
			this.resetSearchState();
			return { results: undefined };
		}

		let search: GitSearch | undefined = this._search;

		if (e.more && search?.more != null && search.comparisonKey === getSearchQueryComparisonKey(e.search)) {
			search = await search.more(e.limit ?? configuration.get('graph.searchItemLimit') ?? 100);
			if (search != null) {
				this._search = search;
				void (await this.ensureSearchStartsInRange(this._graph!, search));

				return {
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
				};
			}

			return { results: undefined };
		}

		if (search == null || search.comparisonKey !== getSearchQueryComparisonKey(e.search)) {
			if (this.repository == null) return { results: { error: 'No repository' } };

			if (this.repository.etag !== this._etagRepository) {
				this.updateState(true);
			}

			if (this._searchCancellation != null) {
				this._searchCancellation.cancel();
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
				throw ex;
				// return {
				// 	results: {
				// 		error: ex instanceof GitSearchError ? 'Invalid search pattern' : 'Unexpected error',
				// 	},
				// };
			}

			if (cancellation.token.isCancellationRequested) {
				throw new CancellationError();
				// return { results: undefined };
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

		return {
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
		};
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

		this.repository = pick;
	}

	private _fireSelectionChangedDebounced: Deferrable<GraphWebviewProvider['fireSelectionChanged']> | undefined =
		undefined;

	private onSelectionChanged(e: UpdateSelectionParams) {
		this._showActiveSelectionDetailsDebounced?.cancel();

		const item = e.selection[0];
		this.setSelectedRows(item?.id);

		if (this._fireSelectionChangedDebounced == null) {
			this._fireSelectionChangedDebounced = debounce(this.fireSelectionChanged.bind(this), 50);
		}

		this._fireSelectionChangedDebounced(item?.id, item?.type);
	}

	private fireSelectionChanged(id: string | undefined, type: GitGraphRowType | undefined) {
		if (this.repository == null) return;

		const commit = this.getRevisionReference(this.repository.path, id, type);
		const commits = commit != null ? [commit] : undefined;

		this._selection = commits;

		if (commits == null) return;
		if (!this._firstSelection && this.host.isHost('editor') && !this.host.active) return;

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

		if (this._notifyDidChangeStateDebounced == null) {
			this._notifyDidChangeStateDebounced = debounce(this.notifyDidChangeState.bind(this), 250);
		}

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
	private async notifyDidChangeRefsVisibility() {
		if (!this.host.ready || !this.host.visible) {
			this.host.addPendingIpcNotification(DidChangeRefsVisibilityNotification, this._ipcNotificationMap, this);
			return false;
		}

		return this.host.notify(DidChangeRefsVisibilityNotification, {
			excludeRefs: this.getExcludedRefs(this._graph),
			excludeTypes: this.getExcludedTypes(this._graph),
			includeOnlyRefs: this.getIncludeOnlyRefs(this._graph),
		});
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
			allowed: access.allowed !== false,
		});
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

	private getComponentConfig(): GraphComponentConfig {
		const config: GraphComponentConfig = {
			avatars: configuration.get('graph.avatars'),
			dateFormat:
				configuration.get('graph.dateFormat') ?? configuration.get('defaultDateFormat') ?? 'short+short',
			dateStyle: configuration.get('graph.dateStyle') ?? configuration.get('defaultDateStyle'),
			enabledRefMetadataTypes: this.getEnabledRefMetadataTypes(),
			dimMergeCommits: configuration.get('graph.dimMergeCommits'),
			enableMultiSelection: true,
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
			types.push('pullRequest');
		}

		if (configuration.get('graph.showUpstreamStatus')) {
			types.push('upstream');
		}

		return types;
	}

	private async getGraphAccess() {
		let access = await this.container.git.access(PlusFeatures.Graph, this.repository?.path);
		this._etagSubscription = this.container.subscription.etag;

		// If we don't have access, but the preview trial hasn't been started, auto-start it
		if (access.allowed === false && access.subscription.current.previewTrial == null) {
			// await this.container.subscription.startPreviewTrial();
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
					ref: this.getRevisionReference(this.repository.path, uncommitted, 'work-dir-changes')!,
				},
			}),
		};
	}

	private async getState(deferRows?: boolean): Promise<State> {
		if (this.container.git.repositoryCount === 0) {
			return { ...this.host.baseWebviewState, allowed: true, repositories: [] };
		}

		if (this.repository == null) {
			this.repository = this.container.git.getBestRepositoryOrFirst();
			if (this.repository == null) {
				return { ...this.host.baseWebviewState, allowed: true, repositories: [] };
			}
		}

		this._etagRepository = this.repository?.etag;
		this.host.title = `${this.host.originalTitle}: ${this.repository.formattedName}`;

		const { defaultItemLimit } = configuration.get('graph');

		// If we have a set of data refresh to the same set
		const limit = Math.max(defaultItemLimit, this._graph?.ids.size ?? defaultItemLimit);

		const selectedId = this._selectedId;
		const ref = selectedId == null || selectedId === uncommitted ? 'HEAD' : selectedId;

		const columns = this.getColumns();
		const columnSettings = this.getColumnSettings(columns);

		const dataPromise = this.container.git.getCommitsForGraph(
			this.repository.uri,
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

		// Check for access and working tree stats
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
				if (selectedId !== uncommitted) {
					this.setSelectedRows(data.id);
				}

				void this.notifyDidChangeRefsVisibility();
				void this.notifyDidChangeRows(true);
			});
		} else {
			data = await dataPromise;
			this.setGraph(data);
			if (selectedId !== uncommitted) {
				this.setSelectedRows(data.id);
			}
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
			...this.host.baseWebviewState,
			windowFocused: this.isWindowFocused,
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
				settings: this.getGraphSettingsIconContext(columnSettings),
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
			id = 'work-dir-changes' satisfies GitGraphRowType;
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
				queueMicrotask(async () => {
					try {
						const results = await this.getSearchResults({ search: search.query, more: true });
						void this.host.notify(DidSearchNotification, results);
					} catch (ex) {
						if (ex instanceof CancellationError) return;

						void this.host.notify(DidSearchNotification, {
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
	private pull(item?: GraphItemContext) {
		const ref = item != null ? this.getGraphItemRef(item, 'branch') : undefined;
		void RepoActions.pull(this.repository, ref);
	}

	@log()
	private push(item?: GraphItemContext) {
		const ref = item != null ? this.getGraphItemRef(item) : undefined;
		void RepoActions.push(this.repository, undefined, ref);
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

			return executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
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
	private cherryPick(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return RepoActions.cherryPick(ref.repoPath, ref);
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

		return executeCommand<CopyMessageToClipboardCommandArgs>(Commands.CopyMessageToClipboard, {
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
			sha = await this.container.git.resolveReference(ref.repoPath, sha, undefined, { force: true });
		}

		return executeCommand<CopyShaToClipboardCommandArgs>(Commands.CopyShaToClipboard, {
			sha: sha,
		});
	}

	@log()
	private openInDetailsView(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		if (this.host.isHost('view')) {
			return void showGraphDetailsView(ref, { preserveFocus: true, preserveVisibility: false });
		}

		return executeCommand<ShowCommitsInViewCommandArgs>(Commands.ShowInDetailsView, {
			repoPath: ref.repoPath,
			refs: [ref.ref],
		});
	}

	@log()
	private openSCM(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return executeCoreCommand('workbench.view.scm');
	}

	@log()
	private openCommitOnRemote(item?: GraphItemContext, clipboard?: boolean) {
		const { selection } = this.getGraphItemRefs(item, 'revision');
		if (selection == null) return Promise.resolve();

		return executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
			repoPath: selection[0].repoPath,
			resource: selection.map(r => ({ type: RemoteResourceType.Commit, sha: r.ref })),
			clipboard: clipboard,
		});
	}

	@log()
	private copyDeepLinkToBranch(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'branch')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<CopyDeepLinkCommandArgs>(Commands.CopyDeepLinkToBranch, { refOrRepoPath: ref });
		}

		return Promise.resolve();
	}

	@log()
	private copyDeepLinkToCommit(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision');
		if (ref == null) return Promise.resolve();

		return executeCommand<CopyDeepLinkCommandArgs>(Commands.CopyDeepLinkToCommit, { refOrRepoPath: ref });
	}

	@log()
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

	@log()
	private copyDeepLinkToTag(item?: GraphItemContext) {
		if (isGraphItemRefContext(item, 'tag')) {
			const { ref } = item.webviewItemValue;
			return executeCommand<CopyDeepLinkCommandArgs>(Commands.CopyDeepLinkToTag, { refOrRepoPath: ref });
		}

		return Promise.resolve();
	}

	@log()
	private async shareAsCloudPatch(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item, 'revision') ?? this.getGraphItemRef(item, 'stash');
		if (ref == null) return Promise.resolve();

		return executeCommand<CreatePatchCommandArgs>(Commands.CreateCloudPatch, {
			to: ref.ref,
			repoPath: ref.repoPath,
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
	private async openPullRequestChanges(item?: GraphItemContext) {
		if (isGraphItemTypedContext(item, 'pullrequest')) {
			const pr = item.webviewItemValue;
			if (pr.refs?.base != null && pr.refs.head != null) {
				const refs = await getComparisonRefsForPullRequest(this.container, pr.repoPath, pr.refs);
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
	private async openPullRequestComparison(item?: GraphItemContext) {
		if (isGraphItemTypedContext(item, 'pullrequest')) {
			const pr = item.webviewItemValue;
			if (pr.refs?.base != null && pr.refs.head != null) {
				const refs = await getComparisonRefsForPullRequest(this.container, pr.repoPath, pr.refs);
				return this.container.searchAndCompareView.compare(refs.repoPath, refs.head, refs.base);
			}
		}

		return Promise.resolve();
	}

	@log()
	private openPullRequestOnRemote(item?: GraphItemContext, clipboard?: boolean) {
		if (isGraphItemTypedContext(item, 'pullrequest')) {
			const { url } = item.webviewItemValue;
			return executeCommand<OpenPullRequestOnRemoteCommandArgs>(Commands.OpenPullRequestOnRemote, {
				pr: { url: url },
				clipboard: clipboard,
			});
		}

		return Promise.resolve();
	}

	@log()
	private async compareAncestryWithWorking(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		const branch = await this.container.git.getBranch(ref.repoPath);
		if (branch == null) return undefined;

		const commonAncestor = await this.container.git.getMergeBase(ref.repoPath, branch.ref, ref.ref);
		if (commonAncestor == null) return undefined;

		return this.container.searchAndCompareView.compare(ref.repoPath, '', {
			ref: commonAncestor,
			label: `${branch.ref} (${shortenRevision(commonAncestor)})`,
		});
	}

	@log()
	private compareHeadWith(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return this.container.searchAndCompareView.compare(ref.repoPath, 'HEAD', ref.ref);
	}

	@log()
	private async compareWithMergeBase(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		const branch = await this.container.git.getBranch(ref.repoPath);
		if (branch == null) return undefined;

		const commonAncestor = await this.container.git.getMergeBase(ref.repoPath, branch.ref, ref.ref);
		if (commonAncestor == null) return undefined;

		return this.container.searchAndCompareView.compare(ref.repoPath, ref.ref, {
			ref: commonAncestor,
			label: `${branch.ref} (${shortenRevision(commonAncestor)})`,
		});
	}

	@log()
	private async openChangedFileDiffsWithMergeBase(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		const branch = await this.container.git.getBranch(ref.repoPath);
		if (branch == null) return undefined;

		const commonAncestor = await this.container.git.getMergeBase(ref.repoPath, branch.ref, ref.ref);
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
				return this.container.searchAndCompareView.compare(ref.repoPath, ref.ref, ref.upstream.name);
			}
		}

		return Promise.resolve();
	}

	@log()
	private compareWorkingWith(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return this.container.searchAndCompareView.compare(ref.repoPath, '', ref.ref);
	}

	private copyWorkingChangesToWorktree(item?: GraphItemContext) {
		const ref = this.getGraphItemRef(item);
		if (ref == null) return Promise.resolve();

		return WorktreeActions.copyChangesToWorktree('working-tree', ref.repoPath);
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

		if (individually) {
			return openAllChangesIndividually(commit);
		}
		return openAllChanges(commit);
	}

	@log()
	private async openAllChangesWithWorking(item?: GraphItemContext, individually?: boolean) {
		const commit = await this.getCommitFromGraphItemRef(item);
		if (commit == null) return;

		if (individually) {
			return openAllChangesWithWorkingIndividually(commit);
		}
		return openAllChangesWithWorking(commit);
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

		return openOnlyChangedFiles(commit);
	}

	@log()
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
				if (!isGraphItemRefContext(item, 'branch') && !isGraphItemTypedContext(item, 'upstreamStatus'))
					return { active: undefined, selection: [] };
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
}

type GraphItemRefs<T> = {
	active: T | undefined;
	selection: T[];
};

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
