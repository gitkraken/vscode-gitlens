import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { OnboardingKeys } from '../../../../../constants.onboarding.js';
import type { RunningOperationExecState } from '../../../plus/graph/components/detailsState.js';
import { chipStateSuffix, statusIconFor } from '../../../plus/graph/components/runningOperationStatus.js';
import { elementBase } from '../styles/lit/base.css.js';
import { modeHeaderStyles, modeToggleStyles } from '../styles/lit/mode.css.js';
import { detailsHeaderStyles } from './gl-details-header.css.js';
import '../chips/action-chip.js';
import '../code-icon.js';
import '../indicators/new-indicator.js';
import '../progress.js';

/** Compose/review live in the details panel as toggle modes. Compare is rendered here too,
 *  as a grouped entry-point chip alongside the toggles (for visual grouping + responsive
 *  label-collapse parity), but it is NOT a `Mode`: it has no active/close state — clicking
 *  it opens a compare sheet over the panel (dispatches `toggle-mode`/'compare'). */
type Mode = 'review' | 'compose' | 'resolve';

const modeConfig: Record<
	Mode,
	{
		icon: string;
		label: string;
		closeLabel: string;
		text: string;
		collapsible: boolean;
		onboardingKey?: OnboardingKeys;
	}
> = {
	compose: {
		icon: 'wand',
		label: 'Compose Changes',
		closeLabel: 'Close',
		text: 'Compose',
		collapsible: true,
		onboardingKey: 'details:compose:buttonCallout',
	},
	review: {
		icon: 'checklist',
		label: 'Review Changes',
		closeLabel: 'Close',
		text: 'Review',
		collapsible: true,
		onboardingKey: 'details:review:buttonCallout',
	},
	resolve: {
		icon: 'gl-merge',
		label: 'Resolve Conflicts',
		closeLabel: 'Close',
		text: 'Resolve Conflicts',
		collapsible: true,
	},
};

@customElement('gl-details-header')
export class GlDetailsHeader extends LitElement {
	static override styles = [elementBase, detailsHeaderStyles, modeHeaderStyles, modeToggleStyles];

	@property() activeMode?: Mode | null;
	@property({ type: Boolean }) loading = false;
	@property({ type: Array }) modes?: Mode[];

	/** When true (and no mode is active), render a Compare entry-point chip in the primary
	 *  action group, after the mode toggles. Not a `Mode` — see the `Mode` type comment. */
	@property({ type: Boolean }) compareEnabled = false;

	/** Per-mode execState + has-result of any running operation at the engaged anchor — drives
	 *  the status-overlay suffix icon on compose/review toggle chips (parallel to the WIP-row
	 *  adornment buttons). `hasResult` distinguishes a `'backed'` entry with a viewable result
	 *  (Restart from success) from a `'backed'`-no-result placeholder (cancelled / first-error
	 *  Go Back) so the chip doesn't falsely advertise a completed run. Set even when `activeMode`
	 *  is null so a toggled-out-but-still-running operation keeps its chip overlay. */
	@property({ attribute: false }) modeStatus?: Partial<
		Record<Mode, { execState: RunningOperationExecState; hasResult: boolean }>
	>;

	/** True when the mode is in its drilled-in "results" sub-state (e.g. review showing
	 *  findings, compose showing a plan). When true, the action cluster gains a Restart
	 *  chip alongside the close — Restart pops back to the scope picker (so the user can
	 *  re-run with different scope) and dispatches `mode-back`, which the host routes to
	 *  the appropriate workflow `.back()` method. Close still exits the mode entirely. */
	@property({ type: Boolean, attribute: 'in-results-view' }) inResultsView = false;

	/** Whether the `actions` slot has any assigned content. Gates the group-separating gap so
	 *  it never reserves trailing space when a consumer (e.g. the comparison panel) slots no
	 *  secondary actions — see `.details-header__actions-secondary` in the stylesheet. */
	@state() private hasActions = false;

