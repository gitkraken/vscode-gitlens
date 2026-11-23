import * as l10n from '@gitkraken/commit-graph/l10n.js';
import type { CSSResultGroup, PropertyValues, TemplateResult } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import { focusableBaseStyles } from '@gitlens/components/components/styles/lit/a11y.css.js';
import { boxSizingBase } from '@gitlens/components/components/styles/lit/base.css.js';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '@gitlens/utils/gitRefs.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import { normalizeWheelDelta } from '@gitlens/utils/wheel.js';
import { connectedGraphs } from './connectedGraphs.js';
import type { WorktreeRefs } from './contracts/rows.js';
import { overviewBarStyles } from './overviewBar.css.js';
import { shortRefName } from './rows/markers.js';
import '@gitlens/components/components/codeIcon.js';
import '@gitlens/components/components/overlays/popover.js';
import '@gitlens/components/components/overlays/tooltip.js';

export const overviewBarElementName = 'gl-graph-overview-bar';

export interface OverviewBarItem extends WorktreeRefs {
	/** The host's unique id for the worktree's pill, passed back in every event. */
	id: string;
	/** Visible name, or a label for a worktree with no branch; also the pill's accessible name and carried by every
	 *  event. */
	branchName: string;
	/** Visible pill text in place of `branchName`; display only. */
	label?: string;
	/** Never read by the bar; passed back in the select, focus and contextmenu details. */
	repoPath?: string;
	/** Drives the `●` dot whether or not the breakdown has been fetched yet. */
	hasWorkingChanges?: boolean;
	/** Shows the `↑` unpushed indicator; leave it unset where the upstream leg already names the remote. */
	hasUnpushed?: boolean;
	/** Passed back in the focus event; double-click focus fires only when it is set. */
	branchId?: string;
	/** When true, hovering the pill doesn't fire `gl-graph-overviewstatsneeded`. */
	statsLoaded?: boolean;
	agent?: 'idle' | 'working' | 'needs-input' | 'ended';
	/** How many agent sessions are running in this worktree. Surfaced next to the robot only when > 1 —
	 *  a single session is already implied by the icon. */
	agentCount?: number;
	/** Styles the pill as the primary one and is passed back in the focus event; it doesn't decide which legs render.
	 *   */
	isPrimary?: boolean;
	upstreamSha?: string;
	/** Labels the upstream leg; without `upstreamSha` the leg is a non-interactive indicator, so leave it unset for a
	 *  gone upstream. */
	upstreamName?: string;
	/** The upstream leg's `code-icon` name; `cloud` when unset. */
	upstreamIcon?: string;
	/** The merge-target leg: `sha` makes it a jump button, a `name` alone a non-interactive indicator. */
	target?: { sha?: string; name?: string };
	/** Serialized `data-vscode-context`, copied onto the bar during a right-click the host doesn't cancel. */
	vscodeContext?: string;
}

export interface OverviewBarSelectDetail {
	id: string;
	branchName: string;
	repoPath: string | undefined;
}

export interface OverviewBarStatsNeededDetail {
	id: string;
}

/** Same shape as `gl-graph-jumptocommit`'s detail; not cancelable, and never changes `selectedId`. */
export interface OverviewBarJumpDetail {
	/** The tip to reveal + select — a HEAD, upstream, or merge-target commit. */
	sha: string;
	/** Always true: the bar always asks for it. */
	focus: boolean;
	/** Always true: the bar always asks for it. */
	flash: boolean;
}

export interface OverviewBarFocusDetail {
	id: string;
	branchId: string;
	branchName: string;
	repoPath: string | undefined;
	/** Tells "focus the branch the graph shows" from "switch the graph to this worktree". */
	isPrimary: boolean;
}

export interface OverviewBarContextMenuDetail {
	id: string;
	branchName: string;
	branchId?: string;
	repoPath: string | undefined;
	isPrimary: boolean;
	clientX: number;
	clientY: number;
}

