import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import type { PropertyValues } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { TelemetryContext } from '../../../shared/contexts/telemetry.js';
import { telemetryContext } from '../../../shared/contexts/telemetry.js';
import { parseFilterTerms } from '../../../shared/utils/filter-match.js';
import type { AppState } from '../context.js';
import { graphStateContext } from '../context.js';
import { sidebarActionsContext } from '../sidebar/sidebarContext.js';
import type { SidebarActions } from '../sidebar/sidebarState.js';
import type { RefFindCandidate, RefFindMatch } from '../utils/refFind.utils.js';
import {
	buildRefFindCandidates,
	elideRefName,
	matchRefs,
	pickInitialTargetIndex,
	refFindPillKey,
	refreshMatchRows,
	stepMatchIndex,
} from '../utils/refFind.utils.js';
import { graphRefFindStyles } from './gl-graph-ref-find.css.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';

export interface GraphRefFindJumpEventDetail {
	sha: string;
	/** Move the keyboard anchor to the row. False while stepping so typing continues uninterrupted. */
	focus: boolean;
	/** Which pill on the landed row answered the query, so the graph can emphasize that one. */
	refKey: string;
}

/**
 * Type-ahead ref finder — the filtered counterpart to `Alt+PgUp`/`Alt+PgDn` ("previous / next ref").
 *
 * TYPE-AHEAD, not a find box and not a picker. The input exists only so you can see and correct what
 * you typed; the graph does the answering, jumping to the best-matching ref on every keystroke the
 * way type-to-select moves the selection in a file tree. Deliberately no match count and no stepper
 * buttons — that chrome reads as the editor's find widget, which is a different interaction (iterate
 * over every hit) from this one (converge on the ref you had in mind).
 *
 * `↓`/`↑` still walk the other matches for the case where a short prefix doesn't rank the ref you
 * wanted first, but they're unadvertised: typing more is the primary way to narrow.
 *
 * Candidates come from the sidebar panels (which carry every ref's tip sha), not from the loaded
 * rows, so refs below the paged window are still findable.
 */
@customElement('gl-graph-ref-find')
export class GlGraphRefFind extends SignalWatcher(LitElement) {
	static override styles = [graphRefFindStyles];

	@consume({ context: graphStateContext, subscribe: true })
	private _graphState!: AppState;

	@consume({ context: sidebarActionsContext, subscribe: true })
	private _sidebarActions?: SidebarActions;

	@consume({ context: telemetryContext as { __context__: TelemetryContext } })
	private _telemetry!: TelemetryContext;

	/** How this session of the finder was opened, for telemetry. Set by the graph when it opens us. */
	@property({ attribute: false })
	openedBy: 'shortcut' | 'button' = 'button';

	@property({ type: Boolean, reflect: true })
	open = false;

	/**
	 * Resolves a sha to its `processedRows` position, or `undefined` when the row isn't paged in.
	 * Injected by the graph, which owns the index.
	 */
	@property({ attribute: false })
	getRowIndex?: (sha: string) => number | undefined;

	/**
	 * Count of paged-in rows. Not read for its value — it's the change signal that tells the widget
	 * rows arrived, since `getRowIndex` is a stable function reference and so never marks it dirty.
	 */
	@property({ type: Number })
	rowsLoaded = 0;

	@query('.find__input')
	private _inputEl?: HTMLInputElement;

	@state() private _query = '';
	@state() private _matches: RefFindMatch[] = [];
	@state() private _index = -1;

	/** Last-seen panel payloads, compared by identity to know when a fetch actually changed something. */
	private _panelData?: unknown[];

	private get activeMatch(): RefFindMatch | undefined {
		return this._index >= 0 ? this._matches[this._index] : undefined;
	}

	/**
	 * Reads through the panel resources every update so `SignalWatcher` subscribes to them — they're
	 * otherwise only touched from event handlers, and a fetch landing after the widget opened would
	 * leave the match set empty until the next keystroke.
	 */
	override willUpdate(): void {
		const panels = this._sidebarActions?.state.panels;
		const next = [panels?.branches.value.get(), panels?.remotes.value.get(), panels?.tags.value.get()];

		const prev = this._panelData;
		if (prev != null && prev.length === next.length && prev.every((v, i) => v === next[i])) return;

		this._panelData = next;
		if (!this.open) return;

		// A panel that was invalidated (reset to null) has to be re-fetched, or the match set stays empty.
		this.ensurePanels();

		// Land the jump only if we never got one — a routine sidebar invalidation shouldn't yank the graph
		// out from under someone reading the row they already jumped to.
		this.recompute({ jump: this.activeMatch == null });
	}

