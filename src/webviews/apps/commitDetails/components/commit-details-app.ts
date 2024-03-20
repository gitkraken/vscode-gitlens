import { Badge, defineGkElement } from '@gitkraken/shared-web-components';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
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
	FetchCommandType,
	FileActionsCommandType,
	NavigateCommitCommandType,
	OpenFileCommandType,
	OpenFileComparePreviousCommandType,
	OpenFileCompareWorkingCommandType,
	OpenFileOnRemoteCommandType,
	PickCommitCommandType,
	PinCommitCommandType,
	PublishCommandType,
	PullCommandType,
	PushCommandType,
	SearchCommitCommandType,
	StageFileCommandType,
	SwitchCommandType,
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
import type { GlInspectNav } from './gl-inspect-nav';
import type { GlWipDetails } from './gl-wip-details';
import '../../shared/components/code-icon';
import './gl-commit-details';
import './gl-wip-details';
import './gl-inspect-nav';
import './gl-status-nav';

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

			DOM.on<GlInspectNav, { action: string; alt: boolean }>('gl-inspect-nav', 'gl-commit-actions', e =>
				this.onCommitActions(e),
			),
			DOM.on<GlInspectNav, { action: string; alt: boolean }>('gl-status-nav', 'gl-branch-action', e =>
				this.onBranchAction(e.detail.action),
			),
			DOM.on('[data-action="pick-commit"]', 'click', e => this.onPickCommit(e)),
			DOM.on('[data-action="wip"]', 'click', e => this.onSwitchMode(e, 'wip')),
			DOM.on('[data-action="details"]', 'click', e => this.onSwitchMode(e, 'commit')),
			DOM.on('[data-action="search-commit"]', 'click', e => this.onSearchCommit(e)),
			DOM.on('[data-action="autolink-settings"]', 'click', e => this.onAutolinkSettings(e)),
			DOM.on('[data-action="files-layout"]', 'click', e => this.onToggleFilesLayout(e)),
			DOM.on<GlInspectNav, undefined>('gl-inspect-nav', 'gl-pin', () => this.onTogglePin()),
			DOM.on<GlInspectNav, undefined>('gl-inspect-nav', 'gl-back', () => this.onNavigate('back')),
			DOM.on<GlInspectNav, undefined>('gl-inspect-nav', 'gl-forward', () => this.onNavigate('forward')),
			DOM.on('[data-action="create-patch"]', 'click', _e => this.onCreatePatchFromWip(true)),
			DOM.on<WebviewPane, WebviewPaneExpandedChangeEventDetail>(
				'[data-region="rich-pane"]',
				'expanded-change',
				e => this.onExpandedChange(e.detail),
			),
			DOM.on('[data-action="explain-commit"]', 'click', e => this.onExplainCommit(e)),
			DOM.on('[data-action="switch-ai"]', 'click', e => this.onSwitchAiModel(e)),
			DOM.on<GlWipDetails, { checked: boolean | 'staged' }>('gl-wip-details', 'create-patch', e =>
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
			DOM.on<GlWipDetails, FileChangeListItemDetail>('gl-wip-details', 'file-stage', e =>
				this.onStageFile(e.detail),
			),
			DOM.on<GlWipDetails, FileChangeListItemDetail>('gl-wip-details', 'file-unstage', e =>
				this.onUnstageFile(e.detail),
			),
			DOM.on<GlWipDetails, { name: string }>('gl-wip-details', 'data-action', e =>
				this.onBranchAction(e.detail.name),
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

	renderTopInspect() {
		if (this.state?.commit == null) return nothing;

		return html`<gl-inspect-nav
			?uncommitted=${this.isUncommitted}
			?pinned=${this.state?.pinned}
			.navigation=${this.state?.navigationStack}
			.shortSha=${this.state?.commit.shortSha ?? ''}
			.stashNumber=${this.state?.commit.stashNumber}
		></gl-inspect-nav>`;
	}

	renderTopWip() {
		if (this.state?.wip == null) return nothing;

		return html`<gl-status-nav .wip=${this.state.wip} .preferences=${this.state.preferences}></gl-status-nav>`;
	}

	renderTopSection() {
		const followTooltip = this.isStash ? 'Stash' : 'Commit';

		const isWip = this.state?.mode === 'wip';

		const wip = this.state?.wip;
		const wipTooltip = wip?.changes?.files.length
			? ` - ${pluralize('change', wip.changes.files.length)} on ${
					wip.repositoryCount > 1
						? `${wip.changes.repository.name}:${wip.changes.branchName}`
						: wip.changes.branchName
			  }`
			: '';

		return html`
			<div class="inspect-header">
				<nav class="inspect-header__tabs">
					<button
						class="inspect-header__tab${!isWip ? ' is-active' : ''}"
						data-action="details"
						title="${followTooltip}"
					>
						<code-icon icon="gl-inspect"></code-icon>
					</button>
					<button
						class="inspect-header__tab${isWip ? ' is-active' : ''}"
						data-action="wip"
						title="Repo Status${wipTooltip}"
					>
						<code-icon icon="gl-repository-filled"></code-icon>
					</button>
				</nav>
				<div class="inspect-header__content">
					${when(
						this.state?.mode !== 'wip',
						() => this.renderTopInspect(),
						() => this.renderTopWip(),
					)}
				</div>
			</div>
		`;
	}

	override render() {
		const wip = this.state?.wip;

		return html`
			<div class="commit-detail-panel scrollable">
				${this.renderTopSection()}
				<main id="main" tabindex="-1">
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

	private onBranchAction(name: string) {
		switch (name) {
			case 'pull':
				this._hostIpc.sendCommand(PullCommandType, undefined);
				break;
			case 'push':
				this._hostIpc.sendCommand(PushCommandType, undefined);
				// this.onCommandClickedCore('gitlens.pushRepositories');
				break;
			case 'fetch':
				this._hostIpc.sendCommand(FetchCommandType, undefined);
				// this.onCommandClickedCore('gitlens.fetchRepositories');
				break;
			case 'publish-branch':
				this._hostIpc.sendCommand(PublishCommandType, undefined);
				// this.onCommandClickedCore('gitlens.publishRepository');
				break;
			case 'switch':
				this._hostIpc.sendCommand(SwitchCommandType, undefined);
				// this.onCommandClickedCore('gitlens.views.switchToBranch');
				break;
		}
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

	private onNavigate(direction: 'back' | 'forward') {
		this._hostIpc.sendCommand(NavigateCommitCommandType, { direction: direction });
	}

	private onTogglePin() {
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

	private onCommitActions(e: CustomEvent<{ action: string; alt: boolean }>) {
		if (this.state?.commit === undefined) {
			return;
		}

		this._hostIpc.sendCommand(CommitActionsCommandType, {
			action: e.detail.action as CommitActionsParams['action'],
			alt: e.detail.alt,
		});
	}
}