export interface OverviewBarEventMap {
	/** Cancelable: cancelling suppresses the native context menu and the `data-vscode-context` copy. */
	'gl-graph-overviewcontextmenu': CustomEvent<OverviewBarContextMenuDetail>;
	'gl-graph-overviewfocus': CustomEvent<OverviewBarFocusDetail>;
	'gl-graph-overviewjump': CustomEvent<OverviewBarJumpDetail>;
	'gl-graph-overviewselect': CustomEvent<OverviewBarSelectDetail>;
	'gl-graph-overviewstatsneeded': CustomEvent<OverviewBarStatsNeededDetail>;
}

/** Rendered inside the bar's shadow root, so page CSS doesn't reach it. */
export type OverviewBarHoverContent = TemplateResult | Node | string | typeof nothing | undefined;

/** Worktree pills above the graph. Host content goes in the `start` slot; register it with {@link
 *  registerOverviewBarElement}. */
export class GlGraphOverviewBar extends LitElement {
	static override styles: CSSResultGroup = [boxSizingBase, focusableBaseStyles, overviewBarStyles];

	@property({ attribute: false }) items: readonly OverviewBarItem[] = [];
	@property({ attribute: false }) selectedId: string | undefined;
	/** False opts out of fetching stats on hover: `gl-graph-overviewstatsneeded` never fires, so `renderHover` should
	 *  show a static hover. */
	@property({ type: Boolean }) statsOnHover = true;
	/** Renders a pill's hover, called only for pills hovered at least once with `open` true while showing; unset means
	 *  no hover. Keep the reference stable. */
	@property({ attribute: false }) renderHover:
		| ((item: OverviewBarItem, open: boolean) => OverviewBarHoverContent)
		| undefined;
	/** Renders a pill's agent indicator in place of the robot; called only for items with an `agent`. Keep the
	 *  reference stable. */
	@property({ attribute: false }) renderAgentStatus: ((item: OverviewBarItem) => OverviewBarHoverContent) | undefined;

	@state() private focusedPillIndex = 0;

	/** The scrolling strip of pills, for anchoring host overlays; undefined until the first render. */
	get pillsElement(): HTMLElement | undefined {
		return this.renderRoot?.querySelector<HTMLElement>('.pills') ?? undefined;
	}

	/**
	 *  Always REASSIGNED, never mutated: `@state` dirty-checks with `Object.is`, so `set.add(id)` on the
	 *  same Set would not trigger an update and the hover would render empty forever. */
	@state() private hoverShownIds: ReadonlySet<string> = new Set();

	@state() private openHoverId: string | undefined;

	private pendingFocusUpdate = false;

	private readonly onContextMenu = (e: MouseEvent): void => {
		const pills = this.pillsElement;
		const pill = e
			.composedPath()
			.find((el): el is HTMLElement => el instanceof HTMLElement && el.parentElement === pills);
		const id = pill?.dataset.id;
		const item = id != null ? this.items.find(i => i.id === id) : undefined;
		if (item == null) return;

		this.clearCopiedContext();

		const event = new CustomEvent<OverviewBarContextMenuDetail>('gl-graph-overviewcontextmenu', {
			detail: {
				id: item.id,
				branchName: item.branchName,
				branchId: item.branchId,
				repoPath: item.repoPath,
				isPrimary: item.isPrimary === true,
				clientX: e.clientX,
				clientY: e.clientY,
			},
			bubbles: true,
			composed: true,
			cancelable: true,
		});
		if (!this.dispatchEvent(event)) {
			e.preventDefault();
			return;
		}
		if (item.vscodeContext == null) return;

		// KEEP: VS Code reads `data-vscode-context` from light DOM as its menu opens, so the copy goes
		// on the host and is cleared right after.
		this.dataset.vscodeContext = item.vscodeContext;
		this.copiedContextTimer = setTimeout(() => this.clearCopiedContext(), 100);
	};

	private copiedContextTimer: ReturnType<typeof setTimeout> | undefined;

	private clearCopiedContext(): void {
		if (this.copiedContextTimer == null) return;

		clearTimeout(this.copiedContextTimer);
		this.copiedContextTimer = undefined;
		delete this.dataset.vscodeContext;
	}

