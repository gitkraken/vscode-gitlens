import type { PropertyValues } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { AgentSessionCategory } from '../../../shared/agentUtils.js';
import { getAgentCategoryLabel } from '../../../shared/agentUtils.js';
import { focusableBaseStyles } from '../../../shared/components/styles/lit/a11y.css.js';
import { boxSizingBase } from '../../../shared/components/styles/lit/base.css.js';
import { ContextMenuProxyController } from '../../../shared/controllers/context-menu-proxy.js';
import { normalizeWheelDelta } from '../utils/wheel.utils.js';
import { wipBarStyles } from './gl-graph-wip-bar.css.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/commit/commit-stats.js';
import '../../../shared/components/overlays/tooltip.js';

export interface WipBarItem {
	/** The WIP's sha (`uncommitted` for the primary worktree; `worktree-wip::<path>` for secondaries). */
	id: string;
	/** User-visible branch name (already extracted from refs / falls back to worktree label). */
	branch: string;
	/** Worktree's repo path — passed back in the select event so the host can route without re-resolving. */
	repoPath: string;
	/** Whether the worktree has working (uncommitted) changes — drives the `●` dot independent of
	 *  whether `files` has been fetched yet (a dirty worktree shows the dot before its breakdown lands). */
	hasWorkingChanges?: boolean;
	/** Whether the worktree has unpushed commits — drives the `↑` indicator. */
	hasUnpushed?: boolean;
	/** Count of commits ahead of the upstream — shown in the hover only, and only for tracked branches.
	 *  Absent for local-only branches (no upstream): the `↑` shows, but the hover omits a precise count. */
	ahead?: number;
	/** Changed-file counts (counts of added/modified/deleted FILES, not line diffstats). `files` is
	 *  their sum. Optional: a pill is surfaced from the worktree's cheap clean/dirty signal, and the
	 *  full breakdown is fetched lazily on hover — so these are absent until that request lands. */
	files?: number;
	added?: number;
	modified?: number;
	deleted?: number;
	/** True when an on-demand stats fetch settled without producing a breakdown (the request failed
	 *  or was cancelled). Lets the hover show a terminal "Couldn't load changes" instead of a
	 *  perpetual "Loading changes…". Only meaningful while `files` is absent. */
	statsUnavailable?: boolean;
	/** Optional — surfaced when available (e.g., from a running agent session); otherwise omitted from the row. */
	lastActivity?: string;
	agent?: AgentSessionCategory;
	isPrimary?: boolean;
	/** Serialized `data-vscode-context` for this WIP's right-click menu — `gitlens:wip` for the primary
	 *  worktree, `gitlens:wip+worktree` for a secondary. Built host-side (see `serializeWipContext`) so a
	 *  pill opens the identical menu as the in-graph WIP row and the details header. */
	context?: string;
}

export interface WipBarSelectDetail {
	id: string;
	branch: string;
	repoPath: string;
}

export interface WipBarStatsNeededDetail {
	/** The hovered/focused pill's WIP sha — the host computes its full breakdown on demand. */
	id: string;
}

@customElement('gl-graph-wip-bar')
export class GlGraphWipBar extends LitElement {
	static override styles = [boxSizingBase, focusableBaseStyles, wipBarStyles];

	@property({ attribute: false }) items: readonly WipBarItem[] = [];
	@property({ attribute: false }) selectedId: string | undefined;
	/** Whether the bar sits at the top or bottom of the graph column — flips the divider border/padding
	 *  to match. The host (`GraphApp`) places it at the bottom when the details panel is on the bottom. */
	@property({ reflect: true }) position: 'top' | 'bottom' = 'top';
	/** False = host's `graph.showWorktreeWipStats` opt-out: don't fetch stats on hover (no
	 *  per-worktree `git status`); show a static "has changes" tooltip, not "Loading…". Breakdown
	 *  appears on click. Primary pill unaffected (always has stats). */
	@property({ type: Boolean }) statsOnHover = true;

	@state() private focusedPillIndex = 0;

	private pendingFocusUpdate = false;

	// Right-click a pill → open the WIP's native context menu. Pills carry `data-vscode-context` in this
	// component's shadow DOM, but VS Code reads the attribute from light DOM, so the proxy copies it onto
	// this host (a light-DOM child of the graph app) as the contextmenu event bubbles out. Mirrors the
	// in-graph WIP row and the details-header kebab, which open the same menu from the same context.
	private readonly _contextMenuProxy = new ContextMenuProxyController(this);

