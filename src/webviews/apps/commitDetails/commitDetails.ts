/*global*/
import { ViewFilesLayout } from '../../../config';
import type { Serialized } from '../../../system/serialize';
import type { CommitActionsParams, State } from '../../commitDetails/protocol';
import {
	AutolinkSettingsCommandType,
	CommitActionsCommandType,
	DidChangeNotificationType,
	DidExplainCommitCommandType,
	ExplainCommitCommandType,
	FileActionsCommandType,
	NavigateCommitCommandType,
	OpenFileCommandType,
	OpenFileComparePreviousCommandType,
	OpenFileCompareWorkingCommandType,
	OpenFileOnRemoteCommandType,
	PickCommitCommandType,
	PinCommitCommandType,
	PreferencesCommandType,
	SearchCommitCommandType,
} from '../../commitDetails/protocol';
import type { IpcMessage } from '../../protocol';
import { ExecuteCommandType, onIpc } from '../../protocol';
import { App } from '../shared/appBase';
import type { FileChangeListItem, FileChangeListItemDetail } from '../shared/components/list/file-change-list-item';
import type { WebviewPane, WebviewPaneExpandedChangeEventDetail } from '../shared/components/webview-pane';
import { DOM } from '../shared/dom';
import type { GlCommitDetailsApp } from './components/commit-details-app';
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

export type CommitState = SomeNonNullable<Serialized<State>, 'selected'>;
export class CommitDetailsApp extends App<Serialized<State>> {
	constructor() {
		super('CommitDetailsApp');
	}

	override onInitialize() {
		this.attachState();
	}

	override onBind() {
		const disposables = [
			DOM.on<FileChangeListItem, FileChangeListItemDetail>('file-change-list-item', 'file-open-on-remote', e =>
				this.onOpenFileOnRemote(e.detail),
			),
			DOM.on<FileChangeListItem, FileChangeListItemDetail>('file-change-list-item', 'file-open', e =>
				this.onOpenFile(e.detail),
			),
			DOM.on<FileChangeListItem, FileChangeListItemDetail>('file-change-list-item', 'file-compare-working', e =>
				this.onCompareFileWithWorking(e.detail),
			),
			DOM.on<FileChangeListItem, FileChangeListItemDetail>('file-change-list-item', 'file-compare-previous', e =>
				this.onCompareFileWithPrevious(e.detail),
			),
			DOM.on<FileChangeListItem, FileChangeListItemDetail>('file-change-list-item', 'file-more-actions', e =>
				this.onFileMoreActions(e.detail),
			),
			DOM.on('[data-action="commit-actions"]', 'click', e => this.onCommitActions(e)),
			DOM.on('[data-action="pick-commit"]', 'click', e => this.onPickCommit(e)),
			DOM.on('[data-action="search-commit"]', 'click', e => this.onSearchCommit(e)),
			DOM.on('[data-action="autolink-settings"]', 'click', e => this.onAutolinkSettings(e)),
			DOM.on('[data-switch-value]', 'click', e => this.onToggleFilesLayout(e)),
			DOM.on('[data-action="pin"]', 'click', e => this.onTogglePin(e)),
			DOM.on('[data-action="back"]', 'click', e => this.onNavigate('back', e)),
			DOM.on('[data-action="forward"]', 'click', e => this.onNavigate('forward', e)),
			DOM.on<WebviewPane, WebviewPaneExpandedChangeEventDetail>(
				'[data-region="rich-pane"]',
				'expanded-change',
				e => this.onExpandedChange(e.detail),
			),
			DOM.on('[data-action="explain-commit"]', 'click', e => this.onExplainCommit(e)),
			DOM.on('[data-action="switch-ai"]', 'click', e => this.onSwitchAiModel(e)),
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

			default:
				super.onMessageReceived?.(e);
		}
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
			const result = await this.sendCommandWithCompletion(
				ExplainCommitCommandType,
				undefined,
				DidExplainCommitCommandType,
			);

			if (result.error) {
				this.component.explain = { error: { message: result.error.message ?? 'Error retrieving content' } };
			} else if (result.summary) {
				this.component.explain = { summary: result.summary };
			} else {
				this.component.explain = undefined;
				this.component.explainBusy = false;
			}
		} catch (ex) {
			this.component.explain = { error: { message: 'Error retrieving content' } };
		}
	}

	private onToggleFilesLayout(e: MouseEvent) {
		const layout = ((e.target as HTMLElement)?.dataset.switchList as ViewFilesLayout) ?? undefined;
		if (layout === this.state.preferences?.files?.layout) return;

		const files = {
			...this.state.preferences?.files,
			layout: layout ?? ViewFilesLayout.Auto,
			compact: this.state.preferences?.files?.compact ?? true,
			threshold: this.state.preferences?.files?.threshold ?? 5,
			icon: this.state.preferences?.files?.icon ?? 'type',
		};

		this.state.preferences = {
			...this.state.preferences,
			files: files,
		};

		this.attachState();

		this.sendCommand(PreferencesCommandType, { files: files });
	}

	private onExpandedChange(e: WebviewPaneExpandedChangeEventDetail) {
		this.state.preferences = {
			...this.state.preferences,
			autolinksExpanded: e.expanded,
		};

		this.sendCommand(PreferencesCommandType, { autolinksExpanded: e.expanded });
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

	private onSearchCommit(_e: MouseEvent) {
		this.sendCommand(SearchCommitCommandType, undefined);
	}

	private onPickCommit(_e: MouseEvent) {
		this.sendCommand(PickCommitCommandType, undefined);
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

	private onCommitActions(e: MouseEvent) {
		e.preventDefault();
		if (this.state.selected === undefined) {
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
