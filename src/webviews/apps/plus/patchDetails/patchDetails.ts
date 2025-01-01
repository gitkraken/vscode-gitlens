/*global*/
import type { TextDocumentShowOptions } from 'vscode';
import type { ViewFilesLayout } from '../../../../config';
import type { Commands } from '../../../../constants.commands';
import type { DraftPatchFileChange, DraftVisibility } from '../../../../gk/models/drafts';
import { debounce } from '../../../../system/function';
import type { Serialized } from '../../../../system/vscode/serialize';
import type { State, SwitchModeParams } from '../../../plus/patchDetails/protocol';
import {
	ApplyPatchCommand,
	ArchiveDraftCommand,
	CopyCloudLinkCommand,
	CreateFromLocalPatchCommand,
	CreatePatchCommand,
	DidChangeCreateNotification,
	DidChangeDraftNotification,
	DidChangeNotification,
	DidChangePatchRepositoryNotification,
	DidChangePreferencesNotification,
	DraftPatchCheckedCommand,
	ExecuteFileActionCommand,
	ExplainRequest,
	GenerateRequest,
	OpenFileCommand,
	OpenFileComparePreviousCommand,
	OpenFileCompareWorkingCommand,
	OpenFileOnRemoteCommand,
	SelectPatchBaseCommand,
	SelectPatchRepoCommand,
	SwitchModeCommand,
	UpdateCreatePatchMetadataCommand,
	UpdateCreatePatchRepositoryCheckedStateCommand,
	UpdatePatchDetailsMetadataCommand,
	UpdatePatchDetailsPermissionsCommand,
	UpdatePatchUsersCommand,
	UpdatePatchUserSelectionCommand,
	UpdatePreferencesCommand,
} from '../../../plus/patchDetails/protocol';
import type { IpcMessage } from '../../../protocol';
import { ExecuteCommand } from '../../../protocol';
import { App } from '../../shared/appBase';
import { DOM } from '../../shared/dom';
import type {
	ApplyPatchDetail,
	DraftReasonEventDetail,
	GlDraftDetails,
	PatchCheckedDetail,
	PatchDetailsUpdateSelectionEventDetail,
} from './components/gl-draft-details';
import type {
	CreatePatchCheckRepositoryEventDetail,
	CreatePatchEventDetail,
	CreatePatchMetadataEventDetail,
	CreatePatchUpdateSelectionEventDetail,
	GlPatchCreate,
} from './components/gl-patch-create';
import type {
	ChangePatchBaseDetail,
	GlPatchDetailsApp,
	SelectPatchRepoDetail,
	ShowPatchInGraphDetail,
} from './components/patch-details-app';
import './patchDetails.scss';
import './components/patch-details-app';

export const uncommittedSha = '0000000000000000000000000000000000000000';

export interface FileChangeListItemDetail extends DraftPatchFileChange {
	showOptions?: TextDocumentShowOptions;
}

export class PatchDetailsApp extends App<Serialized<State>> {
	constructor() {
		super('PatchDetailsApp');
	}

	override onInitialize() {
		this.debouncedAttachState();
	}

