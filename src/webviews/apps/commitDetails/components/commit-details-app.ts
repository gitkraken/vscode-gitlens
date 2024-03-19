import { Badge, defineGkElement } from '@gitkraken/shared-web-components';
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { when } from 'lit/directives/when.js';
import type { ViewFilesLayout } from '../../../../config';
import type { Serialized } from '../../../../system/serialize';
import { pluralize } from '../../../../system/string';
import type { CommitActionsParams, Mode, State } from '../../../commitDetails/protocol';
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
} from '../../../commitDetails/protocol';
import type { IpcMessage } from '../../../protocol';
import { ExecuteCommandType, onIpc } from '../../../protocol';
import type { WebviewPane, WebviewPaneExpandedChangeEventDetail } from '../../shared/components/webview-pane';
import type { Disposable } from '../../shared/dom';
import { DOM } from '../../shared/dom';
import { assertsSerialized, HostIpc } from '../../shared/ipc';
import type { GlCommitDetails } from './gl-commit-details';
import type { FileChangeListItemDetail } from './gl-details-base';
import './gl-commit-details';
import './gl-wip-details';

export const uncommittedSha = '0000000000000000000000000000000000000000';

interface ExplainState {
	cancelled?: boolean;
	error?: { message: string };
	summary?: string;
}

@customElement('gl-commit-details-app')
export class GlCommitDetailsApp extends LitElement {
	@property({ type: Object })
	state?: Serialized<State>;

	@property({ type: Object })
	explain?: ExplainState;

	@state()
	get isUncommitted() {
		return this.state?.commit?.sha === uncommittedSha;
	}

	@state()
	get isStash() {
		return this.state?.commit?.stashNumber != null;
	}

	get navigation() {
		if (this.state?.navigationStack == null) {
			return {
				back: false,
				forward: false,
			};
		}

		const actions = {
			back: true,
			forward: true,
		};

		if (this.state.navigationStack.count <= 1) {
			actions.back = false;
			actions.forward = false;
		} else if (this.state.navigationStack.position === 0) {
			actions.back = true;
			actions.forward = false;
		} else if (this.state.navigationStack.position === this.state.navigationStack.count - 1) {
			actions.back = false;
			actions.forward = true;
		}

		return actions;
	}

	private _disposables: Disposable[] = [];
	private _hostIpc!: HostIpc;

	constructor() {
		super();

		defineGkElement(Badge);
	}

	private indentPreference = 16;
	private updateDocumentProperties() {
		const preference = this.state?.preferences?.indent;
		if (preference === this.indentPreference) return;
		this.indentPreference = preference ?? 16;

		const rootStyle = document.documentElement.style;
		rootStyle.setProperty('--gitlens-tree-indent', `${this.indentPreference}px`);
	}

	override updated(changedProperties: Map<string | number | symbol, unknown>) {
		if (changedProperties.has('state')) {
			this.updateDocumentProperties();
		}
	}

	override connectedCallback() {
		super.connectedCallback();

		this._hostIpc = new HostIpc('commit-details');

		this._disposables = [
			this._hostIpc.onReceiveMessage(e => this.onMessageReceived(e)),
			this._hostIpc,

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
	}

	private onMessageReceived(msg: IpcMessage) {
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
					this.dispatchEvent(new CustomEvent('state-changed', { detail: this.state }));
					// this.setState(this.state);
					// this.attachState();
				});
				break;