	override render() {
		const isModeActive = this.activeMode != null;
		// The mode toggles + Compare form a "center" group, gap-centered between the title and the
		// right-anchored actions slot via two flex spacers. Only render the scaffold when there's
		// something to center; an empty center between two spacers would leave a phantom gap.
		const hasCenter = !isModeActive && ((this.modes?.length ?? 0) >= 1 || this.compareEnabled);

		return html`<div class="details-header mode-header ${isModeActive ? 'mode-header--active' : ''}">
			<div class="details-header__row">
				<div class="details-header__content">
					<slot></slot>
				</div>
				${isModeActive
					? html`<div class="details-header__spacer"></div>
							<div class="details-header__actions">${this.renderCloseButton()}</div>`
					: html`<div class="details-header__spacer"></div>
							${hasCenter
								? html`<div class="details-header__center">
											${this.modes?.length
												? html`<div class="details-header__modes">
														${this.renderModeToggles()}
													</div>`
												: nothing}${this.renderCompareToggle()}
										</div>
										${
											// Trailing spacer only when the actions slot has content — otherwise the
											// center group right-aligns against the empty anchor (comparison panel)
											// instead of floating center-right against zero width.
											this.hasActions ? html`<div class="details-header__spacer"></div>` : nothing
										}`
								: nothing}
							<slot
								name="actions"
								class=${classMap({
									'details-header__actions-secondary': true,
									'has-actions': this.hasActions,
								})}
								@slotchange=${this.onActionsSlotChange}
							></slot>`}
			</div>
			<slot name="secondary"></slot>
			<progress-indicator position="bottom" ?active=${this.loading}></progress-indicator>
		</div>`;
	}

	private renderModeToggles() {
		if (!this.modes?.length) return nothing;

		// In mode: hide every mode-toggle chip. The header title carries the mode identity
		// (e.g. "Composing Changes") and the close button on the right handles exiting. The
		// chip cluster only adds chrome that competes with the verb-led title. Users switch
		// modes via close → re-open from idle.
		if (this.activeMode != null) return nothing;

		return this.modes.map(mode => {
			const config = modeConfig[mode];

			// Collapsible modes show their label (subject to the `@container` collapse rules
			// in `gl-details-header.css.ts`). isActive is always false here — the early-return
			// above covers the in-mode branch.
			const showText = config.collapsible;

			// Status overlay icon for the running operation at the engaged anchor. With the
			// mode chip visible in idle, this is the 1-glance "I have a pending compose /
			// review elsewhere" cue — paired with the per-mode chip coloring below.
			const overlayInfo = this.modeStatus?.[mode];
			const overlayState = overlayInfo?.execState;
			const overlayHasResult = overlayInfo?.hasResult ?? true;
			const overlayIcon = overlayState != null ? statusIconFor(overlayState, overlayHasResult) : null;

			const baseLabel = config.label;
			const label = `${baseLabel}${chipStateSuffix(overlayState, overlayHasResult)}`;

			// When the chip has text, the mode is already named — collapse the two-icon layout
			// (mode icon + overlay suffix) into a single icon by letting the state icon replace
			// the mode icon. When the chip is icon-only (collapsed), keep both so the user can
			// read mode + state.
			const mainIcon = showText && overlayIcon != null ? overlayIcon : config.icon;
			const showSuffixOverlay = !showText && overlayIcon != null;

			const chip = html`<gl-action-chip
				icon=${mainIcon}
				label="${label}"
				overlay="tooltip"
				data-state=${overlayState ?? ''}
				class=${classMap({
					'mode-toggle': true,
					[`mode-toggle--${mode}`]: true,
					'mode-toggle--has-status': overlayState != null,
				})}
				@click=${() => this.handleToggleMode(mode)}
			>
				${showText ? html`<span class="mode-toggle__text">${config.text}</span>` : nothing}
				${showSuffixOverlay
					? html`<code-icon
							slot="suffix"
							icon=${overlayIcon}
							modifier=${overlayIcon === 'loading' ? 'spin' : ''}
						></code-icon>`
					: nothing}
			</gl-action-chip>`;

			return html`<gl-new-indicator key=${ifDefined(config.onboardingKey)}>${chip}</gl-new-indicator>`;
		});
	}

