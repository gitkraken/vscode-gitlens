import { Badge, defineGkElement } from '@gitkraken/shared-web-components';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { ViewFilesLayout } from '../../../../config';
import type { Serialized } from '../../../../system/serialize';
import { pluralize } from '../../../../system/string';
import type { DraftState, ExecuteCommitActionsParams, Mode, State } from '../../../commitDetails/protocol';
import {
	AutolinkSettingsCommand,
	ChangeReviewModeCommand,
	CreatePatchFromWipCommand,
	DidChangeDraftStateNotification,
	DidChangeNotification,
	DidChangeWipStateNotification,
	ExecuteCommitActionCommand,
	ExecuteFileActionCommand,
	ExplainRequest,
	FetchCommand,
	NavigateCommand,
	OpenFileCommand,
	OpenFileComparePreviousCommand,
	OpenFileCompareWorkingCommand,
	OpenFileOnRemoteCommand,
	OpenPullRequestChangesCommand,
	OpenPullRequestComparisonCommand,
	OpenPullRequestOnRemoteCommand,
	PickCommitCommand,
	PinCommand,
	PublishCommand,
	PullCommand,
	PushCommand,
	SearchCommitCommand,
	ShowCodeSuggestionCommand,
	StageFileCommand,
	SuggestChangesCommand,
	SwitchCommand,
	SwitchModeCommand,
	UnstageFileCommand,
	UpdatePreferencesCommand,
} from '../../../commitDetails/protocol';
import type { IpcMessage } from '../../../protocol';
import { ExecuteCommand } from '../../../protocol';
import type { WebviewPane, WebviewPaneExpandedChangeEventDetail } from '../../shared/components/webview-pane';
import type { Disposable } from '../../shared/dom';
import { DOM } from '../../shared/dom';
import { assertsSerialized, HostIpc } from '../../shared/ipc';
import type { GlCommitDetails } from './gl-commit-details';
import type { FileChangeListItemDetail } from './gl-details-base';
import type { GlInspectNav } from './gl-inspect-nav';
import type { CreatePatchEventDetail } from './gl-inspect-patch';
import type { GlWipDetails } from './gl-wip-details';
import '../../shared/components/code-icon';
import '../../shared/components/indicators/indicator';
import '../../shared/components/pills/tracking';
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
	draftState: DraftState = { inReview: false };

	@state()
	get isUncommitted() {
		return this.state?.commit?.sha === uncommittedSha;
	}

	@state()
	get isStash() {
		return this.state?.commit?.stashNumber != null;
	}

	get wipStatus() {
		const wip = this.state?.wip;
		if (wip == null) return undefined;

		const branch = wip.branch;
		if (branch == null) return undefined;

		const changes = wip.changes;
		const working = changes?.files.length ?? 0;
		const ahead = branch.tracking?.ahead ?? 0;
		const behind = branch.tracking?.behind ?? 0;
		const status =
			behind > 0 && ahead > 0
				? 'both'
				: behind > 0
				  ? 'behind'
				  : ahead > 0
				    ? 'ahead'
				    : working > 0
				      ? 'working'
				      : undefined;

		const branchName = wip.repositoryCount > 1 ? `${wip.repo.name}:${branch.name}` : branch.name;

		return {
			branch: branchName,
			ahead: ahead,
			behind: behind,
			working: wip.changes?.files.length ?? 0,
			status: status,
		};
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
			if (this.state?.inReview != null && this.state.inReview != this.draftState.inReview) {
				this.draftState.inReview = this.state.inReview;
			}
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
			DOM.on<GlWipDetails, CreatePatchEventDetail>('gl-wip-details', 'gl-inspect-create-suggestions', e =>
				this.onSuggestChanges(e.detail),
			),
			DOM.on<GlWipDetails, { id: string }>('gl-wip-details', 'gl-show-code-suggestion', e =>
				this.onShowCodeSuggestion(e.detail),
			),
		];
	}

	private onSuggestChanges(e: CreatePatchEventDetail) {
		this._hostIpc.sendCommand(SuggestChangesCommand, e);
	}

	private onShowCodeSuggestion(e: { id: string }) {
		this._hostIpc.sendCommand(ShowCodeSuggestionCommand, e);
	}

	private onMessageReceived(msg: IpcMessage) {
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
				this.dispatchEvent(new CustomEvent('state-changed', { detail: this.state }));
				// this.setState(this.state);
				// this.attachState();
				break;

			case DidChangeWipStateNotification.is(msg):
				this.state = { ...this.state!, wip: msg.params.wip, inReview: msg.params.inReview };
				this.dispatchEvent(new CustomEvent('state-changed', { detail: this.state }));
				// this.setState(this.state);
				// this.attachState();
				break;
			case DidChangeDraftStateNotification.is(msg):
				this.onDraftStateChanged(msg.params.inReview, true);
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

	private renderRepoStatusContent(isWip: boolean) {
		const statusIndicator = this.wipStatus?.status;
		return html`
			<code-icon icon="gl-repository-filled"></code-icon>
			${when(
				this.wipStatus?.status != null,
				() =>
					html`<gl-tracking-pill
						class="inspect-header__tab-tracking"
						.ahead=${this.wipStatus!.ahead}
						.behind=${this.wipStatus!.behind}
						.working=${this.wipStatus!.working}
						outlined
					></gl-tracking-pill>`,
			)}
			${when(
				statusIndicator != null,
				() =>
					html`<gl-indicator
						class="inspect-header__tab-indicator inspect-header__tab-indicator--${statusIndicator}"
					></gl-indicator>`,
			)}
			${when(
				isWip !== true && statusIndicator != null,
				() => html`<gl-indicator pulse class="inspect-header__tab-pulse"></gl-indicator>`,
			)}
		`;
	}

	renderTopSection() {
		const followTooltip = this.isStash ? 'Stash' : 'Commit';

		const isWip = this.state?.mode === 'wip';

		let wipTooltip = 'Repo Status';
		if (this.wipStatus != null) {
			wipTooltip += ` for ${this.wipStatus.branch}`;
			if (this.wipStatus.working > 0) {
				wipTooltip += `\n - ${pluralize('working change', this.wipStatus.working)}`;
			}

			switch (this.wipStatus.status) {
				case 'both':
					wipTooltip += `\n - Behind ${pluralize('commit', this.wipStatus.behind)} and ahead ${pluralize(
						'commit',
						this.wipStatus.ahead,
					)}`;
					break;
				case 'behind':
					wipTooltip += `\n - Behind ${pluralize('commit', this.wipStatus.behind)}`;
					break;
				case 'ahead':
					wipTooltip += `\n - Ahead ${pluralize('commit', this.wipStatus.ahead)}`;
					break;
			}
		}

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
						title="${wipTooltip}"
					>
						${this.renderRepoStatusContent(isWip)}
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
								.draftState=${this.draftState}
								@draft-state-changed=${(e: CustomEvent<{ inReview: boolean }>) =>
									this.onDraftStateChanged(e.detail.inReview)}
							></gl-wip-details>`,
					)}
				</main>
			</div>
		`;
	}

	protected override createRenderRoot() {
		return this;
	}

	private onDraftStateChanged(inReview: boolean, silent = false) {
		if (inReview === this.draftState.inReview) return;
		this.draftState = { ...this.draftState, inReview: inReview };
		this.requestUpdate('draftState');

		if (!silent) {
			this._hostIpc.sendCommand(ChangeReviewModeCommand, { inReview: inReview });
		}
	}

	private onBranchAction(name: string) {
		switch (name) {
			case 'pull':
				this._hostIpc.sendCommand(PullCommand, undefined);
				break;
			case 'push':
				this._hostIpc.sendCommand(PushCommand, undefined);
				// this.onCommandClickedCore('gitlens.pushRepositories');
				break;
			case 'fetch':
				this._hostIpc.sendCommand(FetchCommand, undefined);
				// this.onCommandClickedCore('gitlens.fetchRepositories');
				break;
			case 'publish-branch':
				this._hostIpc.sendCommand(PublishCommand, undefined);
				// this.onCommandClickedCore('gitlens.publishRepository');
				break;
			case 'switch':
				this._hostIpc.sendCommand(SwitchCommand, undefined);
				// this.onCommandClickedCore('gitlens.views.switchToBranch');
				break;
			case 'open-pr-changes':
				this._hostIpc.sendCommand(OpenPullRequestChangesCommand, undefined);
				break;
			case 'open-pr-compare':
				this._hostIpc.sendCommand(OpenPullRequestComparisonCommand, undefined);
				break;
			case 'open-pr-remote':
				this._hostIpc.sendCommand(OpenPullRequestOnRemoteCommand, undefined);
				break;
		}
	}

	private onCreatePatchFromWip(checked: boolean | 'staged' = true) {
		if (this.state?.wip?.changes == null) return;
		this._hostIpc.sendCommand(CreatePatchFromWipCommand, { changes: this.state.wip.changes, checked: checked });
	}

	private onCommandClickedCore(action?: string) {
		const command = action?.startsWith('command:') ? action.slice(8) : action;
		if (command == null) return;

		this._hostIpc.sendCommand(ExecuteCommand, { command: command });
	}

	private onSwitchAiModel(_e: MouseEvent) {
		this.onCommandClickedCore('gitlens.switchAIModel');
	}

	async onExplainCommit(_e: MouseEvent) {
		try {
			const result = await this._hostIpc.sendRequest(ExplainRequest, undefined);
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

		this._hostIpc.sendCommand(UpdatePreferencesCommand, { files: files });
	}

	private onExpandedChange(e: WebviewPaneExpandedChangeEventDetail) {
		this.state = {
			...this.state,
			preferences: { ...this.state!.preferences, autolinksExpanded: e.expanded },
		} as any;
		// this.attachState();

		this._hostIpc.sendCommand(UpdatePreferencesCommand, { autolinksExpanded: e.expanded });
	}

	private onNavigate(direction: 'back' | 'forward') {
		this._hostIpc.sendCommand(NavigateCommand, { direction: direction });
	}

	private onTogglePin() {
		this._hostIpc.sendCommand(PinCommand, { pin: !this.state!.pinned });
	}

	private onAutolinkSettings(e: MouseEvent) {
		e.preventDefault();
		this._hostIpc.sendCommand(AutolinkSettingsCommand, undefined);
	}

	private onPickCommit(_e: MouseEvent) {
		this._hostIpc.sendCommand(PickCommitCommand, undefined);
	}

	private onSearchCommit(_e: MouseEvent) {
		this._hostIpc.sendCommand(SearchCommitCommand, undefined);
	}

	private onSwitchMode(_e: MouseEvent, mode: Mode) {
		this.state = { ...this.state, mode: mode } as any;
		// this.attachState();

		this._hostIpc.sendCommand(SwitchModeCommand, { mode: mode, repoPath: this.state!.commit?.repoPath });
	}

	private onOpenFileOnRemote(e: FileChangeListItemDetail) {
		this._hostIpc.sendCommand(OpenFileOnRemoteCommand, e);
	}

	private onOpenFile(e: FileChangeListItemDetail) {
		this._hostIpc.sendCommand(OpenFileCommand, e);
	}

	private onCompareFileWithWorking(e: FileChangeListItemDetail) {
		this._hostIpc.sendCommand(OpenFileCompareWorkingCommand, e);
	}

	private onCompareFileWithPrevious(e: FileChangeListItemDetail) {
		this._hostIpc.sendCommand(OpenFileComparePreviousCommand, e);
	}

	private onFileMoreActions(e: FileChangeListItemDetail) {
		this._hostIpc.sendCommand(ExecuteFileActionCommand, e);
	}

	private onStageFile(e: FileChangeListItemDetail): void {
		this._hostIpc.sendCommand(StageFileCommand, e);
	}

	private onUnstageFile(e: FileChangeListItemDetail): void {
		this._hostIpc.sendCommand(UnstageFileCommand, e);
	}

	private onCommitActions(e: CustomEvent<{ action: string; alt: boolean }>) {
		if (this.state?.commit === undefined) {
			return;
		}

		this._hostIpc.sendCommand(ExecuteCommitActionCommand, {
			action: e.detail.action as ExecuteCommitActionsParams['action'],
			alt: e.detail.alt,
		});
	}
}