	override onBind() {
		const disposables = [
			DOM.on('[data-switch-value]', 'click', e => this.onToggleFilesLayout(e)),
			DOM.on('[data-action="ai-explain"]', 'click', e => this.onAIExplain(e)),
			DOM.on('[data-action="switch-ai"]', 'click', e => this.onSwitchAIModel(e)),
			DOM.on('[data-action="mode"]', 'click', e => this.onModeClicked(e)),
			DOM.on<GlDraftDetails, ApplyPatchDetail>('gl-draft-details', 'gl-patch-apply-patch', e =>
				this.onApplyPatch(e.detail),
			),
			DOM.on<GlDraftDetails, DraftReasonEventDetail>('gl-draft-details', 'gl-draft-archive', e =>
				this.onArchiveDraft(e.detail.reason),
			),
			DOM.on<GlPatchDetailsApp, ChangePatchBaseDetail>('gl-patch-details-app', 'change-patch-base', e =>
				this.onChangePatchBase(e.detail),
			),
			DOM.on<GlPatchDetailsApp, SelectPatchRepoDetail>('gl-patch-details-app', 'select-patch-repo', e =>
				this.onSelectPatchRepo(e.detail),
			),
			DOM.on<GlPatchDetailsApp, ShowPatchInGraphDetail>(
				'gl-patch-details-app',
				'gl-patch-details-graph-show-patch',
				e => this.onShowPatchInGraph(e.detail),
			),
			DOM.on<GlPatchDetailsApp, CreatePatchEventDetail>('gl-patch-details-app', 'gl-patch-create-patch', e =>
				this.onCreatePatch(e.detail),
			),
			DOM.on<GlPatchDetailsApp, undefined>('gl-patch-details-app', 'gl-patch-share-local-patch', () =>
				this.onShareLocalPatch(),
			),
			DOM.on<GlDraftDetails, undefined>('gl-draft-details', 'gl-patch-details-copy-cloud-link', () =>
				this.onCopyCloudLink(),
			),
			DOM.on<GlPatchCreate, undefined>('gl-patch-create', 'gl-patch-create-invite-users', () =>
				this.onInviteUsers(),
			),
			DOM.on<GlDraftDetails, undefined>('gl-draft-details', 'gl-patch-details-invite-users', () =>
				this.onInviteUsers(),
			),
			DOM.on<GlPatchCreate, CreatePatchUpdateSelectionEventDetail>(
				'gl-patch-create',
				'gl-patch-create-update-selection',
				e => this.onUpdateUserSelection(e.detail),
			),
			DOM.on<GlDraftDetails, PatchDetailsUpdateSelectionEventDetail>(
				'gl-draft-details',
				'gl-patch-details-update-selection',
				e => this.onUpdateUserSelection(e.detail),
			),
			DOM.on<GlPatchCreate, CreatePatchCheckRepositoryEventDetail>(
				'gl-patch-create',
				'gl-patch-create-repo-checked',
				e => this.onCreateCheckRepo(e.detail),
			),
			DOM.on<GlPatchCreate, CreatePatchMetadataEventDetail>('gl-patch-create', 'gl-patch-generate-title', e =>
				this.onCreateGenerateTitle(e.detail),
			),
			DOM.on<GlPatchCreate, CreatePatchMetadataEventDetail>(
				'gl-patch-create',
				'gl-patch-create-update-metadata',
				e => this.onCreateUpdateMetadata(e.detail),
			),
			DOM.on<GlDraftDetails, { visibility: DraftVisibility }>(
				'gl-draft-details',
				'gl-patch-details-update-metadata',
				e => this.onDraftUpdateMetadata(e.detail),
			),
			DOM.on<GlDraftDetails, undefined>('gl-draft-details', 'gl-patch-details-update-permissions', () =>
				this.onDraftUpdatePermissions(),
			),
			DOM.on<GlPatchCreate, FileChangeListItemDetail>(
				'gl-patch-create,gl-draft-details',
				'gl-patch-file-compare-previous',
				e => this.onCompareFileWithPrevious(e.detail),
			),
			DOM.on<GlPatchCreate, FileChangeListItemDetail>(
				'gl-patch-create,gl-draft-details',
				'gl-patch-file-compare-working',
				e => this.onCompareFileWithWorking(e.detail),
			),
			DOM.on<GlDraftDetails, FileChangeListItemDetail>(
				'gl-patch-create,gl-draft-details',
				'gl-patch-file-open',
				e => this.onOpenFile(e.detail),
			),
			DOM.on<GlDraftDetails, PatchCheckedDetail>('gl-draft-details', 'gl-patch-checked', e =>
				this.onPatchChecked(e.detail),
			),
		];

		return disposables;
	}

