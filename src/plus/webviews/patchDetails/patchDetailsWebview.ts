import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable, env, Uri, window } from 'vscode';
import { getAvatarUri } from '../../../avatars';
import { ClearQuickInputButton } from '../../../commands/quickCommand.buttons';
import type { ContextKeys } from '../../../constants';
import { Commands, GlyphChars, previewBadge } from '../../../constants';
import type { Container } from '../../../container';
import { CancellationError } from '../../../errors';
import { openChanges, openChangesWithWorking, openFile } from '../../../git/actions/commit';
import { ApplyPatchCommitError, ApplyPatchCommitErrorReason } from '../../../git/errors';
import type { RepositoriesChangeEvent } from '../../../git/gitProviderService';
import type { GitCommit } from '../../../git/models/commit';
import { uncommitted, uncommittedStaged } from '../../../git/models/constants';
import { GitFileChange } from '../../../git/models/file';
import type { PatchRevisionRange } from '../../../git/models/patch';
import { createReference, shortenRevision } from '../../../git/models/reference';
import type { Repository } from '../../../git/models/repository';
import { isRepository } from '../../../git/models/repository';
import type {
	CreateDraftChange,
	Draft,
	DraftArchiveReason,
	DraftPatch,
	DraftPatchFileChange,
	DraftPendingUser,
	DraftUser,
	DraftVisibility,
	LocalDraft,
} from '../../../gk/models/drafts';
import type { GkRepositoryId } from '../../../gk/models/repositoryIdentities';
import { showNewOrSelectBranchPicker } from '../../../quickpicks/branchPicker';
import type { QuickPickItemOfT } from '../../../quickpicks/items/common';
import { ReferencesQuickPickIncludes, showReferencePicker } from '../../../quickpicks/referencePicker';
import { executeCommand, registerCommand } from '../../../system/command';
import { configuration } from '../../../system/configuration';
import { getContext, onDidChangeContext, setContext } from '../../../system/context';
import { debug } from '../../../system/decorators/log';
import type { Deferrable } from '../../../system/function';
import { debounce } from '../../../system/function';
import { find, some } from '../../../system/iterable';
import { basename } from '../../../system/path';
import { defer } from '../../../system/promise';
import type { Serialized } from '../../../system/serialize';
import { serialize } from '../../../system/serialize';
import { showInspectView } from '../../../webviews/commitDetails/actions';
import type { IpcCallMessageType, IpcMessage } from '../../../webviews/protocol';
import type { WebviewHost, WebviewProvider } from '../../../webviews/webviewProvider';
import type { WebviewShowOptions } from '../../../webviews/webviewsController';
import { showPatchesView } from '../../drafts/actions';
import type { OrganizationMember } from '../../gk/account/organization';
import { confirmDraftStorage, ensureAccount } from '../../utils';
import type { ShowInCommitGraphCommandArgs } from '../graph/protocol';
import type {
	ApplyPatchParams,
	Change,
	CreateDraft,
	CreatePatchParams,
	DidExplainParams,
	DraftPatchCheckedParams,
	DraftUserSelection,
	ExecuteFileActionParams,
	Mode,
	Preferences,
	State,
	SwitchModeParams,
	UpdateablePreferences,
	UpdateCreatePatchMetadataParams,
	UpdateCreatePatchRepositoryCheckedStateParams,
	UpdatePatchDetailsMetadataParams,
	UpdatePatchUserSelection,
} from './protocol';
import {
	ApplyPatchCommand,
	ArchiveDraftCommand,
	CopyCloudLinkCommand,
	CreatePatchCommand,
	DidChangeCreateNotification,
	DidChangeDraftNotification,
	DidChangeNotification,
	DidChangePatchRepositoryNotification,
	DidChangePreferencesNotification,
	DraftPatchCheckedCommand,
	ExplainRequest,
	OpenFileCommand,
	OpenFileComparePreviousCommand,
	OpenFileCompareWorkingCommand,
	OpenInCommitGraphCommand,
	SwitchModeCommand,
	UpdateCreatePatchMetadataCommand,
	UpdateCreatePatchRepositoryCheckedStateCommand,
	UpdatePatchDetailsMetadataCommand,
	UpdatePatchDetailsPermissionsCommand,
	UpdatePatchUsersCommand,
	UpdatePatchUserSelectionCommand,
	UpdatePreferencesCommand,
} from './protocol';
import type { PatchDetailsWebviewShowingArgs } from './registration';
import type { RepositoryChangeset } from './repositoryChangeset';
import { RepositoryRefChangeset, RepositoryWipChangeset } from './repositoryChangeset';

