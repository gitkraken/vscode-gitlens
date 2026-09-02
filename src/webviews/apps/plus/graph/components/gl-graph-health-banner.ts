import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { GitHealthBannerState } from '@gitlens/git/gitHealth.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { Unsubscribe } from '../../../../rpc/services/types.js';
import { emitTelemetrySentEvent } from '../../../shared/telemetry.js';
import { graphServicesContext, graphStateContext } from '../context.js';
import { getSelectedRepoPath } from '../utils/repository.utils.js';
import '../../../shared/components/button.js';
import '@gitlens/components/components/codeIcon.js';
import '@gitlens/components/components/overlays/tooltip.js';

/**
 * Evidence-gated banner strip advertising the Repository Health visualization — shown above the graph
 * column when the host has evidence (measured worktree slowness, or repo scale) and the user hasn't
 * dismissed it for this repository or recently visited the health view. Mirrors `gl-graph-git-health`'s
 * host-subscription pattern (subscribe-before-fetch, stale-drop on repo switch) for one lightweight
 * fetch instead of that view's three.
 *
 * Mirrors its fetched state into `graphState.gitHealthBanner` so the sidebar rail's evidence dot
 * (`gl-graph-sidebar`) can read it without its own fetch.
 */
@customElement('gl-graph-health-banner')
export class GlGraphHealthBanner extends SignalWatcher(LitElement) {
	static override styles = css`
		:host {
			display: block;
			flex: none;
		}

		.strip {
			display: flex;
			gap: var(--gl-space-8);
			align-items: center;
			padding: var(--gl-space-4) var(--gl-space-8);
			font-size: var(--gl-font-md);
			background: color-mix(in lab, var(--vscode-editor-background) 100%, var(--vscode-foreground) 8%);
			border-bottom: var(--gl-border-width) solid var(--vscode-editorWidget-border, transparent);
		}

		.strip__heart {
			flex: none;
			color: var(--color-alert-infoBorder);
		}

		.strip__msg {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.strip__msg strong {
			font-weight: 600;
		}

		.strip__evidence {
			color: var(--vscode-descriptionForeground);
		}

		.strip__actions {
			display: flex;
			flex: none;
			gap: var(--gl-space-4);
			align-items: center;
			margin-left: auto;
		}

		.strip__chip {
			display: inline-flex;
			flex: none;
			gap: var(--gl-space-4);
			align-items: center;
			padding: 0 var(--gl-space-8);
			font-size: var(--gl-font-sm);
			font-weight: 600;
			line-height: 1.8rem;
			color: var(--vscode-foreground);
			background: color-mix(in srgb, var(--color-alert-infoBorder) 14%, transparent);
			border: var(--gl-border-width) solid color-mix(in srgb, var(--color-alert-infoBorder) 40%, transparent);
			border-radius: var(--gl-radius-sm);
		}

		.strip__chip code-icon {
			color: var(--color-alert-infoBorder);
		}

		/* Same treatment as the jump toast's action (gl-graph-jump-toast.css.ts) — the graph's banner
   buttons share one look. */
		.strip__cta {
			flex: none;
			padding: 0.2rem 0.5rem;
			font: inherit;
			font-size: var(--gl-font-md);
			color: var(--vscode-textLink-foreground);
			cursor: pointer;
			background: none;
			border: var(--gl-border-width) solid transparent;
			border-radius: var(--gl-radius-sm);
			transition: color var(--gl-duration-medium) ease;
		}

		.strip__cta:hover {
			color: var(--vscode-textLink-activeForeground);
			border-color: var(--vscode-textLink-activeForeground);
		}

		.strip__cta:focus-visible {
			outline: var(--gl-border-width) solid var(--vscode-focusBorder);
			outline-offset: 0;
			border-color: var(--vscode-focusBorder);
		}
	`;

	@consume({ context: graphStateContext, subscribe: false })
	private graphState!: typeof graphStateContext.__context__;

	@consume({ context: graphServicesContext, subscribe: true })
	private services?: typeof graphServicesContext.__context__;

