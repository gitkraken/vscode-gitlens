import type { PropertyValues, TemplateResult } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '@gitlens/git/utils/branch.utils.js';
import type { OverviewBranch, OverviewBranchWip } from '../../../../shared/overviewBranches.js';
import type { AgentSessionCategory } from '../../../shared/agentUtils.js';
import { focusableBaseStyles } from '../../../shared/components/styles/lit/a11y.css.js';
import { boxSizingBase } from '../../../shared/components/styles/lit/base.css.js';
import { ContextMenuProxyController } from '../../../shared/controllers/context-menu-proxy.js';
import { providerIconName } from '../../../shared/git-utils.js';
import { shortRefName } from '../utils/rowMarker.utils.js';
import { normalizeWheelDelta } from '../utils/wheel.utils.js';
import { overviewBarStyles } from './gl-graph-overview-bar.css.js';
import './gl-branch-hover.js';
import './gl-graph-coachmark.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/overlays/tooltip.js';

export interface OverviewBarItem {
	/** The WIP's id: `uncommitted` for the graph's own worktree, its `wipRowsById` row id (see
	 *  `createWipRowId`) for a peer worktree. */
	id: string;
	/** User-visible branch name (already extracted from refs / falls back to worktree label). */
	branch: string;
	/** Worktree's repo path — passed back in the select event so the host can route without re-resolving. */
	repoPath: string;
	/** Whether the worktree has working (uncommitted) changes — drives the `●` dot independent of
	 *  whether the breakdown has been fetched yet (a dirty worktree shows the dot before its stats land). */
	hasWorkingChanges?: boolean;
	/** Whether the worktree has unpushed commits — drives the `↑` indicator. */
	hasUnpushed?: boolean;
	/** The worktree branch in scope ref-id format (`{repoPath}|heads/{name}`). Joins the pill to
	 *  `state.overview` / `overviewEnrichment` for the hover. Undefined for a detached worktree — those
	 *  get a degraded hover rather than none. */
	branchId?: string;
	/** The host's projection of the worktree's branch. The hover falls back to this when `branchId` isn't
	 *  in `state.overview` — a worktree branch only lands there when the worktree is open or its last
	 *  commit is recent, so a dirty worktree on an older branch would otherwise have nothing to show. */
	branchModel?: OverviewBranch;
	/** WIP in the shape the shared hover consumes. Built inside `graph-app`'s memoized item so its identity
	 *  is stable across renders — the hover dedupes its lazy wip-details fetch by this object's reference
	 *  (not branch id), so a fresh object every render would re-fire the fetch. `workingTreeState` is absent
	 *  until the breakdown is fetched lazily on hover. */
	wip?: OverviewBranchWip;
	agent?: AgentSessionCategory;
	/** How many agent sessions are running in this worktree. Surfaced next to the robot only when > 1 —
	 *  a single session is already implied by the icon. */
	agentCount?: number;
	isPrimary?: boolean;
	/** This worktree's HEAD tip sha — the HEAD jump leg. Primary: `branch.sha`; secondary: `parentSha`. */
	headSha?: string;
	/** The current branch's upstream tip sha — the upstream jump leg. Primary only (host `upstreamSha`);
	 *  secondaries aren't probed, so their upstream leg degrades to a non-interactive indicator. */
	upstreamSha?: string;
	/** The upstream branch name (`origin/main`) — labels the upstream leg and its tooltip. Primary only. */
	upstreamName?: string;
	/** The upstream remote's hosting-provider icon key (`github`, `gitlab`, … or `cloud` when unknown) —
	 *  the upstream leg's glyph. Primary only, from the host's `branchState.provider`. */
	providerIcon?: string;
	/** The current branch's merge-target tip sha — the merge-target jump leg. Primary only (from the
	 *  client-pulled `rowMarkerMergeTarget`); absent on the default branch / detached. */
	targetSha?: string;
	/** The merge-target branch name (`main`) — labels the merge-target leg. Primary only. */
	targetName?: string;
	/** Commits ahead of the upstream — PRIMARY only (`branchState.ahead`), since only the primary renders
	 *  row-marker legs. Never rendered as a number: it keeps the upstream leg alive when the tip can't be
	 *  resolved, and suppresses the pill's `↑` (a tracked branch's counts belong to the hover). Setting it on a
	 *  secondary would suppress that pill's `↑` for nothing. */
	ahead?: number;
	/** Serialized `data-vscode-context` for this WIP's right-click menu — `gitlens:wip` for the primary
	 *  worktree, `gitlens:wip+worktree` for a secondary. Built host-side (see `serializeWipContext`) so a
	 *  pill opens the identical menu as the in-graph WIP row and the details header. */
	context?: string;
}

