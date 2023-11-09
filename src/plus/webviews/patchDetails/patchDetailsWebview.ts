import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable, env, Uri, window } from 'vscode';
import type { CoreConfiguration } from '../../../constants';
import { Commands, GlyphChars } from '../../../constants';
import type { Container } from '../../../container';
import { openChanges, openChangesWithWorking, openFile } from '../../../git/actions/commit';
import type { RepositoriesChangeEvent } from '../../../git/gitProviderService';
import type { GitCommit } from '../../../git/models/commit';
import { uncommitted, uncommittedStaged } from '../../../git/models/constants';
import { GitFileChange } from '../../../git/models/file';
import type { PatchRevisionRange } from '../../../git/models/patch';
import { createReference } from '../../../git/models/reference';
import { isRepository } from '../../../git/models/repository';
import type { CreateDraftChange, Draft, DraftPatch, DraftPatchFileChange, LocalDraft } from '../../../gk/models/drafts';
import type { GkRepositoryId } from '../../../gk/models/repositoryIdentities';
import { showBranchPicker } from '../../../quickpicks/branchPicker';
import { executeCommand, registerCommand } from '../../../system/command';
import { configuration } from '../../../system/configuration';
import { setContext } from '../../../system/context';
import { debug } from '../../../system/decorators/log';
import type { Deferrable } from '../../../system/function';
import { debounce } from '../../../system/function';
import { find, some } from '../../../system/iterable';
import { basename } from '../../../system/path';
import type { Serialized } from '../../../system/serialize';
import { serialize } from '../../../system/serialize';
import type { IpcMessage } from '../../../webviews/protocol';
import { onIpc } from '../../../webviews/protocol';
import type { WebviewController, WebviewProvider } from '../../../webviews/webviewController';
import type { WebviewShowOptions } from '../../../webviews/webviewsController';
import { showPatchesView } from '../../drafts/actions';
import { confirmDraftStorage, ensureAccount } from '../../utils';
import type { ShowInCommitGraphCommandArgs } from '../graph/protocol';
import type {
	ApplyPatchParams,
	Change,
	CreatePatchParams,
	DidExplainParams,
	DraftPatchCheckedParams,
	FileActionParams,
	Mode,
	Preferences,
	State,
	SwitchModeParams,
	UpdateablePreferences,
	UpdateCreatePatchMetadataParams,
	UpdateCreatePatchRepositoryCheckedStateParams,
} from './protocol';
import {
	ApplyPatchCommandType,
	CopyCloudLinkCommandType,
	CreatePatchCommandType,
	DidChangeCreateNotificationType,
	DidChangeDraftNotificationType,
	DidChangeNotificationType,
	DidChangePatchRepositoryNotificationType,
	DidChangePreferencesNotificationType,
	DidExplainCommandType,
	DraftPatchCheckedCommandType,
	ExplainCommandType,
	OpenFileCommandType,
	OpenFileComparePreviousCommandType,
	OpenFileCompareWorkingCommandType,
	OpenInCommitGraphCommandType,
	SwitchModeCommandType,
	UpdateCreatePatchMetadataCommandType,
	UpdateCreatePatchRepositoryCheckedStateCommandType,
	UpdatePreferencesCommandType,
} from './protocol';
import type { CreateDraft, PatchDetailsWebviewShowingArgs } from './registration';
import type { RepositoryChangeset } from './repositoryChangeset';
import { RepositoryRefChangeset, RepositoryWipChangeset } from './repositoryChangeset';