	@state()
	private _state: GitHealthBannerState | undefined;

	/** The repo whose fetched `_state` is actually installed — never the live selection, so a stale
	 *  fetch response can't render (or act) against the wrong repo. */
	@state()
	private _loadedRepoPath: string | undefined;

	/** The repo a fetch is currently in flight for — stale-drop bookkeeping only. */
	private _pendingRepoPath: string | undefined;

	private _unsubscribe: Unsubscribe | undefined;

	/** Repo the "shown" telemetry was last emitted for — one impression per fetch that installs a
	 *  bannered state, not one per render. */
	private _shownFor: string | undefined;

	/** Repo `markHealthViewVisited` was last called for — the host self-guards too, but this keeps a
	 *  render loop from spamming the RPC while the user sits on the health view. */
	private _visitMarkedFor: string | undefined;

	private get repoPath(): string | undefined {
		return getSelectedRepoPath(this.graphState);
	}

	override connectedCallback(): void {
		super.connectedCallback?.();
		void this.subscribe();
	}

	override disconnectedCallback(): void {
		const unsubscribe = this._unsubscribe;
		this._unsubscribe = undefined;
		// `Unsubscribe` may itself be a promise of the real function — resolve before calling it.
		void Promise.resolve(unsubscribe).then(fn => fn?.());
		super.disconnectedCallback?.();
	}

	/**
	 * Subscribes BEFORE the first fetch. Fetching first meant a single rejected read left the banner
	 * with no subscription at all — permanently dead to live updates rather than merely stale.
	 */
	private async subscribe(): Promise<void> {
		let health;
		try {
			health = await this.services?.graphHealth;
		} catch {
			// The RPC surface can reject (channel torn down, service not yet available) — degrade to
			// a hidden banner rather than leaving an unhandled rejection up.
			health = undefined;
		}
		// `_unsubscribe == null` guards re-entry: a disconnect/reconnect while this await is in flight
		// runs a second `subscribe()`, and assigning unconditionally would overwrite — and permanently
		// leak — the first listener.
		if (health != null && this.isConnected && this._unsubscribe == null) {
			this._unsubscribe = health.onHealthChanged(payload => {
				// Unknown/legacy payload (no repoPath) always refreshes; otherwise only when it's about
				// the repo we're showing.
				if (payload == null || payload.repoPath === (this._pendingRepoPath ?? this._loadedRepoPath)) {
					void this.refresh();
				}
			});
		}

		await this.refresh();
	}

	/**
	 * Re-fetches whenever the shown repository changes, and marks the health view visited once the
	 * user is actually looking at it with an armed indicator.
	 */
	protected override willUpdate(): void {
		const repoPath = this.repoPath;
		if (repoPath != null && repoPath !== (this._pendingRepoPath ?? this._loadedRepoPath)) {
			this._visitMarkedFor = undefined;
			void this.refresh();
		}

		if (
			repoPath != null &&
			this._loadedRepoPath === repoPath &&
			this._state?.indicator === true &&
			this.graphState.displayMode === 'visualizations' &&
			this.graphState.visualizationMode === 'health' &&
			this._visitMarkedFor !== repoPath
		) {
			this._visitMarkedFor = repoPath;
			void this.markVisited(repoPath);
		}
	}

	private async markVisited(repoPath: string): Promise<void> {
		try {
			await (await this.services?.graphHealth)?.markHealthViewVisited(repoPath);
		} catch {
			// Best-effort — a failed visit mark just means the indicator/banner may reappear sooner
			// than intended, not a user-visible failure worth surfacing.
		}
	}