export interface OverviewBarSelectDetail {
	id: string;
	branch: string;
	repoPath: string;
}

export interface OverviewBarStatsNeededDetail {
	/** The hovered/focused pill's WIP sha — the host computes its full breakdown on demand. */
	id: string;
}

export interface OverviewBarJumpDetail {
	/** The tip to reveal + select — a HEAD, upstream, or merge-target commit. */
	sha: string;
}

@customElement('gl-graph-overview-bar')
export class GlGraphOverviewBar extends LitElement {
	static override styles = [boxSizingBase, focusableBaseStyles, overviewBarStyles];

	@property({ attribute: false }) items: readonly OverviewBarItem[] = [];
	@property({ attribute: false }) selectedId: string | undefined;
	/** False = host's `graph.showWorktreeWipStats` opt-out: don't fetch stats on hover (no
	 *  per-worktree `git status`); show a static "has changes" tooltip, not "Loading…". Breakdown
	 *  appears on click. Primary pill unaffected (always has stats). */
	@property({ type: Boolean }) statsOnHover = true;
	/** Drives only the coach-mark auto-show trigger; the bar itself is already gated on ≥1 item. */
	@property({ type: Boolean, attribute: 'graph-ready' }) graphReady = false;
	/** Latches once the follow-terminal controller's first passive reveal lands — see `graph-app`'s
	 *  `_followTerminalRevealed`. Drives only the `followTerminal` coach mark's auto-show trigger. */
	@property({ type: Boolean, attribute: 'follow-terminal-revealed' }) followTerminalRevealed = false;

	@state() private focusedPillIndex = 0;

	/** Pills whose hover has been opened at least once. Gates CONSTRUCTION of `<gl-branch-hover>`, so an
	 *  un-hovered bar pays nothing for it — mirrors the overview card's sticky `_hoverShown`.
	 *
	 *  Always REASSIGNED, never mutated: `@state` dirty-checks with `Object.is`, so `set.add(id)` on the
	 *  same Set would not trigger an update and the hover would render empty forever. */
	@state() private hoverShownIds: ReadonlySet<string> = new Set();

	/** The pill whose hover is currently open. Gates the hover's RENDERING — it stays mounted once shown
	 *  (keeping its per-branch merge-target/enrichment caches) but renders nothing while closed, so it
	 *  registers no signal dependencies and costs nothing on subsequent agent/state ticks. */
	@state() private openHoverId: string | undefined;

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

