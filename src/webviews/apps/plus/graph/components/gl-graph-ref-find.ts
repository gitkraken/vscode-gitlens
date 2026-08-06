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
	refreshMatchRows,
	stepMatchIndex,
} from '../utils/refFind.utils.js';
import { refPillKey } from '../utils/refKey.utils.js';
import { graphRefFindStyles } from './gl-graph-ref-find.css.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/tooltip.js';

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

	/** Ref key of the match we last jumped the graph to. Not reactive — used to gate re-jumps, not to render. */
	private _landedRefKey: string | undefined;

	private get activeMatch(): RefFindMatch | undefined {
		return this._index >= 0 ? this._matches[this._index] : undefined;
	}

	private _onWebviewBlur = (): void => this.onWebviewBlur();

	/**
	 * Set while a native context-menu request is in flight. VS Code's menu steals webview focus on open,
	 * which arrives here as a `webview-blur` — indistinguishable from "the user left the webview" unless
	 * we mark the menu ourselves. Without it, right-clicking anywhere (including inside our own input, to
	 * paste) would dismiss the widget and lose the query. Same guard `graph-app.ts` uses for the overlay
	 * sidebar (`_suppressOverlayCollapseForMenu`). Cleared on `webview-focus` (the menu closed and focus
	 * came back) or on the next primary pointerdown (a right-click that raised no menu never gets one).
	 */
	private _suppressBlurForMenu = false;
	private _onWebviewFocus = (): void => {
		this._suppressBlurForMenu = false;
	};
	private _onContextMenu = (): void => {
		this._suppressBlurForMenu = true;
	};
	private _onPointerDown = (e: PointerEvent): void => {
		if (e.button === 0) {
			this._suppressBlurForMenu = false;
		}
	};

	override connectedCallback(): void {
		super.connectedCallback?.();
		window.addEventListener('webview-blur', this._onWebviewBlur, false);
		window.addEventListener('webview-focus', this._onWebviewFocus, false);
		document.addEventListener('contextmenu', this._onContextMenu, true);
		document.addEventListener('pointerdown', this._onPointerDown, true);
	}

	override disconnectedCallback(): void {
		window.removeEventListener('webview-blur', this._onWebviewBlur, false);
		window.removeEventListener('webview-focus', this._onWebviewFocus, false);
		document.removeEventListener('contextmenu', this._onContextMenu, true);
		document.removeEventListener('pointerdown', this._onPointerDown, true);
		super.disconnectedCallback?.();
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

		// Land the jump only if we haven't landed one yet — a routine sidebar invalidation shouldn't yank
		// the graph out from under someone reading the row they already jumped to. Tracked via the landed
		// ref key rather than `activeMatch`, since the invalidation empties `_matches` in between.
		this.recompute({ jump: this._landedRefKey == null });
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

	/** Focuses the input and selects any preserved query, so typing replaces the last search. Public so
	 *  the graph can re-claim the input when `/` is pressed while the widget is already open. */
	override focus(options?: FocusOptions): void {
		const input = this._inputEl;
		if (input == null) return;

		input.focus(options);
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
		void this.updateComplete.then(() => this.focus());
	}

	private reset(): void {
		this._matches = [];
		this._index = -1;
		this._landedRefKey = undefined;
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

		// Prefer restoring the landed match's position over re-picking, so a panel invalidation doesn't
		// throw away wherever the user had stepped to.
		const landedIndex =
			this._landedRefKey != null ? matches.findIndex(m => refPillKey(m) === this._landedRefKey) : -1;
		this._index = landedIndex !== -1 ? landedIndex : pickInitialTargetIndex(matches);

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
		const refKey = refPillKey(match);
		this._landedRefKey = refKey;
		this.dispatchEvent(
			new CustomEvent<GraphRefFindJumpEventDetail>('gl-graph-ref-find-jump', {
				detail: { sha: match.sha, focus: focus, refKey: refKey },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private close(): void {
		this.dispatchEvent(new CustomEvent('gl-graph-ref-find-close', { bubbles: true, composed: true }));
	}

	/**
	 * Closes on focus-out only when `refFindAutoHide` is explicitly on. The setting defaults to `false`
	 * and `GraphComponentConfig.refFindAutoHide` is optional, so `!== true` is the check that treats an
	 * absent value as the documented default — the convention this component's other default-off config
	 * fields (`experimentalKanbanEnabled`, `experimentalVisualizationsEnabled`) already follow.
	 *
	 * `relatedTarget` is retargeted to the nearest
	 * ancestor in OUR shadow tree (e.g. `gl-button` itself, even when focus actually landed on its
	 * internal button), so a plain `shadowRoot.contains()` check is enough to tell a real focus-out
	 * from focus merely moving between elements the widget owns.
	 *
	 * A `null` relatedTarget is ambiguous — the graph's own overlay-collapse handling
	 * (`graph-app.ts`'s `_handleSidebarOverlayFocusOut`) treats it the same way: it can mean focus
	 * left the webview entirely, but VS Code webviews also report it for routine in-webview moves to
	 * a non-focusable node. Closing on every `null` would dismiss the widget on those false positives,
	 * so that case is left to {@link onWebviewBlur}, which fires only when the webview itself loses
	 * focus (the host's `focused: false` message, relayed as the `webview-blur` window event).
	 */
	private onFocusOut(e: FocusEvent): void {
		if (this._graphState?.config?.refFindAutoHide !== true) return;

		const related = e.relatedTarget;
		if (related == null) return;
		if (related instanceof Node && this.shadowRoot?.contains(related) === true) return;

		this.close();
	}

	private onWebviewBlur(): void {
		if (!this.open) return;
		if (this._graphState?.config?.refFindAutoHide !== true) return;
		// A native context menu blurs the webview without the user having left it — see `_suppressBlurForMenu`.
		if (this._suppressBlurForMenu) return;

		this.close();
	}

	private step(direction: 1 | -1): void {
		if (this._matches.length === 0) return;

		this._index = stepMatchIndex(this._index, this._matches.length, direction);
		this.jumpToActive();
	}

	private onInput(e: Event): void {
		this._query = (e.target as HTMLInputElement).value;
		// A new query legitimately re-lands, so drop the old landed ref key before recomputing.
		this._landedRefKey = undefined;
		this.recompute();
	}

	// Escape is NOT here: the graph pushes the open finder onto the keymap's overlay stack, which resolves
	// Esc top-down before any focus scope — so a hovercard opened over the finder closes first and this
	// second. The keys below are genuinely focus-based and stay local.
	private onKeydown(e: KeyboardEvent): void {
		switch (e.key) {
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
		const total = this._matches.length;
		// Sized to the widget: ~328px of text room (34rem less the widget padding and the hit's indent) at
		// ~0.6em per character in the 11px monospace face. Two short of the ~49 that fit, so the unloaded
		// variant's leading glyph doesn't push the last characters under the clip; ~11 shorter again when
		// the step hint shares the line. Move these if the widget's `inline-size` moves — tuned as a set.
		const label = elideRefName(match.label, total > 1 ? 36 : 47);
		const hit = html`<span class="find__hit${unloaded ? ' find__hit--unloaded' : ''}"
			>${
				unloaded ? html`<code-icon class="find__hit-icon" icon="cloud-download"></code-icon>` : nothing
			}${label}</span
		>`;

		// Only worth a tooltip when it has something the line itself doesn't already say: the full name
		// when elision ate part of it, or what Enter will do for a ref that isn't paged in. A tooltip
		// echoing a name that's fully visible is noise.
		const tooltip = unloaded
			? `${match.label} — not loaded, press Enter to fetch it`
			: label !== match.label
				? match.label
				: undefined;
		const hitEl =
			tooltip == null ? hit : html`<gl-tooltip content=${tooltip} placement="bottom">${hit}</gl-tooltip>`;

		// Shown only with somewhere to step TO — it's a discoverability hint for the arrow keys, not a
		// stepper: deliberately text, never buttons, since it's the buttons that would make this read as the
		// editor's find widget. `aria-hidden` because the input carries `aria-keyshortcuts` for the same
		// fact, and announcing a changing count on every keystroke would be noise.
		const nav =
			total > 1
				? html`<span class="find__nav" aria-hidden="true">↑↓ ${this._index + 1} of ${total}</span>`
				: nothing;

		return html`<div class="find__result">${hitEl}${nav}</div>`;
	}

	override render(): unknown {
		const noMatches = this._query.trim().length > 0 && this._matches.length === 0;

		return html`<div class="find" role="search" aria-label="Find a branch or tag" @focusout=${this.onFocusOut}>
			<div class="find__row">
				<div class="find__field">
					<code-icon class="find__icon" icon="search"></code-icon>
					<input
						class="find__input${noMatches ? ' find__input--empty' : ''}"
						type="text"
						spellcheck="false"
						autocomplete="off"
						placeholder="Find a branch or tag..."
						aria-label="Find a branch or tag"
						aria-keyshortcuts="ArrowDown ArrowUp"
						.value=${this._query}
						@input=${this.onInput}
						@keydown=${this.onKeydown}
					/>
				</div>
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
			${this.renderHit()}
		</div>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-ref-find': GlGraphRefFind;
	}
}