	private async refresh(): Promise<void> {
		const repoPath = this.repoPath;
		let health;
		try {
			health = await this.services?.graphHealth;
		} catch {
			health = undefined;
		}
		if (repoPath == null || health == null) return;

		// Claimed up-front so a re-entrant `willUpdate` during the await can't queue a second fetch.
		this._pendingRepoPath = repoPath;
		const state = await health.getBannerState(repoPath);

		// A newer refresh (or a repo switch) during the await makes this response stale — drop it
		// rather than showing repo A's banner under repo B's name.
		if (this._pendingRepoPath !== repoPath) return;

		this._loadedRepoPath = repoPath;
		this._state = state;
		this.graphState.gitHealthBanner = state;

		if (state?.banner === true && this._shownFor !== repoPath) {
			this._shownFor = repoPath;
			emitTelemetrySentEvent(this, {
				name: 'graph/gitHealth/banner/shown',
				data: { reason: state.reason, 'findings.suggested': state.suggestedCount },
			});
		}
	}

	private readonly onOpen = (): void => {
		const state = this._state;
		if (state == null) return;

		emitTelemetrySentEvent(this, {
			name: 'graph/gitHealth/banner/opened',
			data: { reason: state.reason, 'findings.suggested': state.suggestedCount },
		});
		this.dispatchEvent(new CustomEvent('gl-graph-show-git-health', { bubbles: true, composed: true }));
	};

	private readonly onDismiss = (): void => {
		const state = this._state;
		const repoPath = this._loadedRepoPath;
		if (state == null || repoPath == null) return;

		emitTelemetrySentEvent(this, {
			name: 'graph/gitHealth/banner/dismissed',
			data: { reason: state.reason, 'findings.suggested': state.suggestedCount },
		});

		// Optimistic — the host's `onHealthChanged` re-sync will confirm (or correct) this.
		const next: GitHealthBannerState = { ...state, banner: false };
		this._state = next;
		this.graphState.gitHealthBanner = next;

		void this.dismissOnHost(repoPath);
	};

	private async dismissOnHost(repoPath: string): Promise<void> {
		try {
			await (await this.services?.graphHealth)?.dismissBanner(repoPath);
		} catch {
			// The change event re-syncs on success; on failure the optimistic hide simply stands
			// until the next fetch — no user-visible action to retry here.
		}
	}

	private claim(state: GitHealthBannerState): string {
		return state.reason === 'slowness'
			? 'We’ve noticed Git operations have been slow and can be improved'
			: 'We’ve noticed this repository is very large and Git can be tuned for it';
	}

	private evidence(state: GitHealthBannerState): string | undefined {
		if (state.reason === 'slowness') {
			if (state.maxDurationMs == null) return undefined;

			return `up to ${(state.maxDurationMs / 1000).toFixed(1)}s for a single Git operation`;
		}

		if (state.trackedFiles == null) return undefined;

		const prefix = state.trackedFilesExact === false ? '~' : '';
		return `${prefix}${state.trackedFiles.toLocaleString()} tracked files`;
	}

	override render(): unknown {
		const state = this._state;
		if (
			this.graphState.config?.gitHealthAvailable !== true ||
			state?.banner !== true ||
			state.suggestedCount <= 0 ||
			this._loadedRepoPath !== this.repoPath
		) {
			return nothing;
		}

		const evidence = this.evidence(state);

		return html`<div class="strip" role="status">
			<code-icon class="strip__heart" icon="heart"></code-icon>
			<span class="strip__msg">
				<strong>${this.claim(state)}</strong>
				${evidence != null ? html`<span class="strip__evidence">— ${evidence}</span>` : nothing}
			</span>
			<span class="strip__actions">
				<span class="strip__chip">
					<code-icon icon="dashboard"></code-icon>
					${pluralize('optimization', state.suggestedCount)} suggested
				</span>
				<gl-tooltip
					placement="bottom"
					content="Review and apply them in Repository Health — nothing is changed without you"
				>
					<button type="button" class="strip__cta" @click=${this.onOpen}>Show Repository Health</button>
				</gl-tooltip>
				<gl-button
					appearance="toolbar"
					class="strip__dismiss"
					tooltip="Dismiss — won’t show again for this repository"
					aria-label="Dismiss"
					@click=${this.onDismiss}
					><code-icon icon="close"></code-icon
				></gl-button>
			</span>
		</div>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-health-banner': GlGraphHealthBanner;
	}

	interface GlobalEventHandlersEventMap {
		'gl-graph-show-git-health': CustomEvent<void>;
	}
}