	private selectWipById(id: string, e: Event): void {
		e.stopPropagation();
		const item = this.items.find(i => i.id === id);
		if (item == null) return;

		this.selectedId = id;
		this.dispatchEvent(
			new CustomEvent<OverviewBarSelectDetail>('gl-graph-overview-bar-select', {
				detail: { id: item.id, branch: item.branch, repoPath: item.repoPath },
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** A row-marker leg → reveal + select that tip in the graph. Deliberately NOT a pill select: a jump
	 *  never opens the WIP details panel, and never moves `selectedId` (which tracks the selected
	 *  worktree, not the viewport). */
	private readonly onLegClick = (e: MouseEvent): void => {
		const sha = (e.currentTarget as HTMLElement).dataset.sha;
		if (sha == null) return;

		e.stopPropagation();
		this.dispatchEvent(
			new CustomEvent<OverviewBarJumpDetail>('gl-graph-overview-bar-jump', {
				detail: { sha: sha },
				bubbles: true,
				composed: true,
			}),
		);
	};

	/** Hover/focus on a stats-less pill → ask the host to compute them. Fires on the leading edge
	 *  (before the popover's open delay) so the breakdown is ready when the hover shows; graph-app
	 *  dedups per worktree. Suppressed when `statsOnHover` is off so passive hover never costs a
	 *  per-worktree `git status` (revealed on click instead). */
	private readonly onPillHover = (e: Event): void => {
		if (!this.statsOnHover) return;

		const id = (e.currentTarget as HTMLElement).dataset.id;
		if (id == null) return;

		const item = this.items.find(i => i.id === id);
		// Nothing to fetch when the breakdown is already present, or when the pill has no working changes
		// at all (an unpushed-only worktree) — it would be empty, so don't spend a `git status` on it.
		if (item == null || item.wip?.workingTreeState != null || item.hasWorkingChanges !== true) return;

		this.dispatchEvent(
			new CustomEvent<OverviewBarStatsNeededDetail>('gl-graph-overview-bar-stats-needed', {
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
		// Re-arms after a move in the DOM; a no-op on the first connect, where there's no shadow DOM yet.
		this.observeOverflow();
	}

	protected override firstUpdated(): void {
		this.observeOverflow();
	}

	override disconnectedCallback(): void {
		this.cancelWheelPan();
		this.overflowObserver?.disconnect();
		this.overflowObserver = undefined;
		super.disconnectedCallback?.();
	}

	// Keyboard model: two roving groups.
	// Mirrors how the graph's rows expose their own controls (a single tab stop that you "dive" out of
	// into managed-focus buttons):
	//  1. PILLS — every `.pill__main` button; one roving tab stop for the whole bar. Left/Right and
	//     Home/End move between worktrees; Enter/Space select (native <button> activation → the existing
	//     reveal-WIP-row + open-details behavior).
	//  2. LEGS — a pill's row-marker jump buttons, all `tabindex="-1"`, reachable only by Tabbing into
	//     the focused pill. Left/Right + Home/End rove them, Enter/Space activate natively, and
	//     Shift+Tab / Escape retreat to the pill.
	// Tab forward past the legs (or from a pill with none) falls through and leaves the bar — the browser
	// default, since no leg is in the tab order.

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
				this.focusedPillIndex = (this.focusedPillIndex + dir + count) % count;
				this.pendingFocusUpdate = true;
				break;
			}
			case 'Home':
			case 'End':
				if (count === 0) return;

				e.preventDefault();
				this.focusedPillIndex = e.key === 'Home' ? 0 : count - 1;
				this.pendingFocusUpdate = true;
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
		// Keep the roving tab stop valid and aligned with selection. Without this, two states break
		// keyboard access: (1) when `items` shrinks below `focusedPillIndex`, no pill matches the
		// index so every pill renders `tabindex="-1"` and the bar drops out of the Tab order; and
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
			<gl-graph-coachmark
				mark="overviewBar"
				placement="bottom-start"
				.anchor=${() => this.renderRoot.querySelector<HTMLElement>('.pills') ?? undefined}
				?auto-show=${this.graphReady}
			></gl-graph-coachmark>
			<gl-graph-coachmark
				mark="followTerminal"
				placement="bottom-start"
				.anchor=${() => this.renderRoot.querySelector<HTMLElement>('.pills') ?? undefined}
				?auto-show=${this.followTerminalRevealed && this.graphReady}
			></gl-graph-coachmark>
			<div class="bar" @wheel=${this.wheelListener}>
				<div
					class="pills"
					role="toolbar"
					aria-orientation="horizontal"
					aria-label="Overview"
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
		const ahead = item.ahead ?? 0;
		// The arrow is for worktrees whose unpushed work would otherwise go unsaid — a local-only branch,
		// where `ahead` is undefined (there's nothing to count against). A TRACKED branch already names its
		// upstream on its leg, and its tracking state belongs to the pill's hover, so it gets no arrow.
		const isUnpushed = item.hasUnpushed === true && ahead === 0;
		const agentCount = item.agentCount ?? 0;
		const classes = classMap({
			pill: true,
			...(item.agent != null && { [`pill--agent-${item.agent}`]: true }),
			'pill--primary': item.isPrimary === true,
			'pill--unpushed': isUnpushed,
			'pill--selected': isSelected,
		});
		// All indicators lead the branch name in a fixed order — working-changes dot, unpushed arrow,
		// agent robot — so a pill's signals always read in the same left-to-right sequence regardless of
		// which combination is present. Counts live in the hover (per design); the pill arrow is
		// number-less. The one exception is the agent count, shown only when a worktree is running MORE
		// than one session — a single session is already implied by the robot itself. (Same rule and
		// icon+count idiom as the overview card's agents indicator.)
		//
		// The chip is a `group` around TWO things: the selectable `.pill__main` button (the roving tab
		// stop, and the branch hover's anchor) and the always-visible row-marker legs. The hover anchors
		// to the main button only, so hovering a leg shows that leg's own tooltip instead. Right-click
		// context sits on the chip so the WIP menu opens from anywhere in it, legs included.
		return html`
			<span
				class=${classes}
				role="group"
				aria-label=${item.branch}
				data-id=${item.id}
				data-vscode-context=${ifDefined(item.context)}
			>
				<gl-popover
					trigger="hover focus-visible"
					placement="bottom"
					data-id=${item.id}
					@gl-popover-show=${this.onHoverShow}
					@gl-popover-after-hide=${this.onHoverHide}
				>
					<button
						slot="anchor"
						class="pill__main"
						type="button"
						data-id=${item.id}
						data-index=${index}
						@click=${this.onItemClick}
						@mouseenter=${this.onPillHover}
						@focus=${this.onPillHover}
						aria-current=${isSelected ? 'true' : nothing}
						tabindex=${isFocused ? '0' : '-1'}
					>
						${isDirty ? html`<span class="pill__dot"></span>` : nothing}${
							isUnpushed
								? html`<code-icon class="pill__unpushed-icon" icon="arrow-up"></code-icon>`
								: nothing
						}${
							hasAgent
								? html`<span class="pill__agent"
										><code-icon class="pill__agent-icon" icon="robot"></code-icon>${when(
											agentCount > 1,
											() => html`<span class="pill__agent-count">${agentCount}</span>`,
										)}</span
									>`
								: nothing
						}${item.branch}
					</button>
					${when(
						this.hoverShownIds.has(item.id),
						() => html`<gl-branch-hover
							slot="content"
							surface="wip-bar"
							.branchId=${item.branchId}
							.fallbackBranch=${item.branchModel}
							.label=${item.branch}
							.worktreePath=${item.repoPath}
							.wip=${item.wip}
							.wipDetails=${this.statsOnHover}
							.open=${this.openHoverId === item.id}
						></gl-branch-hover>`,
					)}
				</gl-popover>
				${this.renderRowMarkers(item)}
			</span>
		`;
	}

	/** The always-visible row-marker legs — HEAD, upstream, merge target — in that fixed order so every pill
	 *  reads the same way. Each names what it points AT: a glyph, plus its ref for the upstream and the target.
	 *  A leg with a resolvable tip sha is a jump button; one without degrades to a static indicator (the target
	 *  resolves asynchronously, so it appears a beat later). Tracking counts are deliberately absent — they live
	 *  in the pill's hover, and repeating them here left the upstream as the one leg that never named its ref. */
	private renderRowMarkers(item: OverviewBarItem): unknown {
		// RowMarker legs are PRIMARY-only: a secondary worktree's WIP row already sits on its branch, so it
		// has no row markers to point at — and its lone upstream leg otherwise flickers in and out as the
		// worktree metadata re-resolves. (The primary's legs come from stable host-supplied tips.)
		if (item.isPrimary !== true) return nothing;

		const ahead = item.ahead ?? 0;
		const headSha = item.headSha;
		const upstreamSha = item.upstreamSha;
		// A resolvable upstream tip earns a jump leg; without one, unpushed commits still earn a static leg.
		// Keyed on the tip — never merely on having an upstream — so a MISSING (`[gone]`) upstream, which forces
		// ahead/behind to 0 and resolves no tip, renders no leg naming a remote branch that isn't there.
		const showUpstream = upstreamSha != null || ahead > 0;
		if (headSha == null && !showUpstream && item.targetSha == null && item.targetName == null) return nothing;

		// Tooltips NAME the row-marker role ("HEAD", "upstream", "merge target") rather than just the ref, so a
		// leg says what it IS and not only where it goes — the glyphs alone don't carry that. Same vocabulary
		// as the on-row rail's tooltip, and the ref is kept in parentheses. The "Jump to" prefix is promised
		// only when the leg can actually perform one (`renderLeg` renders a static indicator without a sha).
		const upstreamName = item.upstreamName != null ? shortRefName(item.upstreamName) : undefined;
		const upstreamRef = upstreamName != null ? ` (${upstreamName})` : '';
		const upstreamLabel = upstreamSha != null ? `Jump to Upstream${upstreamRef}` : `Upstream${upstreamRef}`;
		// The remote alone (`origin`) when the upstream tracks a same-named branch — the pill already shows that
		// name. Otherwise the full `origin/other`. Same rule as the graph ref pills' upstream segment, so the
		// two surfaces agree.
		let upstreamLegLabel = upstreamName;
		if (upstreamName != null) {
			const remote = getRemoteNameFromBranchName(upstreamName);
			if (remote.length > 0 && getBranchNameWithoutRemote(upstreamName) === item.branch) {
				upstreamLegLabel = remote;
			}
		}

		return html`<span class="pill__legs"
			>${
				headSha != null
					? this.renderLeg(
							'head',
							headSha,
							`Jump to HEAD (${item.branch})`,
							// Legs are primary-only (see the bail above), so this is always the CURRENT worktree's
							// HEAD — the same `vm-active` glyph the graph's current-branch ref pill uses.
							html`<code-icon icon="vm-active"></code-icon>`,
						)
					: nothing
			}${
				showUpstream
					? this.renderLeg(
							'upstream',
							upstreamSha,
							upstreamLabel,
							html`<code-icon icon=${providerIconName(item.providerIcon)}></code-icon>${
									upstreamLegLabel != null
										? html`<span class="pill__leg-label">${upstreamLegLabel}</span>`
										: nothing
								}`,
						)
					: nothing
			}${
				item.targetSha != null || item.targetName != null
					? this.renderLeg(
							'target',
							item.targetSha,
							item.targetName != null
								? `Jump to Merge Target (${shortRefName(item.targetName)})`
								: 'Merge Target',
							html`<code-icon icon="gl-merge-target"></code-icon>${
									item.targetName != null
										? html`<span class="pill__leg-label">${shortRefName(item.targetName)}</span>`
										: nothing
								}`,
						)
					: nothing
			}</span
		>`;
	}

	/** One leg — a managed-focus jump button when its tip sha is known, else a static indicator. Only the
	 *  button carries `--jump`, which is what the keyboard model treats as a roving stop, so an indicator
	 *  is never an arrow-key destination.
	 *
	 *  Wrapped in `<gl-tooltip>` (not the pill's `<gl-popover>`, which is reserved for the rich branch
	 *  hover): a native `title` never shows on keyboard focus and can't be dismissed with Escape, both of
	 *  which the tooltip does — and the legs ARE keyboard destinations. `gl-tooltip` is `display: contents`,
	 *  so the leg itself stays the flex item of `.pill__legs`. `aria-label` stays on the control and mirrors
	 *  the tooltip text, so the leg reads the same whether or not the tooltip is rendered. */
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

	// Stable handlers (bound once) that read the pill id off the popover's `data-id`, so the template
	// doesn't allocate a fresh closure per pill per render and re-bind every listener each time.
	private readonly onHoverShow = (e: Event): void => {
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
		const id = (e.currentTarget as HTMLElement).dataset.id;
		// Only clear if this pill is still the open one — popovers close each other, so a stale
		// after-hide from the pill we just moved off of must not blank the one we moved onto.
		if (id != null && this.openHoverId === id) {
			this.openHoverId = undefined;
		}
	};
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-overview-bar': GlGraphOverviewBar;
	}
}