interface DraftUserState {
	users: DraftUser[];
	selections: DraftUserSelection[];
}
interface Context {
	mode: Mode;
	draft: LocalDraft | Draft | undefined;
	draftGkDevUrl: string | undefined;
	draftVisibiltyState: DraftVisibility | undefined;
	draftUserState: DraftUserState | undefined;
	create:
		| {
				title?: string;
				description?: string;
				changes: Map<string, RepositoryChangeset>;
				showingAllRepos: boolean;
				visibility: DraftVisibility;
				userSelections?: DraftUserSelection[];
		  }
		| undefined;
	preferences: Preferences;
	orgSettings: State['orgSettings'];
}

export class PatchDetailsWebviewProvider
	implements WebviewProvider<State, Serialized<State>, PatchDetailsWebviewShowingArgs>
{
	private _context: Context;
	private readonly _disposable: Disposable;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost,
	) {
		this._context = {
			mode: 'create',
			draft: undefined,
			draftGkDevUrl: undefined,
			draftUserState: undefined,
			draftVisibiltyState: undefined,
			create: undefined,
			preferences: this.getPreferences(),
			orgSettings: this.getOrgSettings(),
		};

		this.setHostTitle();
		this.host.description = previewBadge;

		this._disposable = Disposable.from(
			configuration.onDidChangeAny(this.onAnyConfigurationChanged, this),
			container.git.onDidChangeRepositories(this.onRepositoriesChanged, this),
			onDidChangeContext(this.onContextChanged, this),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	canReuseInstance(...args: PatchDetailsWebviewShowingArgs): boolean | undefined {
		const [arg] = args;
		if (arg?.mode === 'view' && arg.draft != null) {
			switch (arg.draft.draftType) {
				case 'cloud':
					return (
						this._context.draft?.draftType === arg.draft.draftType &&
						this._context.draft.id === arg.draft.id
					);

				case 'local':
					return (
						this._context.draft?.draftType === arg.draft.draftType &&
						this._context.draft.patch.contents === arg.draft.patch?.contents
					);
			}
		}

		return false;
	}

	async onShowing(
		_loading: boolean,
		options: WebviewShowOptions,
		...args: PatchDetailsWebviewShowingArgs
	): Promise<boolean> {
		const [arg] = args;
		if (arg?.mode === 'view' && arg.draft != null) {
			await this.updateViewDraftState(arg.draft);
			void this.trackViewDraft(this._context.draft, arg.source);
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
		const commands: Disposable[] = [];

		if (this.host.isHost('view')) {
			commands.push(
				registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true)),
				registerCommand(`${this.host.id}.close`, () => this.closeView()),
			);
		}

		return commands;
	}

	onMessageReceived(e: IpcMessage) {
		switch (true) {
			case ApplyPatchCommand.is(e):
				void this.applyPatch(e.params);
				break;

			case CopyCloudLinkCommand.is(e):
				this.copyCloudLink();
				break;

			// case CreateFromLocalPatchCommandType.method:
			// 	this.shareLocalPatch();
			// 	break;

			case CreatePatchCommand.is(e):
				void this.createDraft(e.params);
				break;

			case ExplainRequest.is(e):
				void this.explainRequest(ExplainRequest, e);
				break;

			case OpenFileComparePreviousCommand.is(e):
				void this.openFileComparisonWithPrevious(e.params);
				break;

			case OpenFileCompareWorkingCommand.is(e):
				void this.openFileComparisonWithWorking(e.params);
				break;

			case OpenFileCommand.is(e):
				void this.openFile(e.params);
				break;

			case OpenInCommitGraphCommand.is(e):
				void executeCommand<ShowInCommitGraphCommandArgs>(Commands.ShowInCommitGraph, {
					ref: createReference(e.params.ref, e.params.repoPath, { refType: 'revision' }),
				});
				break;

			// case SelectPatchBaseCommandType.is(e):
			// 	void this.selectPatchBase();
			// 	break;

			// case SelectPatchRepoCommandType.is(e):
			// 	void this.selectPatchRepo();
			// 	break;

			case SwitchModeCommand.is(e):
				this.switchMode(e.params);
				break;

			case UpdateCreatePatchMetadataCommand.is(e):
				this.updateCreateMetadata(e.params);
				break;

			case UpdatePatchDetailsMetadataCommand.is(e):
				this.updateDraftMetadata(e.params);
				break;

			case UpdatePatchDetailsPermissionsCommand.is(e):
				void this.updateDraftPermissions();
				break;

			case UpdateCreatePatchRepositoryCheckedStateCommand.is(e):
				this.updateCreateCheckedState(e.params);
				break;

			case UpdatePreferencesCommand.is(e):
				this.updatePreferences(e.params);
				break;

			case DraftPatchCheckedCommand.is(e):
				this.onPatchChecked(e.params);
				break;

			case UpdatePatchUsersCommand.is(e):
				void this.onInviteUsers();
				break;

			case UpdatePatchUserSelectionCommand.is(e):
				this.onUpdatePatchUserSelection(e.params);
				break;

			case ArchiveDraftCommand.is(e):
				void this.archiveDraft(e.params.reason);
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
			configuration.changedCore(e, 'workbench.tree.renderIndentGuides') ||
			configuration.changedCore(e, 'workbench.tree.indent')
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
			indentGuides: configuration.getCore('workbench.tree.renderIndentGuides') ?? 'onHover',
			indent: configuration.getCore('workbench.tree.indent'),
		};
	}

	private onContextChanged(key: ContextKeys) {
		if (['gitlens:gk:organization:ai:enabled', 'gitlens:gk:organization:drafts:enabled'].includes(key)) {
			this._context.orgSettings = this.getOrgSettings();
			this.updateState();
		}
	}

	private getOrgSettings(): State['orgSettings'] {
		return {
			ai: getContext<boolean>('gitlens:gk:organization:ai:enabled', false),
			byob: getContext<boolean>('gitlens:gk:organization:drafts:byob', false),
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
							{ to: uncommitted, from: 'HEAD' },
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
		void setContext(
			'gitlens:views:patchDetails:mode',
			configuration.get('cloudPatches.experimental.layout') === 'editor' ? undefined : mode,
		);
		if (!silent) {
			this.updateState(true);
		}
	}

	private setHostTitle(mode: Mode = this._context.mode) {
		if (mode === 'create') {
			this.host.title = 'Create Cloud Patch';
		} else if (this._context.draft?.draftType === 'cloud' && this._context.draft.type === 'suggested_pr_change') {
			this.host.title = 'Cloud Suggestion';
		} else {
			this.host.title = 'Cloud Patch Details';
		}
	}

	private async applyPatch(params: ApplyPatchParams) {
		// if (params.details.repoPath == null || params.details.commit == null) return;
		// void this.container.git.applyPatchCommit(params.details.repoPath, params.details.commit, {
		// 	branchName: params.targetRef,
		// });
		if (this._context.draft == null || this._context.draft.draftType === 'local' || !params.selected?.length) {
			return;
		}

		const changeset = this._context.draft.changesets?.[0];
		if (changeset == null) return;

		// TODO: should be overridable with targetRef
		const shouldPickBranch = params.target === 'branch';
		for (const patch of changeset.patches) {
			if (!params.selected.includes(patch.id)) continue;

			try {
				const commit = patch.commit ?? (await this.getOrCreateCommitForPatch(patch.gkRepositoryId));
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
					const branch = await showNewOrSelectBranchPicker(
						`Choose a Branch ${GlyphChars.Dot} ${repo?.name}`,
						// 'Choose a branch to apply the Cloud Patch to',
						repo,
					);

					if (branch == null) {
						void window.showErrorMessage(
							`Unable to apply patch to '${patch.repository!.name}': No branch selected`,
						);
						continue;
					}

					const isString = typeof branch === 'string';
					options = {
						branchName: isString ? branch : branch.ref,
						createBranchIfNeeded: isString,
					};
				}

				await this.container.git.applyUnreachableCommitForPatch(commit.repoPath, commit.ref, {
					stash: 'prompt',
					...options,
				});
				void window.showInformationMessage(`Patch applied successfully`);
			} catch (ex) {
				if (ex instanceof CancellationError) return;

				if (ex instanceof ApplyPatchCommitError) {
					if (ex.reason === ApplyPatchCommitErrorReason.AppliedWithConflicts) {
						void window.showWarningMessage('Patch applied with conflicts');
					} else {
						void window.showErrorMessage(ex.message);
					}
				} else {
					void window.showErrorMessage(`Unable to apply patch onto '${patch.baseRef}': ${ex.message}`);
				}
			}
		}
	}

	private closeView() {
		void setContext('gitlens:views:patchDetails:mode', undefined);

		if (this._context.mode === 'create') {
			void this.container.draftsView.show();
		} else if (this._context.draft?.draftType === 'cloud') {
			if (this._context.draft.type === 'suggested_pr_change') {
				const repositoryOrIdentity = this._context.draft.changesets?.[0].patches[0].repository;
				void showInspectView({
					type: 'wip',
					repository: isRepoLocated(repositoryOrIdentity) ? (repositoryOrIdentity as Repository) : undefined,
					source: 'patchDetails',
				});
			} else {
				void this.container.draftsView.revealDraft(this._context.draft);
			}
		}
	}

	private copyCloudLink() {
		if (this._context.draft?.draftType !== 'cloud') return;

		void env.clipboard.writeText(this._context.draft.deepLinkUrl);
	}

	private async getOrganizationMembers() {
		const sub = await this.container.subscription.getSubscription(true);
		const activeOrg = sub?.activeOrganization;
		// TODO: need messaging for no Org
		if (activeOrg == null) return [];

		return this.container.organizations.getOrganizationMembers(activeOrg.id);
	}

	private async onInviteUsers() {
		let userIds: string[] | undefined;
		if (this.mode === 'create') {
			userIds = this._context.create?.userSelections?.map(u => u.member.id);
		} else {
			userIds = this._context.draftUserState?.selections?.map(u => u.member.id);
		}

		const initSelections: Set<DraftUser['userId']> | undefined = userIds != null ? new Set(userIds) : undefined;
		const picks = await this.selectCollaborators(initSelections);
		if (picks == null || picks.length === 0) return;

		if (this.mode === 'create') {
			const userSelections = picks.map(pick => toDraftUserSelection(pick, undefined, 'editor', 'add'));
			if (this._context.create!.userSelections == null) {
				this._context.create!.userSelections = userSelections;
			} else {
				this._context.create!.userSelections.push(...userSelections);
			}
			void this.notifyDidChangeCreateDraftState();
			return;
		}

		const draftUserState = this._context.draftUserState!;
		let added = false;
		for (const pick of picks) {
			const existing = draftUserState.selections.find(u => u.member.id === pick.id);
			if (existing != null) {
				continue;
			}
			added = true;
			draftUserState.selections.push(toDraftUserSelection(pick, undefined, 'editor', 'add'));
		}
		if (added) {
			void this.notifyDidChangeViewDraftState();
		}
	}

	private async selectCollaborators(
		initSelections?: Set<DraftUser['userId']>,
	): Promise<OrganizationMember[] | undefined> {
		const members = await this.getOrganizationMembers();
		if (members.length === 0) return undefined;

		type OrganizationMemberQuickPickItem = QuickPickItemOfT<OrganizationMember>;
		const deferred = defer<OrganizationMember[] | undefined>();
		const disposables: Disposable[] = [];

		try {
			const quickpick = window.createQuickPick<OrganizationMemberQuickPickItem>();
			disposables.push(
				quickpick,
				quickpick.onDidHide(() => deferred.fulfill(undefined)),
				quickpick.onDidAccept(() =>
					!quickpick.busy ? deferred.fulfill(quickpick.selectedItems.map(c => c.item)) : undefined,
				),
				quickpick.onDidTriggerButton(e => {
					if (e === ClearQuickInputButton) {
						if (quickpick.canSelectMany) {
							quickpick.selectedItems = [];
						} else {
							deferred.fulfill([]);
						}
					}
				}),
			);

			quickpick.title = 'Select Collaborators';
			quickpick.placeholder = 'Select the collaborators to share this patch with';
			quickpick.matchOnDescription = true;
			quickpick.matchOnDetail = true;
			quickpick.canSelectMany = true;
			quickpick.buttons = [ClearQuickInputButton];

			quickpick.busy = true;
			quickpick.show();

			const items = members.map(member => {
				const item: OrganizationMemberQuickPickItem = {
					label: member.name ?? member.username,
					description: member.email,
					// TODO: needs to support current collaborator selections
					picked: initSelections ? initSelections.has(member.id) : false,
					item: member,
					iconPath: getAvatarUri(member.email, undefined),
				};

				return item;
			});
			quickpick.items = items;

			quickpick.busy = false;

			const picks = await deferred.promise;
			return picks;
		} finally {
			disposables.forEach(d => void d.dispose());
		}
	}

	private onUpdatePatchUserSelection(params: UpdatePatchUserSelection) {
		if (this.mode === 'create') {
			const userSelections = this._context.create?.userSelections;
			if (userSelections == null) return;

			if (params.role === 'remove') {
				const selection = userSelections.findIndex(u => u.member.id === params.selection.member.id);
				if (selection === -1) return;
				userSelections.splice(selection, 1);
			} else {
				const selection = userSelections.find(u => u.member.id === params.selection.member.id);
				if (selection == null) return;
				selection.pendingRole = params.role;
			}

			void this.notifyDidChangeCreateDraftState();
			return;
		}

		const allSelections = this._context.draftUserState!.selections;
		const selection = allSelections.find(u => u.member.id === params.selection.member.id);
		if (selection == null) return;

		if (params.role === 'remove') {
			selection.change = 'delete';
		} else {
			selection.change = 'modify';
			selection.pendingRole = params.role;
		}

		void this.notifyDidChangeViewDraftState();
	}

	private async createDraft({
		title,
		changesets,
		description,
		visibility,
		userSelections,
	}: CreatePatchParams): Promise<void> {
		if (
			!(await ensureAccount('Cloud Patches are a Preview feature and require an account.', this.container)) ||
			!(await confirmDraftStorage(this.container))
		) {
			return;
		}

		const createChanges: CreateDraftChange[] = [];

		const changes = Object.entries(changesets);
		const ignoreChecked = changes.length === 1;

		for (const [id, change] of changes) {
			if (!ignoreChecked && change.checked === false) continue;

			const repoChangeset = this._context.create?.changes?.get(id);
			if (repoChangeset == null) continue;

			let { revision, repository } = repoChangeset;
			if (change.type === 'wip' && change.checked === 'staged') {
				revision = { ...revision, to: uncommittedStaged };
			}

			createChanges.push({
				repository: repository,
				revision: revision,
			});
		}
		if (createChanges == null) return;

		try {
			const options = {
				description: description,
				visibility: visibility,
			};
			const draft = await this.container.drafts.createDraft('patch', title, createChanges, options);

			if (userSelections != null && userSelections.length !== 0) {
				await this.container.drafts.addDraftUsers(
					draft.id,
					userSelections.map(u => ({
						userId: u.member.id,
						role: u.pendingRole!,
					})),
				);
			}

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

	private async archiveDraft(reason?: Exclude<DraftArchiveReason, 'committed'>) {
		if (this._context.draft?.draftType !== 'cloud') return;

		const isCodeSuggestion = this._context.draft.type === 'suggested_pr_change';
		let label = 'Cloud Patch';
		if (isCodeSuggestion) {
			label = 'Code Suggestion';
		}

		try {
			await this.container.drafts.archiveDraft(this._context.draft, { archiveReason: reason });
			this._context.draft = {
				...this._context.draft,
				isArchived: true,
				archivedReason: reason,
			};

			let action = 'archived';
			if (isCodeSuggestion) {
				switch (reason) {
					case 'accepted':
						action = 'accepted';
						break;
					case 'rejected':
						action = 'declined';
						break;
				}
			}

			void window.showInformationMessage(`${label} successfully ${action}`);
			void this.notifyDidChangeViewDraftState();
		} catch (ex) {
			let action = 'archive';
			if (isCodeSuggestion) {
				switch (reason) {
					case 'accepted':
						action = 'accept';
						break;
					case 'rejected':
						action = 'decline';
						break;
				}
			}

			void window.showErrorMessage(`Unable to ${action} ${label}: ${ex.message}`);
		}
	}

	private async explainRequest<T extends typeof ExplainRequest>(requestType: T, msg: IpcCallMessageType<T>) {
		if (this._context.draft?.draftType !== 'cloud') {
			void this.host.respond(requestType, msg, { error: { message: 'Unable to find patch' } });
			return;
		}

		let params: DidExplainParams;

		try {
			// TODO@eamodio HACK -- only works for the first patch
			const patch = await this.getDraftPatch(this._context.draft);
			if (patch == null) throw new Error('Unable to find patch');

			const commit = await this.getOrCreateCommitForPatch(patch.gkRepositoryId);
			if (commit == null) throw new Error('Unable to find commit');

			const summary = await (
				await this.container.ai
			)?.explainCommit(commit, {
				progress: { location: { viewId: this.host.id } },
			});
			if (summary == null) throw new Error('Error retrieving content');

			params = { summary: summary };
		} catch (ex) {
			debugger;
			params = { error: { message: ex.message } };
		}

		void this.host.respond(requestType, msg, params);
	}

	private async openPatchContents(_params: ExecuteFileActionParams) {
		// TODO@eamodio Open the patch contents for the selected repo in an untitled editor
	}

	private onPatchChecked(params: DraftPatchCheckedParams) {
		if (params.patch.repository.located || params.checked === false) return;

		const patch = (this._context.draft as Draft)?.changesets?.[0].patches?.find(
			p => p.gkRepositoryId === params.patch.gkRepositoryId,
		);
		if (patch == null) return;

		void this.getOrLocatePatchRepository(patch, { prompt: true, notifyOnLocation: true });
	}

	private notifyPatchRepositoryUpdated(patch: DraftPatch) {
		return this.host.notify(DidChangePatchRepositoryNotification, {
			patch: serialize({
				...patch,
				contents: undefined,
				commit: undefined,
				repository: {
					id: patch.gkRepositoryId,
					name: patch.repository?.name ?? '',
					located: isRepoLocated(patch.repository),
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
		this._context.create.visibility = params.visibility;
		void this.notifyDidChangeCreateDraftState();
	}

	private updateDraftMetadata(params: UpdatePatchDetailsMetadataParams) {
		if (this._context.draft == null) return;

		this._context.draftVisibiltyState = params.visibility;
		void this.notifyDidChangeViewDraftState();
	}

	private async updateDraftPermissions() {
		const draft = this._context.draft as Draft;
		const draftId = draft.id;
		const changes = [];

		if (this._context.draftVisibiltyState != null && this._context.draftVisibiltyState !== draft.visibility) {
			changes.push(this.container.drafts.updateDraftVisibility(draftId, this._context.draftVisibiltyState));
		}

		const selections = this._context.draftUserState?.selections;
		const adds: DraftPendingUser[] = [];
		if (selections != null) {
			for (const selection of selections) {
				if (selection.change === undefined) continue;

				// modifying an existing user has to be done by deleting and adding back
				if (selection.change !== 'delete') {
					adds.push({
						userId: selection.member.id,
						role: selection.pendingRole!,
					});
				}

				if (selection.change !== 'add') {
					changes.push(this.container.drafts.removeDraftUser(draftId, selection.member.id));
				}
			}
		}

		if (changes.length === 0 && adds.length === 0) {
			return;
		}
		if (changes.length !== 0) {
			const results = await Promise.all(changes);
			console.log(results);
		}

		if (adds.length !== 0) {
			await this.container.drafts.addDraftUsers(draftId, adds);
		}
		await this.createDraftUserState(draft, { force: true });

		void window.showInformationMessage('Cloud Patch successfully updated');
		void this.notifyDidChangeViewDraftState();
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
			orgSettings: current.orgSettings,
		});
		return state;
	}

	private async notifyDidChangeState() {
		this._notifyDidChangeStateDebounced?.cancel();
		return this.host.notify(DidChangeNotification, { state: await this.getState(this._context) });
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
						{ to: uncommitted, from: 'HEAD' },
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
			visibility: 'public',
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
			visibility: create.visibility,
			userSelections: create.userSelections,
		};
	}

	private async notifyDidChangeCreateDraftState() {
		return this.host.notify(DidChangeCreateNotification, {
			mode: this._context.mode,
			create: await this.getCreateDraftState(this._context),
		});
	}

	private async trackViewDraft(draft: Draft | LocalDraft | undefined, source?: string) {
		if (draft?.draftType !== 'cloud' || draft.type !== 'suggested_pr_change') return;

		draft = await this.ensureDraftContent(draft);
		const patch = draft.changesets?.[0].patches.find(p => isRepoLocated(p.repository));
		if (patch == null) return;

		const repo = patch.repository as Repository;
		const remote = await this.container.git.getBestRemoteWithProvider(repo.uri);
		if (remote == null) return;

		const provider = remote.provider.id;
		const repoPrivacy = await this.container.git.visibility(repo.path);

		this.container.telemetry.sendEvent('codeSuggestionViewed', {
			provider: provider,
			source: source,
			repoPrivacy: repoPrivacy,
			draftPrivacy: draft.visibility,
			draftId: draft.id,
		});
	}

	private async updateViewDraftState(draft: LocalDraft | Draft | undefined) {
		this._context.draft = draft;
		if (draft?.draftType === 'cloud') {
			this._context.draftGkDevUrl = this.container.drafts.generateGkDevUrl(draft).toString();
			await this.createDraftUserState(draft, { force: true });
		}
		this.setMode('view', true);
		void this.notifyDidChangeViewDraftState();
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	private async getViewDraftState(
		current: Context,
		deferredPatchLoading = true,
	): Promise<State['draft'] | undefined> {
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
			if (deferredPatchLoading === true && isDraftMissingContent(draft)) {
				setTimeout(async () => {
					await this.ensureDraftContent(draft);

					void this.notifyDidChangeViewDraftState(false);
				}, 0);
			}

			const draftUserState = this._context.draftUserState!;
			return {
				draftType: 'cloud',
				id: draft.id,
				type: draft.type,
				createdAt: draft.createdAt.getTime(),
				updatedAt: draft.updatedAt.getTime(),
				author: draft.author,
				role: draft.role,
				title: draft.title,
				description: draft.description,
				isArchived: draft.isArchived,
				archivedReason: draft.archivedReason,
				visibility: draft.visibility,
				gkDevLink: this._context.draftGkDevUrl,
				patches: draft.changesets?.length
					? serialize(
							draft.changesets[0].patches.map(p => ({
								...p,
								contents: undefined,
								commit: undefined,
								repository: {
									id: p.gkRepositoryId,
									name: p.repository?.name ?? '',
									located: isRepoLocated(p.repository),
								},
							})),
					  )
					: undefined,
				users: draftUserState.users,
				userSelections: draftUserState.selections,
			};
		}

		return undefined;
	}

	private async createDraftUserState(draft: Draft, options?: { force?: boolean }): Promise<void> {
		if (this._context.draftUserState != null && options?.force !== true) {
			return;
		}
		// try to create the state if it doesn't exist
		try {
			const draftUsers = await this.container.drafts.getDraftUsers(draft.id);
			if (draftUsers.length === 0) {
				return;
			}

			const users: DraftUser[] = [];
			const userSelections: DraftUserSelection[] = [];
			const members = await this.getOrganizationMembers();
			for (const user of draftUsers) {
				users.push(user);
				const member = members.find(m => m.id === user.userId)!;
				userSelections.push(toDraftUserSelection(member, user));
			}

			this._context.draftUserState = { users: users, selections: userSelections };
		} catch (ex) {
			debugger;
		}
	}

	private async notifyDidChangeViewDraftState(deferredPatchLoading = true) {
		return this.host.notify(DidChangeDraftNotification, {
			mode: this._context.mode,
			draft: serialize(await this.getViewDraftState(this._context, deferredPatchLoading)),
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
		return this.host.notify(DidChangePreferencesNotification, { preferences: this._context.preferences });
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
		params: ExecuteFileActionParams,
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
			const commit = await this.container.git.getCommit(file.repoPath, change.revision.to ?? uncommitted);
			if (
				change.revision.to === change.revision.from ||
				(change.revision.from.length === change.revision.to.length + 1 &&
					change.revision.from.endsWith('^') &&
					change.revision.from.startsWith(change.revision.to))
			) {
				return [commit];
			}

			return [commit, change.revision];
		} else if (change.type === 'wip') {
			return [await this.container.git.getCommit(file.repoPath, change.revision.to ?? uncommitted)];
		}

		return [undefined];
	}

	async getOrCreateCommitForPatch(gkRepositoryId: GkRepositoryId): Promise<GitCommit | undefined> {
		const draft = this._context.draft!;
		if (draft.draftType === 'local') return undefined; // TODO

		const patch = await this.getDraftPatch(draft, gkRepositoryId);
		if (patch?.repository == null) return undefined;

		if (patch?.commit == null) {
			const repo = await this.getOrLocatePatchRepository(patch, { prompt: true });
			if (repo == null) return undefined;

			let baseRef = patch.baseRef ?? 'HEAD';

			do {
				try {
					const commit = await this.container.git.createUnreachableCommitForPatch(
						repo.uri,
						patch.contents!,
						baseRef,
						draft.title,
					);
					patch.commit = commit;
				} catch (ex) {
					if (baseRef != null) {
						// const head = { title: 'HEAD' };
						const chooseBase = { title: 'Choose Base...' };
						const cancel = { title: 'Cancel', isCloseAffordance: true };

						const result = await window.showErrorMessage(
							`Unable to apply the patch onto ${
								baseRef === 'HEAD' ? 'HEAD' : `'${shortenRevision(baseRef)}'`
							}.\nDo you want to try again on a different base?`,
							{ modal: true },
							chooseBase,
							cancel,
							// ...(baseRef === 'HEAD' ? [chooseBase, cancel] : [head, chooseBase, cancel]),
						);

						if (result == null || result === cancel) break;
						// if (result === head) {
						// 	baseRef = 'HEAD';
						// 	continue;
						// }

						if (result === chooseBase) {
							const ref = await showReferencePicker(
								repo.path,
								`Choose New Base for Patch`,
								`Choose a new base to apply the patch onto`,
								{
									allowRevisions: true,
									include:
										ReferencesQuickPickIncludes.BranchesAndTags | ReferencesQuickPickIncludes.HEAD,
								},
							);
							if (ref == null) break;

							baseRef = ref.ref;
							continue;
						}
					} else {
						void window.showErrorMessage(
							`Unable to apply the patch on base '${shortenRevision(baseRef)}': ${ex.message}`,
						);
					}
				}

				break;
			} while (true);
		}

		return patch?.commit;
	}

	private async openFile(params: ExecuteFileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file] = result;

		void openFile(file, commit, {
			preserveFocus: true,
			preview: true,
			...params.showOptions,
		});
	}

	private getChangesTitleNote() {
		if (
			this._context.mode === 'view' &&
			this._context.draft?.draftType === 'cloud' &&
			this._context.draft.type === 'suggested_pr_change'
		) {
			return 'Code Suggestion';
		}

		return 'Patch';
	}

	private async openFileComparisonWithPrevious(params: ExecuteFileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file, revision] = result;

		const titleNote = this.getChangesTitleNote();

		void openChanges(
			file,
			revision != null
				? { repoPath: commit.repoPath, rhs: revision.to ?? uncommitted, lhs: revision.from }
				: commit,
			{
				preserveFocus: true,
				preview: true,
				...params.showOptions,
				rhsTitle: this.mode === 'view' ? `${basename(file.path)} (${titleNote})` : undefined,
			},
		);
		this.container.events.fire('file:selected', { uri: file.uri }, { source: this.host.id });
	}

	private async openFileComparisonWithWorking(params: ExecuteFileActionParams) {
		const result = await this.getFileCommitFromParams(params);
		if (result == null) return;

		const [commit, file, revision] = result;

		const titleNote = this.getChangesTitleNote();

		void openChangesWithWorking(file, revision != null ? { repoPath: commit.repoPath, ref: revision.to } : commit, {
			preserveFocus: true,
			preview: true,
			...params.showOptions,
			lhsTitle: this.mode === 'view' ? `${basename(file.path)} (${titleNote})` : undefined,
		});
	}

	private async getOrLocatePatchRepository(
		patch: DraftPatch,
		options?: { notifyOnLocation?: boolean; prompt?: boolean },
	): Promise<Repository | undefined> {
		if (patch.repository == null || isRepository(patch.repository)) {
			return patch.repository;
		}

		const repo = await this.container.repositoryIdentity.getRepository(patch.repository, {
			openIfNeeded: true,
			prompt: options?.prompt ?? false,
		});
		if (repo == null) {
			void window.showErrorMessage(`Unable to locate repository '${patch.repository.name}'`);
		} else {
			patch.repository = repo;

			if (options?.notifyOnLocation) {
				void this.notifyPatchRepositoryUpdated(patch);
			}
		}

		return repo;
	}

	// private draftContentPromise: [Draft['id'], Promise<Draft>] | undefined;
	private async ensureDraftContent(draft: Draft): Promise<Draft> {
		if (!isDraftMissingContent(draft)) {
			return draft;
		}

		if (draft.changesets == null) {
			draft.changesets = await this.container.drafts.getChangesets(draft.id);
		}

		const patches = draft.changesets
			.flatMap(cs => cs.patches)
			.filter(p => p.contents == null || p.files == null || p.repository == null);

		if (patches.length === 0) {
			return draft;
		}

		const patchDetails = await Promise.allSettled(patches.map(p => this.container.drafts.getPatchDetails(p)));

		for (const d of patchDetails) {
			if (d.status === 'fulfilled') {
				const patch = patches.find(p => p.id === d.value.id);
				if (patch != null) {
					patch.contents = d.value.contents;
					patch.files = d.value.files;
					patch.repository = d.value.repository;
					await this.getOrLocatePatchRepository(patch);
				}
			}
		}

		return draft;
	}
}

function isDraftMissingContent(draft: Draft): boolean {
	if (draft.changesets == null) return true;

	return some(draft.changesets, cs =>
		cs.patches.some(p => p.contents == null || p.files == null || p.repository == null),
	);
}

function isRepoLocated(repo: DraftPatch['repository']): boolean {
	return repo != null && isRepository(repo);
}

function toDraftUserSelection(
	member: OrganizationMember,
	user?: DraftUserSelection['user'],
	pendingRole?: DraftPendingUser['role'],
	change?: DraftUserSelection['change'],
): DraftUserSelection {
	return {
		change: change,
		member: member,
		user: user,
		pendingRole: pendingRole,
		avatarUrl: member?.email != null ? getAvatarUri(member.email, undefined).toString() : undefined,
	};
}