	override updated(changedProperties: PropertyValues): void {
		// Rows paged in: a match that could only offer Load may now be an ordinary jump target, so
		// re-resolve the indexes in place. Keeps the cursor on the SAME ref rather than recomputing
		// from scratch, which would throw away wherever the user had stepped to.
		if (changedProperties.has('rowsLoaded') && this.open && this._matches.length > 0) {
			const activeSha = this.activeMatch?.sha;
			const refreshed = refreshMatchRows(this._matches, sha => this.getRowIndex?.(sha));
			this._matches = refreshed;
			if (activeSha != null) {
				const index = refreshed.findIndex(m => m.sha === activeSha);
				this._index = index === -1 ? this._index : index;
			}
		}

		if (changedProperties.has('open')) {
			if (this.open) {
				this.onOpened();
			} else {
				this.reset();
			}
		}
		super.updated(changedProperties);
	}

	/** Focuses the input and selects any preserved query, so typing replaces the last search. */
	private focusInput(): void {
		const input = this._inputEl;
		if (input == null) return;

		input.focus();
		input.select();
	}

	/**
	 * Fetches any candidate panel that has no data and isn't already loading.
	 *
	 * Runs on every update while open, not just on open: the panels are shared with the sidebar and get
	 * INVALIDATED out from under us (they reset to a null value with `loading` false), which silently
	 * emptied the match set mid-session and left it empty until the widget was reopened.
	 */
	private ensurePanels(): void {
		const actions = this._sidebarActions;
		if (actions == null) return;

		for (const panel of ['branches', 'remotes', 'tags'] as const) {
			const resource = actions.state.panels[panel];
			if (resource.value.get() == null && !resource.loading.get()) {
				actions.fetchPanel(panel);
			}
		}
	}

	private onOpened(): void {
		// Usually a no-op — the sidebar/scope popover share these — but the finder can be first to need them.
		this.ensurePanels();

		// Re-run against whatever the panels now hold; a preserved query should still be live on reopen.
		this.recompute({ jump: false });
		void this.updateComplete.then(() => this.focusInput());
	}

	private reset(): void {
		this._matches = [];
		this._index = -1;
	}

	private buildCandidates(): RefFindCandidate[] {
		const panels = this._sidebarActions?.state.panels;
		const branches = panels?.branches.value.get();
		const remotes = panels?.remotes.value.get();
		const tags = panels?.tags.value.get();

		return buildRefFindCandidates(
			{
				branches: branches?.panel === 'branches' ? branches.items : undefined,
				remotes: remotes?.panel === 'remotes' ? remotes.items : undefined,
				tags: tags?.panel === 'tags' ? tags.items : undefined,
			},
			{
				excludeRefs: this._graphState?.excludeRefs,
				excludeTypes: this._graphState?.excludeTypes,
				includeOnlyRefs: this._graphState?.includeOnlyRefs,
			},
		);
	}

	/** Recomputes the match set for the live query and lands on the best-scoring one. */
	private recompute(options?: { jump?: boolean }): void {
		const matches = matchRefs(this._query, this.buildCandidates(), sha => this.getRowIndex?.(sha));
		this._matches = matches;
		this._index = pickInitialTargetIndex(matches);

		if (options?.jump !== false) {
			this.jumpToActive();
		}
	}

	/**
	 * Moves the graph to the active match — but never pages a row in. `navigateToCommit` would fire an
	 * uncapped host walk for an unloaded row, so those wait for the explicit Load action instead.
	 *
	 * No debounce: the wrapper's navigation is latest-wins and settles superseded jumps as cancelled,
	 * so a fast typist just supersedes their own scrolls.
	 */
	private jumpToActive(): void {
		const match = this.activeMatch;
		if (match?.rowIndex == null) return;

		this.emitJump(match, false);
	}

