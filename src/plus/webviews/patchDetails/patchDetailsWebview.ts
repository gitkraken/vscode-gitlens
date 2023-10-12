import type { CancellationToken, ConfigurationChangeEvent, TextDocumentShowOptions, ViewColumn } from 'vscode';
import { CancellationTokenSource, Disposable, env, Uri, window } from 'vscode';
import type { CoreConfiguration } from '../../../constants';
import { Commands } from '../../../constants';
import type { Container } from '../../../container';
import type { DraftSelectedEvent } from '../../../eventBus';
import { executeGitCommand } from '../../../git/actions';
import {
	openChanges,
	openChangesWithWorking,
	openFile,
	openFileOnRemote,
	showDetailsQuickPick,
} from '../../../git/actions/commit';
import type { GitCommit } from '../../../git/models/commit';
import type { GitFileChange } from '../../../git/models/file';
import { getGitFileStatusIcon } from '../../../git/models/file';
import type { GitCloudPatch, GitPatch } from '../../../git/models/patch';
import { createReference } from '../../../git/models/reference';
import type { Repository, RepositoryChangeEvent } from '../../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository';
import { showCommitPicker } from '../../../quickpicks/commitPicker';
import { getRepositoryOrShowPicker } from '../../../quickpicks/repositoryPicker';
import { executeCommand, registerCommand } from '../../../system/command';
import { configuration } from '../../../system/configuration';
import { debug } from '../../../system/decorators/log';
import type { Deferrable } from '../../../system/function';
import { debounce } from '../../../system/function';
import { Logger } from '../../../system/logger';
import { getLogScope } from '../../../system/logger.scope';
import type { Serialized } from '../../../system/serialize';
import { serialize } from '../../../system/serialize';
import type { IpcMessage } from '../../../webviews/protocol';
import { onIpc } from '../../../webviews/protocol';
import type { WebviewController, WebviewProvider } from '../../../webviews/webviewController';
import { updatePendingContext } from '../../../webviews/webviewController';
import type { Draft, LocalDraft } from '../../drafts/draftsService';
import type { ShowInCommitGraphCommandArgs } from '../graph/protocol';
import type {
	Change,
	CreatePatchParams,
	DidExplainParams,
	DraftDetails,
	FileActionParams,
	Preferences,
	State,
	ToggleModeParams,
	UpdateablePreferences,
} from './protocol';
import {
	CopyCloudLinkCommandType,
	CreateFromLocalPatchCommandType,
	CreatePatchCommandType,
	DidChangeCreateNotificationType,
	DidChangeNotificationType,
	DidExplainCommandType,
	ExplainCommandType,
	FileActionsCommandType,
	OpenFileCommandType,
	OpenFileComparePreviousCommandType,
	OpenFileCompareWorkingCommandType,
	OpenFileOnRemoteCommandType,
	OpenInCommitGraphCommandType,
	SelectPatchBaseCommandType,
	SelectPatchRepoCommandType,
	ToggleModeCommandType,
	UpdatePreferencesCommandType,
} from './protocol';
import type { PatchDetailsWebviewShowingArgs } from './registration';

interface Context {
	mode: 'draft' | 'create';
	draft: LocalDraft | Draft | undefined;
	create: Change[] | undefined;
	preferences: Preferences;

	visible: boolean;
	wipStateLoaded: boolean;
}

