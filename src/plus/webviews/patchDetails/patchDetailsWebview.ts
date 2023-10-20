import type {
	CancellationToken,
	CancellationTokenSource,
	ConfigurationChangeEvent,
	TextDocumentShowOptions,
	ViewColumn,
} from 'vscode';
import { Disposable, env, Uri, window } from 'vscode';
import type { CoreConfiguration } from '../../../constants';
import { Commands } from '../../../constants';
import type { Container } from '../../../container';
import type { DraftSelectedEvent } from '../../../eventBus';
import {
	openChanges,
	openChangesWithWorking,
	openFile,
	openFileOnRemote,
	showDetailsQuickPick,
} from '../../../git/actions/commit';
import type { GitCommit } from '../../../git/models/commit';
import type { GitDiff } from '../../../git/models/diff';
import type { GitFileChange, GitFileChangeShape } from '../../../git/models/file';
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
	ApplyPatchParams,
	Change,
	CreatePatchParams,
	DidExplainParams,
	DraftDetails,
	FileActionParams,
	Mode,
	Preferences,
	RepoChangeSet,
	RepoWipChangeSet,
	State,
	SwitchModeParams,
	UpdateablePreferences,
} from './protocol';
import {
	ApplyPatchCommandType,
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
	SwitchModeCommandType,
	UpdatePreferencesCommandType,
} from './protocol';
import type { PatchDetailsWebviewShowingArgs } from './registration';

interface Context {
	mode: Mode;
	draft: LocalDraft | Draft | undefined;
	create: Map<Repository['id'], RepositoryChangeSet>;
	preferences: Preferences;

