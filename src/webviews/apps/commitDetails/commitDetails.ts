/*global*/
import type { ViewFilesLayout } from '../../../config';
import type { Serialized } from '../../../system/serialize';
import type { CommitActionsParams, Mode, State } from '../../commitDetails/protocol';
import {
	AutolinkSettingsCommandType,
	CommitActionsCommandType,
	CreatePatchFromWipCommandType,
	DidChangeNotificationType,
	DidChangeWipStateNotificationType,
	DidExplainCommandType,
	ExplainCommandType,
	FileActionsCommandType,
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
} from '../../commitDetails/protocol';
import type { IpcMessage } from '../../protocol';
import { ExecuteCommandType, onIpc } from '../../protocol';
import { App } from '../shared/appBase';
import type { WebviewPane, WebviewPaneExpandedChangeEventDetail } from '../shared/components/webview-pane';
import { DOM } from '../shared/dom';
import type { GlCommitDetailsApp } from './components/commit-details-app';
import type { GlCommitDetails } from './components/gl-commit-details';
import type { FileChangeListItemDetail } from './components/gl-details-base';
import './commitDetails.scss';
import '../shared/components/actions/action-item';
import '../shared/components/actions/action-nav';
import '../shared/components/code-icon';
import '../shared/components/commit/commit-identity';
import '../shared/components/formatted-date';
import '../shared/components/rich/issue-pull-request';
import '../shared/components/skeleton-loader';
import '../shared/components/commit/commit-stats';
import '../shared/components/webview-pane';
import '../shared/components/progress';
import '../shared/components/list/list-container';
import '../shared/components/list/list-item';
import '../shared/components/list/file-change-list-item';
import './components/commit-details-app';

export const uncommittedSha = '0000000000000000000000000000000000000000';

export type CommitState = SomeNonNullable<Serialized<State>, 'commit'>;
export class CommitDetailsApp extends App<Serialized<State>> {
	constructor() {
		super('CommitDetailsApp');
	}

	override onInitialize() {
		this.attachState();
	}

	override onBind() {
		const disposables = [
			DOM.on('[data-action="commit-actions"]', 'click', e => this.onCommitActions(e)),
			DOM.on('[data-action="pick-commit"]', 'click', e => this.onPickCommit(e)),
			DOM.on('[data-action="wip"]', 'click', e => this.onSwitchMode(e, 'wip')),
			DOM.on('[data-action="details"]', 'click', e => this.onSwitchMode(e, 'commit')),
			DOM.on('[data-action="search-commit"]', 'click', e => this.onSearchCommit(e)),
			DOM.on('[data-action="autolink-settings"]', 'click', e => this.onAutolinkSettings(e)),
			DOM.on('[data-action="files-layout"]', 'click', e => this.onToggleFilesLayout(e)),
			DOM.on('[data-action="pin"]', 'click', e => this.onTogglePin(e)),
			DOM.on('[data-action="back"]', 'click', e => this.onNavigate('back', e)),
			DOM.on('[data-action="forward"]', 'click', e => this.onNavigate('forward', e)),
			DOM.on('[data-action="create-patch"]', 'click', _e => this.onCreatePatchFromWip(true)),
			DOM.on<WebviewPane, WebviewPaneExpandedChangeEventDetail>(
				'[data-region="rich-pane"]',
				'expanded-change',
				e => this.onExpandedChange(e.detail),
			),
			DOM.on('[data-action="explain-commit"]', 'click', e => this.onExplainCommit(e)),
			DOM.on('[data-action="switch-ai"]', 'click', e => this.onSwitchAiModel(e)),
			DOM.on<GlCommitDetails, { checked: boolean | 'staged' }>('gl-wip-details', 'create-patch', e =>
				this.onCreatePatchFromWip(e.detail.checked),
			),

			DOM.on<GlCommitDetails, FileChangeListItemDetail>('gl-commit-details', 'file-open-on-remote', e =>
				this.onOpenFileOnRemote(e.detail),
			),
			DOM.on<GlCommitDetails, FileChangeListItemDetail>('gl-commit-details,gl-wip-details', 'file-open', e =>
				this.onOpenFile(e.detail),
			),
			DOM.on<GlCommitDetails, FileChangeListItemDetail>('gl-commit-details', 'file-compare-working', e =>
				this.onCompareFileWithWorking(e.detail),
			),
			DOM.on<GlCommitDetails, FileChangeListItemDetail>(
				'gl-commit-details,gl-wip-details',
				'file-compare-previous',
				e => this.onCompareFileWithPrevious(e.detail),
			),
			DOM.on<GlCommitDetails, FileChangeListItemDetail>('gl-commit-details', 'file-more-actions', e =>
				this.onFileMoreActions(e.detail),
			),
			DOM.on<GlCommitDetails, FileChangeListItemDetail>('gl-wip-details', 'file-stage', e =>
				this.onStageFile(e.detail),
			),
			DOM.on<GlCommitDetails, FileChangeListItemDetail>('gl-wip-details', 'file-unstage', e =>
				this.onUnstageFile(e.detail),
			),
		];

		return disposables;
	}

