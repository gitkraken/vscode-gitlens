import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { GitDiffFileStats } from '@gitlens/git/models/diff.js';
import '../../../shared/components/commit/commit-stats.js';
import '../../../shared/components/markdown/markdown.js';
import { graphStateContext } from '../context.js';
import type { GraphStateProvider } from '../stateProvider.js';
import { sidebarActionsContext } from './sidebarContext.js';
import type { SidebarActions } from './sidebarState.js';
import type { WorktreeTooltipStatsInput } from './worktreeTooltip.utils.js';
import { getWorktreeTooltipStatsState, shouldRequestWorktreeWipStats } from './worktreeTooltip.utils.js';

/** Every request settles first, so skimming a long worktree list never spawns a `git status` per row passed
 *  over. Applied unconditionally on purpose: `gl-tree-view` keeps the popover open across rows and rebuilds
 *  this element whenever an interleaved row's tooltip isn't a `gl-worktree-tooltip` (bare worktrees, and any
 *  worktree whose cheap probe failed), so "is this a fresh element" says nothing about how fast the pointer
 *  is moving. 150ms is imperceptible next to the 500ms hover delay already spent. */
const requestSettleMs = 150;

/**
 * Hover tooltip for worktree rows in the graph sidebar.
 *
 * The `+N ~M -K` breakdown is NOT shipped with the panel data — it costs a full `git status`, and paying
 * that eagerly for every dirty worktree is what this component exists to avoid. The row's pill is driven by
 * the cheap clean/dirty probe; the breakdown is requested when this tooltip opens.
 *
 * Deliberately dumb: it owns no IPC and no cache. `gl-tree-view` destroys the tooltip on every close — and
 * on the suspend/resume its own sub-controls trigger — so anything cached here would survive only a
 * continuous row→row hover. The fetch and the results live on `SidebarActions`, and this reads them live
 * from a signal, because the tree-view snapshots the tooltip template at hover time and never re-reads it
 * (see `gl-agent-tooltip` for the same constraint).
 */
@customElement('gl-worktree-tooltip')
export class GlWorktreeTooltip extends SignalWatcher(LitElement) {
	static override styles = css`
		/* No font-size/line-height: the body is the same markdown the row rendered inline before, so it has
		   to keep inheriting gl-tree-view's .hover-content typography. Declaring them here would win over
		   that inherited value and size worktree tooltips differently from every other row's. */
		:host {
			display: block;
			max-width: 48rem;
		}

		/* gl-tree-view sizes tooltip codicons to the text via .hover-content gl-markdown, a descendant rule
		   that cannot cross into this shadow root — so mirror it here, or mid-sentence icons revert to the
		   16px default and tower over the words. */
		gl-markdown {
			--code-icon-size: 1.3rem;
		}

		.stats {
			margin-top: var(--gl-space-4);
		}

		.muted {
			color: var(--vscode-descriptionForeground);
		}
	`;

	@consume({ context: sidebarActionsContext, subscribe: true })
	private _actions!: SidebarActions;

	@consume({ context: graphStateContext, subscribe: true })
	private _graphState!: GraphStateProvider;

	/** The row's existing markdown body (identity, folder, branch) — rendered above the stats line. */
	@property()
	markdown = '';

	/** Filesystem path of the worktree; the key both the request and the result map use. */
	@property()
	path?: string;

	/** Clean/dirty from the cheap probe. `undefined` = unknown (bare worktree, or probe failed). */
	@property({ type: Boolean })
	hasChanges?: boolean;

	/** The row's WIP row id, used only to recognize the primary worktree (see `render`). */
	@property()
	wipSha?: string;

