import './commitDetails.scss';
import type { Remote } from '@eamodio/supertalk';
import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import type { StashApplyCommandArgs } from '../../../commands/stashApply.js';
import type { ViewFilesLayout } from '../../../config.js';
import type { InspectWebviewTelemetryContext } from '../../../constants.telemetry.js';
import type { CommitDetailsServices } from '../../commitDetails/commitDetailsService.js';
import type { ExecuteCommitActionsParams } from '../../commitDetails/protocol.js';
import type { CopyCommitPatchEventDetail, OpenMultipleChangesArgs } from '../shared/actions/file.js';
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
import { setupSubscriptions } from './events.js';
import type { CommitDetailsState, ExplainState } from './state.js';
import { createCommitDetailsState } from './state.js';
import '../shared/components/gl-error-banner.js';
import './components/gl-details-commit-panel.js';

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
 * - Resources for async data lifecycle (commit, reachability, explain)
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
		// Unsubscribe RPC event callbacks (before RPC connection is disposed)
		this._unsubscribeEvents?.();
		this._unsubscribeEvents = undefined;

		// Stop auto-persistence
		this._stopAutoPersist?.();
		this._stopAutoPersist = undefined;

		// Dispose all resources
		this._resources?.commit.dispose();
		this._resources?.reachability.dispose();
		this._resources?.explain.dispose();
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
		/* oxlint-disable typescript/await-thenable */
		const [orgSettingsSignal, hasAccountSignal] = await Promise.all([
			subscription.orgSettingsState,
			subscription.hasAccountState,
		]);
		/* oxlint-enable typescript/await-thenable */

		// Connect remote signal bridges — single .get() instead of double .get().get()
		s.orgSettings.connect(orgSettingsSignal);
		s.hasAccount.connect(hasAccountSignal);

		// Create resources — fetchers read current state signals via closure
		const resources: CommitDetailsResources = {
			commit: createResource((signal, repoPath: string, sha: string) => inspect.getCommit(repoPath, sha, signal)),
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
			{ inspect: inspect, repositories: repositories, config: config, integrations: integrations, ai: ai },
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
	 * child components (gl-details-commit-panel) in light DOM.
	 * Custom events from named child elements use template @event bindings instead.
	 */
	private setupDomListeners(): void {
		const actions = this._actions;
		if (actions == null) return;

		const s = this._state;

		// Cancel pending RPC requests on hide (responses would be silently dropped
		// by VS Code); refresh the current commit on visibility restore
		const onVisibilityChange = (): void => {
			if (document.visibilityState !== 'visible') {
				actions.cancelPendingRequests();
				return;
			}

			if (s.loading.get()) return;

			void actions.refetchCurrentCommit();
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		this.disposables.push({ dispose: () => document.removeEventListener('visibilitychange', onVisibilityChange) });

		this.disposables.push(
			DOM.on('[data-action="pick-commit"]', 'click', () => actions.pickCommit()),
			DOM.on('[data-action="search-commit"]', 'click', () => actions.searchCommit()),
			DOM.on('[data-action="files-layout"]', 'click', e => this.onToggleFilesLayout(e)),
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
		const commit = s.currentCommit.get();
		const context: InspectWebviewTelemetryContext = {
			'context.autolinks': s.autolinks.get()?.length ?? 0,
			'context.type': commit?.stashNumber != null ? 'stash' : commit != null ? 'commit' : undefined,
			'context.uncommitted': s.isUncommitted.get(),
		};

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

	override render(): unknown {
		const actions = this._actions;
		const s = this._state;
		const resources = this._resources;
		const commit = s.currentCommit.get();
		const prefs = s.preferences.get();
		const org = s.orgSettings.get();
		const explain = resources?.explain.value.get();
		const reach = resources?.reachability.value.get();
		const reachStatus = resources?.reachability.status.get() ?? 'idle';
		const reachState = mapReachabilityStatus(reachStatus);
		const searchCtx = s.searchContext.get();

		return html`
			<div class="commit-detail-panel scrollable">
				<gl-error-banner .error=${s.error}></gl-error-banner>
				<main id="main" tabindex="-1">
					<gl-details-commit-panel
						variant="embedded"
						file-icons
						?multi-selectable=${true}
						.panelActions=${commit != null}
						?show-pin=${commit != null}
						?pinned=${s.pinned.get()}
						?show-graph-action=${commit != null}
						.navigation=${s.navigationStack.get()}
						.commit=${commit}
						.loading=${resources?.commit.loading.get() ?? false}
						.files=${commit?.files}
						.preferences=${prefs}
						.showSearchBox=${prefs?.showSearchBox ?? true}
						.searchBoxFilter=${prefs?.searchBoxFilter ?? true}
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
						.branchName=${commit?.stashOnRef}
						.aiEnabled=${org?.ai !== false}
						.aiModel=${s.aiModel.get()}
						@switch-model=${() => actions?.executeCommand('gitlens.ai.switchProvider')}
						@gl-pin=${() => actions?.togglePin()}
						@gl-nav-back=${() => actions?.navigateBack()}
						@gl-nav-forward=${() => actions?.navigateForward()}
						@gl-commit-actions=${(e: CustomEvent<{ action: string; alt: boolean }>) =>
							this.onCommitActions(e)}
						@toggle-mode=${(e: CustomEvent<{ mode: 'review' | 'compose' | 'compare' }>) =>
							actions?.openCommitInGraphMode(e.detail.mode, commit)}
						@gl-stash-apply=${(e: CustomEvent<StashApplyCommandArgs>) =>
							actions?.executeCommand('gitlens.stashesApply', e.detail)}
						@explain-commit=${(e: CustomEvent<{ prompt?: string }>) =>
							void actions?.explainCommit(e.detail?.prompt)}
						@load-reachability=${() => void actions?.loadReachability()}
						@refresh-reachability=${() => actions?.refreshReachability()}
						@open-on-remote=${(e: CustomEvent<{ sha: string }>) =>
							actions?.openOnRemote(commit?.repoPath, e.detail.sha)}
						@refresh-commit=${() => void actions?.refetchCurrentCommit()}
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
						@copy-commit-patch=${(e: CustomEvent<CopyCommitPatchEventDetail>) =>
							actions?.copyCommitPatchToClipboard(e.detail.repoPath, e.detail.to, e.detail.from)}
						@gl-issue-pull-request-details=${() => actions?.openPullRequestDetails()}
						@gl-show-search-box-change=${(e: CustomEvent<boolean>) =>
							actions?.updateShowSearchBox(e.detail)}
						@gl-search-box-filter-change=${(e: CustomEvent<boolean>) =>
							actions?.updateSearchBoxFilter(e.detail)}
					></gl-details-commit-panel>
				</main>
			</div>
		`;
	}

	// ============================================================
	// Event handlers
	// ============================================================

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