export class PatchDetailsWebviewProvider
	implements WebviewProvider<State, Serialized<State>, PatchDetailsWebviewShowingArgs>
{
	private _bootstraping = true;
	/** The context the webview has */
	private _context: Context;
	/** The context the webview should have */
	private _pendingContext: Partial<Context> | undefined;
	private readonly _disposable: Disposable;
	private _focused = false;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewController<State, Serialized<State>, PatchDetailsWebviewShowingArgs>,
	) {
		this._context = {
			mode: 'create',
			draft: undefined,
			create: undefined,
			preferences: {
				avatars: configuration.get('views.patchDetails.avatars'),
				dateFormat: configuration.get('defaultDateFormat') ?? 'MMMM Do, YYYY h:mma',
				files: configuration.get('views.patchDetails.files'),
				indentGuides:
					configuration.getAny<CoreConfiguration, Preferences['indentGuides']>(
						'workbench.tree.renderIndentGuides',
					) ?? 'onHover',
			},
			visible: false,
			wipStateLoaded: false,
		};

		this._disposable = Disposable.from(
			configuration.onDidChangeAny(this.onAnyConfigurationChanged, this),
			container.git.onDidChangeRepository(this.onRepositoriesChanged, this),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	onReloaded(): void {
		void this.notifyDidChangeState(true);
	}

	onShowing(
		_loading: boolean,
		options: { column?: ViewColumn; preserveFocus?: boolean },
		...args: PatchDetailsWebviewShowingArgs
	): boolean {
		let data: Partial<DraftSelectedEvent['data']> | { preserveVisibility?: boolean; changes: Change[] } | undefined;

		const [arg] = args;
		// if (isSerializedState<Serialized<State>>(arg)) {
		// 	const { selected } = arg.state;
		// 	if (selected?.repoPath != null && selected?.sha != null) {
		// 		if (selected.stashNumber != null) {
		// 			data = {
		// 				patch: createReference(selected.sha, selected.repoPath, {
		// 					refType: 'stash',
		// 					name: selected.message,
		// 					number: selected.stashNumber,
		// 				}),
		// 			};
		// 		} else {
		// 			data = {
		// 				commit: createReference(selected.sha, selected.repoPath, {
		// 					refType: 'revision',
		// 					message: selected.message,
		// 				}),
		// 			};
		// 		}
		// 	}
		if (arg != null && typeof arg === 'object') {
			data = arg;
		} else {
			data = undefined;
		}

		let draft;
		let changes: Change[] | undefined;
		if (data != null) {
			if ('changes' in data) {
				({ changes, ...data } = data as { preserveVisibility?: boolean; changes: Change[] });
			} else {
				if (data.preserveFocus) {
					options.preserveFocus = true;
				}
				({ draft, ...data } = data);
			}
		}

		if (draft != null) {
			this.updateDraft(draft);
		}

		if (changes != null) {
			this.updateCreate(changes);
		}

		if (data?.preserveVisibility && !this.host.visible) return false;

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

	private onDraftSelected(e: DraftSelectedEvent) {
		if (e.data == null) return;

		// if (this._pinned && e.data.interaction === 'passive') {
		// 	this._commitStack.insert(getReferenceFromRevision(e.data.commit));
		// 	this.updateNavigation();
		// } else {
		void this.host.show(false, { preserveFocus: e.data.preserveFocus }, e.data);
		// }
	}

	onFocusChanged(focused: boolean): void {
		if (this._focused === focused) return;

		this._focused = focused;
		if (focused) {
			this.ensureTrackers();
		}
	}

	onVisibilityChanged(visible: boolean) {
		this.ensureTrackers();
		this.updatePendingContext({ visible: visible });
		if (!visible) return;

		// Since this gets called even the first time the webview is shown, avoid sending an update, because the bootstrap has the data
		if (this._bootstraping) {
			this._bootstraping = false;

			if (this._pendingContext == null) return;
		}

		this.updateState(true);
	}

	private onAnyConfigurationChanged(e: ConfigurationChangeEvent) {
		if (
			configuration.changed(e, ['defaultDateFormat', 'views.patchDetails.files', 'views.patchDetails.avatars']) ||
			configuration.changedAny<CoreConfiguration>(e, 'workbench.tree.renderIndentGuides')
		) {
			this.updatePendingContext({
				preferences: {
					...this._context.preferences,
					...this._pendingContext?.preferences,
					avatars: configuration.get('views.patchDetails.avatars'),
					dateFormat: configuration.get('defaultDateFormat') ?? 'MMMM Do, YYYY h:mma',
					files: configuration.get('views.patchDetails.files'),
					indentGuides:
						configuration.getAny<CoreConfiguration, Preferences['indentGuides']>(
							'workbench.tree.renderIndentGuides',
						) ?? 'onHover',
				},
			});
			this.updateState();
		}
	}

	private _selectionTrackerDisposable: Disposable | undefined;
	// private _repositoryTrackerDisposable: Disposable | undefined;
	private _repositorySubscriptions: Map<Repository, Disposable> | undefined;
	private ensureTrackers(): void {
		this._selectionTrackerDisposable?.dispose();
		this._selectionTrackerDisposable = undefined;
		// this._repositoryTrackerDisposable?.dispose();
		// this._repositoryTrackerDisposable = undefined;
		if (this._repositorySubscriptions != null) {
			for (const disposable of this._repositorySubscriptions.values()) {
				disposable.dispose();
			}
			this._repositorySubscriptions.clear();
			this._repositorySubscriptions = undefined;
		}

		if (!this.host.visible) return;

		this._selectionTrackerDisposable = this.container.events.on('draft:selected', this.onDraftSelected, this);
		// this._repositoryTrackerDisposable = this.container.git.onDidChangeRepository(this.onRepositoryChanged, this);

		// TODO do we need to watch each individual repository?
		const repos = this.container.git.openRepositories;
		for (const repo of repos) {
			this.watchRepository(repo);
		}
	}

	private onRepositoriesChanged(_e: RepositoryChangeEvent) {
		this.ensureTrackers();
		void this.updateCreateStateFromWip();
	}

	private watchRepository(repository: Repository) {
		if (this._repositorySubscriptions == null) {
			this._repositorySubscriptions = new Map();
		}

		if (this._repositorySubscriptions.has(repository)) return;

		const disposable = Disposable.from(
			repository.onDidChange(this.onRepositoriesChanged, this),
			repository.onDidChangeFileSystem(() => this.updateCreateStateFromWip(repository), this),
			repository.onDidChange(e => {
				if (e.changed(RepositoryChange.Index, RepositoryChangeComparisonMode.Any)) {
					void this.updateCreateStateFromWip(repository);
				}
			}),
		);
		this._repositorySubscriptions.set(repository, disposable);
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
			case OpenInCommitGraphCommandType.method:
				onIpc(
					OpenInCommitGraphCommandType,
					e,
					params =>
						void executeCommand<ShowInCommitGraphCommandArgs>(Commands.ShowInCommitGraph, {
							ref: createReference(params.ref, params.repoPath, { refType: 'revision' }),
						}),
				);
				break;
			case UpdatePreferencesCommandType.method:
				onIpc(UpdatePreferencesCommandType, e, params => this.updatePreferences(params));
				break;
			case ExplainCommandType.method:
				onIpc(ExplainCommandType, e, () => this.explainPatch(e.completionId));
				break;
			case SelectPatchBaseCommandType.method:
				onIpc(SelectPatchBaseCommandType, e, () => void this.selectPatchBase());
				break;
			case SelectPatchRepoCommandType.method:
				onIpc(SelectPatchRepoCommandType, e, () => void this.selectPatchRepo());
				break;
			case ToggleModeCommandType.method:
				onIpc(ToggleModeCommandType, e, params => this.toggleMode(params));
				break;
			case CopyCloudLinkCommandType.method:
				onIpc(CopyCloudLinkCommandType, e, () => this.copyCloudLink());
				break;
			case CreateFromLocalPatchCommandType.method:
				onIpc(CreateFromLocalPatchCommandType, e, () => this.shareLocalPatch());
				break;
			case CreatePatchCommandType.method:
				onIpc(CreatePatchCommandType, e, params => this.createDraft(params));
				break;
		}
	}

	private shareLocalPatch() {
		if (this._context.draft?._brand !== 'local') return;

		this.updateCreateFromLocalPatch();
	}

	private copyCloudLink() {
		if (this._context.draft?._brand !== 'cloud') return;

		void env.clipboard.writeText(this._context.draft.deepLinkUrl);
	}

	private toggleMode(params: ToggleModeParams) {
		this.updatePendingContext({ mode: params.mode });
		if (params.mode === 'draft') {
			this.updateState();
		} else {
			void this.updateCreateStateFromWip();
		}
	}

	private async explainPatch(completionId?: string) {
		if (this._context.draft == null) return;

		let params: DidExplainParams;

		try {
			const commit = await this.getUnreachablePatchCommit();
			if (commit == null) return;

			const summary = await this.container.ai.explainCommit(commit, {
				progress: { location: { viewId: this.host.id } },
			});
			params = { summary: summary };
		} catch (ex) {
			debugger;
			params = { error: { message: ex.message } };
		}

		void this.host.notify(DidExplainCommandType, params, completionId);
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
		if (current.draft != null) {
			details = await this.getDetailsModel(current.draft);
		}

		if (current.create == null && !current.wipStateLoaded) {
			this._cancellationTokenSource = new CancellationTokenSource();

			const cancellation = this._cancellationTokenSource.token;
			setTimeout(() => {
				if (cancellation.isCancellationRequested) return;
				void this.updateCreateStateFromWip(undefined, cancellation);
			}, 100);
		}

		// const commitChoices = await Promise.all(this.commits.map(async commit => summaryModel(commit)));

		const state = serialize<State>({
			webviewId: this.host.id,
			timestamp: Date.now(),
			mode: current.mode,
			draft: details,
			create: current.create,
			preferences: current.preferences,
			wipStateLoaded: current.wipStateLoaded,
		});
		return state;
	}

	// @debug({ args: false })
	// private async updateRichState(current: Context, cancellation: CancellationToken): Promise<void> {
	// 	const { commit } = current;
	// 	if (commit == null) return;

	// 	const remote = await this.container.git.getBestRemoteWithRichProvider(commit.repoPath);

	// 	if (cancellation.isCancellationRequested) return;

	// 	let autolinkedIssuesOrPullRequests;
	// 	// let pr: PullRequest | undefined;

	// 	if (remote?.provider != null) {
	// 		// const [autolinkedIssuesOrPullRequestsResult, prResult] = await Promise.allSettled([
	// 		// 	configuration.get('views.patchDetails.autolinks.enabled') &&
	// 		// 	configuration.get('views.patchDetails.autolinks.enhanced')
	// 		// 		? this.container.autolinks.getLinkedIssuesAndPullRequests(commit.message ?? commit.summary, remote)
	// 		// 		: undefined,
	// 		// 	configuration.get('views.patchDetails.pullRequests.enabled')
	// 		// 		? commit.getAssociatedPullRequest({ remote: remote })
	// 		// 		: undefined,
	// 		// ]);
	// 		const autolinkedIssuesOrPullRequestsResult =
	// 			configuration.get('views.patchDetails.autolinks.enabled') &&
	// 			configuration.get('views.patchDetails.autolinks.enhanced')
	// 				? this.container.autolinks.getLinkedIssuesAndPullRequests(commit.message ?? commit.summary, remote)
	// 				: undefined;

	// 		if (cancellation.isCancellationRequested) return;

	// 		// autolinkedIssuesOrPullRequests = getSettledValue(autolinkedIssuesOrPullRequestsResult);
	// 		// pr = getSettledValue(prResult);
	// 		autolinkedIssuesOrPullRequests = autolinkedIssuesOrPullRequestsResult
	// 			? await autolinkedIssuesOrPullRequestsResult
	// 			: undefined;
	// 	}

	// 	const formattedMessage = this.getFormattedMessage(commit, remote, autolinkedIssuesOrPullRequests);

	// 	// Remove possible duplicate pull request
	// 	// if (pr != null) {
	// 	// 	autolinkedIssuesOrPullRequests?.delete(pr.id);
	// 	// }

	// 	this.updatePendingContext({
	// 		formattedMessage: formattedMessage,
	// 		// autolinkedIssues:
	// 		// 	autolinkedIssuesOrPullRequests != null ? [...autolinkedIssuesOrPullRequests.values()] : undefined,
	// 		// pullRequest: pr,
	// 	});

	// 	this.updateState();

	// 	// return {
	// 	// 	formattedMessage: formattedMessage,
	// 	// 	pullRequest: pr,
	// 	// 	autolinkedIssues:
	// 	// 		autolinkedIssuesOrPullRequests != null
	// 	// 			? [...autolinkedIssuesOrPullRequests.values()].filter(<T>(i: T | undefined): i is T => i != null)
	// 	// 			: undefined,
	// 	// };
	// }

	private _commitDisposable: Disposable | undefined;

	private updateCreate(changes: Change[]) {
		this.updatePendingContext({ mode: 'create', wipStateLoaded: true, create: changes });
		this.ensureTrackers();
		this.updateState();
	}

	private updateDraft(draft: LocalDraft | Draft | undefined, options?: { force?: boolean; immediate?: boolean }) {
		// // this.commits = [commit];
		// if (!options?.force && this._context.commit?.sha === patch?.ref) return;
		// this._commitDisposable?.dispose();
		// let commit: GitCommit | undefined;
		// if (isCommit(patch)) {
		// 	commit = patch;
		// } else if (patch != null) {
		// 	if (patch.refType === 'stash') {
		// 		const stash = await this.container.git.getStash(patch.repoPath);
		// 		commit = stash?.commits.get(patch.ref);
		// 	} else {
		// 		commit = await this.container.git.getCommit(patch.repoPath, patch.ref);
		// 	}
		// }
		// if (commit?.isUncommitted) {
		// 	const repository = this.container.git.getRepository(commit.repoPath)!;
		// 	this._commitDisposable = Disposable.from(
		// 		repository.startWatchingFileSystem(),
		// 		repository.onDidChangeFileSystem(() => {
		// 			// this.updatePendingContext({ commit: undefined });
		// 			this.updatePendingContext({ commit: commit }, true);
		// 			this.updateState();
		// 		}),
		// 	);
		// }

		this.updatePendingContext(
			{
				draft: draft,
				// richStateLoaded: false, //(commit?.isUncommitted) || !getContext('gitlens:hasConnectedRemotes'),
				// formattedMessage: undefined,
				// autolinkedIssues: undefined,
				// pullRequest: undefined,
			},
			options?.force,
		);
		this.ensureTrackers();
		this.updateState(options?.immediate ?? true);
	}

	private updatePreferences(preferences: UpdateablePreferences) {
		if (
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

		if (preferences.files != null) {
			if (this._context.preferences?.files?.compact !== preferences.files?.compact) {
				void configuration.updateEffective('views.patchDetails.files.compact', preferences.files?.compact);
			}
			if (this._context.preferences?.files?.icon !== preferences.files?.icon) {
				void configuration.updateEffective('views.patchDetails.files.icon', preferences.files?.icon);
			}
			if (this._context.preferences?.files?.layout !== preferences.files?.layout) {
				void configuration.updateEffective('views.patchDetails.files.layout', preferences.files?.layout);
			}
			if (this._context.preferences?.files?.threshold !== preferences.files?.threshold) {
				void configuration.updateEffective('views.patchDetails.files.threshold', preferences.files?.threshold);
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

	// private async updateRichState() {
	// 	if (this.commit == null) return;

	// 	const richState = await this.getRichState(this.commit);
	// 	if (richState != null) {
	// 		void this.notify(DidChangeRichStateNotificationType, richState);
	// 	}
	// }

	// private getBestCommitOrStash(): GitCommit | GitRevisionReference | undefined {
	// 	let commit: GitCommit | GitRevisionReference | undefined = this._pendingContext?.commit;
	// 	if (commit == null) {
	// 		const args = this.container.events.getCachedEventArgs('commit:selected');
	// 		commit = args?.commit;
	// 	}

	// 	return commit;
	// }

	private async getDraftPatch(draft: Draft): Promise<GitCloudPatch | undefined> {
		if (draft.changesets == null) {
			const changesets = await this.container.drafts.getChangesets(draft.id);
			draft.changesets = changesets;
		}

		const patch = draft.changesets[0].patches[0];
		if (patch == null) return undefined;

		if (patch.contents == null) {
			const contents = await this.container.drafts.getPatchContents(patch.id);
			patch.contents = contents;
		}

		return patch;
	}

	private async getDetailsModel(draft: LocalDraft | Draft): Promise<DraftDetails> {
		let patch: GitPatch | GitCloudPatch | undefined;
		if (draft._brand === 'local') {
			patch = draft.patch;
		} else {
			patch = await this.getDraftPatch(draft);
		}

		if (patch?.contents != null && patch.files == null) {
			setTimeout(async () => {
				const files = await this.container.git.getDiffFiles('', patch!.contents!);
				patch!.files = files?.files;

				this.updatePendingContext({ draft: draft }, true);
				this.updateState();
			}, 1);
		}

		const files = patch?.files?.map(({ status, repoPath, path, originalPath }) => {
			const icon = getGitFileStatusIcon(status);
			return {
				path: path,
				originalPath: originalPath,
				status: status,
				repoPath: repoPath,
				icon: {
					dark: this.host
						.asWebviewUri(Uri.joinPath(this.host.getRootUri(), 'images', 'dark', icon))
						.toString(),
					light: this.host
						.asWebviewUri(Uri.joinPath(this.host.getRootUri(), 'images', 'light', icon))
						.toString(),
				},
			};
		});

		if (draft._brand === 'local' || patch?._brand === 'file') {
			if (patch && patch.repo == null) {
				const repo = this.container.git.getBestRepository();
				if (repo != null) {
					patch.repo = repo;
				}
			}
			return {
				type: 'local',
				files: files,
				repoPath: patch?.repo?.path,
				repoName: patch?.repo?.name,
				baseRef: patch?.baseRef,
			};
		}

		if (patch != null && patch.baseRef == null) {
			patch.baseRef = patch.baseCommitSha;
		}

		return {
			type: 'cloud',
			// eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
			repoPath: patch?.repo?.path!,
			// eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
			repoName: patch?.repo?.name!,
			author: {
				name: 'You',
				email: 'no@way.com',
				avatar: undefined,
			},
			files: files,
			baseRef: patch?.baseRef,
			createdAt: draft.createdAt.getTime(),
			updatedAt: draft.updatedAt.getTime(),
		};
	}

	// private getFormattedMessage(
	// 	commit: GitCommit,
	// 	remote: GitRemote | undefined,
	// 	issuesOrPullRequests?: Map<string, IssueOrPullRequest | PromiseCancelledError | undefined>,
	// ) {
	// 	let message = CommitFormatter.fromTemplate(`\${message}`, commit);
	// 	const index = message.indexOf('\n');
	// 	if (index !== -1) {
	// 		message = `${message.substring(0, index)}${messageHeadlineSplitterToken}${message.substring(index + 1)}`;
	// 	}

	// 	if (!configuration.get('views.patchDetails.autolinks.enabled')) return message;

	// 	return this.container.autolinks.linkify(
	// 		message,
	// 		'html',
	// 		remote != null ? [remote] : undefined,
	// 		issuesOrPullRequests,
	// 	);
	// }

	private async getFileCommitFromParams(
		params: FileActionParams,
	): Promise<[commit: GitCommit, file: GitFileChange] | undefined> {
		const commit = await (await this.getUnreachablePatchCommit())?.getCommitForFile(params.path);
		return commit != null ? [commit, commit.file!] : undefined;
	}

	private async getUnreachablePatchCommit(): Promise<GitCommit | undefined> {
		let patch: GitPatch | GitCloudPatch | undefined;
		switch (this._context.draft?._brand) {
			case 'local':
				patch = this._context.draft.patch;
				break;
			case 'cloud':
				patch = await this.getDraftPatch(this._context.draft);
				if (patch == null) return undefined;
				break;
			default:
				throw new Error('Invalid patch type');
		}

		if (patch.repo == null) {
			const pick = await getRepositoryOrShowPicker(
				'Patch Details: Select Repository',
				'Choose which repository this patch belongs to',
			);
			if (pick == null) return undefined;

			patch.repo = pick;
		}

		if (patch.baseRef == null) {
			const pick = await showCommitPicker(
				this.container.git.getLog(patch.repo.uri),
				'Patch Details: Select Base',
				'Choose the base which this patch was created from or should be applied to',
			);
			if (pick == null) return undefined;

			patch.baseRef = pick.sha;
		}

		if (patch.commit == null) {
			try {
				const commit = await this.container.git.createUnreachableCommitForPatch(
					patch.repo.uri,
					patch.contents!,
					patch.baseRef ?? 'HEAD',
					'PATCH',
				);
				patch.commit = commit;
			} catch (ex) {
				void window.showErrorMessage(`Unable preview the patch on base '${patch.baseRef}': ${ex.message}`);
				patch.baseRef = undefined;
			}
		}
		return patch.commit;
	}

	private async getPatchBaseRef(patch: GitPatch | GitCloudPatch, force = false) {
		if (patch.baseRef != null && force === false) {
			return patch.baseRef;
		}

		if (patch.repo == null) {
			const pick = await getRepositoryOrShowPicker(
				'Patch Repository',
				'Choose which repository this patch belongs to',
			);
			if (pick == null) return undefined;

			patch.repo = pick;
		}

		const pick = await showCommitPicker(
			this.container.git.getLog(patch.repo.uri),
			'Patch Base',
			'Choose which base this patch was created from',
		);
		if (pick == null) return undefined;

		patch.baseRef = pick.sha;

		return patch.baseRef;
	}

	private async selectPatchBase() {
		let patch: GitPatch | GitCloudPatch | undefined;
		switch (this._context.draft?._brand) {
			case 'local':
				patch = this._context.draft.patch;
				break;
			case 'cloud':
				patch = await this.getDraftPatch(this._context.draft);
				if (patch == null) return undefined;
				break;
			default:
				throw new Error('Invalid patch type');
		}

		const baseRef = await this.getPatchBaseRef(patch, true);
		if (baseRef == null) return;

		this.updateDraft(this._context.draft, { force: true });
	}

	private async selectPatchRepo() {
		let patch: GitPatch | GitCloudPatch | undefined;
		switch (this._context.draft?._brand) {
			case 'local':
				patch = this._context.draft.patch;
				break;
			case 'cloud':
				patch = await this.getDraftPatch(this._context.draft);
				if (patch == null) return undefined;
				break;
			default:
				throw new Error('Invalid patch type');
		}

		const repo = await this.getPatchRepo(patch, true);
		if (repo == null) return;

		this.updateDraft(this._context.draft, { force: true });
	}

	private async getPatchRepo(patch: GitPatch | GitCloudPatch, force = false) {
		if (patch.repo != null && force === false) {
			return patch.repo;
		}
		const pick = await getRepositoryOrShowPicker(
			'Patch Repository',
			'Choose which repository this patch belongs to',
		);
		if (pick == null) return undefined;

		patch.repo = pick;

		return patch.repo;
	}

	private showAutolinkSettings() {
		void executeCommand(Commands.ShowSettingsPageAndJumpToAutolinks);
	}

	private showCommitSearch() {
		void executeGitCommand({ command: 'search', state: { openPickInView: true } });
	}

	// private showCommitPicker() {
	// 	void executeGitCommand({
	// 		command: 'log',
	// 		state: {
	// 			reference: 'HEAD',
	// 			repo: this._context.commit?.repoPath,
	// 			openPickInView: true,
	// 		},
	// 	});
	// }

	// private showCommitActions() {
	// 	const commit = this.getPatchCommit();
	// 	if (commit == null || commit.isUncommitted) return;

	// 	void showDetailsQuickPick(commit);
	// }

	private async showFileActions(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		void showDetailsQuickPick(commit, file);
	}

	private async openFileComparisonWithWorking(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

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

	private getShowOptions(params: FileActionParams): TextDocumentShowOptions | undefined {
		return params.showOptions;

		// return getContext('gitlens:webview:graph:active') || getContext('gitlens:webview:rebase:active')
		// 	? { ...params.showOptions, viewColumn: ViewColumn.Beside } : params.showOptions;
	}

	private updateCreateFromLocalPatch() {
		if (this._context.draft?._brand !== 'local') return;

		const patch = this._context.draft.patch;
		if (patch.baseRef == null) {
			const ref = this.getPatchBaseRef(patch);
			if (ref == null) return;
		}

		const change: Change = {
			repository: {
				name: patch.repo!.name,
				path: patch.repo!.path,
			},
			range: {
				baseSha: patch.baseRef ?? 'HEAD',
				sha: patch.commit?.sha,
				// TODO: need to figure out branch name
				branchName: '',
			},
			files:
				patch.files?.map(file => {
					return {
						repoPath: file.repoPath,
						path: file.path,
						status: file.status,
						originalPath: file.originalPath,
					};
				}) ?? [],
			type: 'commit',
		};

		this.updatePendingContext({ mode: 'create', wipStateLoaded: false, create: [change] });
		this.updateState();
	}

	private async updateCreateStateFromWip(repository?: Repository, cancellation?: CancellationToken) {
		const create: Change[] = this._context.create ?? [];
		const repos = this.container.git.openRepositories;
		for (const repo of repos) {
			if (repository != null && repo !== repository) continue;

			const change = await this.getWipChange(repo);
			if (cancellation?.isCancellationRequested) return;

			const index = create.findIndex(c => c.repository.path === repo.path);
			if (change == null) {
				if (index !== -1) {
					create.splice(index, 1);
				}
				continue;
			}

			if (index !== -1) {
				create[index] = change;
			} else {
				create.push(change);
			}
		}

		this.updatePendingContext({ wipStateLoaded: true, create: create });
		this.updateState();
	}

	@debug({ args: false })
	private async updateWipState(repository: Repository, cancellation?: CancellationToken): Promise<void> {
		const change = await this.getWipChange(repository);
		if (cancellation?.isCancellationRequested) return;

		const success =
			!this.host.ready || !this.host.visible
				? await this.host.notify(DidChangeCreateNotificationType, {
						create: change != null ? [serialize<Change>(change)] : undefined,
				  })
				: false;
		if (success) {
			this._context.create = change != null ? [change] : undefined;
		} else {
			this.updatePendingContext({ create: change != null ? [change] : undefined });
			this.updateState();
		}
	}

	private async getWipChange(repository: Repository): Promise<Change | undefined> {
		const status = await this.container.git.getStatusForRepo(repository.path);
		return status == null
			? undefined
			: {
					type: 'wip',
					repository: {
						name: repository.name,
						path: repository.path,
					},
					files: status.files.map(file => {
						return {
							repoPath: file.repoPath,
							path: file.path,
							status: file.status,
							originalPath: file.originalPath,
							staged: file.staged,
						};
					}),
					range: {
						baseSha: 'HEAD',
						sha: undefined,
						branchName: status.branch,
					},
			  };
	}

	private async getCommitChange(commit: GitCommit): Promise<Change> {
		// const [commitResult, avatarUriResult, remoteResult] = await Promise.allSettled([
		// 	!commit.hasFullDetails() ? commit.ensureFullDetails().then(() => commit) : commit,
		// 	commit.author.getAvatarUri(commit, { size: 32 }),
		// 	this.container.git.getBestRemoteWithRichProvider(commit.repoPath, { includeDisconnected: true }),
		// ]);
		// commit = getSettledValue(commitResult, commit);
		// const avatarUri = getSettledValue(avatarUriResult);
		// const remote = getSettledValue(remoteResult);

		commit = !commit.hasFullDetails() ? await commit.ensureFullDetails().then(() => commit) : commit;
		const repo = commit.getRepository()!;

		return {
			type: 'commit',
			repository: {
				name: repo.name,
				path: repo.path,
			},
			range: {
				baseSha: commit.sha,
				sha: undefined,
				branchName: repo.branch.name,
			},
			files:
				commit.files?.map(({ status, repoPath, path, originalPath, staged }) => {
					return {
						repoPath: repoPath,
						path: path,
						status: status,
						originalPath: originalPath,
						staged: staged,
					};
				}) ?? [],
		};
	}

	private async getChangeContents(change: Change) {
		const repo = this.container.git.getRepository(change.repository.path)!;
		const diff = await this.container.git.getDiff(repo.path, change.range.baseSha, change.range.sha);
		if (diff == null) return;

		return {
			repository: repo,
			baseSha: change.range.baseSha,
			contents: diff.contents,
		};
	}

	// create a patch from the current working tree or from a commit
	// create a draft from the resulting patch
	// how do I incorporate branch
	private async createDraft({ title, changes, description }: CreatePatchParams): Promise<void> {
		// const changeContents = await this.getChangeContents(changes[0]);
		// if (changeContents == null) return;
		// const draft = await this.container.drafts.createDraft(
		// 	'patch',
		// 	title,
		// 	changeContents,
		// 	description ? { description: description } : undefined,
		// );

		return Promise.resolve();
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
