import type {
	CancellationToken,
	ConfigurationChangeEvent,
	TreeViewSelectionChangeEvent,
	TreeViewVisibilityChangeEvent,
} from 'vscode';
import { CancellationTokenSource, Disposable, env, Uri, window } from 'vscode';
import { executeGitCommand, GitActions } from '../../commands/gitCommands.actions';
import { configuration } from '../../configuration';
import { Commands } from '../../constants';
import type { Container } from '../../container';
import type { GitCommit } from '../../git/models/commit';
import { isCommit } from '../../git/models/commit';
import type { GitFileChange } from '../../git/models/file';
import { GitFile } from '../../git/models/file';
import type { IssueOrPullRequest } from '../../git/models/issue';
import { serializeIssueOrPullRequest } from '../../git/models/issue';
import type { PullRequest } from '../../git/models/pullRequest';
import { serializePullRequest } from '../../git/models/pullRequest';
import type { GitRevisionReference } from '../../git/models/reference';
import { Logger } from '../../logger';
import type { ShowCommitInGraphCommandArgs } from '../../plus/webviews/graph/graphWebview';
import { executeCommand } from '../../system/command';
import type { DateTimeFormat } from '../../system/date';
import { debug, getLogScope } from '../../system/decorators/log';
import type { Deferrable } from '../../system/function';
import { debounce } from '../../system/function';
import { getSettledValue } from '../../system/promise';
import type { Serialized } from '../../system/serialize';
import { serialize } from '../../system/serialize';
import type { LinesChangeEvent } from '../../trackers/lineTracker';
import { CommitFileNode } from '../../views/nodes/commitFileNode';
import { CommitNode } from '../../views/nodes/commitNode';
import { FileRevisionAsCommitNode } from '../../views/nodes/fileRevisionAsCommitNode';
import { StashFileNode } from '../../views/nodes/stashFileNode';
import { StashNode } from '../../views/nodes/stashNode';
import type { ViewNode } from '../../views/nodes/viewNode';
import type { IpcMessage } from '../protocol';
import { onIpc } from '../protocol';
import { WebviewViewBase } from '../webviewViewBase';
import type { CommitDetails, FileActionParams, SavedPreferences, State } from './protocol';
import {
	AutolinkSettingsCommandType,
	CommitActionsCommandType,
	DidChangeStateNotificationType,
	FileActionsCommandType,
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
	preferences: SavedPreferences | undefined;
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
		super(container, 'gitlens.views.commitDetails', 'commitDetails.html', 'Commit Details', 'commitDetailsView');

		this._context = {
			pinned: false,
			commit: undefined,
			preferences: {
				autolinksExpanded: this.container.storage.getWorkspace('views:commitDetails:autolinksExpanded'),
				filesAsTree: this.container.storage.getWorkspace('views:commitDetails:filesAsTree'),
			},
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
		);
	}

	override async show(options?: {
		commit?: GitRevisionReference | GitCommit;
		pin?: boolean;
		preserveFocus?: boolean | undefined;
	}): Promise<void> {
		if (options != null) {
			let commit;
			let pin;
			({ commit, pin, ...options } = options);
			if (commit == null) {
				commit = this.getBestCommitOrStash();
			}
			if (commit != null) {
				if (!isCommit(commit)) {
					if (commit.refType === 'stash') {
						const stash = await this.container.git.getStash(commit.repoPath);
						commit = stash?.commits.get(commit.ref);
					} else {
						commit = await this.container.git.getCommit(commit.repoPath, commit.ref);
					}
				}
				this.updateCommit(commit, { pinned: pin ?? true });
			}
		}

		return super.show(options);
	}

	protected override async includeBootstrap(): Promise<Serialized<State>> {
		this._bootstraping = true;

		this._context = { ...this._context, ...this._pendingContext };
		this._pendingContext = undefined;

		return this.getState(this._context);
	}

	protected override onInitializing(): Disposable[] | undefined {
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

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'defaultDateFormat')) {
			this.updatePendingContext({ dateFormat: configuration.get('defaultDateFormat') ?? 'MMMM Do, YYYY h:mma' });
			this.updateState();
		}
	}

	private ensureTrackers(): void {
		this._visibilityDisposable?.dispose();
		this._visibilityDisposable = undefined;

		if (this._pinned || !this.visible) return;

		const { lineTracker, commitsView, stashesView } = this.container;
		this._visibilityDisposable = Disposable.from(
			lineTracker.subscribe(this, lineTracker.onDidChangeActiveLines(this.onActiveLinesChanged, this)),
			commitsView.onDidChangeSelection(this.onCommitsViewSelectionChanged, this),
			commitsView.onDidChangeVisibility(this.onCommitsViewVisibilityChanged, this),
			stashesView.onDidChangeSelection(this.onStashesViewSelectionChanged, this),
			stashesView.onDidChangeVisibility(this.onStashesViewVisibilityChanged, this),
		);

		const commit = this.getBestCommitOrStash();
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

							void executeCommand<ShowCommitInGraphCommandArgs>(Commands.ShowCommitInGraph, {
								repoPath: this._context.commit.repoPath,
								sha: this._context.commit.sha,
							});
							break;
						case 'more':
							this.showCommitActions();
							break;
						case 'sha':
							if (params.alt) {
								this.showCommitPicker();
							} else if (this._context.commit != null) {
								void env.clipboard.writeText(this._context.commit.sha);
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

		const commit =
			e.selections != null ? this.container.lineTracker.getState(e.selections[0].active)?.commit : undefined;
		this.updateCommit(commit);
	}

	private onCommitsViewSelectionChanged(e: TreeViewSelectionChangeEvent<ViewNode>) {
		const node = e.selection?.[0];
		if (
			node != null &&
			(node instanceof CommitNode || node instanceof FileRevisionAsCommitNode || node instanceof CommitFileNode)
		) {
			this.updateCommit(node.commit);
		}
	}

	private onCommitsViewVisibilityChanged(e: TreeViewVisibilityChangeEvent) {
		if (!e.visible) return;

		const node = this.container.commitsView.activeSelection;
		if (
			node != null &&
			(node instanceof CommitNode || node instanceof FileRevisionAsCommitNode || node instanceof CommitFileNode)
		) {
			this.updateCommit(node.commit);
		}
	}

	private onStashesViewSelectionChanged(e: TreeViewSelectionChangeEvent<ViewNode>) {
		const node = e.selection?.[0];
		if (node != null && (node instanceof StashNode || node instanceof StashFileNode)) {
			this.updateCommit(node.commit);
		}
	}

	private onStashesViewVisibilityChanged(e: TreeViewVisibilityChangeEvent) {
		if (!e.visible) return;

		const node = this.container.stashesView.activeSelection;
		if (node != null && (node instanceof StashNode || node instanceof StashFileNode)) {
			this.updateCommit(node.commit);
		}
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
			if (!current.commit.hasFullDetails()) {
				await current.commit.ensureFullDetails();
				// current.commit.assertsFullDetails();
			}

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
		const commit = current.commit;
		if (commit == null) return;

		const remotes = await this.container.git.getRemotesWithProviders(commit.repoPath, { sort: true });
		const remote = await this.container.git.getBestRemoteWithRichProvider(remotes);

		if (cancellation.isCancellationRequested) return;

		let autolinkedIssuesOrPullRequests;
		let pr;

		if (remote?.provider != null) {
			const [autolinkedIssuesOrPullRequestsResult, prResult] = await Promise.allSettled([
				this.container.autolinks.getLinkedIssuesAndPullRequests(commit.message ?? commit.summary, remote),
				commit.getAssociatedPullRequest({ remote: remote }),
			]);

			if (cancellation.isCancellationRequested) return;

			autolinkedIssuesOrPullRequests = getSettledValue(autolinkedIssuesOrPullRequestsResult);
			pr = getSettledValue(prResult);
		}

		// TODO: add HTML formatting option to linkify
		const formattedMessage = this.container.autolinks.linkify(
			encodeMarkup(commit.message!),
			true,
			remote != null ? [remote] : undefined,
			autolinkedIssuesOrPullRequests,
		);

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

	private updateCommit(commit: GitCommit | undefined, options?: { pinned?: boolean; immediate?: boolean }) {
		// this.commits = [commit];
		if (this._context.commit?.sha === commit?.sha) return;

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

		this.updatePendingContext({
			commit: commit,
			richStateLoaded: Boolean(commit?.isUncommitted),
			formattedMessage: undefined,
			autolinkedIssues: undefined,
			pullRequest: undefined,
		});

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

	private updatePreferences(preferences: SavedPreferences) {
		if (
			this._context.preferences?.autolinksExpanded === preferences.autolinksExpanded &&
			this._context.preferences?.filesAsTree === preferences.filesAsTree
		) {
			return;
		}

		const changes: SavedPreferences = {};
		if (this._context.preferences?.autolinksExpanded !== preferences.autolinksExpanded) {
			void this.container.storage.storeWorkspace(
				'views:commitDetails:autolinksExpanded',
				preferences.autolinksExpanded,
			);
			changes.autolinksExpanded = preferences.autolinksExpanded;
		}

		if (this._context.preferences?.filesAsTree !== preferences.filesAsTree) {
			void this.container.storage.storeWorkspace('views:commitDetails:filesAsTree', preferences.filesAsTree);
			changes.filesAsTree = preferences.filesAsTree;
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
				const success = await this.notify(DidChangeStateNotificationType, {
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

		const { lineTracker } = this.container;
		const line = lineTracker.selections?.[0].active;
		if (line != null) {
			commit = lineTracker.getState(line)?.commit;
		}

		if (commit == null) {
			const { commitsView } = this.container;
			const node = commitsView.activeSelection;
			if (
				node != null &&
				(node instanceof CommitNode ||
					node instanceof FileRevisionAsCommitNode ||
					node instanceof CommitFileNode)
			) {
				commit = node.commit;
			}
		}

		if (commit == null) {
			const { stashesView } = this.container;
			const node = stashesView.activeSelection;
			if (node != null && (node instanceof StashNode || node instanceof StashFileNode)) {
				commit = node.commit;
			}
		}

		return commit;
	}

	private async getDetailsModel(commit: GitCommit, formattedMessage?: string): Promise<CommitDetails> {
		// if (commit == null) return undefined;

		// if (!commit.hasFullDetails()) {
		// 	await commit.ensureFullDetails();
		// 	commit.assertsFullDetails();
		// }

		const authorAvatar = await commit.author.getAvatarUri(commit);
		// const committerAvatar = await commit.committer?.getAvatarUri(commit);

		// const formattedMessage = this.container.autolinks.linkify(
		// 	encodeMarkup(commit.message),
		// 	true,
		// 	remote != null ? [remote] : undefined,
		// 	autolinkedIssuesOrPullRequests,
		// );

		return {
			sha: commit.sha,
			shortSha: commit.shortSha,
			isStash: commit.refType === 'stash',
			// summary: commit.summary,
			message: formattedMessage ?? encodeMarkup(commit.message ?? commit.summary),
			author: { ...commit.author, avatar: authorAvatar.toString(true) },
			// committer: { ...commit.committer, avatar: committerAvatar?.toString(true) },
			files: commit.files?.map(({ status, repoPath, path, originalPath }) => {
				const icon = GitFile.getStatusIcon(status);
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
		};
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

		void GitActions.Commit.showDetailsQuickPick(this._context.commit);
	}

	private async showFileActions(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		this.updatePinned(true, true);
		void GitActions.Commit.showDetailsQuickPick(commit, file);
	}

	private async openFileComparisonWithWorking(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		this.updatePinned(true, true);
		void GitActions.Commit.openChangesWithWorking(file.path, commit, {
			preserveFocus: true,
			preview: true,
			...params.showOptions,
		});
	}

	private async openFileComparisonWithPrevious(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		this.updatePinned(true, true);
		void GitActions.Commit.openChanges(file.path, commit, {
			preserveFocus: true,
			preview: true,
			...params.showOptions,
		});
	}

	private async openFile(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		this.updatePinned(true, true);
		void GitActions.Commit.openFile(file.path, commit, {
			preserveFocus: true,
			preview: true,
			...params.showOptions,
		});
	}

	private async openFileOnRemote(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		void GitActions.Commit.openFileOnRemote(file.path, commit);
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

function encodeMarkup(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