	visible: boolean;
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
			create: new Map(
				container.git.openRepositories.map(r => [
					r.id,
					new RepositoryWipChangeSet(container, r, this.onDidChangeRepositoryWip.bind(this)),
				]),
			),
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
		};

		this._disposable = Disposable.from(
			configuration.onDidChangeAny(this.onAnyConfigurationChanged, this),
			container.git.onDidChangeRepository(this.onRepositoriesChanged, this),
		);
	}

	dispose() {
		this._disposable.dispose();
		// this._selectionTrackerDisposable?.dispose();
	}

	onReloaded(): void {
		void this.notifyDidChangeState(true);
	}

	onDidChangeRepositoryWip(_e: RepositoryWipChangeSet) {
		this.updateState();
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
		// if (focused) {
		// 	this.ensureTrackers();
		// }
	}

	onVisibilityChanged(visible: boolean) {
		// this.ensureTrackers();
		this.updatePendingContext({ visible: visible });
		if (!visible) return;

		// Since this gets called even the first time the webview is shown, avoid sending an update, because the bootstrap has the data
		if (this._bootstraping) {
			this._bootstraping = false;

			if (this._pendingContext == null) return;

			this.updateState();
		} else {
			this.updateState(true);
		}
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

	// private _selectionTrackerDisposable: Disposable | undefined;
	// // private _repositoryTrackerDisposable: Disposable | undefined;
	// private _repositorySubscriptions: Map<Repository, Disposable> | undefined;
	// private ensureTrackers(): void {
	// 	this._selectionTrackerDisposable?.dispose();
	// 	this._selectionTrackerDisposable = undefined;
	// 	// this._repositoryTrackerDisposable?.dispose();
	// 	// this._repositoryTrackerDisposable = undefined;
	// 	if (this._repositorySubscriptions != null) {
	// 		for (const disposable of this._repositorySubscriptions.values()) {
	// 			disposable.dispose();
	// 		}
	// 		this._repositorySubscriptions.clear();
	// 		this._repositorySubscriptions = undefined;
	// 	}

	// 	if (!this.host.visible) return;

	// 	this._selectionTrackerDisposable = this.container.events.on('draft:selected', this.onDraftSelected, this);
	// 	// this._repositoryTrackerDisposable = this.container.git.onDidChangeRepository(this.onRepositoryChanged, this);

	// 	// TODO do we need to watch each individual repository?
	// 	// const repos = this.container.git.openRepositories;
	// 	// for (const repo of repos) {
	// 	// 	this.watchRepository(repo);
	// 	// }
	// 	if (this._context.create == null) {
	// 		const repo = this.container.git.getBestRepositoryOrFirst();
	// 		if (repo == null) return;
	// 		this.watchRepository(repo);
	// 	} else {
	// 		for (const change of this._context.create) {
	// 			const repo = this.container.git.getRepository(change.repository.uri);
	// 			if (repo == null) continue;
	// 			this.watchRepository(repo);
	// 		}
	// 	}
	// }

	private onRepositoriesChanged(_e: RepositoryChangeEvent) {
		// this.ensureTrackers();
		// void this.updateCreateStateFromWip();
	}

	// private watchRepository(repository: Repository) {
	// 	if (this._repositorySubscriptions == null) {
	// 		this._repositorySubscriptions = new Map();
	// 	}

	// 	if (this._repositorySubscriptions.has(repository)) return;

	// 	const disposable = Disposable.from(
	// 		repository.onDidChange(this.onRepositoriesChanged, this),
	// 		repository.onDidChangeFileSystem(() => this.updateCreateStateFromWip(repository), this),
	// 		repository.onDidChange(e => {
	// 			if (e.changed(RepositoryChange.Index, RepositoryChangeComparisonMode.Any)) {
	// 				void this.updateCreateStateFromWip(repository);
	// 			}
	// 		}),
	// 	);
	// 	this._repositorySubscriptions.set(repository, disposable);
	// }

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
			case SwitchModeCommandType.method:
				onIpc(SwitchModeCommandType, e, params => this.switchMode(params));
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
			case ApplyPatchCommandType.method:
				onIpc(ApplyPatchCommandType, e, params => this.applyPatch(params));
		}
	}

	private get mode(): Mode {
		return this._pendingContext?.mode ?? this._context.mode;
	}

	private setMode(mode: Mode) {
		this.updatePendingContext({ mode: mode });
		if (mode === 'draft') {
			this.updateState(true);
		} else {
			// void this.updateCreateStateFromWip();
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

	private applyPatch(params: ApplyPatchParams) {
		if (params.details.repoPath == null || params.details.commit == null) return;

		void this.container.git.applyPatchCommit(params.details.repoPath, params.details.commit, params.targetRef);
	}

	private switchMode(params: SwitchModeParams) {
		this.setMode(params.mode);
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
			this._cancellationTokenSource = undefined;
		}

		let details;
		if (current.draft != null) {
			details = await this.getDetailsModel(current.draft);
		}

		if (current.create == null) {
			// this._cancellationTokenSource = new CancellationTokenSource();
			// const cancellation = this._cancellationTokenSource.token;
			// setTimeout(() => {
			// 	if (cancellation.isCancellationRequested) return;
			// 	void this.updateCreateStateFromWip(undefined, cancellation);
			// }, 100);
		}

		const state = serialize<State>({
			webviewId: this.host.id,
			timestamp: Date.now(),
			mode: current.mode,
			draft: details,
			create: await toRepoChanges(current.create),
			preferences: current.preferences,
		});
		return state;
	}

	private _commitDisposable: Disposable | undefined;

	private updateCreate(changes: Change[]) {
		const repoChanges = this._context.create ?? new Map<Repository['id'], RepositoryChangeSet>();

		const updated = new Set<Repository['id']>();
		for (const change of changes) {
			const repo = this.container.git.getRepository(Uri.parse(change.repository.uri));
			if (repo == null) continue;

			let repoChangeSet: RepositoryChangeSet;
			if (change.type === 'wip') {
				repoChangeSet = new RepositoryWipChangeSet(
					this.container,
					repo,
					this.onDidChangeRepositoryWip.bind(this),
				);
				repoChangeSet.checked = true;
			} else {
				repoChangeSet = {
					checked: true,
					getChange: async () =>
						Promise.resolve({
							type: change.type,
							repoName: repo.name,
							repoUri: repo.uri.toString(),
							change: change,

							checked: true,
							expanded: true,
						}),
					provideDataForDraft: async () =>
						Promise.resolve({
							repository: repo,
							baseSha: change.range.baseSha,
							branchName: change.range.branchName,
						}),
				};
			}

			updated.add(repo.id);
			repoChanges.set(repo.id, repoChangeSet);
		}

		if (updated.size !== repoChanges.size) {
			for (const [id, repoChange] of repoChanges) {
				if (updated.has(id)) continue;
				repoChange.checked = false;
			}
		}

		this.updatePendingContext({ mode: 'create', create: repoChanges });
		this.updateState();

		// this.updatePendingContext({ mode: 'create', wipStateLoaded: true, create: changes });
		// // this.ensureTrackers();
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
				mode: 'draft',
				draft: draft,
				// richStateLoaded: false, //(commit?.isUncommitted) || !getContext('gitlens:hasConnectedRemotes'),
				// formattedMessage: undefined,
				// autolinkedIssues: undefined,
				// pullRequest: undefined,
			},
			options?.force,
		);
		// this.ensureTrackers();
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

	private async getDraftPatch(draft: Draft): Promise<GitCloudPatch | undefined> {
		if (draft.changesets == null) {
			const changesets = await this.container.drafts.getChangesets(draft.id);
			draft.changesets = changesets;
		}

		const patch = draft.changesets[0].patches?.[0];
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

		if (draft._brand === 'local' || patch?._brand === 'file') {
			if (patch && patch.repo == null) {
				const repo = this.container.git.getBestRepository();
				if (repo != null) {
					patch.repo = repo;
				}
			}
			return {
				type: 'local',
				files: patch?.files,
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
			commit: (await this.getUnreachablePatchCommit())?.sha,
			// eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
			repoPath: patch?.repo?.path!,
			// eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
			repoName: patch?.repo?.name!,
			author: {
				name: 'You',
				email: 'no@way.com',
				avatar: undefined,
			},
			title: draft.title,
			description: draft.description,
			files: patch?.files,
			baseRef: patch?.baseRef,
			createdAt: draft.createdAt.getTime(),
			updatedAt: draft.updatedAt.getTime(),
		};
	}

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

		// TODO: need to figure out branch name
		const branchName = '';
		const baseSha = patch.baseRef ?? 'HEAD';
		const change: RepoChangeSet = {
			type: 'commit',
			repoName: patch.repo!.name,
			repoUri: patch.repo!.uri.toString(),
			change: {
				type: 'commit',
				repository: {
					name: patch.repo!.name,
					path: patch.repo!.path,
					uri: patch.repo!.uri.toString(),
				},
				range: {
					baseSha: baseSha,
					sha: patch.commit?.sha,
					branchName: branchName,
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
			},
			checked: true,
			expanded: true,
		};

		this.updatePendingContext({
			mode: 'create',
			create: new Map([
				[
					patch.repo!.id,
					{
						checked: true,
						getChange: () => Promise.resolve(change),
						provideDataForDraft: () =>
							Promise.resolve({ repository: patch.repo!, branchName: branchName, baseSha: baseSha }),
					},
				],
			]),
		});
		this.updateState();
	}

	// private async updateCreateStateFromWip(repository?: Repository, cancellation?: CancellationToken) {
	// 	const changes: Change[] =
	// 		this._context.create?.filter(
	// 			change => change.type === 'wip' && (repository == null || change.repository.path === repository.path),
	// 		) ?? [];

	// 	// if there's no created changes:
	// 	// - then we need to load the wip state from repository
	// 	// - or if there's no repository, then we need to load the wip state from the best repository

	// 	// if there's created changes:
	// 	// - then we need to update the wip state of the change matching the repository
	// 	// - or if there's no repository, then we need to update the wip state of all changes

	// 	if (changes.length === 0) {
	// 		if (repository == null) {
	// 			repository = this.container.git.getBestRepositoryOrFirst();
	// 		}
	// 		if (repository == null) return;
	// 		const change = await this.getWipChange(repository);
	// 		if (change == null || cancellation?.isCancellationRequested) return;
	// 		changes.push(change);
	// 	} else {
	// 		for (const change of changes) {
	// 			const repo = repository ?? this.container.git.getRepository(change.repository.uri);
	// 			if (repo == null) {
	// 				changes.splice(changes.indexOf(change), 1);
	// 				continue;
	// 			}

	// 			const wip = await this.getWipChange(repo);
	// 			if (wip == null || cancellation?.isCancellationRequested) return;

	// 			changes[changes.indexOf(change)] = wip;
	// 		}
	// 	}

	// 	this.updatePendingContext({ wipStateLoaded: true, create: changes });
	// 	this.updateState(true);
	// }

	// private async updateCreateStateFromWipOld(repository?: Repository, cancellation?: CancellationToken) {
	// 	const create: Change[] = this._context.create ?? [];
	// 	const repos = this.container.git.openRepositories;
	// 	for (const repo of repos) {
	// 		if (repository != null && repo !== repository) continue;

	// 		const change = await this.getWipChange(repo);
	// 		if (cancellation?.isCancellationRequested) return;

	// 		// TODO: not checking if its a wip change
	// 		const index = create.findIndex(c => c.repository.path === repo.path);
	// 		if (change == null) {
	// 			if (index !== -1) {
	// 				create.splice(index, 1);
	// 			}
	// 			continue;
	// 		}

	// 		if (index !== -1) {
	// 			create[index] = change;
	// 		} else {
	// 			create.push(change);
	// 		}
	// 	}

	// 	this.updatePendingContext({ wipStateLoaded: true, create: create });
	// 	this.updateState(true);
	// }

	// @debug({ args: false })
	// private async updateWipState(repository: Repository, cancellation?: CancellationToken): Promise<void> {
	// 	const change = await this.getWipChange(repository);
	// 	if (cancellation?.isCancellationRequested) return;

	// 	const success =
	// 		!this.host.ready || !this.host.visible
	// 			? await this.host.notify(DidChangeCreateNotificationType, {
	// 					create: change != null ? [serialize<Change>(change)] : undefined,
	// 			  })
	// 			: false;
	// 	if (success) {
	// 		this._context.create = change != null ? [change] : undefined;
	// 	} else {
	// 		this.updatePendingContext({ create: change != null ? [change] : undefined });
	// 		this.updateState();
	// 	}
	// }

	// private async getWipChange(repository: Repository): Promise<Change | undefined> {
	// 	const status = await this.container.git.getStatusForRepo(repository.path);
	// 	if (status == null) return undefined;

	// 	const files: GitFileChangeShape[] = [];
	// 	for (const file of status.files) {
	// 		const change = {
	// 			repoPath: file.repoPath,
	// 			path: file.path,
	// 			status: file.status,
	// 			originalPath: file.originalPath,
	// 			staged: file.staged,
	// 		};

	// 		files.push(change);
	// 		if (file.staged && file.wip) {
	// 			files.push({ ...change, staged: false });
	// 		}
	// 	}

	// 	return {
	// 		type: 'wip',
	// 		repository: {
	// 			name: repository.name,
	// 			path: repository.path,
	// 			uri: repository.uri.toString(),
	// 		},
	// 		files: files,
	// 		range: {
	// 			baseSha: 'HEAD',
	// 			sha: undefined,
	// 			branchName: status.branch,
	// 		},
	// 	};
	// }

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
				uri: repo.uri.toString(),
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

	private async getChangeContents(changeSet: RepoChangeSet) {
		if (changeSet.change == null) return;

		const repo = this.container.git.getRepository(Uri.parse(changeSet.repoUri))!;
		const diff = await this.container.git.getDiff(
			repo.path,
			changeSet.change.range.baseSha,
			changeSet.change.range.sha,
		);
		if (diff == null) return;

		return {
			repository: repo,
			baseSha: changeSet.change.range.baseSha,
			contents: diff.contents,
		};
	}

	// create a patch from the current working tree or from a commit
	// create a draft from the resulting patch
	// how do I incorporate branch
	private async createDraft({ title, changeSets, description }: CreatePatchParams): Promise<void> {
		// const changeContents = await this.getChangeContents(changeSets);
		const changeContents: { contents: string; baseSha: string; repository: Repository }[] = [];
		for (const [id, changeSet] of Object.entries(changeSets)) {
			if (changeSet.checked === false) continue;

			const repositoryChangeSet = this._context.create?.get(id);
			if (repositoryChangeSet == null) continue;

			const { baseSha, branchName, repository } = await repositoryChangeSet.provideDataForDraft();

			let diff: GitDiff | undefined;
			if (changeSet.type === 'wip') {
				if (changeSet.checked === 'staged') {
					// need to get the staged changes only
					diff = await this.container.git.getDiff(
						repository.path,
						changeSet.change!.range.baseSha,
						changeSet.change!.range.sha,
					);
				} else {
					diff = await this.container.git.getDiff(
						repository.path,
						changeSet.change!.range.baseSha,
						changeSet.change!.range.sha,
					);
				}
			} else {
				diff = await this.container.git.getDiff(
					repository.path,
					changeSet.change.range.baseSha,
					changeSet.change.range.sha,
				);
			}
			if (diff == null) continue;

			changeContents.push({
				repository: repository,
				baseSha: baseSha,
				contents: diff.contents,
			});
		}
		if (changeContents == null) return;

		// TODO: support multiple changesets in createDraft
		// const draft = await this.container.drafts.createDraft(
		// 	'patch',
		// 	title,
		// 	changeContents,
		// 	description ? { description: description } : undefined,
		// );

		return Promise.resolve();
	}
}