	private readonly onItemClick = (e: MouseEvent): void => {
		const id = (e.currentTarget as HTMLElement).dataset.id;
		if (id == null) return;

		this.selectWipById(id, e);
	};

	private readonly onItemDblClick = (e: MouseEvent): void => {
		const id = (e.currentTarget as HTMLElement).dataset.id;
		const item = id != null ? this.items.find(i => i.id === id) : undefined;
		if (item?.branchId == null) return;

		e.stopPropagation();
		this.dispatchEvent(
			new CustomEvent<OverviewBarFocusDetail>('gl-graph-overviewfocus', {
				detail: {
					id: item.id,
					branchId: item.branchId,
					branchName: item.branchName,
					repoPath: item.repoPath,
					isPrimary: item.isPrimary === true,
				},
				bubbles: true,
				composed: true,
			}),
		);
	};

	private selectWipById(id: string, e: Event): void {
		e.stopPropagation();
		const item = this.items.find(i => i.id === id);
		if (item == null) return;

		this.dispatchEvent(
			new CustomEvent<OverviewBarSelectDetail>('gl-graph-overviewselect', {
				detail: { id: item.id, branchName: item.branchName, repoPath: item.repoPath },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private readonly onLegClick = (e: MouseEvent): void => {
		const sha = (e.currentTarget as HTMLElement).dataset.sha;
		if (sha == null) return;

		e.stopPropagation();
		this.dispatchEvent(
			new CustomEvent<OverviewBarJumpDetail>('gl-graph-overviewjump', {
				detail: { sha: sha, focus: true, flash: true },
				bubbles: true,
				composed: true,
			}),
		);
	};

	private readonly onPillFocus = (e: FocusEvent): void => {
		const index = (e.currentTarget as HTMLElement).dataset.index;
		if (index != null) {
			this.focusedPillIndex = Number(index);
		}
		this.onPillHover(e);
	};

	private readonly onPillHover = (e: Event): void => {
		if (!this.statsOnHover || this.renderHover == null) return;

		const id = (e.currentTarget as HTMLElement).dataset.id;
		if (id == null) return;

		const item = this.items.find(i => i.id === id);
		if (item == null || item.statsLoaded === true || item.hasWorkingChanges !== true) return;

		this.dispatchEvent(
			new CustomEvent<OverviewBarStatsNeededDetail>('gl-graph-overviewstatsneeded', {
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
		if (e.composedPath().some(el => el instanceof HTMLElement && el.classList.contains('pill__hover'))) return;

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

	// Gates the bar's edge fades (`.is-overflowing`). CSS picks WHICH edge fades from a scroll timeline, but
	// it can't answer WHETHER anything overflows: once the scroll range collapses to zero Chromium holds the
	// timeline at 100% instead of going inactive, stranding a start-edge fade on a bar that now fits. So the
	// cheap, rarely-changing half of the question lives here — resize and items-change only, never per scroll.
	private overflowObserver: ResizeObserver | undefined;

	// `.bar` for its clientWidth (panel/window resize), `.pills` for its scrollWidth (items or labels change).
	// Toggled straight through the CSSOM like `.scrolling`, so it can never trigger a re-render. Safe against
	// observer feedback: the fades are sticky with a negating margin, so generating them leaves both widths
	// untouched.
	private readonly updateOverflowing = (): void => {
		const bar = this.shadowRoot?.querySelector('.bar');
		if (bar == null) return;

		// +1 tolerance so a subpixel rounding difference doesn't read as overflow (as in gl-breadcrumbs).
		bar.classList.toggle('is-overflowing', bar.scrollWidth > bar.clientWidth + 1);
	};

	private observeOverflow(): void {
		if (this.overflowObserver != null) return;

		const bar = this.shadowRoot?.querySelector('.bar');
		const pills = this.shadowRoot?.querySelector('.pills');
		if (bar == null || pills == null) return; // not rendered yet — `firstUpdated` picks it up

		this.overflowObserver = new ResizeObserver(this.updateOverflowing);
		this.overflowObserver.observe(bar);
		this.overflowObserver.observe(pills);
	}

	override connectedCallback(): void {
		super.connectedCallback?.();
		connectedGraphs.add(this);
		// Re-arms after a move in the DOM; a no-op on the first connect, where there's no shadow DOM yet.
		this.observeOverflow();
	}

	protected override firstUpdated(): void {
		this.observeOverflow();
	}

	override disconnectedCallback(): void {
		connectedGraphs.delete(this);
		this.cancelWheelPan();
		this.clearCopiedContext();
		this.overflowObserver?.disconnect();
		this.overflowObserver = undefined;
		super.disconnectedCallback?.();
	}

	/** The owning chip's jump legs, in visual (DOM) order. Non-interactive indicator legs are excluded
	 *  (no `--jump`), so arrow keys never land on something that can't be activated. */
	private legsFor(el: HTMLElement): HTMLElement[] {
		const chip = el.closest('.pill');
		return chip != null ? [...chip.querySelectorAll<HTMLElement>('.pill__leg--jump')] : [];
	}

	private readonly onPillsKeyDown = (e: KeyboardEvent): void => {
		const target = e.target as HTMLElement | null;
		if (target == null) return;

		if (target.classList.contains('pill__leg--jump')) {
			this.onLegKeyDown(e, target);
			return;
		}
		if (!target.classList.contains('pill__main')) return;

		const count = this.items.length;
		switch (e.key) {
			case 'ArrowLeft':
			case 'ArrowRight': {
				if (count === 0) return;

				e.preventDefault();
				const dir = e.key === 'ArrowLeft' ? -1 : 1;
				const from = target.dataset.index != null ? Number(target.dataset.index) : this.focusedPillIndex;
				this.focusedPillIndex = (from + dir + count) % count;
				this.pendingFocusUpdate = true;
				this.requestUpdate();
				break;
			}
			case 'Home':
			case 'End':
				if (count === 0) return;

				e.preventDefault();
				this.focusedPillIndex = e.key === 'Home' ? 0 : count - 1;
				this.pendingFocusUpdate = true;
				this.requestUpdate();
				break;
			case 'Tab': {
				// Dive into this pill's row-marker legs. Shift+Tab — and a pill with no legs — falls
				// through, leaving the bar.
				if (e.shiftKey) return;

				const legs = this.legsFor(target);
				if (legs.length === 0) return;

				e.preventDefault();
				this.moveFocusTo(legs[0]);
				break;
			}
		}
	};

	private onLegKeyDown(e: KeyboardEvent, leg: HTMLElement): void {
		const legs = this.legsFor(leg);
		const i = legs.indexOf(leg);
		if (i < 0) return;

		switch (e.key) {
			case 'ArrowLeft':
			case 'ArrowRight': {
				e.preventDefault();
				const next = Math.max(0, Math.min(legs.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1)));
				this.moveFocusTo(legs[next]);
				break;
			}
			case 'Home':
			case 'End':
				e.preventDefault();
				this.moveFocusTo(e.key === 'Home' ? legs[0] : legs.at(-1));
				break;
			case 'Escape':
			case 'Tab': {
				// Retreat to the owning pill. Tabbing FORWARD past the legs falls through (leaves the bar).
				if (e.key === 'Tab' && !e.shiftKey) return;

				const main = leg.closest('.pill')?.querySelector<HTMLElement>('.pill__main');
				if (main == null) return;

				e.preventDefault();
				if (e.key === 'Escape') {
					e.stopPropagation();
				}
				this.moveFocusTo(main);
				break;
			}
		}
	}

	/** Move managed focus. Keyboard focus owns the scroll position — `focus()` scrolls the control into
	 *  view, so cancel any in-flight wheel pan first or its RAF would yank scrollLeft back. */
	private moveFocusTo(el: HTMLElement | undefined): void {
		if (el == null) return;

		this.cancelWheelPan();
		el.focus();
	}

	protected override willUpdate(changedProperties: PropertyValues<this>): void {
		// KEEP: while focus is in the bar, a host selection change must not move the tab stop.
		if (changedProperties.has('selectedId') && this.selectedId != null && !this.matches(':focus-within')) {
			const selectedIndex = this.items.findIndex(i => i.id === this.selectedId);
			if (selectedIndex >= 0) {
				this.focusedPillIndex = selectedIndex;
			}
		}
		if (this.focusedPillIndex > this.items.length - 1) {
			// KEEP: move focus only when it is already inside the bar, never from elsewhere on the page.
			if (this.matches(':focus-within')) {
				this.pendingFocusUpdate = true;
			}
			this.focusedPillIndex = Math.max(0, this.items.length - 1);
		}
		if (changedProperties.has('items') && this.hoverShownIds.size !== 0) {
			const itemIds = new Set(this.items.map(i => i.id));
			if ([...this.hoverShownIds].some(id => !itemIds.has(id))) {
				this.hoverShownIds = new Set([...this.hoverShownIds].filter(id => itemIds.has(id)));
			}
		}
	}

	protected override updated(): void {
		if (!this.pendingFocusUpdate) return;

		this.moveFocusTo(
			this.shadowRoot?.querySelector<HTMLElement>(`.pill__main[data-index="${this.focusedPillIndex}"]`) ??
				undefined,
		);
		this.pendingFocusUpdate = false;
	}

	override render(): unknown {
		// `toolbar`, not `listbox`: each pill now owns interactive row-marker jump buttons, and `option`
		// makes its children presentational — the jumps would be dropped from the a11y tree entirely.
		// A toolbar is the ARIA-valid composite for a roving-tabindex strip of controls and permits both
		// the per-pill `group` and its buttons; which worktree is selected rides on `aria-current`.
		return html`
			<slot name="start"></slot>
			<div class="bar" @wheel=${this.wheelListener} @contextmenu=${this.onContextMenu}>
				<div
					class="pills"
					role="toolbar"
					aria-orientation="horizontal"
					aria-label=${l10n.t('Overview')}
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

	private renderPill(item: OverviewBarItem, index: number): unknown {
		const isFocused = index === this.focusedPillIndex;
		const isSelected = this.selectedId === item.id;
		const hasAgent = item.agent != null;
		const isDirty = item.hasWorkingChanges === true;
		const isUnpushed = item.hasUnpushed === true;
		const agentCount = item.agentCount ?? 0;
		const classes = classMap({
			pill: true,
			...(item.agent != null && { [`pill--agent-${item.agent}`]: true }),
			'pill--primary': item.isPrimary === true,
			'pill--unpushed': isUnpushed,
			'pill--selected': isSelected,
		});
		let changesState: string | undefined;
		if (isDirty) {
			changesState = isUnpushed
				? l10n.t('Uncommitted changes and unpushed commits')
				: l10n.t('Uncommitted changes');
		} else if (isUnpushed) {
			changesState = l10n.t('Unpushed commits');
		}
		const stateId = changesState != null ? `pill-state-${index}` : undefined;
		const agentState = item.agent != null ? describeAgents(item.agent, Math.max(agentCount, 1)) : undefined;
		const agentStateId = agentState != null ? `pill-agent-${index}` : undefined;
		const describedBy = [stateId, agentStateId].filter(id => id != null).join(' ');
		const main = html`<button
			slot=${ifDefined(this.renderHover != null ? 'anchor' : undefined)}
			class="pill__main"
			type="button"
			data-id=${item.id}
			data-index=${index}
			@click=${this.onItemClick}
			@dblclick=${this.onItemDblClick}
			@mouseenter=${this.onPillHover}
			@focus=${this.onPillFocus}
			aria-current=${isSelected ? 'true' : nothing}
			aria-describedby=${describedBy || nothing}
			aria-label=${item.label != null ? item.branchName : nothing}
			tabindex=${isFocused ? '0' : '-1'}
		>
			${isDirty ? html`<span class="pill__dot" aria-hidden="true"></span>` : nothing}${
				isUnpushed
					? html`<code-icon class="pill__unpushed-icon" icon="arrow-up" aria-hidden="true"></code-icon>`
					: nothing
			}${hasAgent ? this.renderAgent(item, agentCount) : nothing}${item.label ?? item.branchName}
		</button>`;

		return html`
			<span class=${classes} role="group" aria-label=${item.branchName} data-id=${item.id}>
				${this.renderPillHover(item, main)} ${this.renderRowMarkers(item)}
				${stateId != null ? html`<span id=${stateId} hidden>${changesState}</span>` : nothing}
				${agentStateId != null ? html`<span id=${agentStateId} hidden>${agentState}</span>` : nothing}
			</span>
		`;
	}

	private renderAgent(item: OverviewBarItem, agentCount: number): unknown {
		const renderAgentStatus = this.renderAgentStatus;
		if (renderAgentStatus != null) {
			return html`<span class="pill__agent" aria-hidden="true">${renderAgentStatus(item)}</span>`;
		}

		return html`<span class="pill__agent" aria-hidden="true"
			><code-icon class="pill__agent-icon" icon="robot"></code-icon>${when(
				agentCount > 1,
				() => html`<span class="pill__agent-count">${agentCount}</span>`,
			)}</span
		>`;
	}

	private renderPillHover(item: OverviewBarItem, main: TemplateResult): unknown {
		const renderHover = this.renderHover;
		if (renderHover == null) {
			if (item.label != null && item.label !== item.branchName) {
				return html`<gl-tooltip content=${item.branchName} placement="bottom">${main}</gl-tooltip>`;
			}
			return main;
		}

		return html`<gl-popover
			trigger="hover focus-visible"
			placement="bottom"
			data-id=${item.id}
			@gl-popover-show=${this.onHoverShow}
			@gl-popover-after-hide=${this.onHoverHide}
		>
			${main}
			${when(
				this.hoverShownIds.has(item.id),
				() =>
					html`<div slot="content" class="pill__hover">
						${renderHover(item, this.openHoverId === item.id)}
					</div>`,
			)}
		</gl-popover>`;
	}

	/** The always-visible row-marker legs — HEAD, upstream, merge target — in that fixed order so every pill
	 *  reads the same way. Each names what it points AT: a glyph, plus its ref for the upstream and the target.
	 */
	private renderRowMarkers(item: OverviewBarItem): unknown {
		const headSha = item.tipSha;
		const upstreamSha = item.upstreamSha;
		const showUpstream = upstreamSha != null || item.upstreamName != null;
		if (headSha == null && !showUpstream && item.target?.sha == null && item.target?.name == null) return nothing;

		// Tooltips NAME the row-marker role ("HEAD", "upstream", "merge target") rather than just the ref, so a
		// leg says what it IS and not only where it goes — the glyphs alone don't carry that. Same vocabulary
		// as the on-row rail's tooltip, and the ref is kept in parentheses. The "Jump to" prefix is promised
		// only when the leg can actually perform one (`renderLeg` renders a static indicator without a sha).
		const upstreamName = item.upstreamName != null ? shortRefName(item.upstreamName) : undefined;
		let upstreamLabel: string;
		if (upstreamSha != null) {
			upstreamLabel =
				upstreamName != null ? l10n.t('Jump to Upstream ({0})', upstreamName) : l10n.t('Jump to Upstream');
		} else {
			upstreamLabel = upstreamName != null ? l10n.t('Upstream ({0})', upstreamName) : l10n.t('Upstream');
		}
		const targetName = item.target?.name != null ? shortRefName(item.target.name) : undefined;
		let targetLabel: string;
		if (item.target?.sha != null) {
			targetLabel =
				targetName != null ? l10n.t('Jump to Merge Target ({0})', targetName) : l10n.t('Jump to Merge Target');
		} else {
			targetLabel = targetName != null ? l10n.t('Merge Target ({0})', targetName) : l10n.t('Merge Target');
		}
		// The remote alone (`origin`) when the upstream tracks a same-named branch — the pill already shows that
		// name. Otherwise the full `origin/other`. Same rule as the graph ref pills' upstream segment, so the
		// two surfaces agree.
		let upstreamLegLabel = upstreamName;
		if (upstreamName != null) {
			const remote = getRemoteNameFromBranchName(upstreamName);
			if (remote.length > 0 && getBranchNameWithoutRemote(upstreamName) === item.branchName) {
				upstreamLegLabel = remote;
			}
		}

		return html`<span class="pill__legs"
			>${
				headSha != null
					? this.renderLeg(
							'head',
							headSha,
							l10n.t('Jump to HEAD ({0})', item.branchName),
							html`<code-icon icon="vm-active"></code-icon>`,
						)
					: nothing
			}${
				showUpstream
					? this.renderLeg(
							'upstream',
							upstreamSha,
							upstreamLabel,
							html`<code-icon icon=${item.upstreamIcon ?? 'cloud'}></code-icon>${
									upstreamLegLabel != null
										? html`<span class="pill__leg-label">${upstreamLegLabel}</span>`
										: nothing
								}`,
						)
					: nothing
			}${
				item.target?.sha != null || item.target?.name != null
					? this.renderLeg(
							'target',
							item.target?.sha,
							targetLabel,
							html`<code-icon icon="gl-merge-target"></code-icon>${
									targetName != null
										? html`<span class="pill__leg-label">${targetName}</span>`
										: nothing
								}`,
						)
					: nothing
			}</span
		>`;
	}

	private renderLeg(
		kind: 'head' | 'upstream' | 'target',
		sha: string | undefined,
		label: string,
		content: TemplateResult,
	): TemplateResult {
		if (sha == null) {
			return html`<gl-tooltip content=${label} placement="bottom"
				><span class="pill__leg pill__leg--${kind}" aria-label=${label} role="img">${content}</span></gl-tooltip
			>`;
		}

		return html`<gl-tooltip content=${label} placement="bottom"
			><button
				class="pill__leg pill__leg--${kind} pill__leg--jump"
				type="button"
				tabindex="-1"
				data-sha=${sha}
				aria-label=${label}
				@click=${this.onLegClick}
			>
				${content}
			</button></gl-tooltip
		>`;
	}

	private readonly onHoverShow = (e: Event): void => {
		if (e.target !== e.currentTarget) return;

		const id = (e.currentTarget as HTMLElement).dataset.id;
		if (id == null) return;

		// Reassign — mutating the Set in place would not trip Lit's `Object.is` dirty check, and the
		// `when()` gate would never flip (an empty popover, forever).
		if (!this.hoverShownIds.has(id)) {
			this.hoverShownIds = new Set(this.hoverShownIds).add(id);
		}
		this.openHoverId = id;
	};

	private readonly onHoverHide = (e: Event): void => {
		if (e.target !== e.currentTarget) return;

		const id = (e.currentTarget as HTMLElement).dataset.id;
		// Only clear if this pill is still the open one — popovers close each other, so a stale
		// after-hide from the pill we just moved off of must not blank the one we moved onto.
		if (id != null && this.openHoverId === id) {
			this.openHoverId = undefined;
		}
	};
}

/** Idempotent; `registerCommitGraphElements` does not register the bar. */
export function registerOverviewBarElement(registry: CustomElementRegistry = customElements): void {
	if (registry.get(overviewBarElementName) == null) {
		registry.define(overviewBarElementName, GlGraphOverviewBar);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-overview-bar': GlGraphOverviewBar;
	}

	interface GlobalEventHandlersEventMap extends OverviewBarEventMap {}
}

function describeAgents(agent: NonNullable<OverviewBarItem['agent']>, count: number): string {
	switch (agent) {
		case 'needs-input':
			return formatPlural(
				l10n.t('{0, plural, one{Agent needs input} other{{0} agents, at least one needs input}}'),
				[count],
			);
		case 'working':
			return formatPlural(l10n.t('{0, plural, one{Agent working} other{{0} agents, at least one working}}'), [
				count,
			]);
		case 'idle':
			return formatPlural(l10n.t('{0, plural, one{Agent idle} other{{0} agents, idle}}'), [count]);
		case 'ended':
			return formatPlural(l10n.t('{0, plural, one{Agent ended} other{{0} agents, ended}}'), [count]);
	}
}
