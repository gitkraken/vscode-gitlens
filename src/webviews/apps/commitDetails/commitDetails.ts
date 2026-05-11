import './commitDetails.scss';
import type { Remote } from '@eamodio/supertalk';
import { html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { StashApplyCommandArgs } from '../../../commands/stashApply.js';
import type { ViewFilesLayout } from '../../../config.js';
import type { InspectWebviewTelemetryContext } from '../../../constants.telemetry.js';
import type { CommitDetailsServices } from '../../commitDetails/commitDetailsService.js';
import type { ExecuteCommitActionsParams } from '../../commitDetails/protocol.js';
import type { OpenMultipleChangesArgs } from '../shared/actions/file.js';
import { SignalWatcherWebviewApp } from '../shared/appBase.js';
import type { WebviewPane, WebviewPaneExpandedChangeEventDetail } from '../shared/components/webview-pane.js';
import { DOM } from '../shared/dom.js';
import { getHost } from '../shared/host/context.js';
import { RpcController } from '../shared/rpc/rpcController.js';
import type { ResourceStatus } from '../shared/state/resource.js';
import { createResource } from '../shared/state/resource.js';
import type { CommitDetailsActions, CommitDetailsResources } from './actions.js';
import { createActions } from './actions.js';
import type { FileChangeListItemDetail } from './components/gl-details-base.js';
import type { CreatePatchEventDetail } from './components/gl-inspect-patch.js';
import { setupSubscriptions } from './events.js';
import type { CommitDetailsState, ExplainState, GenerateState } from './state.js';
import { createCommitDetailsState } from './state.js';
import '../shared/components/code-icon.js';
import '../shared/components/gl-error-banner.js';
import '../shared/components/indicators/indicator.js';
import '../shared/components/overlays/tooltip.js';
import '../shared/components/pills/tracking.js';
import './components/gl-details-commit-panel.js';
import './components/gl-details-wip-panel.js';
import './components/gl-inspect-nav.js';
import './components/gl-status-nav.js';

export const uncommittedSha = '0000000000000000000000000000000000000000';

/**
 * Commit Details App - signal-based state management with RPC.
 *
 * This component uses:
 * - SignalWatcher to automatically re-render when signals change
 * - RpcController for RPC lifecycle management
 * - Instance-owned state created via createCommitDetailsState()
 * - HostContext for portable persistence and RPC endpoint creation
 * - RemoteSignalBridge for host-pushed signals (orgSettings, hasAccount)
 * - Resources for async data lifecycle (commit, wip, reachability, explain, generate)
 */
@customElement('gl-commit-details-app')
export class GlCommitDetailsApp extends SignalWatcherWebviewApp {
	protected override createRenderRoot(): HTMLElement {
		return this;
	}

	@property({ type: String, noAccessor: true })
	private context!: string;

	// ── Host abstraction ──
	private _host = getHost();

	/**
	 * Instance-owned state — created here with persistence support, passed to actions/events.
	 */
	private _state: CommitDetailsState = createCommitDetailsState(this._host.storage);

	/**
	 * RPC controller — manages connection lifecycle via Lit's ReactiveController pattern.
	 */
	private _rpc = new RpcController<CommitDetailsServices>(this, {
		rpcOptions: { endpoint: () => this._host.createEndpoint() },
		onReady: services => this._onRpcReady(services),
		onError: error => this._state.error.set(error.message),
	});

	/**
	 * Actions instance for handling user interactions.
	 */
	private _actions?: CommitDetailsActions;

	/**
	 * Resources for async data lifecycle — created in _onRpcReady.
	 */
	private _resources?: CommitDetailsResources;

	/**
	 * Unsubscribe function for event subscriptions.
	 */
	private _unsubscribeEvents?: () => void;

	/**
	 * Stop auto-persistence — returned by startAutoPersist().
	 */
	private _stopAutoPersist?: () => void;

	override connectedCallback(): void {
		super.connectedCallback?.();

		const context = this.context;
		this.context = undefined!;
		this.initWebviewContext(context);
	}

	override disconnectedCallback(): void {
		// Stop watching WIP repo FS changes
		this._actions?.unwatchWip();

		// Unsubscribe RPC event callbacks (before RPC connection is disposed)
		this._unsubscribeEvents?.();
		this._unsubscribeEvents = undefined;

		// Stop auto-persistence
		this._stopAutoPersist?.();
		this._stopAutoPersist = undefined;

		// Dispose all resources
		this._resources?.commit.dispose();
		this._resources?.wip.dispose();
		this._resources?.reachability.dispose();
		this._resources?.explain.dispose();
		this._resources?.generate.dispose();
		this._resources = undefined;

		// Disconnect remote signal bridges
		this._state.orgSettings.disconnect();
		this._state.hasAccount.disconnect();

		// Clear actions reference
		this._actions = undefined;

		// Reset state
		this._state.resetAll();

		// GlWebviewApp: cleans up focus tracker, disposes ipc/promos/telemetry/DOM listeners
		// Lit framework: calls RpcController.hostDisconnected() → disposes RPC connection
		super.disconnectedCallback?.();
	}

	/**
	 * Called by RpcController when RPC connection is established.
	 * Resolves all sub-services once (resolve-once pattern), creates resources,
	 * then passes them to actions and subscriptions for direct method calls.
	 */
	private async _onRpcReady(services: Remote<CommitDetailsServices>): Promise<void> {
		const s = this._state;

		// Resolve all sub-services in parallel (one await per sub-service)
		const [
			inspect,
			repository,
			repositories,
			commands,
			config,
			storage,
			ai,
			autolinks,
			subscription,
			integrations,
			files,
			pullRequests,
			drafts,
			telemetry,
		] = await Promise.all([
			services.inspect,
			services.repository,
			services.repositories,
			services.commands,
			services.config,
			services.storage,
			services.ai,
			services.autolinks,
			services.subscription,
			services.integrations,
			services.files,
			services.pullRequests,
			services.drafts,
			services.telemetry,
		]);

		// Supertalk remote proxy properties are thenable at runtime (ProxyProperty with .then()),
		// but Remote<T> types them as synchronous values. The lint rule correctly detects the
		// thenable; the disable is required — this is how Supertalk property access works.
		/* eslint-disable @typescript-eslint/await-thenable */
		const [orgSettingsSignal, hasAccountSignal] = await Promise.all([
			subscription.orgSettingsState,
			subscription.hasAccountState,
		]);
		/* eslint-enable @typescript-eslint/await-thenable */

		// Connect remote signal bridges — single .get() instead of double .get().get()
		s.orgSettings.connect(orgSettingsSignal);
		s.hasAccount.connect(hasAccountSignal);

		// Create resources — fetchers read current state signals via closure
		const resources: CommitDetailsResources = {
			commit: createResource((signal, repoPath: string, sha: string) => inspect.getCommit(repoPath, sha, signal)),
			wip: createResource((signal, repoPath: string | undefined) => inspect.getWipChanges(repoPath, signal)),
			reachability: createResource<GitCommitReachability | undefined>(async _signal => {
				const commit = s.currentCommit.get();
				if (commit == null) return undefined;
				return repository.getCommitReachability(commit.repoPath, commit.sha, _signal);
			}),
			explain: createResource<ExplainState | undefined, [string | undefined]>(async (signal, prompt) => {
				const commit = s.currentCommit.get();
				if (commit == null) return undefined;
				try {
					const result = await inspect.explainCommit(commit.repoPath, commit.sha, prompt, signal);
					if (result.error) {
						return { error: { message: result.error.message ?? 'Error retrieving content' } };
					}
					return { result: result.result };
				} catch (_ex) {
					return { error: { message: 'Error retrieving content' } };
				}
			}),
			generate: createResource<GenerateState | undefined>(async signal => {
				const repoPath = s.wipState.get()?.repo?.path ?? s.currentCommit.get()?.repoPath;
				if (repoPath == null) return undefined;
				try {
					const result = await inspect.generateDescription(repoPath, signal);
					if (result.error) {
						return { error: { message: result.error.message ?? 'Error retrieving content' } };
					}
					if (result.title || result.description) {
						return { title: result.title, description: result.description };
					}
					return undefined;
				} catch (_ex) {
					return { error: { message: 'Error retrieving content' } };
				}
			}),
		};
		this._resources = resources;

		const resolvedServices = {
			inspect: inspect,
			drafts: drafts,
			repositories: repositories,
			repository: repository,
			commands: commands,
			config: config,
			storage: storage,
			ai: ai,
			autolinks: autolinks,
			subscription: subscription,
			integrations: integrations,
			files: files,
			pullRequests: pullRequests,
			telemetry: telemetry,
		};

		// Create actions instance with resolved sub-services and resources
		this._actions = createActions(s, resolvedServices, resources);

		// Start auto-persistence before any state changes from host
		this._stopAutoPersist = s.startAutoPersist();

		// Set up DOM event listeners (needs actions to be initialized)
		this.setupDomListeners();

		// Set up event subscriptions FIRST (so we don't miss events during fetch)
		this._unsubscribeEvents = await setupSubscriptions(
			s,
			{ inspect: inspect, repositories: repositories, config: config, integrations: integrations },
			this._actions,
		);

		// Fetch initial state via individual parallel calls (replaces legacy getState())
		await this._actions.fetchInitialState();

		// Update document properties based on initial state
		this.updateDocumentProperties();
	}

	/**
	 * Set up DOM event listeners for data-action buttons inside child templates.
	 * These use document-level delegation because the buttons are rendered by
	 * child components (gl-details-commit-panel, gl-details-wip-panel) in light DOM.
	 * Custom events from named child elements use template @event bindings instead.
	 */
	private setupDomListeners(): void {
		const actions = this._actions;
		if (actions == null) return;

		const s = this._state;

		// Cancel pending RPC requests on hide (responses would be silently dropped
		// by VS Code); refresh WIP data on visibility restore
		const onVisibilityChange = (): void => {
			if (document.visibilityState !== 'visible') {
				actions.cancelPendingRequests();
				return;
			}

			if (s.loading.get()) return;

			if (s.mode.get() === 'wip') {
				const repoPath = s.wipState.get()?.repo?.path;
				if (repoPath != null) {
					void actions.fetchWipState(repoPath);
				}
				return;
			}

			void actions.refetchCurrentCommit();
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		this.disposables.push({ dispose: () => document.removeEventListener('visibilitychange', onVisibilityChange) });

		this.disposables.push(
			DOM.on('[data-action="pick-commit"]', 'click', () => actions.pickCommit()),
			DOM.on('[data-action="wip"]', 'click', () => actions.switchMode('wip')),
			DOM.on('[data-action="details"]', 'click', () => actions.switchMode('commit')),
			DOM.on('[data-action="search-commit"]', 'click', () => actions.searchCommit()),
			DOM.on('[data-action="files-layout"]', 'click', e => this.onToggleFilesLayout(e)),
			DOM.on('[data-action="create-patch"]', 'click', () => this.onCreatePatchFromWip(true)),
			DOM.on<WebviewPane, WebviewPaneExpandedChangeEventDetail>(
				'[data-region="pullrequest-pane"]',
				'expanded-change',
				e => this.onExpandedChange(e.detail, 'pullrequest'),
			),
			DOM.on('[data-action="switch-ai"]', 'click', () => actions.executeCommand('gitlens.ai.switchProvider')),
		);
	}

	override updated(_changedProperties: Map<PropertyKey, unknown>): void {
		this.updateDocumentProperties();
		this.pushTelemetryContext();
	}

	private _lastTelemetryContextStr = '';
	private pushTelemetryContext(): void {
		const actions = this._actions;
		if (actions == null) return;

		const s = this._state;
		const mode = s.mode.get();
		let context: InspectWebviewTelemetryContext;

		if (mode === 'wip') {
			context = {
				'context.autolinks': 0,
				'context.codeSuggestions': s.codeSuggestions.get()?.length ?? 0,
			};
		} else {
			const commit = s.currentCommit.get();
			context = {
				'context.autolinks': s.autolinks.get()?.length ?? 0,
				'context.type': commit?.stashNumber != null ? 'stash' : commit != null ? 'commit' : undefined,
				'context.uncommitted': s.isUncommitted.get(),
			};
		}

		const str = JSON.stringify(context);
		if (str !== this._lastTelemetryContextStr) {
			this._lastTelemetryContextStr = str;
			actions.updateTelemetryContext(context);
		}
	}

	private indentPreference = 16;
	private updateDocumentProperties(): void {
		const prefs = this._state.preferences.get();
		const preference = prefs?.indent;
		if (preference === this.indentPreference) return;
		this.indentPreference = preference ?? 16;

		const rootStyle = document.documentElement.style;
		rootStyle.setProperty('--gitlens-tree-indent', `${this.indentPreference}px`);
	}

	// ============================================================
	// Render methods
	// ============================================================

	private renderTopInspect() {
		const actions = this._actions;
		const s = this._state;
		const commit = s.currentCommit.get();
		if (commit == null) return nothing;

		const nav = s.navigationStack.get();
		const isPinned = s.pinned.get();

		return html`<gl-inspect-nav
			?uncommitted=${s.isUncommitted.get()}
			?pinned=${isPinned}
			.navigation=${nav}
			.shortSha=${commit.shortSha ?? ''}
			.stashNumber=${commit.stashNumber}
			@gl-commit-actions=${(e: CustomEvent<{ action: string; alt: boolean }>) => this.onCommitActions(e)}
			@gl-pin=${() => actions?.togglePin()}
			@gl-back=${() => actions?.navigateBack()}
			@gl-forward=${() => actions?.navigateForward()}
		></gl-inspect-nav>`;
	}

	private renderTopWip() {
		const actions = this._actions;
		const s = this._state;
		const wip = s.wipState.get();
		const prefs = s.preferences.get();
		if (wip == null) return nothing;

		return html`<gl-status-nav
			.wip=${wip}
			.pullRequest=${s.pullRequest.get()}
			.preferences=${prefs}
			@gl-branch-action=${(e: CustomEvent<{ action: string }>) => this.onBranchAction(e.detail.action)}
			@gl-issue-pull-request-details=${() => actions?.openPullRequestDetails()}
		></gl-status-nav>`;
	}

	private renderRepoStatusContent(_isWip: boolean) {
		const wipStatus = this._state.wipStatus.get();
		const statusIndicator = wipStatus?.status;
		return html`
			<code-icon icon="gl-repository-filled"></code-icon>
			${when(
				wipStatus?.status != null,
				() =>
					html`<gl-tracking-pill
						class="inspect-header__tab-tracking"
						.ahead=${wipStatus!.ahead}
						.behind=${wipStatus!.behind}
						.working=${wipStatus!.working}
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
	}

	private renderWipTooltipContent() {
		const wipStatus = this._state.wipStatus.get();
		if (wipStatus == null) return 'Overview';

		return html`
			Overview of &nbsp;<code-icon icon="git-branch" size="12"></code-icon
			><span class="md-code">${wipStatus.branch}</span>
			${when(
				wipStatus.status === 'both',
				() =>
					html`<hr />
						<span class="md-code">${wipStatus.branch}</span> is ${pluralize('commit', wipStatus.behind)}
						behind and ${pluralize('commit', wipStatus.ahead)} ahead of
						<span class="md-code">${wipStatus.upstream ?? 'origin'}</span>`,
			)}
			${when(
				wipStatus.status === 'behind',
				() =>
					html`<hr />
						<span class="md-code">${wipStatus.branch}</span> is ${pluralize('commit', wipStatus.behind)}
						behind <span class="md-code">${wipStatus.upstream ?? 'origin'}</span>`,
			)}
			${when(
				wipStatus.status === 'ahead',
				() =>
					html`<hr />
						<span class="md-code">${wipStatus.branch}</span> is ${pluralize('commit', wipStatus.ahead)}
						ahead of <span class="md-code"> ${wipStatus.upstream ?? 'origin'}</span>`,
			)}
			${when(
				wipStatus.working > 0,
				() =>
					html`<hr />
						${pluralize('working change', wipStatus.working)}`,
			)}
		`;
	}

	private renderTopSection() {
		const s = this._state;
		const currentMode = s.mode.get();
		const isWip = currentMode === 'wip';
		const commit = s.currentCommit.get();
		const isPinned = s.pinned.get();

		return html`
			<div class="inspect-header">
				<nav class="inspect-header__tabs">
					<gl-tooltip>
						<button class="inspect-header__tab${!isWip ? ' is-active' : ''}" data-action="details">
							<code-icon icon="gl-inspect"></code-icon>
						</button>
						<span slot="content"
							>${commit != null
								? !s.isStash.get()
									? html`Inspect Commit
											<span class="md-code"
												><code-icon icon="git-commit"></code-icon> ${commit.shortSha}</span
											>`
									: html`Inspect Stash
											<span class="md-code"
												><code-icon icon="gl-stashes-view"></code-icon>
												#${commit.stashNumber}</span
											>`
								: 'Inspect'}${isPinned
								? html`(pinned)
										<hr />
										Automatic following is suspended while pinned`
								: ''}</span
						>
					</gl-tooltip>
					<gl-tooltip>
						<button class="inspect-header__tab${isWip ? ' is-active' : ''}" data-action="wip">
							${this.renderRepoStatusContent(isWip)}
						</button>
						<span slot="content">${this.renderWipTooltipContent()}</span>
					</gl-tooltip>
				</nav>
				<div class="inspect-header__content">
					${when(
						!isWip,
						() => this.renderTopInspect(),
						() => this.renderTopWip(),
					)}
				</div>
			</div>
		`;
	}

	override render(): unknown {
		const actions = this._actions;
		const s = this._state;
		const resources = this._resources;
		const currentMode = s.mode.get();
		const commit = s.currentCommit.get();
		const wip = s.wipState.get();
		const prefs = s.preferences.get();
		const org = s.orgSettings.get();
		const explain = resources?.explain.value.get();
		const generate = resources?.generate.value.get();
		const reach = resources?.reachability.value.get();
		const reachStatus = resources?.reachability.status.get() ?? 'idle';
		const reachState = mapReachabilityStatus(reachStatus);
		const searchCtx = s.searchContext.get();
		const draft = s.draftState.get();
		const experimentalComposer = s.capabilities.experimentalComposerEnabled;

		return html`
			<div class="commit-detail-panel scrollable">
				<gl-error-banner .error=${s.error}></gl-error-banner>
				${this.renderTopSection()}
				<main id="main" tabindex="-1">
					${when(
						currentMode === 'commit',
						() =>
							html`<gl-details-commit-panel
								variant="embedded"
								file-icons
								?panel-actions=${false}
								.commit=${commit}
								.loading=${resources?.commit.loading.get() ?? false}
								.files=${commit?.files}
								.preferences=${prefs}
								.orgSettings=${org}
								.isUncommitted=${s.isUncommitted.get()}
								.filesCollapsable=${false}
								.autolinksEnabled=${s.capabilities.autolinksEnabled}
								.autolinks=${s.autolinks.get()}
								.formattedMessage=${s.formattedMessage.get()}
								.autolinkedIssues=${s.autolinkedIssues.get()}
								.pullRequest=${s.pullRequest.get()}
								.signature=${s.signature.get()}
								.hasAccount=${s.hasAccount.get()}
								.hasIntegrationsConnected=${s.capabilities.hasIntegrationsConnected}
								.hasRemotes=${s.hasRemotes.get()}
								.explain=${explain}
								.searchContext=${searchCtx}
								.reachability=${reach}
								.reachabilityState=${reachState}
								.branchName=${commit?.stashOnRef ?? this.getCommitBranchName(reach)}
								.aiEnabled=${org?.ai !== false}
								@gl-stash-apply=${(e: CustomEvent<StashApplyCommandArgs>) =>
									actions?.executeCommand('gitlens.stashesApply', e.detail)}
								@explain-commit=${(e: CustomEvent<{ prompt?: string }>) =>
									void actions?.explainCommit(e.detail?.prompt)}
								@load-reachability=${() => void actions?.loadReachability()}
								@refresh-reachability=${() => actions?.refreshReachability()}
								@open-on-remote=${(e: CustomEvent<{ sha: string }>) =>
									actions?.openOnRemote(commit?.repoPath, e.detail.sha)}
								@change-files-layout=${(e: CustomEvent<{ layout: ViewFilesLayout }>) =>
									actions?.changeFilesLayout(e.detail.layout)}
								@file-open-on-remote=${(e: CustomEvent<FileChangeListItemDetail>) =>
									actions?.openFileOnRemote(e.detail)}
								@file-open=${(e: CustomEvent<FileChangeListItemDetail>) =>
									actions?.openFile(e.detail, e.detail.showOptions)}
								@file-compare-working=${(e: CustomEvent<FileChangeListItemDetail>) =>
									actions?.openFileCompareWorking(e.detail, e.detail.showOptions)}
								@file-compare-previous=${(e: CustomEvent<FileChangeListItemDetail>) =>
									actions?.openFileComparePrevious(e.detail, e.detail.showOptions)}
								@file-more-actions=${(e: CustomEvent<FileChangeListItemDetail>) =>
									actions?.executeFileAction(e.detail, e.detail.showOptions)}
								@open-multiple-changes=${(e: CustomEvent<OpenMultipleChangesArgs>) =>
									actions?.openMultipleChanges(e.detail)}
								@gl-issue-pull-request-details=${() => actions?.openPullRequestDetails()}
							></gl-details-commit-panel>`,
						() =>
							html`<gl-details-wip-panel
								.experimentalComposerEnabled=${experimentalComposer}
								.wip=${wip}
								.pullRequest=${s.pullRequest.get()}
								.codeSuggestions=${s.codeSuggestions.get()}
								.files=${wip?.changes?.files}
								.preferences=${prefs}
								.orgSettings=${org}
								.generate=${generate}
								.isUncommitted=${true}
								.emptyText=${'No working changes'}
								.draftState=${draft}
								@draft-state-changed=${(e: CustomEvent<{ inReview: boolean }>) =>
									actions?.changeReviewMode(e.detail.inReview)}
								@create-patch=${(e: CustomEvent<{ checked: boolean | 'staged' }>) =>
									this.onCreatePatchFromWip(e.detail.checked)}
								@file-open=${(e: CustomEvent<FileChangeListItemDetail>) =>
									actions?.openFile(e.detail, e.detail.showOptions)}
								@file-compare-previous=${(e: CustomEvent<FileChangeListItemDetail>) =>
									actions?.openFileComparePrevious(e.detail, e.detail.showOptions)}
								@file-stage=${(e: CustomEvent<FileChangeListItemDetail>) =>
									actions?.stageFile(e.detail)}
								@file-unstage=${(e: CustomEvent<FileChangeListItemDetail>) =>
									actions?.unstageFile(e.detail)}
								@file-discard=${(e: CustomEvent<FileChangeListItemDetail>) =>
									actions?.discardFile(e.detail)}
								@discard-unstaged=${() => actions?.discardUnstagedFiles()}
								@data-action=${(e: CustomEvent<{ name: string }>) => this.onBranchAction(e.detail.name)}
								@gl-inspect-create-suggestions=${(e: CustomEvent<CreatePatchEventDetail>) =>
									actions?.suggestChanges(e.detail)}
								@gl-patch-generate-title=${() => void actions?.generateDescription()}
								@gl-show-code-suggestion=${(e: CustomEvent<{ id: string }>) => {
									const draft = s.codeSuggestions.get()?.find(d => d.id === e.detail.id);
									if (draft) {
										actions?.showCodeSuggestion(draft);
									}
								}}
								@gl-patch-file-compare-previous=${(e: CustomEvent<FileChangeListItemDetail>) =>
									actions?.openFileComparePrevious(e.detail, e.detail.showOptions)}
								@gl-patch-file-open=${(e: CustomEvent<FileChangeListItemDetail>) =>
									actions?.openFile(e.detail, e.detail.showOptions)}
								@gl-patch-file-stage=${(e: CustomEvent<FileChangeListItemDetail>) =>
									actions?.stageFile(e.detail)}
								@gl-patch-file-unstage=${(e: CustomEvent<FileChangeListItemDetail>) =>
									actions?.unstageFile(e.detail)}
								@gl-patch-create-cancelled=${() => actions?.changeReviewMode(false)}
								@open-multiple-changes=${(e: CustomEvent<OpenMultipleChangesArgs>) =>
									actions?.openMultipleChanges(e.detail)}
							></gl-details-wip-panel>`,
					)}
				</main>
			</div>
		`;
	}

	// ============================================================
	// Event handlers
	// ============================================================

	private getCommitBranchName(reachability: GitCommitReachability | undefined): string | undefined {
		if (!reachability?.refs?.length) return undefined;

		const branches = reachability.refs.filter(
			(r): r is Extract<typeof r, { refType: 'branch' }> => r.refType === 'branch',
		);
		const current = branches.find(r => r.current);
		if (current) return current.name;
		if (branches.length > 0) return branches[0].name;
		return undefined;
	}

	private onBranchAction(name: string): void {
		this._actions?.handleBranchAction(name);
	}

	private onCreatePatchFromWip(checked: boolean | 'staged' = true): void {
		const wip = this._state.wipState.get();
		if (wip?.changes == null) return;
		this._actions?.createPatchFromWip(wip.changes, checked);
	}

	private onToggleFilesLayout(e: MouseEvent): void {
		const layout = ((e.target as HTMLElement)?.dataset.filesLayout as ViewFilesLayout) ?? undefined;
		const prefs = this._state.preferences.get();
		if (prefs?.files == null || layout === prefs.files.layout) return;

		const files = {
			...prefs.files,
			layout: layout ?? 'auto',
		};
		this._actions?.updateFilesLayout(files);
	}

	private onExpandedChange(e: WebviewPaneExpandedChangeEventDetail, pane: string): void {
		if (pane === 'pullrequest') {
			this._actions?.updatePullRequestExpanded(e.expanded);
		}
	}

	private onCommitActions(e: CustomEvent<{ action: string; alt: boolean }>): void {
		const commit = this._state.currentCommit.get();
		if (commit == null) return;

		this._actions?.executeCommitAction(e.detail.action as ExecuteCommitActionsParams['action'], e.detail.alt);
	}
}

/** Maps resource status to the component's reachability state. */
function mapReachabilityStatus(status: ResourceStatus): 'idle' | 'loading' | 'loaded' | 'error' {
	return status === 'success' ? 'loaded' : status;
}