	private _settleTimer?: ReturnType<typeof setTimeout>;
	/** The `path` this element has already asked for. A failed fetch is not retried within one open — the
	 *  tooltip is destroyed on close, so the next open is a fresh element and asks again. */
	private _requestedKey?: string;
	/** Whether this element's own attempt for `_requestedKey` has finished, however it finished. `@state`
	 *  so settling repaints: that repaint is what replaces the spinner with the terminal line. */
	@state()
	private _attemptSettled = false;

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this.cancelSettle();
	}

	private cancelSettle(): void {
		if (this._settleTimer != null) {
			clearTimeout(this._settleTimer);
			this._settleTimer = undefined;
		}
	}

	override updated(): void {
		// Keyed on what the request is FOR, not on which property Lit saw change. The render decides
		// `loading` from live state, so anything that makes this row requestable — a row swap, or
		// `hasChanges`/config flipping on a reused element — must be able to issue the request, or the
		// tooltip spins for a fetch that was never made. The key is what stops the results arriving from
		// re-triggering the request that produced them.
		const key = this.shouldRequest() ? this.path : undefined;
		if (key == null) {
			this.cancelSettle();
			// Becoming requestable later counts as a new request, not a repeat of the one never made.
			this._requestedKey = undefined;
			return;
		}

		if (key === this._requestedKey) return;

		this._requestedKey = key;
		this._attemptSettled = false;
		this.cancelSettle();
		this._settleTimer = setTimeout(() => {
			this._settleTimer = undefined;
			this.request();
		}, requestSettleMs);
	}

	private get statsInput(): WorktreeTooltipStatsInput {
		return {
			path: this.path,
			hasChanges: this.hasChanges,
			primary: this.isPrimary(),
			enabled: this._graphState?.config?.showWorktreeWipStats,
		};
	}

	private shouldRequest(): boolean {
		return this._actions != null && shouldRequestWorktreeWipStats(this.statsInput);
	}

	private request(): void {
		const path = this.path;
		if (path == null) return;

		void this._actions.requestWorktreeWipStats(path).finally(() => {
			// Only the attempt this element is waiting on may end its spinner — a late settle from a row
			// hovered earlier must not resolve the current row's.
			if (this._requestedKey !== path) return;

			this._attemptSettled = true;
		});
	}

	private isPrimary(): boolean {
		return this.wipSha != null && this.wipSha === this._graphState?.primaryWipRowId;
	}

	/** The primary worktree is served by the working-tree push channel rather than an on-demand read, so
	 *  read its breakdown from graph state. Absent on a cold load — treated as terminal, never "loading". */
	private getPrimaryStats(): GitDiffFileStats | null {
		const stats = this.wipSha != null ? this._graphState?.wipStateById?.[this.wipSha]?.workDirStats : undefined;
		if (stats == null) return null;

		return { added: stats.added, changed: stats.modified, deleted: stats.deleted };
	}

	override render(): unknown {
		return html`<gl-markdown density="compact" .markdown=${this.markdown}></gl-markdown>
			<div class="stats">${this.renderStats()}</div>`;
	}

	private renderStats(): unknown {
		const stats = this.isPrimary()
			? this.getPrimaryStats()
			: this.path != null
				? this._actions?.worktreeWipStats.get().get(this.path)
				: undefined;

		// Pending from the moment this element decides to ask — including the settle window before the
		// request goes out — until its own attempt settles. Both halves are load-bearing: without the first
		// a row that never asks (setting off, primary) would spin, and without the second a row whose ask
		// already failed would.
		const resolved = getWorktreeTooltipStatsState({
			...this.statsInput,
			stats: stats,
			inFlight: this.shouldRequest() && !this._attemptSettled,
		});
		switch (resolved.state) {
			case 'stats':
				return html`<commit-stats
					added=${resolved.stats.added || nothing}
					modified=${resolved.stats.changed || nothing}
					removed=${resolved.stats.deleted || nothing}
					symbol="icons"
					appearance="pill"
					no-tooltip
				></commit-stats>`;
			case 'loading':
				return html`<span class="muted">Loading changes…</span>`;
			case 'dirty':
				return html`<span class="muted">Has Uncommitted Changes</span>`;
			case 'clean':
				return html`<span class="muted">No Uncommitted Changes</span>`;
			// Unknown clean/dirty (bare worktree, or the probe failed) — say nothing rather than assert a state.
			case 'unknown':
				return nothing;
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-worktree-tooltip': GlWorktreeTooltip;
	}
}