interface Context {
	mode: Mode;
	draft: LocalDraft | Draft | undefined;
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
			draft: undefined,
			create: undefined,
			preferences: this.getPreferences(),
		};

		this.setHostTitle();
		this.host.description = 'PREVIEW ☁️';

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
		if (arg?.mode === 'view' && arg.draft != null) {
			this.updateViewDraftState(arg.draft);
		} else {
			if (this.container.git.isDiscoveringRepositories) {
				await this.container.git.isDiscoveringRepositories;
			}

			const create = arg?.mode === 'create' && arg.create != null ? arg.create : { repositories: undefined };
			this.updateCreateDraftState(create);
		}

		if (options?.preserveVisibility && !this.host.visible) return false;

		return true;
	}

	includeBootstrap(): Promise<Serialized<State>> {
		return this.getState(this._context);
	}

	registerCommands(): Disposable[] {
		return [
			registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true)),
			registerCommand(`${this.host.id}.close`, () => this.closeView()),
		];
	}

	onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case ApplyPatchCommandType.method:
				onIpc(ApplyPatchCommandType, e, params => this.applyPatch(params));
				break;
			case CopyCloudLinkCommandType.method:
				onIpc(CopyCloudLinkCommandType, e, () => this.copyCloudLink());
				break;
			// case CreateFromLocalPatchCommandType.method:
			// 	onIpc(CreateFromLocalPatchCommandType, e, () => this.shareLocalPatch());
			// 	break;
			case CreatePatchCommandType.method:
				onIpc(CreatePatchCommandType, e, params => this.createDraft(params));
				break;
			case ExplainCommandType.method:
				onIpc(ExplainCommandType, e, () => this.explainPatch(e.completionId));
				break;

			case OpenFileComparePreviousCommandType.method:
				onIpc(
					OpenFileComparePreviousCommandType,
					e,
					params => void this.openFileComparisonWithPrevious(params),
				);
				break;
			case OpenFileCompareWorkingCommandType.method:
				onIpc(OpenFileCompareWorkingCommandType, e, params => void this.openFileComparisonWithWorking(params));
				break;
			case OpenFileCommandType.method:
				onIpc(OpenFileCommandType, e, params => void this.openFile(params));
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
			// case SelectPatchBaseCommandType.method:
			// 	onIpc(SelectPatchBaseCommandType, e, () => void this.selectPatchBase());
			// 	break;
			// case SelectPatchRepoCommandType.method:
			// 	onIpc(SelectPatchRepoCommandType, e, () => void this.selectPatchRepo());
			// 	break;
			case SwitchModeCommandType.method:
				onIpc(SwitchModeCommandType, e, params => this.switchMode(params));
				break;
			case UpdateCreatePatchMetadataCommandType.method:
				onIpc(UpdateCreatePatchMetadataCommandType, e, params => this.updateCreateMetadata(params));
				break;
			case UpdateCreatePatchRepositoryCheckedStateCommandType.method:
				onIpc(UpdateCreatePatchRepositoryCheckedStateCommandType, e, params =>
					this.updateCreateCheckedState(params),
				);
				break;
			case UpdatePreferencesCommandType.method:
				onIpc(UpdatePreferencesCommandType, e, params => this.updatePreferences(params));
				break;
			case DraftPatchCheckedCommandType.method:
				onIpc(DraftPatchCheckedCommandType, e, params => this.onPatchChecked(params));
				break;
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
							{ baseSha: 'HEAD', sha: uncommitted },
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

			void this.notifyDidChangeCreateDraftState();
		}
	}

	private onRepositoryWipChanged(_e: RepositoryWipChangeset) {
		void this.notifyDidChangeCreateDraftState();
	}

	private get mode(): Mode {
		return this._context.mode;
	}
	private setMode(mode: Mode, silent?: boolean) {
		this._context.mode = mode;
		this.setHostTitle(mode);
		void setContext('gitlens:views:patchDetails:mode', mode);
		if (!silent) {
			this.updateState(true);
		}
	}

	private setHostTitle(mode: Mode = this._context.mode) {
		this.host.title = mode === 'create' ? 'Create Cloud Patch' : 'Cloud Patch Details';
	}

	private async applyPatch(params: ApplyPatchParams) {
		// if (params.details.repoPath == null || params.details.commit == null) return;
		// void this.container.git.applyPatchCommit(params.details.repoPath, params.details.commit, {
		// 	branchName: params.targetRef,
		// });
		if (this._context.draft == null || this._context.draft.draftType === 'local' || !params.selected?.length) {
			return;
		}

		if (
			!(await ensureAccount('Cloud Patches require a GitKraken account.', this.container)) ||
			!(await confirmDraftStorage(this.container))
		) {
			return;
		}

		const changeset = this._context.draft.changesets?.[0];
		if (changeset == null) return;

		// TODO: should be overridable with targetRef
		const shouldPickBranch = params.target === 'branch';
		for (const patch of changeset.patches) {
			if (!params.selected.includes(patch.id)) continue;

			try {
				console.log(patch);
				let commit = patch.commit;
				if (!commit) {
					commit = await this.getOrCreateCommitForPatch(patch.gkRepositoryId);
				}
				if (!commit) {
					// TODO: say we can't apply this patch
					continue;
				}

				let options:
					| {
							branchName?: string;
							createBranchIfNeeded?: boolean;
							createWorktreePath?: string;
					  }
					| undefined = undefined;

				if (shouldPickBranch) {
					const repo = commit.getRepository();
					const branch = await showBranchPicker(
						`Choose a Branch ${GlyphChars.Dot} ${repo?.name}`,
						'Choose a branch to apply the Cloud Patch to',
						repo,
					);

					if (branch == null) {
						void window.showErrorMessage(
							`Unable apply patch to '${patch.repository!.name}': No branch selected`,
						);
						continue;
					}
					options = {
						branchName: branch.ref,
						createBranchIfNeeded: true,
					};
				}

				void this.container.git.applyPatchCommit(commit.repoPath, commit.ref, options);
			} catch (ex) {
				void window.showErrorMessage(`Unable apply patch to '${patch.baseRef}': ${ex.message}`);
			}
		}
	}

	private closeView() {
		void setContext('gitlens:views:patchDetails:mode', undefined);
	}

	private copyCloudLink() {
		if (this._context.draft?.draftType !== 'cloud') return;

		void env.clipboard.writeText(this._context.draft.deepLinkUrl);
	}

	private async createDraft({ title, changesets, description }: CreatePatchParams): Promise<void> {
		if (!(await ensureAccount('Cloud patches require a GitKraken account.', this.container))) return;

		const createChanges: CreateDraftChange[] = [];

		const changes = Object.entries(changesets);
		const ignoreChecked = changes.length === 1;

		for (const [id, change] of changes) {
			if (!ignoreChecked && change.checked === false) continue;

			const repoChangeset = this._context.create?.changes?.get(id);
			if (repoChangeset == null) continue;

			let { revision, repository } = repoChangeset;
			if (change.type === 'wip' && change.checked === 'staged') {
				revision = { ...revision, sha: uncommittedStaged };
			}

			createChanges.push({
				repository: repository,
				revision: revision,
			});
		}
		if (createChanges == null) return;

		try {
			const draft = await this.container.drafts.createDraft(
				'patch',
				title,
				createChanges,
				description ? { description: description } : undefined,
			);

			async function showNotification() {
				const view = { title: 'View Patch' };
				const copy = { title: 'Copy Link' };
				let copied = false;
				while (true) {
					const result = await window.showInformationMessage(
						`Cloud Patch successfully created${copied ? '\u2014 link copied to the clipboard' : ''}`,
						view,
						copy,
					);

					if (result === copy) {
						void env.clipboard.writeText(draft.deepLinkUrl);
						copied = true;
						continue;
					}

					if (result === view) {
						void showPatchesView({ mode: 'view', draft: draft });
					}

					break;
				}
			}

			void showNotification();
			void this.container.draftsView.refresh(true).then(() => void this.container.draftsView.revealDraft(draft));

			this.closeView();
		} catch (ex) {
			debugger;

			void window.showErrorMessage(`Unable to create draft: ${ex.message}`);
		}
	}

	private async explainPatch(completionId?: string) {
		if (this._context.draft?.draftType !== 'cloud') return;

		let params: DidExplainParams;

		try {
			// TODO@eamodio HACK -- only works for the first patch
			const patch = await this.getDraftPatch(this._context.draft);
			if (patch == null) return;

			const commit = await this.getOrCreateCommitForPatch(patch.gkRepositoryId);
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

	private async openPatchContents(_params: FileActionParams) {
		// TODO@eamodio Open the patch contents for the selected repo in an untitled editor
	}

	private async onPatchChecked(params: DraftPatchCheckedParams) {
		if (params.patch.repository.located || params.checked === false) return;

		const patch = (this._context.draft as Draft)?.changesets?.[0].patches?.find(
			p => p.gkRepositoryId === params.patch.gkRepositoryId,
		);
		if (patch?.repository == null || isRepository(patch.repository)) return;

		const repo = await this.container.repositoryIdentity.getRepository(patch.repository, {
			openIfNeeded: true,
			prompt: true,
		});

		if (repo == null) {
			void window.showErrorMessage(`Unable to locate repository '${patch.repository.name}'`);
		} else {
			patch.repository = repo;
		}

		void this.notifyPatchRepositoryUpdated(patch);
	}

	private notifyPatchRepositoryUpdated(patch: DraftPatch) {
		return this.host.notify(DidChangePatchRepositoryNotificationType, {
			patch: serialize({
				...patch,
				contents: undefined,
				commit: undefined,
				repository: {
					id: patch.gkRepositoryId,
					name: patch.repository?.name ?? '',
					located: patch.repository != null && isRepository(patch.repository),
				},
			}),
		});
	}

	private updateCreateCheckedState(params: UpdateCreatePatchRepositoryCheckedStateParams) {
		const changeset = this._context.create?.changes.get(params.repoUri);
		if (changeset == null) return;

		changeset.checked = params.checked;
		void this.notifyDidChangeCreateDraftState();
	}

	private updateCreateMetadata(params: UpdateCreatePatchMetadataParams) {
		if (this._context.create == null) return;

		this._context.create.title = params.title;
		this._context.create.description = params.description;
		void this.notifyDidChangeCreateDraftState();
	}

	// private shareLocalPatch() {
	// 	if (this._context.open?.draftType !== 'local') return;

	// 	this.updateCreateFromLocalPatch(this._context.open);
	// }

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
			create = await this.getCreateDraftState(current);
		}

		let draft;
		if (current.mode === 'view' && current.draft != null) {
			draft = await this.getViewDraftState(current);
		}

		const state = serialize<State>({
			...this.host.baseWebviewState,
			mode: current.mode,
			create: create,
			draft: draft,
			preferences: current.preferences,
		});
		return state;
	}

	private async notifyDidChangeState() {
		this._notifyDidChangeStateDebounced?.cancel();
		return this.host.notify(DidChangeNotificationType, { state: await this.getState(this._context) });
	}

	private updateCreateDraftState(create: CreateDraft) {
		let changesetByRepo: Map<string, RepositoryChangeset>;
		let allRepos = false;

		if (create.changes != null) {
			changesetByRepo = this._context.create?.changes ?? new Map<string, RepositoryChangeset>();

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
							sha: uncommitted,
						},
						this.onRepositoryWipChanged.bind(this),
						true,
						true, // TODO revisit
					),
				]),
			);
		}

		this._context.create = {
			title: create.title,
			description: create.description,
			changes: changesetByRepo,
			showingAllRepos: allRepos,
		};
		this.setMode('create', true);
		void this.notifyDidChangeCreateDraftState();
	}

	private async getCreateDraftState(current: Context): Promise<State['create'] | undefined> {
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

	private async notifyDidChangeCreateDraftState() {
		return this.host.notify(DidChangeCreateNotificationType, {
			mode: this._context.mode,
			create: await this.getCreateDraftState(this._context),
		});
	}

	private updateViewDraftState(draft: LocalDraft | Draft | undefined) {
		this._context.draft = draft;
		this.setMode('view', true);
		void this.notifyDidChangeViewDraftState();
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	private async getViewDraftState(current: Context): Promise<State['draft'] | undefined> {
		if (current.draft == null) return undefined;

		const draft = current.draft;

		// if (draft.draftType === 'local') {
		// 	const { patch } = draft;
		// 	if (patch.repository == null) {
		// 		const repo = this.container.git.getBestRepository();
		// 		if (repo != null) {
		// 			patch.repository = repo;
		// 		}
		// 	}

		// 	return {
		// 		draftType: 'local',
		// 		files: patch.files ?? [],
		// 		repoPath: patch.repository?.path,
		// 		repoName: patch.repository?.name,
		// 		baseRef: patch.baseRef,
		// 	};
		// }

		if (draft.draftType === 'cloud') {
			if (
				draft.changesets == null ||
				some(draft.changesets, cs =>
					cs.patches.some(p => p.contents == null || p.files == null || p.repository == null),
				)
			) {
				setTimeout(async () => {
					if (draft.changesets == null) {
						draft.changesets = await this.container.drafts.getChangesets(draft.id);
					}

					const patches = draft.changesets
						.flatMap(cs => cs.patches)
						.filter(p => p.contents == null || p.files == null || p.repository == null);
					const patchDetails = await Promise.allSettled(
						patches.map(p => this.container.drafts.getPatchDetails(p)),
					);

					for (const d of patchDetails) {
						if (d.status === 'fulfilled') {
							const patch = patches.find(p => p.id === d.value.id);
							if (patch != null) {
								patch.contents = d.value.contents;
								patch.files = d.value.files;
								patch.repository = d.value.repository;
							}
						}
					}

					void this.notifyDidChangeViewDraftState();
				}, 0);
			}

			return {
				draftType: 'cloud',
				id: draft.id,
				createdAt: draft.createdAt.getTime(),
				updatedAt: draft.updatedAt.getTime(),
				author: draft.author,
				title: draft.title,
				description: draft.description,
				patches: serialize(
					draft.changesets![0].patches.map(p => ({
						...p,
						contents: undefined,
						commit: undefined,
						repository: {
							id: p.gkRepositoryId,
							name: p.repository?.name ?? '',
							located: p.repository != null && isRepository(p.repository),
						},
					})),
				),
			};
		}

		return undefined;
	}

	private async notifyDidChangeViewDraftState() {
		return this.host.notify(DidChangeDraftNotificationType, {
			mode: this._context.mode,
			draft: serialize(await this.getViewDraftState(this._context)),
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

	private async getDraftPatch(draft: Draft, gkRepositoryId?: GkRepositoryId): Promise<DraftPatch | undefined> {
		if (draft.changesets == null) {
			const changesets = await this.container.drafts.getChangesets(draft.id);
			draft.changesets = changesets;
		}

		const patch =
			gkRepositoryId == null
				? draft.changesets[0].patches?.[0]
				: draft.changesets[0].patches?.find(p => p.gkRepositoryId === gkRepositoryId);
		if (patch == null) return undefined;

		if (patch.contents == null || patch.files == null || patch.repository == null) {
			const details = await this.container.drafts.getPatchDetails(patch.id);
			patch.contents = details.contents;
			patch.files = details.files;
			patch.repository = details.repository;
		}

		return patch;
	}

	private async getFileCommitFromParams(
		params: FileActionParams,
	): Promise<
		| [commit: GitCommit, file: GitFileChange, revision?: Required<Omit<PatchRevisionRange, 'branchName'>>]
		| undefined
	> {
		let [commit, revision] = await this.getOrCreateCommit(params);

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
		file: DraftPatchFileChange,
	): Promise<[commit: GitCommit | undefined, revision?: PatchRevisionRange]> {
		switch (this.mode) {
			case 'create':
				return this.getCommitForFile(file);
			case 'view':
				return [await this.getOrCreateCommitForPatch(file.gkRepositoryId)];
			default:
				return [undefined];
		}
	}

	async getCommitForFile(
		file: DraftPatchFileChange,
	): Promise<[commit: GitCommit | undefined, revision?: PatchRevisionRange]> {
		const changeset = find(this._context.create!.changes.values(), cs => cs.repository.path === file.repoPath);
		if (changeset == null) return [undefined];

		const change = await changeset.getChange();
		if (change == null) return [undefined];

		if (change.type === 'revision') {
			const commit = await this.container.git.getCommit(file.repoPath, change.revision.sha ?? uncommitted);
			if (
				change.revision.sha === change.revision.baseSha ||
				change.revision.sha === change.revision.baseSha.substring(0, change.revision.baseSha.length - 1)
			) {
				return [commit];
			}

			return [commit, change.revision];
		} else if (change.type === 'wip') {
			return [await this.container.git.getCommit(file.repoPath, change.revision.sha ?? uncommitted)];
		}

		return [undefined];
	}

	async getOrCreateCommitForPatch(gkRepositoryId: GkRepositoryId): Promise<GitCommit | undefined> {
		const draft = this._context.draft!;
		if (draft.draftType === 'local') return undefined; // TODO

		const patch = await this.getDraftPatch(draft, gkRepositoryId);
		if (patch?.repository == null) return undefined;

		if (patch?.commit == null) {
			if (!isRepository(patch.repository)) {
				const repo = await this.container.repositoryIdentity.getRepository(patch.repository, {
					openIfNeeded: true,
					prompt: true,
				});
				if (repo == null) {
					void window.showErrorMessage(`Unable to locate repository '${patch.repository.name}'`);
					return undefined;
				}

				patch.repository = repo;
			}

			try {
				const commit = await this.container.git.createUnreachableCommitForPatch(
					patch.repository.uri,
					patch.contents!,
					patch.baseRef ?? 'HEAD',
					draft.title,
				);
				patch.commit = commit;
			} catch (ex) {
				void window.showErrorMessage(`Unable preview the patch on base '${patch.baseRef}': ${ex.message}`);
				patch.baseRef = undefined!;
			}
		}

		return patch?.commit;
	}

	private async openFile(params: FileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		void openFile(file, commit, {
			preserveFocus: true,
			preview: true,
			...params.showOptions,
		});
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
				...params.showOptions,
				rhsTitle: this.mode === 'view' ? `${basename(file.path)} (Patch)` : undefined,
			},
		);
		this.container.events.fire('file:selected', { uri: file.uri }, { source: this.host.id });
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
				...params.showOptions,
				lhsTitle: this.mode === 'view' ? `${basename(file.path)} (Patch)` : undefined,
			},
		);
	}
}