	protected override onMessageReceived(msg: IpcMessage) {
		switch (true) {
			// case DidChangeRichStateNotificationType.method:
			// 	onIpc(DidChangeRichStateNotificationType, msg, params => {
			// 		if (this.state.selected == null) return;

			// 		assertsSerialized<typeof params>(params);

			// 		const newState = { ...this.state };
			// 		if (params.formattedMessage != null) {
			// 			newState.selected!.message = params.formattedMessage;
			// 		}
			// 		// if (params.pullRequest != null) {
			// 		newState.pullRequest = params.pullRequest;
			// 		// }
			// 		// if (params.formattedMessage != null) {
			// 		newState.autolinkedIssues = params.autolinkedIssues;
			// 		// }

			// 		this.state = newState;
			// 		this.setState(this.state);

			// 		this.renderRichContent();
			// 	});
			// 	break;
			case DidChangeNotification.is(msg):
				assertsSerialized<State>(msg.params.state);

				this.state = msg.params.state;
				this.setState(this.state);
				this.debouncedAttachState();
				break;

			case DidChangeCreateNotification.is(msg):
				// assertsSerialized<State>(params.state);

				this.state = { ...this.state, ...msg.params };
				this.setState(this.state);
				this.debouncedAttachState(true);
				break;

			case DidChangeDraftNotification.is(msg):
				// assertsSerialized<State>(params.state);

				this.state = { ...this.state, ...msg.params };
				this.setState(this.state);
				this.debouncedAttachState(true);
				break;

			case DidChangePreferencesNotification.is(msg):
				// assertsSerialized<State>(params.state);

				this.state = { ...this.state, ...msg.params };
				this.setState(this.state);
				this.debouncedAttachState(true);
				break;

			case DidChangePatchRepositoryNotification.is(msg): {
				// assertsSerialized<State>(params.state);

				const draft = this.state.draft!;
				const patches = draft.patches!;
				const patchIndex = patches.findIndex(p => p.id === msg.params.patch.id);
				patches.splice(patchIndex, 1, msg.params.patch);

				this.state = {
					...this.state,
					draft: draft,
				};
				this.setState(this.state);
				this.debouncedAttachState(true);
				break;
			}
			default:
				super.onMessageReceived?.(msg);
		}
	}

	private onPatchChecked(e: PatchCheckedDetail) {
		this.sendCommand(DraftPatchCheckedCommand, e);
	}

	private onCreateCheckRepo(e: CreatePatchCheckRepositoryEventDetail) {
		this.sendCommand(UpdateCreatePatchRepositoryCheckedStateCommand, e);
	}

	private onCreateUpdateMetadata(e: CreatePatchMetadataEventDetail) {
		this.sendCommand(UpdateCreatePatchMetadataCommand, e);
	}

	private async onCreateGenerateTitle(_e: CreatePatchMetadataEventDetail) {
		try {
			const result = await this.sendRequest(GenerateRequest, undefined);

			if (result.error) {
				this.component.generate = { error: { message: result.error.message ?? 'Error retrieving content' } };
			} else if (result.title || result.description) {
				this.component.generate = {
					title: result.title,
					description: result.description,
				};

				this.state = {
					...this.state,
					create: {
						...this.state.create!,
						title: result.title ?? this.state.create?.title,
						description: result.description ?? this.state.create?.description,
					},
				};
				this.setState(this.state);
				this.debouncedAttachState();
			} else {
				this.component.generate = undefined;
			}
		} catch (_ex) {
			this.component.generate = { error: { message: 'Error retrieving content' } };
		}
	}

	private onDraftUpdateMetadata(e: { visibility: DraftVisibility }) {
		this.sendCommand(UpdatePatchDetailsMetadataCommand, e);
	}

	private onDraftUpdatePermissions() {
		this.sendCommand(UpdatePatchDetailsPermissionsCommand, undefined);
	}

	private onShowPatchInGraph(_e: ShowPatchInGraphDetail) {
		// this.sendCommand(OpenInCommitGraphCommandType, { });
	}

	private onCreatePatch(e: CreatePatchEventDetail) {
		this.sendCommand(CreatePatchCommand, e);
	}

	private onShareLocalPatch() {
		this.sendCommand(CreateFromLocalPatchCommand, undefined);
	}

	private onCopyCloudLink() {
		this.sendCommand(CopyCloudLinkCommand, undefined);
	}

	private onModeClicked(e: Event) {
		const mode = ((e.target as HTMLElement)?.dataset.actionValue as SwitchModeParams['mode']) ?? undefined;
		if (mode === this.state.mode) return;

		this.sendCommand(SwitchModeCommand, { mode: mode });
	}

