import type { ConfigurationChangeEvent, TextDocumentShowOptions } from 'vscode';
import { Disposable, env, Uri, window } from 'vscode';
import type { CoreConfiguration } from '../../../constants';
import { Commands } from '../../../constants';
import type { Container } from '../../../container';
import {
	openChanges,
	openChangesWithWorking,
	openFile,
	openFileOnRemote,
	showDetailsQuickPick,
} from '../../../git/actions/commit';
import type { RepositoriesChangeEvent } from '../../../git/gitProviderService';
import type { GitCommit } from '../../../git/models/commit';
import { uncommitted } from '../../../git/models/constants';
import type { GitDiff } from '../../../git/models/diff';
import { GitFileChange } from '../../../git/models/file';
import type { GitPatch, RevisionRange } from '../../../git/models/patch';
import { createReference } from '../../../git/models/reference';
import type { CreateDraftChange, Draft, DraftPatch, LocalDraft } from '../../../gk/models/drafts';
import { showCommitPicker } from '../../../quickpicks/commitPicker';
import { getRepositoryOrShowPicker } from '../../../quickpicks/repositoryPicker';
import { executeCommand, registerCommand } from '../../../system/command';
import { configuration } from '../../../system/configuration';
import { debug } from '../../../system/decorators/log';
import type { Deferrable } from '../../../system/function';
import { debounce } from '../../../system/function';
import { find } from '../../../system/iterable';
import type { Serialized } from '../../../system/serialize';
import { serialize } from '../../../system/serialize';
import type { IpcMessage } from '../../../webviews/protocol';
import { onIpc } from '../../../webviews/protocol';
import type { WebviewController, WebviewProvider } from '../../../webviews/webviewController';
import type { WebviewShowOptions } from '../../../webviews/webviewsController';
import type { ShowInCommitGraphCommandArgs } from '../graph/protocol';
import type {
	ApplyPatchParams,
	Change,
	CreatePatchCheckRepositoryParams,
	CreatePatchParams,
	DidExplainParams,
	FileActionParams,
	Mode,
	Preferences,
	State,
	SwitchModeParams,
	UpdateablePreferences,
} from './protocol';
import {
	ApplyPatchCommandType,
	CopyCloudLinkCommandType,
	CreateFromLocalPatchCommandType,
	CreatePatchCheckRepositoryCommandType,
	CreatePatchCommandType,
	DidChangeCreateNotificationType,
	DidChangeDraftNotificationType,
	DidChangeNotificationType,
	DidChangePreferencesNotificationType,
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
import type { CreateDraft, PatchDetailsWebviewShowingArgs } from './registration';
import type { RepositoryChangeset } from './repositoryChangeset';
import { RepositoryRefChangeset, RepositoryWipChangeset } from './repositoryChangeset';

interface Context {
	mode: Mode;
	open: LocalDraft | Draft | undefined;
	create:
		| {
				title?: string;
				description?: string;
				changes: Map<string, RepositoryChangeset>;
				showingAllRepos: boolean;
		  }
		| undefined;
	preferences: Preferences;
}

export class PatchDetailsWebviewProvider
	implements WebviewProvider<State, Serialized<State>, PatchDetailsWebviewShowingArgs>
{
	private _context: Context;
	private readonly _disposable: Disposable;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewController<State, Serialized<State>, PatchDetailsWebviewShowingArgs>,
	) {
		this._context = {
			mode: 'create',
			open: undefined,
			create: undefined,
			preferences: this.getPreferences(),
		};

		this._disposable = Disposable.from(
			configuration.onDidChangeAny(this.onAnyConfigurationChanged, this),
			container.git.onDidChangeRepositories(this.onRepositoriesChanged, this),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	async onShowing(
		_loading: boolean,
		options: WebviewShowOptions,
		...args: PatchDetailsWebviewShowingArgs
	): Promise<boolean> {
		const [arg] = args;
		if (arg?.mode === 'open' && arg.open != null) {
			this.updateOpenState(arg.open);
		} else {
			if (this.container.git.isDiscoveringRepositories) {
				await this.container.git.isDiscoveringRepositories;
			}

			const create = arg?.mode === 'create' && arg.create != null ? arg.create : { repositories: undefined };
			this.updateCreateState(create);
		}

		if (options?.preserveVisibility && !this.host.visible) return false;

		return true;
	}

	includeBootstrap(): Promise<Serialized<State>> {
		return this.getState(this._context);
	}

	registerCommands(): Disposable[] {
		return [registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true))];
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
				break;
			case CreatePatchCheckRepositoryCommandType.method:
				onIpc(CreatePatchCheckRepositoryCommandType, e, params => this.checkChange(params));
		}
	}

	onRefresh(): void {
		this.updateState(true);
	}

	onReloaded(): void {
		this.updateState(true);
	}

	onVisibilityChanged(visible: boolean) {
		// TODO@eamodio ugly -- clean this up later
		this._context.create?.changes.forEach(c => (visible ? c.resume() : c.suspend()));

		if (visible) {
			this.host.sendPendingIpcNotifications();
		}
	}

	private onAnyConfigurationChanged(e: ConfigurationChangeEvent) {
		if (
			configuration.changed(e, ['defaultDateFormat', 'views.patchDetails.files', 'views.patchDetails.avatars']) ||
			configuration.changedAny<CoreConfiguration>(e, 'workbench.tree.renderIndentGuides') ||
			configuration.changedAny<CoreConfiguration>(e, 'workbench.tree.indent')
		) {
			this._context.preferences = { ...this._context.preferences, ...this.getPreferences() };
			this.updateState();
		}
	}

	private getPreferences(): Preferences {
		return {
			avatars: configuration.get('views.patchDetails.avatars'),
			dateFormat: configuration.get('defaultDateFormat') ?? 'MMMM Do, YYYY h:mma',
			files: configuration.get('views.patchDetails.files'),
			indentGuides:
				configuration.getAny<CoreConfiguration, Preferences['indentGuides']>(
					'workbench.tree.renderIndentGuides',
				) ?? 'onHover',
			indent: configuration.getAny<CoreConfiguration, Preferences['indent']>('workbench.tree.indent'),
		};
	}

	private onRepositoriesChanged(e: RepositoriesChangeEvent) {
		if (this.mode === 'create' && this._context.create != null) {
			if (this._context.create?.showingAllRepos) {
				for (const repo of e.added) {
					this._context.create.changes.set(
						repo.uri.toString(),
						new RepositoryWipChangeset(
							this.container,
							repo,
							{ baseSha: 'HEAD', sha: undefined },
							this.onRepositoryWipChanged.bind(this),
							false,
							true,
						),
					);
				}
			}

			for (const repo of e.removed) {
				this._context.create.changes.delete(repo.uri.toString());
			}

			void this.notifyDidChangeCreateState();
		}
	}

	private onRepositoryWipChanged(_e: RepositoryWipChangeset) {
		void this.notifyDidChangeCreateState();
	}

	private get mode(): Mode {
		return this._context.mode;
	}
	private setMode(mode: Mode) {
		this._context.mode = mode;
		this.updateState(true);
	}

	private applyPatch(params: ApplyPatchParams) {
		if (params.details.repoPath == null || params.details.commit == null) return;

		void this.container.git.applyPatchCommit(params.details.repoPath, params.details.commit, {
			branchName: params.targetRef,
		});
	}

	private checkChange(params: CreatePatchCheckRepositoryParams) {
		const changeset = this._context.create?.changes.get(params.repoUri);
		if (changeset == null) return;

		changeset.checked = params.checked;
		void this.notifyDidChangeCreateState();
	}

	private copyCloudLink() {
		if (this._context.open?.draftType !== 'cloud') return;

		void env.clipboard.writeText(this._context.open.deepLinkUrl);
	}

	private async explainPatch(completionId?: string) {
		let params: DidExplainParams;

		try {
			const commit = await this.getOrCreateUnreachableCommitForPatch();
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

	private shareLocalPatch() {
		if (this._context.open?.draftType !== 'local') return;

		this.updateCreateFromLocalPatch(this._context.open);
	}

	private switchMode(params: SwitchModeParams) {
		this.setMode(params.mode);
	}

	private _notifyDidChangeStateDebounced: Deferrable<() => void> | undefined = undefined;

	private updateState(immediate: boolean = false) {
		this.host.clearPendingIpcNotifications();

		if (immediate) {
			void this.notifyDidChangeState();
			return;
		}

		if (this._notifyDidChangeStateDebounced == null) {
			this._notifyDidChangeStateDebounced = debounce(this.notifyDidChangeState.bind(this), 500);
		}

		this._notifyDidChangeStateDebounced();
	}

	@debug({ args: false })
	protected async getState(current: Context): Promise<Serialized<State>> {
		let create;
		if (current.mode === 'create' && current.create != null) {
			create = await this.getCreateState(current);
		}

		let details;
		if (current.mode === 'open' && current.open != null) {
			details = await this.getDraftState(current);
		}

		const state = serialize<State>({
			...this.host.baseWebviewState,
			mode: current.mode,
			create: create,
			draft: details,
			preferences: current.preferences,
		});
		return state;
	}

	private async notifyDidChangeState() {
		this._notifyDidChangeStateDebounced?.cancel();
		return this.host.notify(DidChangeNotificationType, { state: await this.getState(this._context) });
	}

	private updateCreateState(create: CreateDraft) {
		let changesetByRepo: Map<string, RepositoryChangeset>;
		let allRepos = false;

		if (create.changes != null) {
			changesetByRepo = new Map<string, RepositoryChangeset>();

			const updated = new Set<string>();
			for (const change of create.changes) {
				const repo = this.container.git.getRepository(Uri.parse(change.repository.uri));
				if (repo == null) continue;

				let changeset: RepositoryChangeset;
				if (change.type === 'wip') {
					changeset = new RepositoryWipChangeset(
						this.container,
						repo,
						change.revision,
						this.onRepositoryWipChanged.bind(this),
						change.checked ?? true,
						change.expanded ?? true,
					);
				} else {
					changeset = new RepositoryRefChangeset(
						this.container,
						repo,
						change.revision,
						change.files,
						change.checked ?? true,
						change.expanded ?? true,
					);
				}

				updated.add(repo.uri.toString());
				changesetByRepo.set(repo.uri.toString(), changeset);
			}

			if (updated.size !== changesetByRepo.size) {
				for (const [uri, repoChange] of changesetByRepo) {
					if (updated.has(uri)) continue;
					repoChange.checked = false;
				}
			}
		} else {
			allRepos = create.repositories == null;
			const repos = create.repositories ?? this.container.git.openRepositories;
			changesetByRepo = new Map(
				repos.map(r => [
					r.uri.toString(),
					new RepositoryWipChangeset(
						this.container,
						r,
						{
							baseSha: 'HEAD',
							sha: undefined,
						},
						this.onRepositoryWipChanged.bind(this),
						false,
						true, // TODO revisit
					),
				]),
			);
		}

		this._context.mode = 'create';
		this._context.create = {
			title: create.title,
			description: create.description,
			changes: changesetByRepo,
			showingAllRepos: allRepos,
		};
		void this.notifyDidChangeCreateState();
	}

	private async getCreateState(current: Context): Promise<Serialized<State>['create'] | undefined> {
		const { create } = current;
		if (create == null) return undefined;

		const repoChanges: Record<string, Change> = {};

		if (create.changes.size !== 0) {
			for (const [id, repo] of create.changes) {
				const change = await repo.getChange();
				if (change?.files?.length === 0) continue; // TODO remove when we support dynamic expanded repos

				if (change.checked !== repo.checked) {
					change.checked = repo.checked;
				}
				repoChanges[id] = change;
			}
		}

		return {
			title: create.title,
			description: create.description,
			changes: repoChanges,
		};
	}

	private async notifyDidChangeCreateState() {
		return this.host.notify(DidChangeCreateNotificationType, {
			mode: this._context.mode,
			create: await this.getCreateState(this._context),
		});
	}

	private updateOpenState(draft: LocalDraft | Draft | undefined) {
		this._context.mode = 'open';
		this._context.open = draft;
		void this.notifyDidChangeDraftState();
	}

	private async getDraftState(current: Context): Promise<Serialized<State>['draft'] | undefined> {
		if (current.open == null) return undefined;

		const draft = current.open;

		let patch: GitPatch | DraftPatch | undefined;
		if (draft.draftType === 'local') {
			patch = draft.patch;
		} else {
			patch = await this.getDraftPatch(draft);
		}

		if (patch?.contents != null && patch.files == null) {
			setTimeout(async () => {
				const files = await this.container.git.getDiffFiles('', patch!.contents!);
				patch!.files = files?.files;

				this._context.open = draft;
				void this.notifyDidChangeDraftState();
			}, 1);
		}

		if (draft.draftType === 'local' || patch?.type === 'local') {
			if (patch && patch.repository == null) {
				const repo = this.container.git.getBestRepository();
				if (repo != null) {
					patch.repository = repo;
				}
			}
			return {
				type: 'local',
				files: patch?.files,
				repoPath: patch?.repository?.path,
				repoName: patch?.repository?.name,
				baseRef: patch?.baseRef,
			};
		}

		// if (patch != null && patch.baseRef == null) {
		// 	patch.baseRef = patch.baseRef;
		// }

		return {
			type: 'cloud',
			commit: (await this.getOrCreateUnreachableCommitForPatch())?.sha,
			// eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
			repoPath: patch?.repository?.path!,
			// eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
			repoName: patch?.repository?.name!,
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

	private async notifyDidChangeDraftState() {
		return this.host.notify(DidChangeDraftNotificationType, {
			mode: this._context.mode,
			draft: await this.getDraftState(this._context),
		});
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

			this._context.preferences.files = preferences.files;
		}

		void this.notifyDidChangePreferences();
	}

	private async notifyDidChangePreferences() {
		return this.host.notify(DidChangePreferencesNotificationType, { preferences: this._context.preferences });
	}

	private async getDraftPatch(draft: Draft): Promise<DraftPatch | undefined> {
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

	private async getFileCommitFromParams(
		params: FileActionParams,
	): Promise<
		[commit: GitCommit, file: GitFileChange, revision?: Required<Omit<RevisionRange, 'branchName'>>] | undefined
	> {
		let [commit, revision] = await this.getOrCreateCommit(params.repoPath);

		if (commit != null && revision != null) {
			return [
				commit,
				new GitFileChange(
					params.repoPath,
					params.path,
					params.status,
					params.originalPath,
					undefined,
					undefined,
					params.staged,
				),
				revision,
			];
		}

		commit = await commit?.getCommitForFile(params.path, params.staged);
		return commit != null ? [commit, commit.file!, revision] : undefined;
	}

	private async getOrCreateCommit(
		repoPath: string,
	): Promise<[commit: GitCommit | undefined, revision?: RevisionRange]> {
		if (this.mode === 'create') {
			const changeset = find(this._context.create!.changes.values(), cs => cs.repository.path === repoPath);
			if (changeset == null) return [undefined];

			const change = await changeset.getChange();
			if (change == null) return [undefined];

			if (change.type === 'revision') {
				const commit = await this.container.git.getCommit(repoPath, change.revision.sha ?? uncommitted);
				if (
					change.revision.sha === change.revision.baseSha ||
					change.revision.sha === change.revision.baseSha.substring(0, change.revision.baseSha.length - 1)
				) {
					return [commit];
				}

				return [commit, change.revision];
			} else if (change.type === 'wip') {
				return [await this.container.git.getCommit(repoPath, change.revision.sha ?? uncommitted)];
			}

			return [undefined];
		}

		if (this.mode === 'open') {
			return [await this.getOrCreateUnreachableCommitForPatch(repoPath)];
		}

		return [undefined];
	}

	private async getOrCreateUnreachableCommitForPatch(repoPath?: string): Promise<GitCommit | undefined> {
		let patch: GitPatch | DraftPatch | undefined;
		switch (this._context.open?.draftType) {
			case 'local':
				patch = this._context.open.patch;
				break;
			case 'cloud':
				patch = await this.getDraftPatch(this._context.open);
				if (patch == null) return undefined;
				break;
			default:
				throw new Error('Invalid patch type');
		}

		if (patch.repository == null) {
			const repo = repoPath != null ? this.container.git.getRepository(repoPath) : undefined;
			if (repo == null) {
				const pick = await getRepositoryOrShowPicker(
					'Patch Details: Select Repository',
					'Choose which repository this patch belongs to',
				);
				if (pick == null) return undefined;

				patch.repository = pick;
			} else {
				patch.repository = repo;
			}
		}

		if (patch.baseRef == null) {
			const pick = await showCommitPicker(
				this.container.git.getLog(patch.repository.uri),
				'Patch Details: Select Base',
				'Choose the base which this patch was created from or should be applied to',
			);
			if (pick == null) return undefined;

			patch.baseRef = pick.sha;
		}

		if (patch.commit == null) {
			try {
				const commit = await this.container.git.createUnreachableCommitForPatch(
					patch.repository.uri,
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

	private async getPatchBaseRef(patch: GitPatch | DraftPatch, force = false) {
		if (patch.baseRef != null && force === false) {
			return patch.baseRef;
		}

		if (patch.repository == null) {
			const pick = await getRepositoryOrShowPicker(
				'Patch Repository',
				'Choose which repository this patch belongs to',
			);
			if (pick == null) return undefined;

			patch.repository = pick;
		}

		const pick = await showCommitPicker(
			this.container.git.getLog(patch.repository.uri),
			'Patch Base',
			'Choose which base this patch was created from',
		);
		if (pick == null) return undefined;

		patch.baseRef = pick.sha;

		return patch.baseRef;
	}

	private async selectPatchBase() {
		let patch: GitPatch | DraftPatch | undefined;
		switch (this._context.open?.draftType) {
			case 'local':
				patch = this._context.open.patch;
				break;
			case 'cloud':
				patch = await this.getDraftPatch(this._context.open);
				if (patch == null) return undefined;
				break;
			default:
				throw new Error('Invalid patch type');
		}

		const baseRef = await this.getPatchBaseRef(patch, true);
		if (baseRef == null) return;

		this.updateOpenState(this._context.open);
	}

	private async selectPatchRepo() {
		let patch: GitPatch | DraftPatch | undefined;
		switch (this._context.open?.draftType) {
			case 'local':
				patch = this._context.open.patch;
				break;
			case 'cloud':
				patch = await this.getDraftPatch(this._context.open);
				if (patch == null) return undefined;
				break;
			default:
				throw new Error('Invalid patch type');
		}

		const repo = await this.getPatchRepo(patch, true);
		if (repo == null) return;

		this.updateOpenState(this._context.open);
	}

	private async getPatchRepo(patch: GitPatch | DraftPatch, force = false) {
		if (patch.repository != null && force === false) {
			return patch.repository;
		}
		const pick = await getRepositoryOrShowPicker(
			'Patch Repository',
			'Choose which repository this patch belongs to',
		);
		if (pick == null) return undefined;

		patch.repository = pick;

		return patch.repository;
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

		const [commit, file, revision] = result;

		void openChangesWithWorking(
			file,
			revision != null ? { repoPath: commit.repoPath, ref: revision.baseSha } : commit,
			{
				preserveFocus: true,
				preview: true,
				...this.getShowOptions(params),
			},
		);
	}

	private async openFileComparisonWithPrevious(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file, revision] = result;

		void openChanges(
			file,
			revision != null
				? { repoPath: commit.repoPath, ref1: revision.sha ?? uncommitted, ref2: revision.baseSha }
				: commit,
			{
				preserveFocus: true,
				preview: true,
				...this.getShowOptions(params),
			},
		);
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

	private updateCreateFromLocalPatch(draft: LocalDraft) {
		const patch = draft.patch;
		if (patch.baseRef == null) {
			const ref = this.getPatchBaseRef(patch);
			if (ref == null) return;
		}

		// TODO: need to figure out branch name
		const branchName = '';
		const baseSha = patch.baseRef ?? 'HEAD';
		const change: Change = {
			type: 'revision',
			repository: {
				name: patch.repository!.name,
				path: patch.repository!.path,
				uri: patch.repository!.uri.toString(),
			},
			revision: {
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
			checked: true,
			expanded: true,
		};

		this.updateCreateState({ changes: [change] });
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
			type: 'revision',
			repository: {
				name: repo.name,
				path: repo.path,
				uri: repo.uri.toString(),
			},
			revision: {
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

	// private async getChangeContents(changeset: RepoChangeSet) {
	// 	if (changeset.change == null) return;

	// 	const repo = this.container.git.getRepository(Uri.parse(changeset.repoUri))!;
	// 	const diff = await this.container.git.getDiff(
	// 		repo.path,
	// 		changeset.change.range.baseSha,
	// 		changeset.change.range.sha,
	// 	);
	// 	if (diff == null) return;

	// 	return {
	// 		repository: repo,
	// 		baseSha: changeset.change.range.baseSha,
	// 		contents: diff.contents,
	// 	};
	// }

	// create a patch from the current working tree or from a commit
	// create a draft from the resulting patch
	// how do I incorporate branch
	private async createDraft({ title, changesets, description }: CreatePatchParams): Promise<Draft | undefined> {
		// const changeContents = await this.getChangeContents(changesets);
		const createChanges: CreateDraftChange[] = [];
		for (const [id, changeset] of Object.entries(changesets)) {
			if (changeset.checked === false) continue;

			const repoChangeset = this._context.create?.changes?.get(id);
			if (repoChangeset == null) continue;

			const {
				revision: { baseSha, branchName },
				repository,
			} = repoChangeset;

			let diff: GitDiff | undefined;
			if (changeset.type === 'wip') {
				if (changeset.checked === 'staged') {
					// need to get the staged changes only
					diff = await this.container.git.getDiff(
						repository.path,
						changeset.revision.baseSha,
						changeset.revision.sha,
					);
				} else {
					diff = await this.container.git.getDiff(
						repository.path,
						changeset.revision.baseSha,
						changeset.revision.sha,
					);
				}
			} else {
				diff = await this.container.git.getDiff(
					repository.path,
					changeset.revision.baseSha,
					changeset.revision.sha,
				);
			}
			if (diff == null) continue;

			createChanges.push({
				repository: repository,
				baseSha: baseSha,
				contents: diff.contents,
			});
		}
		if (createChanges == null) return;

		const draft = await this.container.drafts.createDraft(
			'patch',
			title,
			createChanges,
			description ? { description: description } : undefined,
		);
		return draft;
	}
}