	private readonly onItemClick = (e: MouseEvent): void => {
		const id = (e.currentTarget as HTMLElement).dataset.id;
		if (id == null) return;

		this.selectWipById(id, e);
	};

	private readonly onItemKeyDown = (e: KeyboardEvent): void => {
		if (e.key !== 'Enter' && e.key !== ' ') return;

		if (e.key === ' ') {
			e.preventDefault();
		}
		const id = (e.currentTarget as HTMLElement).dataset.id;
		if (id == null) return;

		this.selectWipById(id, e);
	};

	private selectWipById(id: string, e: Event): void {
		e.stopPropagation();
		const item = this.items.find(i => i.id === id);
		if (item == null) return;

		this.selectedId = id;
		this.dispatchEvent(
			new CustomEvent<WipBarSelectDetail>('gl-graph-wip-bar-select', {
				detail: { id: item.id, branch: item.branch, repoPath: item.repoPath },
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** Hover/focus on a stats-less pill → ask the host to compute them. Fires on the leading edge
	 *  (before the tooltip's open delay) so the breakdown is ready when the tooltip shows; graph-app
	 *  dedups per worktree. Suppressed when `statsOnHover` is off so passive hover never costs a
	 *  per-worktree `git status` (revealed on click instead). */
	private readonly onPillHover = (e: Event): void => {
		if (!this.statsOnHover) return;

		const id = (e.currentTarget as HTMLElement).dataset.id;
		if (id == null) return;

		const item = this.items.find(i => i.id === id);
		// Nothing to fetch when stats are already present, or when the pill has no working changes at all
		// (an unpushed-only worktree) — its breakdown would be empty, so don't spend a `git status` on it.
		if (item == null || item.files != null || item.hasWorkingChanges !== true) return;

		this.dispatchEvent(
			new CustomEvent<WipBarStatsNeededDetail>('gl-graph-wip-bar-stats-needed', {
				detail: { id: id },
				bubbles: true,
				composed: true,
			}),
		);
	};

	private wheelTarget: number | undefined;
	private wheelPos = 0;
	private wheelMax = 0;
	private wheelClientWidth = 0;
	private wheelRaf: number | undefined;

	// Translate a wheel into a horizontal pan. Native wheel scrolling won't pan a horizontal-only strip
	// when an ancestor (the graph) can scroll vertically, so we redirect the axis ourselves. Rather than
	// `scrollLeft += delta` (an instant per-event jump that reads as steppy/janky — especially with a
	// notched wheel — and can thrash layout under the heavy graph), accumulate into a target and ease
	// toward it once per frame, mirroring native smooth scrolling.
	private readonly onWheel = (e: WheelEvent): void => {
		// Pan from either axis: a vertical wheel is redirected to horizontal, and a horizontal wheel /
		// trackpad swipe pans directly — we consume the event, so its native scroll must be applied here.
		if (e.deltaY === 0 && e.deltaX === 0) return;

		const bar = e.currentTarget as HTMLElement;
		// scrollWidth/clientWidth only change on resize or items-change, not on scroll — sample them once
		// at the start of a gesture (RAF idle) and reuse for the in-flight pan, so a fast wheel stream
		// doesn't force a layout read (and reflow against the RAF's scrollLeft writes) on every event.
		if (this.wheelRaf == null) {
			this.wheelClientWidth = bar.clientWidth;
			this.wheelMax = bar.scrollWidth - this.wheelClientWidth;
		}
		if (this.wheelMax <= 0) return; // nothing to pan — let the page scroll

		// Accumulate onto the in-flight target (not the live scrollLeft) so rapid ticks add up instead of
		// each resetting from wherever the easing happens to be.
		const delta = normalizeWheelDelta(e.deltaMode, e.deltaY + e.deltaX, this.wheelClientWidth);
		const from = this.wheelTarget ?? bar.scrollLeft;
		const target = Math.max(0, Math.min(this.wheelMax, from + delta));
		if (Math.abs(target - from) < 0.5) return; // at the boundary in this direction — let the page scroll

		e.preventDefault();
		this.wheelTarget = target;
		if (this.wheelRaf != null) return; // a pan is animating — it will ease toward the updated target

		// Pills run hover machinery (CSS `:hover`, `mouseenter` → lazy stats fetch, per-pill tooltips).
		// As the bar pans, pills slide under a stationary cursor and fire that machinery every frame,
		// which stutters the scroll. Suppress pointer hit-testing on the pills until the pan settles —
		// toggled directly (not via reactive state) so it never triggers a re-render mid-scroll.
		bar.classList.add('scrolling');

		// Ease a float position toward the target and write it to scrollLeft each frame. Converging on our
		// own float — not the read-back scrollLeft — is what guarantees the loop terminates: scrollLeft
		// snaps to the pixel grid, so a sub-pixel eased step can round to no movement; reading it back would
		// leave `diff` stuck above the threshold and spin forever (never dropping `.scrolling`, so hover
		// would stay dead). The float always converges, so the pan reliably settles and re-enables hover.
		this.wheelPos = bar.scrollLeft;
		const step = (): void => {
			const target = this.wheelTarget;
			if (target == null) {
				// Pan was cancelled (e.g. keyboard focus took over) — stop and re-enable hover.
				this.wheelRaf = undefined;
				bar.classList.remove('scrolling');
				return;
			}

			const diff = target - this.wheelPos;
			if (Math.abs(diff) < 0.5) {
				bar.scrollLeft = target;
				bar.classList.remove('scrolling');
				this.wheelRaf = undefined;
				this.wheelTarget = undefined;
				return;
			}

			this.wheelPos += diff * 0.25; // ease ~95% toward target in ~10 frames (≈ native feel)
			bar.scrollLeft = this.wheelPos;
			this.wheelRaf = requestAnimationFrame(step);
		};
		this.wheelRaf = requestAnimationFrame(step);
	};

	// Stable listener object (non-passive so `onWheel` can `preventDefault`) — kept off the template so
	// Lit doesn't remove/re-add the wheel listener on every render.
	private readonly wheelListener = { handleEvent: this.onWheel, passive: false };

	// Stop an in-flight wheel pan and re-enable pill hit-testing. Centralized so teardown and the
	// keyboard-focus path can't leave `.scrolling` (pointer-events: none) latched on the pills.
	private cancelWheelPan(): void {
		if (this.wheelRaf != null) {
			cancelAnimationFrame(this.wheelRaf);
			this.wheelRaf = undefined;
		}
		this.wheelTarget = undefined;
		this.shadowRoot?.querySelector('.bar')?.classList.remove('scrolling');
	}

	override disconnectedCallback(): void {
		this.cancelWheelPan();
		super.disconnectedCallback?.();
	}

	private readonly onPillsKeyDown = (e: KeyboardEvent): void => {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

		const count = this.items.length;
		if (count === 0) return;

		e.preventDefault();
		const dir = e.key === 'ArrowLeft' ? -1 : 1;
		this.focusedPillIndex = (this.focusedPillIndex + dir + count) % count;
		this.pendingFocusUpdate = true;
	};

	protected override willUpdate(changedProperties: PropertyValues<this>): void {
		// Keep the roving tab stop valid and aligned with selection. Without this, two states break
		// keyboard access: (1) when `items` shrinks below `focusedPillIndex`, no pill matches the
		// index so every pill renders `tabindex="-1"` and the listbox drops out of the Tab order; and
		// (2) the tab stop should land on the selected pill (WAI-ARIA APG), not always index 0. Only
		// the tab stop moves here — actual focus is moved solely by arrow-key navigation (`updated`).
		if (changedProperties.has('selectedId') && this.selectedId != null) {
			const selectedIndex = this.items.findIndex(i => i.id === this.selectedId);
			if (selectedIndex >= 0) {
				this.focusedPillIndex = selectedIndex;
			}
		}
		if (this.focusedPillIndex > this.items.length - 1) {
			// The focused pill fell out of range — its item was removed. If focus was actually on a
			// pill inside the bar, move it to the re-homed tab stop so keyboard focus isn't dropped
			// to <body>. Guard on `:focus-within` so we never steal focus when the user is elsewhere
			// (e.g. the host changed `selectedId` while focus is in the editor).
			if (this.matches(':focus-within')) {
				this.pendingFocusUpdate = true;
			}
			this.focusedPillIndex = Math.max(0, this.items.length - 1);
		}
	}

	protected override updated(): void {
		if (!this.pendingFocusUpdate) return;

		// Keyboard focus owns the scroll position: `focus()` scrolls the pill into view, so cancel any
		// in-flight wheel pan first or its RAF would yank scrollLeft back and fight the focus scroll.
		this.cancelWheelPan();
		const el = this.shadowRoot?.querySelector<HTMLElement>(`.pill[data-index="${this.focusedPillIndex}"]`);
		el?.focus();
		this.pendingFocusUpdate = false;
	}

	override render(): unknown {
		// Roving tabindex (one focusable item at a time) is the chosen listbox keyboard pattern;
		// see WAI-ARIA APG. Don't mix with aria-activedescendant.
		return html`
			<div class="bar" @wheel=${this.wheelListener}>
				<div
					class="pills"
					role="listbox"
					aria-orientation="horizontal"
					aria-label="Working changes"
					@keydown=${this.onPillsKeyDown}
				>
					${repeat(
						this.items,
						item => item.id,
						(item, index) => this.renderPill(item, index),
					)}
				</div>
			</div>
		`;
	}

	private renderPill(item: WipBarItem, index: number): unknown {
		const isFocused = index === this.focusedPillIndex;
		const isSelected = this.selectedId === item.id;
		const hasAgent = item.agent != null;
		const isDirty = item.hasWorkingChanges === true;
		const isUnpushed = item.hasUnpushed === true;
		const classes = classMap({
			pill: true,
			...(item.agent != null && { [`pill--agent-${item.agent}`]: true }),
			'pill--primary': item.isPrimary === true,
			'pill--unpushed': isUnpushed,
			'pill--selected': isSelected,
		});
		// All indicators lead the branch name in a fixed order — working-changes dot, unpushed arrow,
		// agent robot — so a pill's signals always read in the same left-to-right sequence regardless of
		// which combination is present. Counts live in the hover (per design); the pill arrow is number-less.
		return html`
			<gl-tooltip placement="bottom">
				<span
					class=${classes}
					data-id=${item.id}
					data-index=${index}
					data-vscode-context=${ifDefined(item.context)}
					@click=${this.onItemClick}
					@keydown=${this.onItemKeyDown}
					@mouseenter=${this.onPillHover}
					@focus=${this.onPillHover}
					role="option"
					aria-selected=${isSelected}
					tabindex=${isFocused ? '0' : '-1'}
				>
					${isDirty ? html`<span class="pill__dot"></span>` : nothing}${isUnpushed
						? html`<code-icon class="pill__unpushed-icon" icon="arrow-up" size="11"></code-icon>`
						: nothing}${hasAgent
						? html`<code-icon class="pill__agent-icon" icon="robot" size="11"></code-icon>`
						: nothing}${item.branch}
				</span>
				<div slot="content">${this.renderHoverDetail(item)}</div>
			</gl-tooltip>
		`;
	}

	private renderHoverDetail(item: WipBarItem): unknown {
		return html`
			<div class="pill-hover">
				<div class="pill-hover__branch">
					<code-icon icon="gl-worktree"></code-icon>
					<span>${item.branch}</span>
				</div>
				${item.hasWorkingChanges === true
					? html`<div class="pill-hover__row">
							${item.files != null
								? html`
										<span class="pill-hover__files">${pluralize('file', item.files)} changed</span>
										<commit-stats
											added=${item.added || nothing}
											modified=${item.modified || nothing}
											removed=${item.deleted || nothing}
											symbol="icons"
											no-tooltip
										></commit-stats>
									`
								: item.statsUnavailable === true
									? html`<span class="pill-hover__files">Couldn't load changes</span>`
									: this.statsOnHover
										? html`<span class="pill-hover__files">Loading changes…</span>`
										: html`<span class="pill-hover__files">Has working changes</span>`}
						</div>`
					: nothing}
				${item.hasUnpushed === true
					? html`<div class="pill-hover__row">
							<span class="pill-hover__unpushed">
								<code-icon icon="arrow-up"></code-icon>
								${item.ahead != null && item.ahead > 0
									? `${pluralize('commit', item.ahead)} to push`
									: 'Unpushed commits · no upstream'}
							</span>
						</div>`
					: nothing}
				<div class="pill-hover__row">
					${item.agent != null
						? html`
								<span class="pill-hover__agent pill-hover__agent--${item.agent}">
									<code-icon icon="robot"></code-icon>
									Agent · ${getAgentCategoryLabel(item.agent)}
								</span>
							`
						: nothing}
					${item.lastActivity != null
						? html`<span class="pill-hover__time">Updated ${item.lastActivity} ago</span>`
						: nothing}
				</div>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-wip-bar': GlGraphWipBar;
	}
}
