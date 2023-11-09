/*global*/
import type { TextDocumentShowOptions } from 'vscode';
import type { ViewFilesLayout } from '../../../../config';
import type { DraftPatchFileChange } from '../../../../gk/models/drafts';
import type { State, SwitchModeParams } from '../../../../plus/webviews/patchDetails/protocol';
import {
	ApplyPatchCommandType,
	CopyCloudLinkCommandType,
	CreateFromLocalPatchCommandType,
	CreatePatchCommandType,
	DidChangeCreateNotificationType,
	DidChangeDraftNotificationType,
	DidChangeNotificationType,
	DidChangePatchRepositoryNotificationType,
	DidChangePreferencesNotificationType,
	DidExplainCommandType,
	DraftPatchCheckedCommandType,
	ExplainCommandType,
	FileActionsCommandType,
	OpenFileCommandType,
	OpenFileComparePreviousCommandType,
	OpenFileCompareWorkingCommandType,
	OpenFileOnRemoteCommandType,
	SelectPatchBaseCommandType,
	SelectPatchRepoCommandType,
	SwitchModeCommandType,
	UpdateCreatePatchMetadataCommandType,
	UpdateCreatePatchRepositoryCheckedStateCommandType,
	UpdatePreferencesCommandType,
} from '../../../../plus/webviews/patchDetails/protocol';
import type { Serialized } from '../../../../system/serialize';
import type { IpcMessage } from '../../../protocol';
import { ExecuteCommandType, onIpc } from '../../../protocol';
import { App } from '../../shared/appBase';
import { DOM } from '../../shared/dom';
import type { ApplyPatchDetail, GlDraftDetails, PatchCheckedDetail } from './components/gl-draft-details';
import type {
	CreatePatchCheckRepositoryEventDetail,
	CreatePatchEventDetail,
	CreatePatchMetadataEventDetail,
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
		this.attachState();
	}

	override onBind() {
		const disposables = [
			// DOM.on<FileChangeListItem, FileChangeListItemDetail>('file-change-list-item', 'file-open-on-remote', e =>
			// 	this.onOpenFileOnRemote(e.detail),
			// ),
			// DOM.on<FileChangeListItem, FileChangeListItemDetail>('file-change-list-item', 'file-compare-working', e =>
			// 	this.onCompareFileWithWorking(e.detail),
			// ),
			// DOM.on<FileChangeListItem, FileChangeListItemDetail>('file-change-list-item', 'file-more-actions', e =>
			// 	this.onFileMoreActions(e.detail),
			// ),
			DOM.on('[data-switch-value]', 'click', e => this.onToggleFilesLayout(e)),
			DOM.on('[data-action="ai-explain"]', 'click', e => this.onAIExplain(e)),
			DOM.on('[data-action="switch-ai"]', 'click', e => this.onSwitchAIModel(e)),
			DOM.on('[data-action="mode"]', 'click', e => this.onModeClicked(e)),
			DOM.on<GlDraftDetails, ApplyPatchDetail>('gl-draft-details', 'gl-patch-apply-patch', e =>
				this.onApplyPatch(e.detail),
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
			DOM.on<GlPatchCreate, CreatePatchCheckRepositoryEventDetail>(
				'gl-patch-create',
				'gl-patch-create-repo-checked',
				e => this.onCreateCheckRepo(e.detail),
			),
			DOM.on<GlPatchCreate, CreatePatchMetadataEventDetail>(
				'gl-patch-create',
				'gl-patch-create-update-metadata',
				e => this.onCreateUpdateMetadata(e.detail),
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

	protected override onMessageReceived(e: MessageEvent) {
		const msg = e.data as IpcMessage;
		this.log(`onMessageReceived(${msg.id}): name=${msg.method}`);

		switch (msg.method) {
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
			case DidChangeNotificationType.method:
				onIpc(DidChangeNotificationType, msg, params => {
					assertsSerialized<State>(params.state);

					this.state = params.state;
					this.setState(this.state);
					this.attachState();
				});
				break;

			case DidChangeCreateNotificationType.method:
				onIpc(DidChangeCreateNotificationType, msg, params => {
					// assertsSerialized<State>(params.state);

					this.state = { ...this.state, ...params };
					this.setState(this.state);
					this.attachState(true);
				});
				break;

			case DidChangeDraftNotificationType.method:
				onIpc(DidChangeDraftNotificationType, msg, params => {
					// assertsSerialized<State>(params.state);

					this.state = { ...this.state, ...params };
					this.setState(this.state);
					this.attachState(true);
				});
				break;

			case DidChangePreferencesNotificationType.method:
				onIpc(DidChangePreferencesNotificationType, msg, params => {
					// assertsSerialized<State>(params.state);

					this.state = { ...this.state, ...params };
					this.setState(this.state);
					this.attachState(true);
				});
				break;

			case DidChangePatchRepositoryNotificationType.method:
				onIpc(DidChangePatchRepositoryNotificationType, msg, params => {
					// assertsSerialized<State>(params.state);

					const draft = this.state.draft!;
					const patches = draft.patches!;
					const patchIndex = patches.findIndex(p => p.id === params.patch.id);
					patches.splice(patchIndex, 1, params.patch);

					this.state = {
						...this.state,
						draft: draft,
					};
					this.setState(this.state);
					this.attachState(true);
				});
				break;

			default:
				super.onMessageReceived?.(e);
		}
	}

	private onPatchChecked(e: PatchCheckedDetail) {
		this.sendCommand(DraftPatchCheckedCommandType, e);
	}

	private onCreateCheckRepo(e: CreatePatchCheckRepositoryEventDetail) {
		this.sendCommand(UpdateCreatePatchRepositoryCheckedStateCommandType, e);
	}

	private onCreateUpdateMetadata(e: CreatePatchMetadataEventDetail) {
		this.sendCommand(UpdateCreatePatchMetadataCommandType, e);
	}

	private onShowPatchInGraph(_e: ShowPatchInGraphDetail) {
		// this.sendCommand(OpenInCommitGraphCommandType, { });
	}

	private onCreatePatch(e: CreatePatchEventDetail) {
		this.sendCommand(CreatePatchCommandType, e);
	}

	private onShareLocalPatch() {
		this.sendCommand(CreateFromLocalPatchCommandType, undefined);
	}

	private onCopyCloudLink() {
		this.sendCommand(CopyCloudLinkCommandType, undefined);
	}

	private onModeClicked(e: Event) {
		const mode = ((e.target as HTMLElement)?.dataset.actionValue as SwitchModeParams['mode']) ?? undefined;
		if (mode === this.state.mode) return;

		this.sendCommand(SwitchModeCommandType, { mode: mode });
	}

	private onApplyPatch(e: ApplyPatchDetail) {
		console.log('onApplyPatch', e);
		if (e.selectedPatches == null || e.selectedPatches.length === 0) return;
		this.sendCommand(ApplyPatchCommandType, {
			details: e.draft,
			target: e.target ?? 'current',
			selected: e.selectedPatches,
		});
	}

	private onChangePatchBase(e: ChangePatchBaseDetail) {
		console.log('onChangePatchBase', e);
		this.sendCommand(SelectPatchBaseCommandType, undefined);
	}

	private onSelectPatchRepo(e: SelectPatchRepoDetail) {
		console.log('onSelectPatchRepo', e);
		this.sendCommand(SelectPatchRepoCommandType, undefined);
	}

	private onCommandClickedCore(action?: string) {
		const command = action?.startsWith('command:') ? action.slice(8) : action;
		if (command == null) return;

		this.sendCommand(ExecuteCommandType, { command: command });
	}

	private onSwitchAIModel(_e: MouseEvent) {
		this.onCommandClickedCore('gitlens.switchAIModel');
	}

	async onAIExplain(_e: MouseEvent) {
		try {
			const result = await this.sendCommandWithCompletion(ExplainCommandType, undefined, DidExplainCommandType);

			if (result.error) {
				this.component.explain = { error: { message: result.error.message ?? 'Error retrieving content' } };
			} else if (result.summary) {
				this.component.explain = { summary: result.summary };
			} else {
				this.component.explain = undefined;
			}
		} catch (ex) {
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
		this.attachState();

		this.sendCommand(UpdatePreferencesCommandType, { files: files });
	}

	private onOpenFileOnRemote(e: FileChangeListItemDetail) {
		this.sendCommand(OpenFileOnRemoteCommandType, e);
	}

	private onOpenFile(e: FileChangeListItemDetail) {
		this.sendCommand(OpenFileCommandType, e);
	}

	private onCompareFileWithWorking(e: FileChangeListItemDetail) {
		this.sendCommand(OpenFileCompareWorkingCommandType, e);
	}

	private onCompareFileWithPrevious(e: FileChangeListItemDetail) {
		this.sendCommand(OpenFileComparePreviousCommandType, e);
	}

	private onFileMoreActions(e: FileChangeListItemDetail) {
		this.sendCommand(FileActionsCommandType, e);
	}

	private _component?: GlPatchDetailsApp;
	private get component() {
		if (this._component == null) {
			this._component = (document.getElementById('app') as GlPatchDetailsApp)!;
			this._component.app = this;
		}
		return this._component;
	}

	attachState(_force?: boolean) {
		this.component.state = this.state!;
		// if (force) {
		// 	this.component.requestUpdate('state');
		// }
	}
}

function assertsSerialized<T>(obj: unknown): asserts obj is Serialized<T> {}

new PatchDetailsApp();