async function toRepoChanges(
	createMap?: Map<Repository['id'], RepositoryChangeSet>,
): Promise<Record<string, RepoChangeSet>> {
	const repoChanges: Record<string, RepoChangeSet> = {};
	if (createMap == null || createMap.size === 0) return repoChanges;

	for (const [id, repo] of createMap) {
		const change = await repo.getChange();
		if (change.checked !== repo.checked) {
			change.checked = repo.checked;
		}
		repoChanges[id] = change;
	}

	return repoChanges;
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

interface RepositoryChangeSet {
	checked: RepoWipChangeSet['checked'];
	getChange(): Promise<RepoChangeSet>;
	provideDataForDraft(): Promise<{ baseSha: string; branchName: string; repository: Repository }>;
}

class RepositoryWipChangeSet implements RepositoryChangeSet {
	private _disposable: Disposable | undefined;

	constructor(
		private readonly container: Container,
		public readonly repository: Repository,
		private readonly onDidChangeRepositoryWip: (e: RepositoryWipChangeSet) => void,
		expanded: boolean = true,
	) {
		this.expanded = expanded;
	}

	private _checked: RepoWipChangeSet['checked'] = false;
	get checked(): RepoWipChangeSet['checked'] {
		return this._checked;
	}
	set checked(value: RepoWipChangeSet['checked']) {
		this._checked = value;
	}

	private _expanded = false;
	get expanded(): boolean {
		return this._expanded;
	}
	set expanded(value: boolean) {
		if (this._expanded === value) return;

		this._wipChange = undefined;
		if (value) {
			this.subscribe();
		} else {
			this._disposable?.dispose();
			this._disposable = undefined;
		}
		this._expanded = value;
	}

	private _wipChange: Promise<Change> | undefined;
	async getChange(): Promise<RepoChangeSet> {
		if (this.expanded && this._wipChange == null) {
			this._wipChange = this.getWipChange();
		}

		return {
			type: 'wip',
			repoName: this.repository.name,
			repoUri: this.repository.uri.toString(),
			change: this.expanded ? await this._wipChange : undefined,
			checked: this.checked,
			expanded: this.expanded,
		};
	}

	async provideDataForDraft(): Promise<{
		contents: string;
		baseSha: string;
		branchName: string;
		repository: Repository;
	}> {
		return Promise.resolve({
			contents: '',
			baseSha: 'HEAD',
			branchName: '',
			repository: this.repository,
		});
	}

	private subscribe() {
		if (this._disposable != null) return;

		this._disposable = Disposable.from(
			this.repository.startWatchingFileSystem(),
			this.repository.onDidChangeFileSystem(() => this.onDidChangeWip(), this),
			this.repository.onDidChange(e => {
				if (e.changed(RepositoryChange.Index, RepositoryChangeComparisonMode.Any)) {
					this.onDidChangeWip();
				}
			}),
		);
	}

	private onDidChangeWip() {
		this._wipChange = undefined;
		this.onDidChangeRepositoryWip(this);
	}

	private async getWipChange(): Promise<Change> {
		const status = await this.container.git.getStatusForRepo(this.repository.path);

		const files: GitFileChangeShape[] = [];
		if (status != null) {
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
					files.push({ ...change, staged: false });
				}
			}
		}

		return {
			type: 'wip',
			repository: {
				name: this.repository.name,
				path: this.repository.path,
				uri: this.repository.uri.toString(),
			},
			files: files,
			range: {
				baseSha: 'HEAD',
				sha: undefined,
				branchName: status?.branch ?? '',
			},
		};
	}
}