	private handleToggleMode(mode: Mode) {
		// Single-click hide/close. The registry entry persists across hide, the run keeps going
		// (or the completed result stays). The Back-then-close destroy path also fires through
		// here when active is clicked from `'backed'`; the controller side handles the destroy.
		this.dispatchEvent(new CustomEvent('toggle-mode', { detail: { mode: mode }, bubbles: true, composed: true }));
	}

	private renderCompareToggle() {
		if (!this.compareEnabled) return nothing;

		// Grouped with the mode toggles for layout + label-collapse parity, but Compare is not
		// a mode (no active/close state) — it just opens the compare sheet. Its label collapses
		// first (widest `@container` breakpoint in `gl-details-header.css.ts`).
		return html`<gl-new-indicator key="details:compare:buttonCallout">
			<gl-action-chip
				icon="compare-changes"
				label="Compare"
				overlay="tooltip"
				class="mode-toggle mode-toggle--compare"
				@click=${this.handleCompare}
			>
				<span class="mode-toggle__text">Compare</span>
			</gl-action-chip>
		</gl-new-indicator>`;
	}

	private handleCompare = (): void => {
		this.dispatchEvent(
			new CustomEvent('toggle-mode', { detail: { mode: 'compare' }, bubbles: true, composed: true }),
		);
	};

	private onActionsSlotChange(e: Event) {
		this.hasActions = (e.target as HTMLSlotElement).assignedElements().length > 0;
	}

	private renderCloseButton() {
		if (this.activeMode == null) return nothing;

		const config = modeConfig[this.activeMode];
		const closeChip = html`<gl-action-chip
			icon="close"
			label=${config.closeLabel}
			overlay="tooltip"
			class="mode-close"
			@click=${this.handleCloseMode}
		></gl-action-chip>`;

		// Results sub-state: prepend a Restart chip that pops to the scope picker so the user
		// can re-run with a different scope without losing the result (back() snapshots it for
		// forward()). Close still exits the mode entirely.
		if (this.inResultsView) {
			return html`<gl-action-chip
					icon="debug-restart"
					label="Restart"
					overlay="tooltip"
					class="mode-restart"
					@click=${this.handleBack}
				></gl-action-chip
				>${closeChip}`;
		}

		// Idle / scope-picker sub-state: prepend a Refresh chip that re-fetches the picker's
		// underlying data (working changes, branch commits, scope files) so the user can pick
		// up newly-staged work or post-rebase commits without exiting the mode. Hidden while
		// a run is in flight — refreshing scope mid-generation would either be ignored (the
		// run is locked to the scope it started with) or race with the result, so the chip
		// would be misleading.
		const isGenerating = this.modeStatus?.[this.activeMode]?.execState === 'generating';
		if (isGenerating) return closeChip;

		return html`<gl-action-chip
				icon="refresh"
				label="Refresh"
				overlay="tooltip"
				class="mode-refresh"
				@click=${this.handleRefresh}
			></gl-action-chip
			>${closeChip}`;
	}

	private handleCloseMode = (): void => {
		if (this.activeMode == null) return;

		this.dispatchEvent(
			new CustomEvent('toggle-mode', { detail: { mode: this.activeMode }, bubbles: true, composed: true }),
		);
	};

	private handleBack = (): void => {
		if (this.activeMode == null) return;

		this.dispatchEvent(
			new CustomEvent('mode-back', { detail: { mode: this.activeMode }, bubbles: true, composed: true }),
		);
	};

	private handleRefresh = (): void => {
		if (this.activeMode == null) return;

		this.dispatchEvent(
			new CustomEvent('mode-refresh', { detail: { mode: this.activeMode }, bubbles: true, composed: true }),
		);
	};
}
