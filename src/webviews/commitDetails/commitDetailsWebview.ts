import type { CancellationToken, ConfigurationChangeEvent, TextDocumentShowOptions, ViewColumn } from 'vscode';
import { CancellationTokenSource, Disposable, Uri, window } from 'vscode';
import type { MaybeEnrichedAutolink } from '../../annotations/autolinks';
import { serializeAutolink } from '../../annotations/autolinks';
import type { CopyShaToClipboardCommandArgs } from '../../commands/copyShaToClipboard';
import type { CoreConfiguration } from '../../constants';
import { Commands } from '../../constants';
import type { Container } from '../../container';
import type { CommitSelectedEvent } from '../../eventBus';
import { executeGitCommand } from '../../git/actions';
import {
	openChanges,
	openChangesWithWorking,
	openFile,
	openFileOnRemote,
	showDetailsQuickPick,
} from '../../git/actions/commit';
import { CommitFormatter } from '../../git/formatters/commitFormatter';
import type { GitCommit } from '../../git/models/commit';
import { isCommit } from '../../git/models/commit';
import { uncommitted } from '../../git/models/constants';
import type { GitFileChange, GitFileChangeShape } from '../../git/models/file';
import type { IssueOrPullRequest } from '../../git/models/issue';
import { serializeIssueOrPullRequest } from '../../git/models/issue';
import type { PullRequest } from '../../git/models/pullRequest';
import { serializePullRequest } from '../../git/models/pullRequest';
import type { GitRevisionReference } from '../../git/models/reference';
import { createReference, getReferenceFromRevision, shortenRevision } from '../../git/models/reference';
import type { GitRemote } from '../../git/models/remote';
import type { Repository } from '../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../git/models/repository';
import type { ShowInCommitGraphCommandArgs } from '../../plus/webviews/graph/protocol';
import { pauseOnCancelOrTimeoutMapTuplePromise } from '../../system/cancellation';
import { executeCommand, executeCoreCommand, registerCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import { getContext } from '../../system/context';
import { debug } from '../../system/decorators/log';
import type { Deferrable } from '../../system/function';
import { debounce } from '../../system/function';
import { filterMap, map } from '../../system/iterable';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import { MRU } from '../../system/mru';
import { getSettledValue } from '../../system/promise';
import type { Serialized } from '../../system/serialize';
import { serialize } from '../../system/serialize';
import type { LinesChangeEvent } from '../../trackers/lineTracker';
import type { IpcMessage } from '../protocol';
import { onIpc } from '../protocol';
import type { WebviewController, WebviewProvider } from '../webviewController';
import { updatePendingContext } from '../webviewController';
import { isSerializedState } from '../webviewsController';
import type {
	CommitDetails,
	DidExplainParams,
	FileActionParams,
	Mode,
	Preferences,
	State,
	SwitchModeParams,
	UpdateablePreferences,
	Wip,
	WipChange,
} from './protocol';
import {
	AutolinkSettingsCommandType,
	CommitActionsCommandType,
	DidChangeNotificationType,
	DidChangeWipStateNotificationType,
	DidExplainCommandType,
	ExplainCommandType,
	FileActionsCommandType,
	messageHeadlineSplitterToken,
	NavigateCommitCommandType,
	OpenFileCommandType,
	OpenFileComparePreviousCommandType,
	OpenFileCompareWorkingCommandType,
	OpenFileOnRemoteCommandType,
	PickCommitCommandType,
	PinCommitCommandType,
	SearchCommitCommandType,
	StageFileCommandType,
	SwitchModeCommandType,
	UnstageFileCommandType,
	UpdatePreferencesCommandType,
} from './protocol';

type RepositorySubscription = { repo: Repository; subscription: Disposable };

interface Context {
	mode: Mode;
	navigationStack: {
		count: number;
		position: number;
		hint?: string;
	};
	pinned: boolean;
	preferences: Preferences;
	visible: boolean;

	commit: GitCommit | undefined;
	richStateLoaded: boolean;
	formattedMessage: string | undefined;
	autolinkedIssues: IssueOrPullRequest[] | undefined;
	pullRequest: PullRequest | undefined;
	wip: Wip | undefined;
}

export class CommitDetailsWebviewProvider implements WebviewProvider<State, Serialized<State>> {
	private _bootstraping = true;
	/** The context the webview has */
	private _context: Context;
	/** The context the webview should have */
	private _pendingContext: Partial<Context> | undefined;
	private readonly _disposable: Disposable;
	private _pinned = false;
	private _focused = false;
	private _commitStack = new MRU<GitRevisionReference>(10, (a, b) => a.ref === b.ref);

	constructor(
		private readonly container: Container,
		private readonly host: WebviewController<State, Serialized<State>>,
		private readonly options: { attachedTo: 'default' | 'graph' },
	) {
		this._context = {
			mode: 'commit',
			navigationStack: {
				count: 0,
				position: 0,
			},
			pinned: false,
			preferences: {
				autolinksExpanded: this.container.storage.getWorkspace('views:commitDetails:autolinksExpanded') ?? true,
				avatars: configuration.get('views.commitDetails.avatars'),
				dateFormat: configuration.get('defaultDateFormat') ?? 'MMMM Do, YYYY h:mma',
				files: configuration.get('views.commitDetails.files'),
				// indent: configuration.getAny('workbench.tree.indent') ?? 8,
				indentGuides:
					configuration.getAny<CoreConfiguration, Preferences['indentGuides']>(
						'workbench.tree.renderIndentGuides',
					) ?? 'onHover',
			},
			visible: false,

			commit: undefined,
			richStateLoaded: false,
			formattedMessage: undefined,
			autolinkedIssues: undefined,
			pullRequest: undefined,
			wip: undefined,
		};

		this._disposable = configuration.onDidChangeAny(this.onAnyConfigurationChanged, this);
	}

	dispose() {
		this._disposable.dispose();
		this._commitTrackerDisposable?.dispose();
		this._lineTrackerDisposable?.dispose();
		this._repositorySubscription?.subscription.dispose();
		this._wipSubscription?.subscription.dispose();
	}

	onReloaded(): void {
		void this.notifyDidChangeState(true);
	}

	private _skipNextRefreshOnVisibilityChange = false;

	async onShowing(
		_loading: boolean,
		options: { column?: ViewColumn; preserveFocus?: boolean },
		...args: [Partial<CommitSelectedEvent['data']> | { state: Partial<Serialized<State>> }] | unknown[]
	): Promise<boolean> {
		let data: Partial<CommitSelectedEvent['data']> | undefined;

		const [arg] = args;
		if (isSerializedState<Serialized<State>>(arg)) {
			const { commit: selected } = arg.state;
			if (selected?.repoPath != null && selected?.sha != null) {
				if (selected.stashNumber != null) {
					data = {
						commit: createReference(selected.sha, selected.repoPath, {
							refType: 'stash',
							name: selected.message,
							number: selected.stashNumber,
						}),
					};
				} else {
					data = {
						commit: createReference(selected.sha, selected.repoPath, {
							refType: 'revision',
							message: selected.message,
						}),
					};
				}
			}
		} else if (arg != null && typeof arg === 'object') {
			data = arg as Partial<CommitSelectedEvent['data']> | undefined;
		} else {
			data = undefined;
		}

		let commit;
		if (data != null) {
			if (data.preserveFocus) {
				options.preserveFocus = true;
			}
			({ commit, ...data } = data);
		}

		if (commit != null && this.mode === 'wip' && data?.interaction !== 'passive') {
			this.setMode('commit');
		}

		if (commit == null) {
			if (!this._pinned) {
				commit = this.getBestCommitOrStash();
			}
		}

		if (commit != null && !this._context.commit?.ref.startsWith(commit.ref)) {
			await this.updateCommit(commit, { pinned: false });
		}

		if (data?.preserveVisibility && !this.host.visible) return false;

		this._skipNextRefreshOnVisibilityChange = true;
		return true;
	}

	includeBootstrap(): Promise<Serialized<State>> {
		this._bootstraping = true;

		this._context = { ...this._context, ...this._pendingContext };
		this._pendingContext = undefined;

		return this.getState(this._context);
	}

	registerCommands(): Disposable[] {
		return [registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true))];
	}

	private onCommitSelected(e: CommitSelectedEvent) {
		if (
			e.data == null ||
			(this.options.attachedTo === 'graph' && e.source !== 'gitlens.views.graph') ||
			(this.options.attachedTo === 'default' && e.source === 'gitlens.views.graph')
		) {
			return;
		}

		if (this.mode === 'wip') {
			if (e.data.commit.repoPath !== this._context.wip?.changes?.repository.path) {
				void this.updateWipState(this.container.git.getRepository(e.data.commit.repoPath));
			}

			return;
		}

		if (this._pinned && e.data.interaction === 'passive') {
			this._commitStack.insert(getReferenceFromRevision(e.data.commit));
			this.updateNavigation();
		} else {
			void this.host.show(false, { preserveFocus: e.data.preserveFocus }, e.data);
		}
	}

	onFocusChanged(focused: boolean): void {
		if (this._focused === focused) return;

		this._focused = focused;
		if (focused && this.isLineTrackerSuspended) {
			this.ensureTrackers();
		}
	}

	onVisibilityChanged(visible: boolean) {
		this.ensureTrackers();
		this.updatePendingContext({ visible: visible });
		if (!visible) return;

		const skipRefresh = this._skipNextRefreshOnVisibilityChange;
		if (skipRefresh) {
			this._skipNextRefreshOnVisibilityChange = false;
		}

		// Since this gets called even the first time the webview is shown, avoid sending an update, because the bootstrap has the data
		if (this._bootstraping) {
			this._bootstraping = false;

			if (this._pendingContext == null) return;

			this.updateState();
		} else {
			if (!skipRefresh) {
				this.onRefresh();
			}
			this.updateState(true);
		}
	}

	private onAnyConfigurationChanged(e: ConfigurationChangeEvent) {
		if (
			configuration.changed(e, [
				'defaultDateFormat',
				'views.commitDetails.files',
				'views.commitDetails.avatars',
			]) ||
			configuration.changedAny<CoreConfiguration>(e, 'workbench.tree.renderIndentGuides')
		) {
			this.updatePendingContext({
				preferences: {
					...this._context.preferences,
					...this._pendingContext?.preferences,
					avatars: configuration.get('views.commitDetails.avatars'),
					dateFormat: configuration.get('defaultDateFormat') ?? 'MMMM Do, YYYY h:mma',
					files: configuration.get('views.commitDetails.files'),
					indentGuides:
						configuration.getAny<CoreConfiguration, Preferences['indentGuides']>(
							'workbench.tree.renderIndentGuides',
						) ?? 'onHover',
				},
			});
			this.updateState();
		}

		if (
			this._context.commit != null &&
			configuration.changed(e, ['views.commitDetails.autolinks', 'views.commitDetails.pullRequests'])
		) {
			void this.updateCommit(this._context.commit, { force: true });
			this.updateState();
		}
	}

	private _commitTrackerDisposable: Disposable | undefined;
	private _lineTrackerDisposable: Disposable | undefined;
	private ensureTrackers(): void {
		this._commitTrackerDisposable?.dispose();
		this._commitTrackerDisposable = undefined;
		this._lineTrackerDisposable?.dispose();
		this._lineTrackerDisposable = undefined;

		if (!this.host.visible) return;

		this._commitTrackerDisposable = this.container.events.on('commit:selected', this.onCommitSelected, this);

		if (this._pinned) return;

		if (this.options.attachedTo !== 'graph') {
			const { lineTracker } = this.container;
			this._lineTrackerDisposable = lineTracker.subscribe(
				this,
				lineTracker.onDidChangeActiveLines(this.onActiveEditorLinesChanged, this),
			);
		}
	}

	private get isLineTrackerSuspended() {
		return this.options.attachedTo !== 'graph' ? this._lineTrackerDisposable == null : false;
	}

	private suspendLineTracker() {
		// Defers the suspension of the line tracker, so that the focus change event can be handled first
		setTimeout(() => {
			this._lineTrackerDisposable?.dispose();
			this._lineTrackerDisposable = undefined;
		}, 100);
	}

	onRefresh(_force?: boolean | undefined): void {
		if (this._pinned) return;

		if (this.mode === 'wip') {
			const uri = this._context.wip?.changes?.repository.uri;
			void this.updateWipState(
				this.container.git.getBestRepositoryOrFirst(uri != null ? Uri.parse(uri) : undefined),
			);
		} else {
			const commit = this._pendingContext?.commit ?? this.getBestCommitOrStash();
			void this.updateCommit(commit, { immediate: false });
		}
	}

	onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case OpenFileOnRemoteCommandType.method:
				onIpc(OpenFileOnRemoteCommandType, e, params => void this.openFileOnRemote(params));
				break;
			case OpenFileCommandType.method:
				onIpc(OpenFileCommandType, e, params => void this.openFile(params));
				break;
			case OpenFileCompareWorkingCommandType.method:
				onIpc(OpenFileCompareWorkingCommandType, e, params => void this.openFileComparisonWithWorking(params));
				break;
			case OpenFileComparePreviousCommandType.method:
				onIpc(
					OpenFileComparePreviousCommandType,
					e,
					params => void this.openFileComparisonWithPrevious(params),
				);
				break;
			case FileActionsCommandType.method:
				onIpc(FileActionsCommandType, e, params => void this.showFileActions(params));
				break;
			case CommitActionsCommandType.method:
				onIpc(CommitActionsCommandType, e, params => {
					switch (params.action) {
						case 'graph': {
							let ref: GitRevisionReference | undefined;
							if (this._context.mode === 'wip') {
								ref =
									this._context.wip?.changes != null
										? createReference(uncommitted, this._context.wip.changes.repository.path, {
												refType: 'revision',
										  })
										: undefined;
							} else {
								ref =
									this._context.commit != null
										? getReferenceFromRevision(this._context.commit)
										: undefined;
							}
							if (ref == null) return;

							void executeCommand<ShowInCommitGraphCommandArgs>(
								this.options.attachedTo === 'graph'
									? Commands.ShowInCommitGraphView
									: Commands.ShowInCommitGraph,
								{ ref: ref },
							);
							break;
						}
						case 'more':
							this.showCommitActions();
							break;
						case 'scm':
							void executeCoreCommand('workbench.view.scm');
							break;
						case 'sha':
							if (params.alt) {
								this.showCommitPicker();
							} else if (this._context.commit != null) {
								void executeCommand<CopyShaToClipboardCommandArgs>(Commands.CopyShaToClipboard, {
									sha: this._context.commit.sha,
								});
							}
							break;
					}
				});
				break;
			case PickCommitCommandType.method:
				onIpc(PickCommitCommandType, e, _params => this.showCommitPicker());
				break;
			case SearchCommitCommandType.method:
				onIpc(SearchCommitCommandType, e, _params => this.showCommitSearch());
				break;
			case SwitchModeCommandType.method:
				onIpc(SwitchModeCommandType, e, params => this.switchMode(params));
				break;
			case AutolinkSettingsCommandType.method:
				onIpc(AutolinkSettingsCommandType, e, _params => this.showAutolinkSettings());
				break;
			case PinCommitCommandType.method:
				onIpc(PinCommitCommandType, e, params => this.updatePinned(params.pin ?? false, true));
				break;
			case NavigateCommitCommandType.method:
				onIpc(NavigateCommitCommandType, e, params => this.navigateStack(params.direction));
				break;
			case UpdatePreferencesCommandType.method:
				onIpc(UpdatePreferencesCommandType, e, params => this.updatePreferences(params));
				break;
			case ExplainCommandType.method:
				onIpc(ExplainCommandType, e, () => this.explainCommit(e.completionId));
				break;
			case StageFileCommandType.method:
				onIpc(StageFileCommandType, e, params => this.stageFile(params));
				break;
			case UnstageFileCommandType.method:
				onIpc(UnstageFileCommandType, e, params => this.unstageFile(params));
				break;
		}
	}

	private onActiveEditorLinesChanged(e: LinesChangeEvent) {
		if (e.pending || e.editor == null || e.suspended) return;

		if (this.mode === 'wip') {
			const repo = this.container.git.getBestRepositoryOrFirst(e.editor);
			void this.updateWipState(repo);

			return;
		}

		const line = e.selections?.[0]?.active;
		const commit = line != null ? this.container.lineTracker.getState(line)?.commit : undefined;
		void this.updateCommit(commit);
	}

	private _wipSubscription: RepositorySubscription | undefined;

	private get mode(): Mode {
		return this._pendingContext?.mode ?? this._context.mode;
	}

	private setMode(mode: Mode, repository?: Repository) {
		this.updatePendingContext({ mode: mode });
		if (mode === 'commit') {
			this._wipSubscription?.subscription.dispose();
			this._wipSubscription = undefined;

			this.updateState(true);
		} else {
			void this.updateWipState(repository ?? this.container.git.getBestRepositoryOrFirst());
		}
	}

	private async explainCommit(completionId?: string) {
		let params: DidExplainParams;
		try {
			const summary = await this.container.ai.explainCommit(this._context.commit!, {
				progress: { location: { viewId: this.host.id } },
			});
			params = { summary: summary };
		} catch (ex) {
			debugger;
			params = { error: { message: ex.message } };
		}
		void this.host.notify(DidExplainCommandType, params, completionId);
	}

	private navigateStack(direction: 'back' | 'forward') {
		const commit = this._commitStack.navigate(direction);
		if (commit == null) return;

		void this.updateCommit(commit, { immediate: true, skipStack: true });
	}

	private _cancellationTokenSource: CancellationTokenSource | undefined = undefined;

	@debug({ args: false })
	protected async getState(current: Context): Promise<Serialized<State>> {
		if (this._cancellationTokenSource != null) {
			this._cancellationTokenSource.cancel();
			this._cancellationTokenSource = undefined;
		}

		let details;
		if (current.commit != null) {
			details = await this.getDetailsModel(current.commit, current.formattedMessage);

			if (!current.richStateLoaded) {
				this._cancellationTokenSource = new CancellationTokenSource();

				const cancellation = this._cancellationTokenSource.token;
				setTimeout(() => {
					if (cancellation.isCancellationRequested) return;
					void this.updateRichState(current, cancellation);
				}, 100);
			}
		}

		const state = serialize<State>({
			...this.host.baseWebviewState,
			mode: current.mode,
			commit: details,
			navigationStack: current.navigationStack,
			pinned: current.pinned,
			preferences: current.preferences,
			includeRichContent: current.richStateLoaded,
			autolinkedIssues: current.autolinkedIssues?.map(serializeIssueOrPullRequest),
			pullRequest: current.pullRequest != null ? serializePullRequest(current.pullRequest) : undefined,
			wip: current.wip,
		});
		return state;
	}

	@debug({ args: false })
	private async updateWipState(repository: Repository | undefined): Promise<void> {
		if (this._wipSubscription != null) {
			const { repo, subscription } = this._wipSubscription;
			if (repository?.path !== repo.path) {
				subscription.dispose();
				this._wipSubscription = undefined;
			}
		}

		let wip: Wip | undefined = undefined;

		if (repository != null) {
			if (this._wipSubscription == null) {
				this._wipSubscription = { repo: repository, subscription: this.subscribeToRepositoryWip(repository) };
			}

			const changes = await this.getWipChange(repository);
			wip = { changes: changes, repositoryCount: this.container.git.openRepositoryCount };

			if (this._pendingContext == null) {
				const success = await this.host.notify(DidChangeWipStateNotificationType, { wip: wip });
				if (success) {
					this._context.wip = wip;
					return;
				}
			}
		}

		this.updatePendingContext({ wip: wip });
		this.updateState(true);
	}

	@debug({ args: false })
	private async updateRichState(current: Context, cancellation: CancellationToken): Promise<void> {
		const { commit } = current;
		if (commit == null) return;

		const remote = await this.container.git.getBestRemoteWithRichProvider(commit.repoPath);

		if (cancellation.isCancellationRequested) return;

		const [enrichedAutolinksResult, prResult] =
			remote?.provider != null
				? await Promise.allSettled([
						configuration.get('views.commitDetails.autolinks.enabled') &&
						configuration.get('views.commitDetails.autolinks.enhanced')
							? pauseOnCancelOrTimeoutMapTuplePromise(commit.getEnrichedAutolinks(remote))
							: undefined,
						configuration.get('views.commitDetails.pullRequests.enabled')
							? commit.getAssociatedPullRequest(remote)
							: undefined,
				  ])
				: [];

		if (cancellation.isCancellationRequested) return;

		const enrichedAutolinks = getSettledValue(enrichedAutolinksResult)?.value;
		const pr = getSettledValue(prResult);

		const formattedMessage = this.getFormattedMessage(commit, remote, enrichedAutolinks);

		this.updatePendingContext({
			richStateLoaded: true,
			formattedMessage: formattedMessage,
			autolinkedIssues:
				enrichedAutolinks != null
					? [...filterMap(enrichedAutolinks.values(), ([issueOrPullRequest]) => issueOrPullRequest?.value)]
					: undefined,
			pullRequest: pr,
		});

		this.updateState();

		// return {
		// 	formattedMessage: formattedMessage,
		// 	pullRequest: pr,
		// 	autolinkedIssues:
		// 		autolinkedIssuesAndPullRequests != null
		// 			? [...autolinkedIssuesAndPullRequests.values()].filter(<T>(i: T | undefined): i is T => i != null)
		// 			: undefined,
		// };
	}

	private _repositorySubscription: RepositorySubscription | undefined;

	private async updateCommit(
		commitish: GitCommit | GitRevisionReference | undefined,
		options?: { force?: boolean; pinned?: boolean; immediate?: boolean; skipStack?: boolean },
	) {
		// this.commits = [commit];
		if (!options?.force && this._context.commit?.sha === commitish?.ref) return;

		let commit: GitCommit | undefined;
		if (isCommit(commitish)) {
			commit = commitish;
		} else if (commitish != null) {
			if (commitish.refType === 'stash') {
				const stash = await this.container.git.getStash(commitish.repoPath);
				commit = stash?.commits.get(commitish.ref);
			} else {
				commit = await this.container.git.getCommit(commitish.repoPath, commitish.ref);
			}
		}

		let wip = this._pendingContext?.wip ?? this._context.wip;

		if (this._repositorySubscription != null) {
			const { repo, subscription } = this._repositorySubscription;
			if (commit?.repoPath !== repo.path) {
				subscription.dispose();
				this._repositorySubscription = undefined;
				wip = undefined;
			}
		}

		if (this._repositorySubscription == null && commit != null) {
			const repo = await this.container.git.getOrOpenRepository(commit.repoPath);
			if (repo != null) {
				this._repositorySubscription = { repo: repo, subscription: this.subscribeToRepositoryWip(repo) };

				if (this.mode === 'wip') {
					void this.updateWipState(repo);
				} else {
					wip = undefined;
				}
			}
		}

		this.updatePendingContext(
			{
				commit: commit,
				richStateLoaded: Boolean(commit?.isUncommitted) || !getContext('gitlens:hasConnectedRemotes'),
				formattedMessage: undefined,
				autolinkedIssues: undefined,
				pullRequest: undefined,
				wip: wip,
			},
			options?.force,
		);

		if (options?.pinned != null) {
			this.updatePinned(options?.pinned);
		}

		if (this.isLineTrackerSuspended) {
			this.ensureTrackers();
		}

		if (commit != null) {
			if (!options?.skipStack) {
				this._commitStack.add(getReferenceFromRevision(commit));
			}

			this.updateNavigation();
		}
		this.updateState(options?.immediate ?? true);
	}

	private subscribeToRepositoryWip(repo: Repository) {
		return Disposable.from(
			repo.startWatchingFileSystem(),
			repo.onDidChangeFileSystem(() => this.onWipChanged(repo)),
			repo.onDidChange(e => {
				if (e.changed(RepositoryChange.Index, RepositoryChangeComparisonMode.Any)) {
					this.onWipChanged(repo);
				}
			}),
		);
	}

	private onWipChanged(repository: Repository) {
		void this.updateWipState(repository);
	}

	private async getWipChange(repository: Repository): Promise<WipChange | undefined> {
		const status = await this.container.git.getStatusForRepo(repository.path);
		if (status == null) return undefined;

		const files: GitFileChangeShape[] = [];
		for (const file of status.files) {
			const change = {
				repoPath: file.repoPath,
				path: file.path,
				status: file.status,
				originalPath: file.originalPath,
				staged: file.staged,
			};

			files.push(change);
			if (file.staged && file.wip) {
				files.push({
					...change,
					staged: false,
				});
			}
		}

		return {
			repository: {
				name: repository.name,
				path: repository.path,
				uri: repository.uri.toString(),
			},
			branchName: status.branch,
			files: files,
		};
	}

	private updatePinned(pinned: boolean, immediate?: boolean) {
		if (pinned === this._context.pinned) return;

		this._pinned = pinned;
		this.ensureTrackers();

		this.updatePendingContext({ pinned: pinned });
		this.updateState(immediate);
	}

	private updatePreferences(preferences: UpdateablePreferences) {
		if (
			this._context.preferences?.autolinksExpanded === preferences.autolinksExpanded &&
			this._context.preferences?.files?.compact === preferences.files?.compact &&
			this._context.preferences?.files?.icon === preferences.files?.icon &&
			this._context.preferences?.files?.layout === preferences.files?.layout &&
			this._context.preferences?.files?.threshold === preferences.files?.threshold
		) {
			return;
		}

		const changes: Preferences = {
			...this._context.preferences,
			...this._pendingContext?.preferences,
		};

		if (
			preferences.autolinksExpanded != null &&
			this._context.preferences?.autolinksExpanded !== preferences.autolinksExpanded
		) {
			void this.container.storage.storeWorkspace(
				'views:commitDetails:autolinksExpanded',
				preferences.autolinksExpanded,
			);

			changes.autolinksExpanded = preferences.autolinksExpanded;
		}

		if (preferences.files != null) {
			if (this._context.preferences?.files?.compact !== preferences.files?.compact) {
				void configuration.updateEffective('views.commitDetails.files.compact', preferences.files?.compact);
			}
			if (this._context.preferences?.files?.icon !== preferences.files?.icon) {
				void configuration.updateEffective('views.commitDetails.files.icon', preferences.files?.icon);
			}
			if (this._context.preferences?.files?.layout !== preferences.files?.layout) {
				void configuration.updateEffective('views.commitDetails.files.layout', preferences.files?.layout);
			}
			if (this._context.preferences?.files?.threshold !== preferences.files?.threshold) {
				void configuration.updateEffective('views.commitDetails.files.threshold', preferences.files?.threshold);
			}

			changes.files = preferences.files;
		}

		this.updatePendingContext({ preferences: changes });
		this.updateState();
	}

	private updatePendingContext(context: Partial<Context>, force: boolean = false): boolean {
		const [changed, pending] = updatePendingContext(this._context, this._pendingContext, context, force);
		if (changed) {
			this._pendingContext = pending;
		}

		return changed;
	}

	private _notifyDidChangeStateDebounced: Deferrable<() => void> | undefined = undefined;

	private updateState(immediate: boolean = false) {
		if (immediate) {
			void this.notifyDidChangeState();
			return;
		}

		if (this._notifyDidChangeStateDebounced == null) {
			this._notifyDidChangeStateDebounced = debounce(this.notifyDidChangeState.bind(this), 500);
		}

		this._notifyDidChangeStateDebounced();
	}

	private updateNavigation() {
		let sha = this._commitStack.get(this._commitStack.position - 1)?.ref;
		if (sha != null) {
			sha = shortenRevision(sha);
		}
		this.updatePendingContext({
			navigationStack: {
				count: this._commitStack.count,
				position: this._commitStack.position,
				hint: sha,
			},
		});
		this.updateState();
	}

	private async notifyDidChangeState(force: boolean = false) {
		const scope = getLogScope();

		this._notifyDidChangeStateDebounced?.cancel();
		if (!force && this._pendingContext == null) return false;

		let context: Context;
		if (this._pendingContext != null) {
			context = { ...this._context, ...this._pendingContext };
			this._context = context;
			this._pendingContext = undefined;
		} else {
			context = this._context;
		}

		return window.withProgress({ location: { viewId: this.host.id } }, async () => {
			try {
				await this.host.notify(DidChangeNotificationType, {
					state: await this.getState(context),
				});
			} catch (ex) {
				Logger.error(scope, ex);
				debugger;
			}
		});
	}

	private getBestCommitOrStash(): GitCommit | GitRevisionReference | undefined {
		if (this._pinned) return undefined;

		let commit;

		if (this.options.attachedTo !== 'graph' && window.activeTextEditor != null) {
			const { lineTracker } = this.container;
			const line = lineTracker.selections?.[0].active;
			if (line != null) {
				commit = lineTracker.getState(line)?.commit;
			}
		} else {
			commit = this._pendingContext?.commit;
			if (commit == null) {
				const args = this.container.events.getCachedEventArgs('commit:selected');
				commit = args?.commit;
			}
		}

		return commit;
	}

	private async getDetailsModel(commit: GitCommit, formattedMessage?: string): Promise<CommitDetails> {
		const [commitResult, avatarUriResult, remoteResult] = await Promise.allSettled([
			!commit.hasFullDetails() ? commit.ensureFullDetails().then(() => commit) : commit,
			commit.author.getAvatarUri(commit, { size: 32 }),
			this.container.git.getBestRemoteWithRichProvider(commit.repoPath, { includeDisconnected: true }),
		]);

		commit = getSettledValue(commitResult, commit);
		const avatarUri = getSettledValue(avatarUriResult);
		const remote = getSettledValue(remoteResult);

		if (formattedMessage == null) {
			formattedMessage = this.getFormattedMessage(commit, remote);
		}

		const autolinks =
			commit.message != null ? this.container.autolinks.getAutolinks(commit.message, remote) : undefined;

		return {
			repoPath: commit.repoPath,
			sha: commit.sha,
			shortSha: commit.shortSha,
			author: { ...commit.author, avatar: avatarUri?.toString(true) },
			// committer: { ...commit.committer, avatar: committerAvatar?.toString(true) },
			message: formattedMessage,
			parents: commit.parents,
			stashNumber: commit.refType === 'stash' ? commit.number : undefined,
			files: commit.files,
			stats: commit.stats,
			autolinks: autolinks != null ? [...map(autolinks.values(), serializeAutolink)] : undefined,
		};
	}

	private getFormattedMessage(
		commit: GitCommit,
		remote: GitRemote | undefined,
		enrichedAutolinks?: Map<string, MaybeEnrichedAutolink>,
	) {
		let message = CommitFormatter.fromTemplate(`\${message}`, commit);
		const index = message.indexOf('\n');
		if (index !== -1) {
			message = `${message.substring(0, index)}${messageHeadlineSplitterToken}${message.substring(index + 1)}`;
		}

		if (!configuration.get('views.commitDetails.autolinks.enabled')) return message;

		return this.container.autolinks.linkify(
			message,
			'html',
			remote != null ? [remote] : undefined,
			enrichedAutolinks,
		);
	}

	private async getFileCommitFromParams(
		params: FileActionParams,
	): Promise<[commit: GitCommit, file: GitFileChange] | undefined> {
		let commit: GitCommit | undefined;
		if (this.mode === 'wip') {
			const uri = this._context.wip?.changes?.repository.uri;
			if (uri == null) return;

			commit = await this.container.git.getCommit(Uri.parse(uri), uncommitted);
		} else {
			commit = this._context.commit;
		}

		commit = await commit?.getCommitForFile(params.path, params.staged);
		return commit != null ? [commit, commit.file!] : undefined;
	}

	private showAutolinkSettings() {
		void executeCommand(Commands.ShowSettingsPageAndJumpToAutolinks);
	}

	private showCommitPicker() {
		void executeGitCommand({
			command: 'log',
			state: {
				reference: 'HEAD',
				repo: this._context.commit?.repoPath,
				openPickInView: true,
			},
		});
	}

	private showCommitSearch() {
		void executeGitCommand({ command: 'search', state: { openPickInView: true } });
	}

	private showCommitActions() {
		if (this._context.commit == null || this._context.commit.isUncommitted) return;

		void showDetailsQuickPick(this._context.commit);
	}

	private async showFileActions(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		this.suspendLineTracker();
		void showDetailsQuickPick(commit, file);
	}

	private switchMode(params: SwitchModeParams) {
		let repo;
		if (params.mode === 'wip') {
			let { repoPath } = params;
			if (repoPath == null) {
				repo = this.container.git.getBestRepositoryOrFirst();
				if (repo == null) return;

				repoPath = repo.path;
			} else {
				repo = this.container.git.getRepository(repoPath)!;
			}
		}

		this.setMode(params.mode, repo);
	}

	private async openFileComparisonWithWorking(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		this.suspendLineTracker();
		void openChangesWithWorking(file, commit, {
			preserveFocus: true,
			preview: true,
			...this.getShowOptions(params),
		});
	}

	private async openFileComparisonWithPrevious(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		this.suspendLineTracker();
		void openChanges(file, commit, {
			preserveFocus: true,
			preview: true,
			...this.getShowOptions(params),
		});
		this.container.events.fire('file:selected', { uri: file.uri }, { source: this.host.id });
	}

	private async openFile(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		this.suspendLineTracker();
		void openFile(file, commit, {
			preserveFocus: true,
			preview: true,
			...this.getShowOptions(params),
		});
	}

	private async openFileOnRemote(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		void openFileOnRemote(file, commit);
	}

	private async stageFile(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		await this.container.git.stageFile(commit.repoPath, file.path);
	}

	private async unstageFile(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		await this.container.git.unstageFile(commit.repoPath, file.path);
	}

	private getShowOptions(params: FileActionParams): TextDocumentShowOptions | undefined {
		return params.showOptions;

		// return getContext('gitlens:webview:graph:active') || getContext('gitlens:webview:rebase:active')
		// 	? { ...params.showOptions, viewColumn: ViewColumn.Beside } : params.showOptions;
	}
}

// async function summaryModel(commit: GitCommit): Promise<CommitSummary> {
// 	return {
// 		sha: commit.sha,
// 		shortSha: commit.shortSha,
// 		summary: commit.summary,
// 		message: commit.message,
// 		author: commit.author,
// 		avatar: (await commit.getAvatarUri())?.toString(true),
// 	};
// }