	private emitJump(match: RefFindMatch, focus: boolean): void {
		this.dispatchEvent(
			new CustomEvent<GraphRefFindJumpEventDetail>('gl-graph-ref-find-jump', {
				detail: { sha: match.sha, focus: focus, refKey: refFindPillKey(match) },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private close(): void {
		this.dispatchEvent(new CustomEvent('gl-graph-ref-find-close', { bubbles: true, composed: true }));
	}

	private step(direction: 1 | -1): void {
		if (this._matches.length === 0) return;

		this._index = stepMatchIndex(this._index, this._matches.length, direction);
		this.jumpToActive();
	}

	private onInput(e: Event): void {
		this._query = (e.target as HTMLInputElement).value;
		this.recompute();
	}

	private onKeydown(e: KeyboardEvent): void {
		switch (e.key) {
			case 'Escape':
				e.preventDefault();
				e.stopPropagation();
				this.close();
				return;

			case 'Enter':
				e.preventDefault();
				e.stopPropagation();
				// Enter commits: land on the active match WITH focus so the graph takes over the keyboard,
				// then dismiss. Shift+Enter walks backwards, mirroring the unadvertised arrow stepping.
				if (e.shiftKey) {
					this.step(-1);
					return;
				}

				this.commit();
				return;

			case 'ArrowDown':
				e.preventDefault();
				e.stopPropagation();
				this.step(1);
				return;

			case 'ArrowUp':
				e.preventDefault();
				e.stopPropagation();
				this.step(-1);
		}
	}

	/**
	 * Enter goes there — and pages the row in first when it isn't loaded.
	 *
	 * This is the one place a page-in can start: typing and stepping never trigger the host's uncapped
	 * walk, so browsing stays cheap and only a deliberate commit pays for it. The widget stays OPEN
	 * across a load so you can see it resolve; it dismisses once the row is actually there.
	 */
	private commit(): void {
		const match = this.activeMatch;
		if (match == null) return;

		this.reportLanding(match);

		if (match.rowIndex == null) {
			this.emitJump(match, false);
			return;
		}

		this.emitJump(match, true);
		this.close();
	}

	/** One event per landed reference — on commit, not per keystroke, which would be mostly noise. */
	private reportLanding(match: RefFindMatch): void {
		const terms = parseFilterTerms(this._query);
		this._telemetry?.sendEvent({
			name: 'graph/action/refFind',
			data: {
				source: this.openedBy,
				kind: match.kind,
				loaded: match.rowIndex != null,
				segmented: terms.some(t => t.includes('/')),
				terms: terms.length,
			},
		});
	}

	/**
	 * Names the active match. The buffer alone can't confirm the hit — after a long scroll you'd have
	 * to hunt the row for it. Elided from the LEFT so the identifying tail survives
	 * (`…/some-long-branch`), with the full name on the tooltip.
	 *
	 * A ref whose row isn't paged in is named here too, dimmed: the graph can't move to it yet, so
	 * this line is the only thing telling you the ref exists and what Enter would fetch. It replaced a
	 * second row carrying a Load button — chrome you could only find by blind-stepping onto it.
	 */
	private renderHit(): unknown {
		const match = this.activeMatch;
		if (match == null) return nothing;

		const unloaded = match.rowIndex == null;
		return html`<span
			class="find__hit${unloaded ? ' find__hit--unloaded' : ''}"
			title=${unloaded ? `${match.name} — not loaded, press Enter to fetch it` : match.name}
			>${
				unloaded ? html`<code-icon class="find__hit-icon" icon="cloud-download"></code-icon>` : nothing
			}${elideRefName(match.name)}</span
		>`;
	}

	override render(): unknown {
		const noMatches = this._query.trim().length > 0 && this._matches.length === 0;

		return html`<div class="find" role="search" aria-label="Find a branch or tag">
			<div class="find__row">
				<code-icon class="find__icon" icon="search"></code-icon>
				<input
					class="find__input${noMatches ? ' find__input--empty' : ''}"
					type="text"
					spellcheck="false"
					autocomplete="off"
					placeholder="Find a branch or tag..."
					aria-label="Find a branch or tag"
					.value=${this._query}
					@input=${this.onInput}
					@keydown=${this.onKeydown}
				/>
				${this.renderHit()}
				<gl-button
					class="find__close"
					appearance="toolbar"
					density="compact"
					aria-label="Close"
					@click=${this.close}
				>
					<code-icon icon="close"></code-icon>
					<span slot="tooltip">Close</span>
				</gl-button>
			</div>
		</div>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-ref-find': GlGraphRefFind;
	}
}
