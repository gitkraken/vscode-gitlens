import type { CancellationToken, ConfigurationChangeEvent, TextDocumentShowOptions } from 'vscode';
import { CancellationTokenSource, Disposable, Uri, ViewColumn, window } from 'vscode';
import { serializeAutolink } from '../../annotations/autolinks';
import type { CopyShaToClipboardCommandArgs } from '../../commands';
import { Commands, ContextKeys, CoreCommands } from '../../constants';
import type { Container } from '../../container';
import { getContext } from '../../context';
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
import type { GitFileChange } from '../../git/models/file';
import { getGitFileStatusIcon } from '../../git/models/file';
import type { IssueOrPullRequest } from '../../git/models/issue';
import { serializeIssueOrPullRequest } from '../../git/models/issue';
import type { PullRequest } from '../../git/models/pullRequest';
import { serializePullRequest } from '../../git/models/pullRequest';
import type { GitRevisionReference } from '../../git/models/reference';
import { getReferenceFromRevision } from '../../git/models/reference';
import type { GitRemote } from '../../git/models/remote';
import type { ShowInCommitGraphCommandArgs } from '../../plus/webviews/graph/graphWebview';
import { executeCommand, executeCoreCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import type { DateTimeFormat } from '../../system/date';
import { debug, log } from '../../system/decorators/log';
import type { Deferrable } from '../../system/function';
import { debounce } from '../../system/function';
import { map, union } from '../../system/iterable';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import type { PromiseCancelledError } from '../../system/promise';
import { getSettledValue } from '../../system/promise';
import type { Serialized } from '../../system/serialize';
import { serialize } from '../../system/serialize';
import type { LinesChangeEvent } from '../../trackers/lineTracker';
import { CommitFileNode } from '../../views/nodes/commitFileNode';
import { CommitNode } from '../../views/nodes/commitNode';
import { FileRevisionAsCommitNode } from '../../views/nodes/fileRevisionAsCommitNode';
import { StashFileNode } from '../../views/nodes/stashFileNode';
import { StashNode } from '../../views/nodes/stashNode';
import type { IpcMessage } from '../protocol';
import { onIpc } from '../protocol';
import { WebviewViewBase } from '../webviewViewBase';
import type { CommitDetails, FileActionParams, Preferences, State } from './protocol';
import {
	AutolinkSettingsCommandType,
	CommitActionsCommandType,
	DidChangeNotificationType,
	FileActionsCommandType,
	messageHeadlineSplitterToken,
	OpenFileCommandType,
	OpenFileComparePreviousCommandType,
	OpenFileCompareWorkingCommandType,
	OpenFileOnRemoteCommandType,
	PickCommitCommandType,
	PinCommitCommandType,
	PreferencesCommandType,
	SearchCommitCommandType,
} from './protocol';

interface Context {
	pinned: boolean;
	commit: GitCommit | undefined;
	preferences: Preferences | undefined;
	richStateLoaded: boolean;
	formattedMessage: string | undefined;
	autolinkedIssues: IssueOrPullRequest[] | undefined;
	pullRequest: PullRequest | undefined;

	// commits: GitCommit[] | undefined;
	dateFormat: DateTimeFormat | string;
	// indent: number;
	indentGuides: 'none' | 'onHover' | 'always';
}

export class CommitDetailsWebviewView extends WebviewViewBase<State, Serialized<State>> {
	private _bootstraping = true;
	/** The context the webview has */
	private _context: Context;
	/** The context the webview should have */
	private _pendingContext: Partial<Context> | undefined;

	private _pinned = false;

	constructor(container: Container) {
		super(
			container,
			'gitlens.views.commitDetails',
			'commitDetails.html',
			'Commit Details',
			`${ContextKeys.WebviewViewPrefix}commitDetails`,
			'commitDetailsView',
		);

		this._context = {
			pinned: false,
			commit: undefined,
			preferences: undefined,
			richStateLoaded: false,
			formattedMessage: undefined,
			autolinkedIssues: undefined,
			pullRequest: undefined,
			dateFormat: configuration.get('defaultDateFormat') ?? 'MMMM Do, YYYY h:mma',
			// indent: configuration.getAny('workbench.tree.indent') ?? 8,
			indentGuides: configuration.getAny('workbench.tree.renderIndentGuides') ?? 'onHover',
		};

		this.disposables.push(
			configuration.onDidChange(this.onConfigurationChanged, this),
			configuration.onDidChangeAny(this.onAnyConfigurationChanged, this),
			this.container.events.on('commit:selected', debounce(this.onCommitSelected, 250), this),
		);
	}

	onCommitSelected(e: CommitSelectedEvent) {
		if (e.data == null) return;

		void this.show(e.data);
	}

	@log<CommitDetailsWebviewView['show']>({
		args: {
			0: o =>
				`{"commit":${o?.commit?.ref},"pin":${o?.pin},"preserveFocus":${o?.preserveFocus},"preserveVisibility":${o?.preserveVisibility}}`,
		},
	})
	override async show(options?: {
		commit?: GitRevisionReference | GitCommit;
		pin?: boolean;
		preserveFocus?: boolean | undefined;
		preserveVisibility?: boolean | undefined;
	}): Promise<void> {
		if (this._pinned && !options?.pin && this.visible) return;

		if (options != null) {
			let commit;
			let pin;
			({ commit, pin, ...options } = options);
			if (commit == null) {
				commit = this.getBestCommitOrStash();
			}
			if (commit != null && !this._context.commit?.ref.startsWith(commit.ref)) {
				if (!isCommit(commit)) {
					if (commit.refType === 'stash') {
						const stash = await this.container.git.getStash(commit.repoPath);
						commit = stash?.commits.get(commit.ref);
					} else {
						commit = await this.container.git.getCommit(commit.repoPath, commit.ref);
					}
				}
				this.updateCommit(commit, { pinned: pin ?? false });
			}
		}

		if (options?.preserveVisibility) return;

		return super.show(options);
	}

	protected override async includeBootstrap(): Promise<Serialized<State>> {
		this._bootstraping = true;

		this._context = { ...this._context, ...this._pendingContext };
		this._pendingContext = undefined;

		return this.getState(this._context);
	}

	protected override onInitializing(): Disposable[] | undefined {
		if (this._context.preferences == null) {
			this.updatePendingContext({
				preferences: {
					autolinksExpanded: this.container.storage.getWorkspace('views:commitDetails:autolinksExpanded'),
					avatars: configuration.get('views.commitDetails.avatars'),
					dismissed: this.container.storage.get('views:commitDetails:dismissed'),
					files: configuration.get('views.commitDetails.files'),
				},
			});
		}

		if (this._context.commit == null) {
			const commit = this.getBestCommitOrStash();
			if (commit != null) {
				this.updateCommit(commit, { immediate: false });
			}
		}

		return undefined;
	}

	private _visibilityDisposable: Disposable | undefined;
	protected override onVisibilityChanged(visible: boolean) {
		this.ensureTrackers();
		if (!visible) return;

		// Since this gets called even the first time the webview is shown, avoid sending an update, because the bootstrap has the data
		if (this._bootstraping) {
			this._bootstraping = false;

			if (this._pendingContext == null) return;
		}

		this.updateState(true);
	}

	private onAnyConfigurationChanged(e: ConfigurationChangeEvent) {
		// if (e.affectsConfiguration('workbench.tree.indent')) {
		// 	this.updatePendingContext({ indent: configuration.getAny('workbench.tree.indent') ?? 8 });
		// 	this.updateState();
		// }

		if (e.affectsConfiguration('workbench.tree.renderIndentGuides')) {
			this.updatePendingContext({
				indentGuides: configuration.getAny('workbench.tree.renderIndentGuides') ?? 'onHover',
			});
			this.updateState();
		}
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'defaultDateFormat')) {
			this.updatePendingContext({ dateFormat: configuration.get('defaultDateFormat') ?? 'MMMM Do, YYYY h:mma' });
			this.updateState();
		}

		if (configuration.changed(e, 'views.commitDetails')) {
			if (
				configuration.changed(e, 'views.commitDetails.files') ||
				configuration.changed(e, 'views.commitDetails.avatars')
			) {
				this.updatePendingContext({
					preferences: {
						...this._context.preferences,
						...this._pendingContext?.preferences,
						avatars: configuration.get('views.commitDetails.avatars'),
						files: configuration.get('views.commitDetails.files'),
					},
				});
			}

			if (
				this._context.commit != null &&
				(configuration.changed(e, 'views.commitDetails.autolinks') ||
					configuration.changed(e, 'views.commitDetails.pullRequests'))
			) {
				this.updateCommit(this._context.commit, { force: true });
			}

			this.updateState();
		}
	}

	private ensureTrackers(): void {
		this._visibilityDisposable?.dispose();
		this._visibilityDisposable = undefined;

		if (this._pinned || !this.visible) return;

		const { lineTracker } = this.container;
		this._visibilityDisposable = Disposable.from(
			lineTracker.subscribe(this, lineTracker.onDidChangeActiveLines(this.onActiveLinesChanged, this)),
		);

		const commit = this._pendingContext?.commit ?? this.getBestCommitOrStash();
		this.updateCommit(commit, { immediate: false });
	}

	protected override onReady(): void {
		this.updateState(false);
	}

	protected override onMessageReceived(e: IpcMessage) {
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
						case 'graph':
							if (this._context.commit == null) return;

							void executeCommand<ShowInCommitGraphCommandArgs>(Commands.ShowInCommitGraph, {
								ref: getReferenceFromRevision(this._context.commit),
							});
							break;
						case 'more':
							this.showCommitActions();
							break;
						case 'scm':
							void executeCoreCommand(CoreCommands.ShowSCM);
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
			case AutolinkSettingsCommandType.method:
				onIpc(AutolinkSettingsCommandType, e, _params => this.showAutolinkSettings());
				break;
			case PinCommitCommandType.method:
				onIpc(PinCommitCommandType, e, params => this.updatePinned(params.pin ?? false, true));
				break;
			case PreferencesCommandType.method:
				onIpc(PreferencesCommandType, e, params => this.updatePreferences(params));
				break;
		}
	}

	private onActiveLinesChanged(e: LinesChangeEvent) {
		if (e.pending) return;

		let commit;
		if (e.editor == null) {
			if (getContext('gitlens:webview:graph:active') || getContext('gitlens:webview:rebaseEditor:active')) {
				commit = this._pendingContext?.commit ?? this._context.commit;
				if (commit == null) return;
			}
		}

		if (commit == null) {
			commit =
				e.selections != null ? this.container.lineTracker.getState(e.selections[0].active)?.commit : undefined;
		}
		this.updateCommit(commit);
	}

	private _cancellationTokenSource: CancellationTokenSource | undefined = undefined;

	@debug({ args: false })
	protected async getState(current: Context): Promise<Serialized<State>> {
		if (this._cancellationTokenSource != null) {
			this._cancellationTokenSource.cancel();
			this._cancellationTokenSource.dispose();
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

		// const commitChoices = await Promise.all(this.commits.map(async commit => summaryModel(commit)));

		const state = serialize<State>({
			pinned: current.pinned,
			includeRichContent: current.richStateLoaded,
			// commits: commitChoices,
			preferences: current.preferences,
			selected: details,
			autolinkedIssues: current.autolinkedIssues?.map(serializeIssueOrPullRequest),
			pullRequest: current.pullRequest != null ? serializePullRequest(current.pullRequest) : undefined,
			dateFormat: current.dateFormat,
			// indent: current.indent,
			indentGuides: current.indentGuides,
		});
		return state;
	}

	private async updateRichState(current: Context, cancellation: CancellationToken): Promise<void> {
		const { commit } = current;
		if (commit == null) return;

		const remote = await this.container.git.getBestRemoteWithRichProvider(commit.repoPath);

		if (cancellation.isCancellationRequested) return;

		let autolinkedIssuesOrPullRequests;
		let pr;

		if (remote?.provider != null) {
			const [autolinkedIssuesOrPullRequestsResult, prResult] = await Promise.allSettled([
				configuration.get('views.commitDetails.autolinks.enabled') &&
				configuration.get('views.commitDetails.autolinks.enhanced')
					? this.container.autolinks.getLinkedIssuesAndPullRequests(commit.message ?? commit.summary, remote)
					: undefined,
				configuration.get('views.commitDetails.pullRequests.enabled')
					? commit.getAssociatedPullRequest({ remote: remote })
					: undefined,
			]);

			if (cancellation.isCancellationRequested) return;

			autolinkedIssuesOrPullRequests = getSettledValue(autolinkedIssuesOrPullRequestsResult);
			pr = getSettledValue(prResult);
		}

		const formattedMessage = this.getFormattedMessage(commit, remote, autolinkedIssuesOrPullRequests);

		// Remove possible duplicate pull request
		if (pr != null) {
			autolinkedIssuesOrPullRequests?.delete(pr.id);
		}

		this.updatePendingContext({
			richStateLoaded: true,
			formattedMessage: formattedMessage,
			autolinkedIssues:
				autolinkedIssuesOrPullRequests != null ? [...autolinkedIssuesOrPullRequests.values()] : undefined,
			pullRequest: pr,
		});

		this.updateState();

		// return {
		// 	formattedMessage: formattedMessage,
		// 	pullRequest: pr,
		// 	autolinkedIssues:
		// 		autolinkedIssuesOrPullRequests != null
		// 			? [...autolinkedIssuesOrPullRequests.values()].filter(<T>(i: T | undefined): i is T => i != null)
		// 			: undefined,
		// };
	}

	private _commitDisposable: Disposable | undefined;

	private updateCommit(
		commit: GitCommit | undefined,
		options?: { force?: boolean; pinned?: boolean; immediate?: boolean },
	) {
		// this.commits = [commit];
		if (!options?.force && this._context.commit?.sha === commit?.sha) return;

		this._commitDisposable?.dispose();

		if (commit?.isUncommitted) {
			const repository = this.container.git.getRepository(commit.repoPath)!;
			this._commitDisposable = Disposable.from(
				repository.startWatchingFileSystem(),
				repository.onDidChangeFileSystem(() => {
					// this.updatePendingContext({ commit: undefined });
					this.updatePendingContext({ commit: commit }, true);
					this.updateState();
				}),
			);
		}

		this.updatePendingContext(
			{
				commit: commit,
				richStateLoaded: Boolean(commit?.isUncommitted) || !getContext(ContextKeys.HasConnectedRemotes),
				formattedMessage: undefined,
				autolinkedIssues: undefined,
				pullRequest: undefined,
			},
			options?.force,
		);

		if (options?.pinned != null) {
			this.updatePinned(options?.pinned);
		}

		this.updateState(options?.immediate ?? true);
	}

	private updatePinned(pinned: boolean, immediate?: boolean) {
		if (pinned === this._context.pinned) return;

		this._pinned = pinned;
		this.ensureTrackers();

		this.updatePendingContext({ pinned: pinned });
		this.updateState(immediate);
	}

	private updatePreferences(preferences: Preferences) {
		if (
			this._context.preferences?.autolinksExpanded === preferences.autolinksExpanded &&
			this._context.preferences?.avatars === preferences.avatars &&
			this._context.preferences?.dismissed === preferences.dismissed &&
			this._context.preferences?.files === preferences.files &&
			this._context.preferences?.files?.compact === preferences.files?.compact &&
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

		if (preferences.avatars != null && this._context.preferences?.avatars !== preferences.avatars) {
			void configuration.updateEffective('views.commitDetails.avatars', preferences.avatars);

			changes.avatars = preferences.avatars;
		}

		if (preferences.dismissed != null && this._context.preferences?.dismissed !== preferences.dismissed) {
			void this.container.storage.store('views:commitDetails:dismissed', preferences.dismissed);

			changes.dismissed = preferences.dismissed;
		}

		if (preferences.files != null && this._context.preferences?.files !== preferences.files) {
			if (this._context.preferences?.files?.compact !== preferences.files?.compact) {
				void configuration.updateEffective('views.commitDetails.files.compact', preferences.files?.compact);
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
	}

	private updatePendingContext(context: Partial<Context>, force: boolean = false): boolean {
		let changed = false;
		for (const [key, value] of Object.entries(context)) {
			const current = (this._context as unknown as Record<string, unknown>)[key];
			if (
				!force &&
				(current instanceof Uri || value instanceof Uri) &&
				(current as any)?.toString() === value?.toString()
			) {
				continue;
			}

			if (!force && current === value) {
				if (
					(value !== undefined || key in this._context) &&
					(this._pendingContext == null || !(key in this._pendingContext))
				) {
					continue;
				}
			}

			if (this._pendingContext == null) {
				this._pendingContext = {};
			}

			(this._pendingContext as Record<string, unknown>)[key] = value;
			changed = true;
		}

		return changed;
	}

	private _notifyDidChangeStateDebounced: Deferrable<() => void> | undefined = undefined;

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

	private async notifyDidChangeState() {
		if (!this.isReady || !this.visible) return false;

		const scope = getLogScope();

		this._notifyDidChangeStateDebounced?.cancel();
		if (this._pendingContext == null) return false;

		const context = { ...this._context, ...this._pendingContext };

		return window.withProgress({ location: { viewId: this.id } }, async () => {
			try {
				const success = await this.notify(DidChangeNotificationType, {
					state: await this.getState(context),
				});
				if (success) {
					this._context = context;
					this._pendingContext = undefined;
				}
			} catch (ex) {
				Logger.error(scope, ex);
				debugger;
			}
		});
	}

	// private async updateRichState() {
	// 	if (this.commit == null) return;

	// 	const richState = await this.getRichState(this.commit);
	// 	if (richState != null) {
	// 		void this.notify(DidChangeRichStateNotificationType, richState);
	// 	}
	// }

	private getBestCommitOrStash(): GitCommit | undefined {
		if (this._pinned) return undefined;

		let commit;

		if (window.activeTextEditor != null) {
			const { lineTracker } = this.container;
			const line = lineTracker.selections?.[0].active;
			if (line != null) {
				commit = lineTracker.getState(line)?.commit;
				if (commit != null) return commit;
			}
		} else if (getContext('gitlens:webview:graph:active') || getContext('gitlens:webview:rebaseEditor:active')) {
			commit = this._pendingContext?.commit ?? this._context.commit;
			if (commit != null) return commit;
		}

		const { commitsView } = this.container;
		let node = commitsView.activeSelection;
		if (
			node != null &&
			(node instanceof CommitNode || node instanceof FileRevisionAsCommitNode || node instanceof CommitFileNode)
		) {
			commit = node.commit;
			if (commit != null) return commit;
		}

		const { stashesView } = this.container;
		node = stashesView.activeSelection;
		if (node != null && (node instanceof StashNode || node instanceof StashFileNode)) {
			commit = node.commit;
			if (commit != null) return commit;
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

		let autolinks;
		if (commit.message != null) {
			const customAutolinks = this.container.autolinks.getAutolinks(commit.message);
			if (remote != null) {
				const providerAutolinks = this.container.autolinks.getAutolinks(commit.message, remote);
				autolinks = new Map(union(providerAutolinks, customAutolinks));
			} else {
				autolinks = customAutolinks;
			}
		}

		return {
			sha: commit.sha,
			shortSha: commit.shortSha,
			isStash: commit.refType === 'stash',
			message: formattedMessage,
			author: { ...commit.author, avatar: avatarUri?.toString(true) },
			// committer: { ...commit.committer, avatar: committerAvatar?.toString(true) },
			files: commit.files?.map(({ status, repoPath, path, originalPath }) => {
				const icon = getGitFileStatusIcon(status);
				return {
					path: path,
					originalPath: originalPath,
					status: status,
					repoPath: repoPath,
					icon: {
						dark: this._view!.webview.asWebviewUri(
							Uri.joinPath(this.container.context.extensionUri, 'images', 'dark', icon),
						).toString(),
						light: this._view!.webview.asWebviewUri(
							Uri.joinPath(this.container.context.extensionUri, 'images', 'light', icon),
						).toString(),
					},
				};
			}),
			stats: commit.stats,
			autolinks: autolinks != null ? [...map(autolinks.values(), serializeAutolink)] : undefined,
		};
	}

	private getFormattedMessage(
		commit: GitCommit,
		remote: GitRemote | undefined,
		issuesOrPullRequests?: Map<string, IssueOrPullRequest | PromiseCancelledError | undefined>,
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
			issuesOrPullRequests,
		);
	}

	private async getFileCommitFromParams(
		params: FileActionParams,
	): Promise<[commit: GitCommit, file: GitFileChange] | undefined> {
		const commit = await this._context.commit?.getCommitForFile(params.path);
		return commit != null ? [commit, commit.file!] : undefined;
	}

	private showAutolinkSettings() {
		void executeCommand(Commands.ShowSettingsPageAndJumpToAutolinks);
	}

	private showCommitSearch() {
		void executeGitCommand({ command: 'search', state: { openPickInView: true } });
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

	private showCommitActions() {
		if (this._context.commit == null || this._context.commit.isUncommitted) return;

		void showDetailsQuickPick(this._context.commit);
	}

	private async showFileActions(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		this.updatePinned(true, true);
		void showDetailsQuickPick(commit, file);
	}

	private async openFileComparisonWithWorking(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		this.updatePinned(true, true);
		void openChangesWithWorking(file.path, commit, {
			preserveFocus: true,
			preview: true,
			...this.getShowOptions(params),
		});
	}

	private async openFileComparisonWithPrevious(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		this.updatePinned(true, true);
		void openChanges(file.path, commit, {
			preserveFocus: true,
			preview: true,
			...this.getShowOptions(params),
		});
		this.container.events.fire('file:selected', { uri: file.uri }, { source: this.id });
	}

	private async openFile(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		this.updatePinned(true, true);
		void openFile(file.path, commit, {
			preserveFocus: true,
			preview: true,
			...this.getShowOptions(params),
		});
	}

	private async openFileOnRemote(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		void openFileOnRemote(file.path, commit);
	}

	private getShowOptions(params: FileActionParams): TextDocumentShowOptions | undefined {
		return getContext('gitlens:webview:graph:active') || getContext('gitlens:webview:rebaseEditor:active')
			? { ...params.showOptions, viewColumn: ViewColumn.Beside }
			: params.showOptions;
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