	protected override onMessageReceived(msg: IpcMessage) {
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

			case DidChangeWipStateNotificationType.method:
				onIpc(DidChangeWipStateNotificationType, msg, params => {
					this.state = { ...this.state, ...params };
					this.setState(this.state);
					this.attachState();
				});
				break;

			default:
				super.onMessageReceived?.(msg);
		}
	}

	private onCreatePatchFromWip(checked: boolean | 'staged' = true) {
		if (this.state.wip?.changes == null) return;
		this.sendCommand(CreatePatchFromWipCommandType, { changes: this.state.wip?.changes, checked: checked });
	}

	private onCommandClickedCore(action?: string) {
		const command = action?.startsWith('command:') ? action.slice(8) : action;
		if (command == null) return;

		this.sendCommand(ExecuteCommandType, { command: command });
	}

	private onSwitchAiModel(_e: MouseEvent) {
		this.onCommandClickedCore('gitlens.switchAIModel');
	}

	async onExplainCommit(_e: MouseEvent) {
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
		const layout = ((e.target as HTMLElement)?.dataset.filesLayout as ViewFilesLayout) ?? undefined;
		if (layout === this.state.preferences?.files?.layout) return;

		const files = {
			...this.state.preferences?.files,
			layout: layout ?? 'auto',
		};

		this.state = { ...this.state, preferences: { ...this.state.preferences, files: files } };
		this.attachState();

		this.sendCommand(UpdatePreferencesCommandType, { files: files });
	}

	private onExpandedChange(e: WebviewPaneExpandedChangeEventDetail) {
		this.state = { ...this.state, preferences: { ...this.state.preferences, autolinksExpanded: e.expanded } };
		this.attachState();

		this.sendCommand(UpdatePreferencesCommandType, { autolinksExpanded: e.expanded });
	}

	private onNavigate(direction: 'back' | 'forward', e: Event) {
		e.preventDefault();
		this.sendCommand(NavigateCommitCommandType, { direction: direction });
	}

	private onTogglePin(e: MouseEvent) {
		e.preventDefault();
		this.sendCommand(PinCommitCommandType, { pin: !this.state.pinned });
	}

	private onAutolinkSettings(e: MouseEvent) {
		e.preventDefault();
		this.sendCommand(AutolinkSettingsCommandType, undefined);
	}

	private onPickCommit(_e: MouseEvent) {
		this.sendCommand(PickCommitCommandType, undefined);
	}

	private onSearchCommit(_e: MouseEvent) {
		this.sendCommand(SearchCommitCommandType, undefined);
	}

	private onSwitchMode(_e: MouseEvent, mode: Mode) {
		this.state = { ...this.state, mode: mode };
		this.attachState();

		this.sendCommand(SwitchModeCommandType, { mode: mode, repoPath: this.state.commit?.repoPath });
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

	onStageFile(e: FileChangeListItemDetail): void {
		this.sendCommand(StageFileCommandType, e);
	}

	onUnstageFile(e: FileChangeListItemDetail): void {
		this.sendCommand(UnstageFileCommandType, e);
	}

	private onCommitActions(e: MouseEvent) {
		e.preventDefault();
		if (this.state.commit === undefined) {
			e.stopPropagation();
			return;
		}

		const action = (e.target as HTMLElement)?.getAttribute('data-action-type');
		if (action == null) return;

		this.sendCommand(CommitActionsCommandType, { action: action as CommitActionsParams['action'], alt: e.altKey });
	}

	private _component?: GlCommitDetailsApp;
	private get component() {
		if (this._component == null) {
			this._component = (document.getElementById('app') as GlCommitDetailsApp)!;
		}
		return this._component;
	}

	attachState() {
		this.component.state = this.state;
	}
}

function assertsSerialized<T>(obj: unknown): asserts obj is Serialized<T> {}

new CommitDetailsApp();