	private onApplyPatch(e: ApplyPatchDetail) {
		console.log('onApplyPatch', e);
		if (e.selectedPatches == null || e.selectedPatches.length === 0) return;
		this.sendCommand(ApplyPatchCommand, {
			details: e.draft,
			target: e.target ?? 'current',
			selected: e.selectedPatches,
		});
	}

	private onArchiveDraft(reason?: DraftReasonEventDetail['reason']) {
		this.sendCommand(ArchiveDraftCommand, { reason: reason });
	}

	private onChangePatchBase(e: ChangePatchBaseDetail) {
		console.log('onChangePatchBase', e);
		this.sendCommand(SelectPatchBaseCommand, undefined);
	}

	private onSelectPatchRepo(e: SelectPatchRepoDetail) {
		console.log('onSelectPatchRepo', e);
		this.sendCommand(SelectPatchRepoCommand, undefined);
	}

	private onCommandClickedCore(action?: Commands | `command:${Commands}`) {
		const command = (action?.startsWith('command:') ? action.slice(8) : action) as Commands | undefined;
		if (command == null) return;

		this.sendCommand(ExecuteCommand, { command: command });
	}

	private onSwitchAIModel(_e: MouseEvent) {
		this.onCommandClickedCore('gitlens.switchAIModel');
	}

	async onAIExplain(_e: MouseEvent) {
		try {
			const result = await this.sendRequest(ExplainRequest, undefined);

			if (result.error) {
				this.component.explain = { error: { message: result.error.message ?? 'Error retrieving content' } };
			} else {
				this.component.explain = result;
			}
		} catch (_ex) {
			this.component.explain = { error: { message: 'Error retrieving content' } };
		}
	}

	private onToggleFilesLayout(e: MouseEvent) {
		const layout = ((e.target as HTMLElement)?.dataset.switchValue as ViewFilesLayout) ?? undefined;
		if (layout === this.state.preferences.files?.layout) return;

		const files: State['preferences']['files'] = {
			...this.state.preferences.files,
			layout: layout ?? 'auto',
			compact: this.state.preferences.files?.compact ?? true,
			threshold: this.state.preferences.files?.threshold ?? 5,
			icon: this.state.preferences.files?.icon ?? 'type',
		};

		this.state = { ...this.state, preferences: { ...this.state.preferences, files: files } };
		this.debouncedAttachState();

		this.sendCommand(UpdatePreferencesCommand, { files: files });
	}

	private onInviteUsers() {
		this.sendCommand(UpdatePatchUsersCommand, undefined);
	}

	private onUpdateUserSelection(e: CreatePatchUpdateSelectionEventDetail | PatchDetailsUpdateSelectionEventDetail) {
		this.sendCommand(UpdatePatchUserSelectionCommand, e);
	}

	private onOpenFileOnRemote(e: FileChangeListItemDetail) {
		this.sendCommand(OpenFileOnRemoteCommand, e);
	}

	private onOpenFile(e: FileChangeListItemDetail) {
		this.sendCommand(OpenFileCommand, e);
	}

	private onCompareFileWithWorking(e: FileChangeListItemDetail) {
		this.sendCommand(OpenFileCompareWorkingCommand, e);
	}

	private onCompareFileWithPrevious(e: FileChangeListItemDetail) {
		this.sendCommand(OpenFileComparePreviousCommand, e);
	}

	private onFileMoreActions(e: FileChangeListItemDetail) {
		this.sendCommand(ExecuteFileActionCommand, e);
	}

	private _component?: GlPatchDetailsApp;
	private get component() {
		if (this._component == null) {
			this._component = (document.getElementById('app') as GlPatchDetailsApp)!;
			this._component.app = this;
		}
		return this._component;
	}

	private attachState(_force?: boolean) {
		this.component.state = this.state!;
		// if (force) {
		// 	this.component.requestUpdate('state');
		// }
	}
	private debouncedAttachState = debounce(this.attachState.bind(this), 100);
}

function assertsSerialized<T>(obj: unknown): asserts obj is Serialized<T> {}

new PatchDetailsApp();