			case DidChangeWipStateNotificationType.method:
				onIpc(DidChangeWipStateNotificationType, msg, params => {
					this.state = { ...this.state, ...params } as any;
					this.dispatchEvent(new CustomEvent('state-changed', { detail: this.state }));
					// this.setState(this.state);
					// this.attachState();
				});
				break;
		}
	}

	override disconnectedCallback() {
		this._disposables.forEach(d => d.dispose());
		this._disposables = [];

		super.disconnectedCallback();
	}

	override render() {
		const wip = this.state?.wip;

		return html`
			<div class="commit-detail-panel scrollable">
				<main id="main" tabindex="-1">
					<nav class="details-tab">
						<button
							class="details-tab__item ${this.state?.mode === 'commit' ? ' is-active' : ''}"
							data-action="details"
						>
							${this.isStash ? 'Stash' : 'Commit'}
						</button>
						<button
							class="details-tab__item ${this.state?.mode === 'wip' ? ' is-active' : ''}"
							data-action="wip"
							title="${ifDefined(
								this.state?.mode === 'wip' && wip?.changes?.files.length
									? `${pluralize('change', wip.changes.files.length)} on ${
											wip.repositoryCount > 1
												? `${wip.changes.repository.name}:${wip.changes.branchName}`
												: wip.changes.branchName
									  }`
									: undefined,
							)}"
						>
							Working
							Changes${ifDefined(
								this.state?.mode === 'wip' && wip?.changes?.files.length
									? html` &nbsp;<gk-badge variant="filled">${wip.changes.files.length}</gk-badge>`
									: undefined,
							)}
						</button>
					</nav>
					${when(
						this.state?.mode === 'commit',
						() =>
							html`<gl-commit-details
								.state=${this.state}
								.files=${this.state?.commit?.files}
								.explain=${this.explain}
								.preferences=${this.state?.preferences}
								.orgSettings=${this.state?.orgSettings}
								.isUncommitted=${this.isUncommitted}
							></gl-commit-details>`,
						() =>
							html`<gl-wip-details
								.wip=${wip}
								.files=${wip?.changes?.files}
								.preferences=${this.state?.preferences}
								.orgSettings=${this.state?.orgSettings}
								.isUncommitted=${true}
								.emptyText=${'No working changes'}
							></gl-wip-details>`,
					)}
				</main>
			</div>
		`;
	}

	protected override createRenderRoot() {
		return this;
	}

	private onCreatePatchFromWip(checked: boolean | 'staged' = true) {
		if (this.state?.wip?.changes == null) return;
		this._hostIpc.sendCommand(CreatePatchFromWipCommandType, { changes: this.state.wip.changes, checked: checked });
	}

	private onCommandClickedCore(action?: string) {
		const command = action?.startsWith('command:') ? action.slice(8) : action;
		if (command == null) return;

		this._hostIpc.sendCommand(ExecuteCommandType, { command: command });
	}

	private onSwitchAiModel(_e: MouseEvent) {
		this.onCommandClickedCore('gitlens.switchAIModel');
	}

	async onExplainCommit(_e: MouseEvent) {
		try {
			const result = await this._hostIpc.sendCommandWithCompletion(
				ExplainCommandType,
				undefined,
				DidExplainCommandType,
			);
			if (result.error) {
				this.explain = { error: { message: result.error.message ?? 'Error retrieving content' } };
			} else if (result.summary) {
				this.explain = { summary: result.summary };
			} else {
				this.explain = undefined;
			}
		} catch (ex) {
			this.explain = { error: { message: 'Error retrieving content' } };
		}
	}

	private onToggleFilesLayout(e: MouseEvent) {
		const layout = ((e.target as HTMLElement)?.dataset.filesLayout as ViewFilesLayout) ?? undefined;
		if (layout === this.state?.preferences?.files?.layout) return;

		const files = {
			...this.state!.preferences?.files,
			layout: layout ?? 'auto',
		};

		this.state = { ...this.state, preferences: { ...this.state!.preferences, files: files } } as any;
		// this.attachState();

		this._hostIpc.sendCommand(UpdatePreferencesCommandType, { files: files });
	}

	private onExpandedChange(e: WebviewPaneExpandedChangeEventDetail) {
		this.state = {
			...this.state,
			preferences: { ...this.state!.preferences, autolinksExpanded: e.expanded },
		} as any;
		// this.attachState();

		this._hostIpc.sendCommand(UpdatePreferencesCommandType, { autolinksExpanded: e.expanded });
	}

	private onNavigate(direction: 'back' | 'forward', e: Event) {
		e.preventDefault();
		this._hostIpc.sendCommand(NavigateCommitCommandType, { direction: direction });
	}

	private onTogglePin(e: MouseEvent) {
		e.preventDefault();
		this._hostIpc.sendCommand(PinCommitCommandType, { pin: !this.state!.pinned });
	}

	private onAutolinkSettings(e: MouseEvent) {
		e.preventDefault();
		this._hostIpc.sendCommand(AutolinkSettingsCommandType, undefined);
	}

	private onPickCommit(_e: MouseEvent) {
		this._hostIpc.sendCommand(PickCommitCommandType, undefined);
	}

	private onSearchCommit(_e: MouseEvent) {
		this._hostIpc.sendCommand(SearchCommitCommandType, undefined);
	}

	private onSwitchMode(_e: MouseEvent, mode: Mode) {
		this.state = { ...this.state, mode: mode } as any;
		// this.attachState();

		this._hostIpc.sendCommand(SwitchModeCommandType, { mode: mode, repoPath: this.state!.commit?.repoPath });
	}

	private onOpenFileOnRemote(e: FileChangeListItemDetail) {
		this._hostIpc.sendCommand(OpenFileOnRemoteCommandType, e);
	}

	private onOpenFile(e: FileChangeListItemDetail) {
		this._hostIpc.sendCommand(OpenFileCommandType, e);
	}

	private onCompareFileWithWorking(e: FileChangeListItemDetail) {
		this._hostIpc.sendCommand(OpenFileCompareWorkingCommandType, e);
	}

	private onCompareFileWithPrevious(e: FileChangeListItemDetail) {
		this._hostIpc.sendCommand(OpenFileComparePreviousCommandType, e);
	}

	private onFileMoreActions(e: FileChangeListItemDetail) {
		this._hostIpc.sendCommand(FileActionsCommandType, e);
	}

	private onStageFile(e: FileChangeListItemDetail): void {
		this._hostIpc.sendCommand(StageFileCommandType, e);
	}

	private onUnstageFile(e: FileChangeListItemDetail): void {
		this._hostIpc.sendCommand(UnstageFileCommandType, e);
	}

	private onCommitActions(e: MouseEvent) {
		e.preventDefault();
		if (this.state?.commit === undefined) {
			e.stopPropagation();
			return;
		}

		const action = (e.target as HTMLElement)?.getAttribute('data-action-type');
		if (action == null) return;

		this._hostIpc.sendCommand(CommitActionsCommandType, {
			action: action as CommitActionsParams['action'],
			alt: e.altKey,
		});
	}
}
