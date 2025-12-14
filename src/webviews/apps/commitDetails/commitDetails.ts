import { html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { ViewFilesLayout } from '../../../config';
import type { GlCommands } from '../../../constants.commands';
import type { GitCommitReachability } from '../../../git/gitProvider';
import type { IpcSerialized } from '../../../system/ipcSerialize';
import { pluralize } from '../../../system/string';
import type { DraftState, ExecuteCommitActionsParams, Mode, State } from '../../commitDetails/protocol';
import {
	ChangeReviewModeCommand,
	CreatePatchFromWipCommand,
	ExecuteCommitActionCommand,
	ExecuteFileActionCommand,
	ExplainRequest,
	FetchCommand,
	GenerateRequest,
	NavigateCommand,
	OpenFileCommand,
	OpenFileComparePreviousCommand,
	OpenFileCompareWorkingCommand,
	OpenFileOnRemoteCommand,
	OpenPullRequestChangesCommand,
	OpenPullRequestComparisonCommand,
	OpenPullRequestDetailsCommand,
	OpenPullRequestOnRemoteCommand,
	PickCommitCommand,
	PinCommand,
	PublishCommand,
	PullCommand,
	PushCommand,
	ReachabilityRequest,
	SearchCommitCommand,
	ShowCodeSuggestionCommand,
	StageFileCommand,
	SuggestChangesCommand,
	SwitchCommand,
	UnstageFileCommand,
} from '../../commitDetails/protocol';
import { ExecuteCommand } from '../../protocol';
import type { CreatePatchMetadataEventDetail } from '../plus/patchDetails/components/gl-patch-create';
import { GlAppHost } from '../shared/appHost';
import type { IssuePullRequest } from '../shared/components/rich/issue-pull-request';
import type { WebviewPane, WebviewPaneExpandedChangeEventDetail } from '../shared/components/webview-pane';
import type { LoggerContext } from '../shared/contexts/logger';
import { DOM } from '../shared/dom';
import type { HostIpc } from '../shared/ipc';
import type { GlCommitDetails } from './components/gl-commit-details';
import type { FileChangeListItemDetail } from './components/gl-details-base';
import type { GlInspectNav } from './components/gl-inspect-nav';
import type { CreatePatchEventDetail, GenerateState } from './components/gl-inspect-patch';
import type { GlWipDetails } from './components/gl-wip-details';
import { CommitDetailsStateProvider } from './stateProvider';
import './commitDetails.scss';
import '../shared/components/code-icon';
import '../shared/components/indicators/indicator';
import '../shared/components/overlays/tooltip';
import '../shared/components/pills/tracking';
import './components/gl-commit-details';
import './components/gl-wip-details';
import './components/gl-inspect-nav';
import './components/gl-status-nav';

export const uncommittedSha = '0000000000000000000000000000000000000000';

interface ExplainState {
	cancelled?: boolean;
	error?: { message: string };
	result?: { summary: string; body: string };
}

@customElement('gl-commit-details-app')
export class GlCommitDetailsApp extends GlAppHost<IpcSerialized<State>> {
	protected override createRenderRoot(): HTMLElement {
		return this;
	}

	protected override createStateProvider(
		bootstrap: string,
		ipc: HostIpc,
		logger: LoggerContext,
	): CommitDetailsStateProvider {
		return new CommitDetailsStateProvider(this, bootstrap, ipc, logger);
	}

	@state()
	private explain?: ExplainState;

	@state()
	private generate?: GenerateState;

	@state()
	private draftState: DraftState = { inReview: false };

	@state()
	private reachability?: GitCommitReachability;

	@state()
	private reachabilityState: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';

	@state()
	private get isUncommitted(): boolean {
		return this.state?.commit?.sha === uncommittedSha;
	}

	@state()
	private get isStash(): boolean {
		return this.state?.commit?.stashNumber != null;
	}

	private get wipStatus() {
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
			upstream: branch.upstream?.name,
			ahead: ahead,
			behind: behind,
			working: wip.changes?.files.length ?? 0,
			status: status,
		};
	}

	override connectedCallback(): void {
		super.connectedCallback?.();

		this.disposables.push(
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
			DOM.on('[data-action="files-layout"]', 'click', e => this.onToggleFilesLayout(e)),
			DOM.on<GlInspectNav, undefined>('gl-inspect-nav', 'gl-pin', () => this.onTogglePin()),
			DOM.on<GlInspectNav, undefined>('gl-inspect-nav', 'gl-back', () => this.onNavigate('back')),
			DOM.on<GlInspectNav, undefined>('gl-inspect-nav', 'gl-forward', () => this.onNavigate('forward')),
			DOM.on('[data-action="create-patch"]', 'click', _e => this.onCreatePatchFromWip(true)),
			DOM.on<WebviewPane, WebviewPaneExpandedChangeEventDetail>(
				'[data-region="pullrequest-pane"]',
				'expanded-change',
				e => this.onExpandedChange(e.detail, 'pullrequest'),
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
			DOM.on<GlWipDetails, CreatePatchMetadataEventDetail>('gl-wip-details', 'gl-patch-generate-title', e =>
				this.onCreateGenerateTitle(e.detail),
			),
			DOM.on<GlWipDetails, { id: string }>('gl-wip-details', 'gl-show-code-suggestion', e =>
				this.onShowCodeSuggestion(e.detail),
			),
			DOM.on<GlWipDetails, any>('gl-wip-details', 'gl-patch-file-compare-previous', e =>
				this.onCompareFileWithPrevious(e.detail),
			),
			DOM.on<GlWipDetails, FileChangeListItemDetail>('gl-wip-details', 'gl-patch-file-open', e =>
				this.onOpenFile(e.detail),
			),
			DOM.on<GlWipDetails, FileChangeListItemDetail>('gl-wip-details', 'gl-patch-file-stage', e =>
				this.onStageFile(e.detail),
			),
			DOM.on<GlWipDetails, FileChangeListItemDetail>('gl-wip-details', 'gl-patch-file-unstage', e =>
				this.onUnstageFile(e.detail),
			),
			DOM.on<GlWipDetails, undefined>('gl-wip-details', 'gl-patch-create-cancelled', () =>
				this.onDraftStateChanged(false),
			),
			DOM.on<IssuePullRequest, undefined>(
				'gl-status-nav,issue-pull-request',
				'gl-issue-pull-request-details',
				() => this.onBranchAction('open-pr-details'),
			),
		);
	}

	override updated(changedProperties: Map<string | number | symbol, unknown>): void {
		if (changedProperties.has('state')) {
			this.updateDocumentProperties();
			if (this.state?.inReview != null && this.state.inReview !== this.draftState.inReview) {
				this.draftState.inReview = this.state.inReview;
			}
		}
	}

	private indentPreference = 16;
	private updateDocumentProperties() {
		const preference = this.state?.preferences?.indent;
		if (preference === this.indentPreference) return;
		this.indentPreference = preference ?? 16;

		const rootStyle = document.documentElement.style;
		rootStyle.setProperty('--gitlens-tree-indent', `${this.indentPreference}px`);
	}

	private onSuggestChanges(e: CreatePatchEventDetail) {
		this._ipc.sendCommand(SuggestChangesCommand, e);
	}

	private onShowCodeSuggestion(e: { id: string }) {
		this._ipc.sendCommand(ShowCodeSuggestionCommand, e);
	}

	private renderTopInspect() {
		if (this.state?.commit == null) return nothing;

		return html`<gl-inspect-nav
			?uncommitted=${this.isUncommitted}
			?pinned=${this.state?.pinned}
			.navigation=${this.state?.navigationStack}
			.shortSha=${this.state?.commit.shortSha ?? ''}
			.stashNumber=${this.state?.commit.stashNumber}
		></gl-inspect-nav>`;
	}

	private renderTopWip() {
		if (this.state?.wip == null) return nothing;

		return html`<gl-status-nav .wip=${this.state.wip} .preferences=${this.state.preferences}></gl-status-nav>`;
	}

	private renderRepoStatusContent(_isWip: boolean) {
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
		`;
		// ${when(
		// 	isWip !== true && statusIndicator != null,
		// 	() => html`<gl-indicator pulse class="inspect-header__tab-pulse"></gl-indicator>`,
		// )}
	}

	private renderWipTooltipContent() {
		if (this.wipStatus == null) return 'Overview';

		return html`
			Overview of &nbsp;<code-icon icon="git-branch" size="12"></code-icon
			><span class="md-code">${this.wipStatus.branch}</span>
			${when(
				this.wipStatus.status === 'both',
				() =>
					html`<hr />
						<span class="md-code">${this.wipStatus!.branch}</span> is
						${pluralize('commit', this.wipStatus!.behind)} behind and
						${pluralize('commit', this.wipStatus!.ahead)} ahead of
						<span class="md-code">${this.wipStatus!.upstream ?? 'origin'}</span>`,
			)}
			${when(
				this.wipStatus.status === 'behind',
				() =>
					html`<hr />
						<span class="md-code">${this.wipStatus!.branch}</span> is
						${pluralize('commit', this.wipStatus!.behind)} behind
						<span class="md-code">${this.wipStatus!.upstream ?? 'origin'}</span>`,
			)}
			${when(
				this.wipStatus.status === 'ahead',
				() =>
					html`<hr />
						<span class="md-code">${this.wipStatus!.branch}</span> is
						${pluralize('commit', this.wipStatus!.ahead)} ahead of
						<span class="md-code"> ${this.wipStatus!.upstream ?? 'origin'}</span>`,
			)}
			${when(
				this.wipStatus.working > 0,
				() =>
					html`<hr />
						${pluralize('working change', this.wipStatus!.working)}`,
			)}
		`;
	}

	private renderTopSection() {
		const isWip = this.state?.mode === 'wip';

		return html`
			<div class="inspect-header">
				<nav class="inspect-header__tabs">
					<gl-tooltip hoist>
						<button class="inspect-header__tab${!isWip ? ' is-active' : ''}" data-action="details">
							<code-icon icon="gl-inspect"></code-icon>
						</button>
						<span slot="content"
							>${this.state?.commit != null
								? !this.isStash
									? html`Inspect Commit
											<span class="md-code"
												><code-icon icon="git-commit"></code-icon> ${this.state.commit
													.shortSha}</span
											>`
									: html`Inspect Stash
											<span class="md-code"
												><code-icon icon="gl-stashes-view"></code-icon> #${this.state.commit
													.stashNumber}</span
											>`
								: 'Inspect'}${this.state?.pinned
								? html`(pinned)
										<hr />
										Automatic following is suspended while pinned`
								: ''}</span
						>
					</gl-tooltip>
					<gl-tooltip hoist>
						<button class="inspect-header__tab${isWip ? ' is-active' : ''}" data-action="wip">
							${this.renderRepoStatusContent(isWip)}
						</button>
						<span slot="content">${this.renderWipTooltipContent()}</span>
					</gl-tooltip>
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

	override render(): unknown {
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
								.searchContext=${this.state?.searchContext}
								.reachability=${this.reachability}
								.reachabilityState=${this.reachabilityState}
								@load-reachability=${() => this.onLoadReachability()}
								@refresh-reachability=${() => this.onRefreshReachability()}
							></gl-commit-details>`,
						() =>
							html`<gl-wip-details
								.experimentalComposerEnabled=${this.state?.experimentalComposerEnabled}
								.wip=${wip}
								.files=${wip?.changes?.files}
								.preferences=${this.state?.preferences}
								.orgSettings=${this.state?.orgSettings}
								.generate=${this.generate}
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

	private onDraftStateChanged(inReview: boolean, silent = false) {
		if (inReview === this.draftState.inReview) return;
		this.draftState = { ...this.draftState, inReview: inReview };
		this.requestUpdate('draftState');

		if (!silent) {
			this._ipc.sendCommand(ChangeReviewModeCommand, { inReview: inReview });
		}
	}

	private onBranchAction(name: string) {
		switch (name) {
			case 'pull':
				this._ipc.sendCommand(PullCommand, undefined);
				break;
			case 'push':
				this._ipc.sendCommand(PushCommand, undefined);
				// this.onCommandClickedCore('gitlens.pushRepositories');
				break;
			case 'fetch':
				this._ipc.sendCommand(FetchCommand, undefined);
				// this.onCommandClickedCore('gitlens.fetchRepositories');
				break;
			case 'publish-branch':
				this._ipc.sendCommand(PublishCommand, undefined);
				// this.onCommandClickedCore('gitlens.publishRepository');
				break;
			case 'switch':
				this._ipc.sendCommand(SwitchCommand, undefined);
				// this.onCommandClickedCore('gitlens.views.switchToBranch');
				break;
			case 'open-pr-changes':
				this._ipc.sendCommand(OpenPullRequestChangesCommand, undefined);
				break;
			case 'open-pr-compare':
				this._ipc.sendCommand(OpenPullRequestComparisonCommand, undefined);
				break;
			case 'open-pr-remote':
				this._ipc.sendCommand(OpenPullRequestOnRemoteCommand, undefined);
				break;
			case 'open-pr-details':
				this._ipc.sendCommand(OpenPullRequestDetailsCommand, undefined);
				break;
		}
	}

	private onCreatePatchFromWip(checked: boolean | 'staged' = true) {
		if (this.state?.wip?.changes == null) return;
		this._ipc.sendCommand(CreatePatchFromWipCommand, { changes: this.state.wip.changes, checked: checked });
	}

	private onCommandClickedCore(action?: GlCommands | `command:${GlCommands}`) {
		const command = (action?.startsWith('command:') ? action.slice(8) : action) as GlCommands | undefined;
		if (command == null) return;

		this._ipc.sendCommand(ExecuteCommand, { command: command });
	}

	private onSwitchAiModel(_e: MouseEvent) {
		this.onCommandClickedCore('gitlens.ai.switchProvider');
	}

	private async onExplainCommit(_e: MouseEvent) {
		try {
			const result = await this._ipc.sendRequest(ExplainRequest, undefined);
			if (result.error) {
				this.explain = { error: { message: result.error.message ?? 'Error retrieving content' } };
			} else {
				this.explain = result;
			}
		} catch (_ex) {
			this.explain = { error: { message: 'Error retrieving content' } };
		}
	}

	private async onLoadReachability() {
		if (this.reachabilityState === 'loading' || this.state?.commit == null) return;

		this.reachabilityState = 'loading';

		try {
			const result = await this._ipc.sendRequest(ReachabilityRequest, undefined);

			if (result.error) {
				this.reachabilityState = 'error';
				this.reachability = undefined;
			} else {
				this.reachabilityState = 'loaded';
				this.reachability = { refs: result.refs };
			}
		} catch {
			this.reachabilityState = 'error';
			this.reachability = undefined;
		}
	}

	private onRefreshReachability() {
		this.reachabilityState = 'idle';
		this.reachability = undefined;
		void this.onLoadReachability();
	}

	private async onCreateGenerateTitle(_e: CreatePatchMetadataEventDetail) {
		try {
			const result = await this._ipc.sendRequest(GenerateRequest, undefined);

			if (result.error) {
				this.generate = { error: { message: result.error.message ?? 'Error retrieving content' } };
			} else if (result.title || result.description) {
				this.generate = {
					title: result.title,
					description: result.description,
				};
				// this.state = {
				// 	...this.state,
				// 	create: {
				// 		...this.state.create!,
				// 		title: result.title ?? this.state.create?.title,
				// 		description: result.description ?? this.state.create?.description,
				// 	},
				// };
				// this.setState(this.state);
			} else {
				this.generate = undefined;
			}
		} catch (_ex) {
			this.generate = { error: { message: 'Error retrieving content' } };
		}
		this.requestUpdate('generate');
	}

	private onToggleFilesLayout(e: MouseEvent) {
		const layout = ((e.target as HTMLElement)?.dataset.filesLayout as ViewFilesLayout) ?? undefined;
		if (layout === this.state?.preferences?.files?.layout) return;

		const files = {
			...this.state.preferences?.files,
			layout: layout ?? 'auto',
		};
		(this._stateProvider as CommitDetailsStateProvider).updatePreferences({ files: files });
	}

	private onExpandedChange(e: WebviewPaneExpandedChangeEventDetail, pane: string) {
		let preferenceChange;
		if (pane === 'pullrequest') {
			preferenceChange = { pullRequestExpanded: e.expanded };
		}
		if (preferenceChange == null) return;

		(this._stateProvider as CommitDetailsStateProvider).updatePreferences(preferenceChange);
	}

	private onNavigate(direction: 'back' | 'forward') {
		this._ipc.sendCommand(NavigateCommand, { direction: direction });
	}

	private onTogglePin() {
		this._ipc.sendCommand(PinCommand, { pin: !this.state.pinned });
	}

	private onPickCommit(_e: MouseEvent) {
		this._ipc.sendCommand(PickCommitCommand, undefined);
	}

	private onSearchCommit(_e: MouseEvent) {
		this._ipc.sendCommand(SearchCommitCommand, undefined);
	}

	private onSwitchMode(_e: MouseEvent, mode: Mode) {
		(this._stateProvider as CommitDetailsStateProvider).switchMode(mode);
	}

	private onOpenFileOnRemote(e: FileChangeListItemDetail) {
		this._ipc.sendCommand(OpenFileOnRemoteCommand, e);
	}

	private onOpenFile(e: FileChangeListItemDetail) {
		this._ipc.sendCommand(OpenFileCommand, e);
	}

	private onCompareFileWithWorking(e: FileChangeListItemDetail) {
		this._ipc.sendCommand(OpenFileCompareWorkingCommand, e);
	}

	private onCompareFileWithPrevious(e: FileChangeListItemDetail) {
		this._ipc.sendCommand(OpenFileComparePreviousCommand, e);
	}

	private onFileMoreActions(e: FileChangeListItemDetail) {
		this._ipc.sendCommand(ExecuteFileActionCommand, e);
	}

	private onStageFile(e: FileChangeListItemDetail): void {
		this._ipc.sendCommand(StageFileCommand, e);
	}

	private onUnstageFile(e: FileChangeListItemDetail): void {
		this._ipc.sendCommand(UnstageFileCommand, e);
	}

	private onCommitActions(e: CustomEvent<{ action: string; alt: boolean }>) {
		if (this.state?.commit === undefined) return;

		this._ipc.sendCommand(ExecuteCommitActionCommand, {
			action: e.detail.action as ExecuteCommitActionsParams['action'],
			alt: e.detail.alt,
		});
	}
}
