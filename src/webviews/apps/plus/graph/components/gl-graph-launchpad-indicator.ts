import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { LaunchpadCommandArgs } from '../../../../../plus/launchpad/launchpad.js';
import type { LaunchpadSummaryResult } from '../../../../../plus/launchpad/launchpadIndicator.js';
import { ruleStyles } from '../../shared/components/vscode.css.js';
import type { GraphLaunchpadState } from '../graphLaunchpadState.js';
import { graphLaunchpadContext } from '../graphLaunchpadState.js';
import { actionButton } from '../styles/graph.css.js';
import './gl-launchpad-summary.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/popover.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-launchpad-indicator': GlGraphLaunchpadIndicator;
	}
}

type CountGroup = { total: number; label: string };
/** Mutually-exclusive rocket overlay: a centered spinner, or a corner-badge codicon name. */
type RocketOverlay = 'spinner' | 'plug' | 'circle-slash';

/**
 * Graph header Launchpad presence — replaces the old rocket + Home buttons. The rocket is the only glyph;
 * shared-store state rides on it as a bottom-right corner badge sharing one grid cell, so the pill is the
 * same width in every state: a spinning loader (resolving), a `plug` (not connected), a `circle-slash`
 * (error), or a severity dot (connected, actionable PRs). Clicking opens a popover with the full summary
 * (`gl-launchpad-summary`) and an "Open Launchpad" action.
 *
 * Data comes from the shared {@link graphLaunchpadContext} store owned by `gl-graph-app` — this
 * component never fetches.
 */
@customElement('gl-graph-launchpad-indicator')
export class GlGraphLaunchpadIndicator extends SignalWatcher(LitElement) {
	static override styles = [
		actionButton,
		ruleStyles,
		css`
			:host {
				display: inline-flex;
			}

			/* One grid cell holds the rocket and every state overlay (spinner, badge, dot), so no state changes the pill's width. */
			.rocket {
				display: inline-grid;
			}

			/* line-height: 1 collapses the cell to the rocket's own 1.6rem glyph box, so overlays anchor to the
	   glyph instead of the pill's 2.2rem line box (the .action-button code-icon rule). The :is() bump
	   beats that rule on specificity rather than on static-styles ordering. */
			.rocket code-icon:is(.rocket__icon, .rocket__badge) {
				grid-area: 1 / 1;
				line-height: 1;
			}

			/* 1.2rem corner badge overhanging the rocket's bottom-right — the one slot every state overlay uses
	   (spinner, plug, circle-slash). Negative margins, not translate: the spin animation owns transform,
	   so a translate here would fight it and the badge would bob instead of spin. */
			.rocket__badge {
				--code-icon-size: 1.2rem;

				place-self: end end;
				margin-right: -0.1rem;
				margin-bottom: -0.1rem;
				pointer-events: none;
			}

			/* Punch a hole in the rocket behind the badge rather than backing the badge with an opaque chip: the
	   pill is transparent at rest and tinted on hover, and a cutout tracks neither. Geometry resolves in
	   the rocket's own em box (1em = 1.6rem): the 1.2rem badge centers 0.69em in from each edge, so a
	   0.4em radius clears it. Only applied with a badge present, so a lone rocket isn't notched. */
			.rocket__icon--badged {
				--gl-launchpad-badge-cutout: radial-gradient(circle 0.4em at 0.69em 0.69em, transparent 96%, #000 100%);

				-webkit-mask-image: var(--gl-launchpad-badge-cutout);
				mask-image: var(--gl-launchpad-badge-cutout);
			}

			.dot {
				z-index: 1;
				grid-area: 1 / 1;
				place-self: end end;
				width: 0.6rem;
				aspect-ratio: 1;
				pointer-events: none;
				background-color: var(--gl-launchpad-dot-color);
				border-radius: 100%;

				/* +40% (not -10%) because the cell is the glyph's 1.6rem box, not the 2.2rem line box — same rendered position. */
				transform: translate(48%, 40%);
			}

			.dot--blocked {
				--gl-launchpad-dot-color: var(--vscode-gitlens-launchpadIndicatorBlockedColor);
			}

			.dot--attention {
				--gl-launchpad-dot-color: var(--vscode-gitlens-launchpadIndicatorAttentionColor);
			}

			.popover__header {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				justify-content: space-between;
				padding: var(--gl-space-4) var(--gl-space-8) 0;
			}

			.popover__heading {
				margin: 0;
				font-size: var(--gl-font-sm);
				font-weight: 500;
				color: var(--color-foreground--65);
				text-transform: uppercase;
				letter-spacing: 0.05em;
			}

			.popover__body {
				padding: 0 var(--gl-space-8) var(--gl-space-4);
			}

			/* Not-connected welcome blurb — constrain width so the popover wraps to a readable column instead of stretching to the single-line max-content width. */
			.welcome {
				max-width: 26rem;
				margin: 0 0 var(--gl-space-6);
				font-size: var(--gl-font-md);
				line-height: 1.4;
				color: var(--vscode-foreground);
			}

			.popover__footer {
				padding: var(--gl-space-4) var(--gl-space-8) var(--gl-space-8);
			}

			@media (prefers-reduced-motion: reduce) {
				/* Outer-tree rule wins over code-icon's own :host([modifier='spin']) animation. */
				.rocket code-icon[modifier='spin'] {
					animation: none;
				}
			}
		`,
	];

	@consume({ context: graphLaunchpadContext, subscribe: true })
	private _state?: GraphLaunchpadState;

	private get summary(): LaunchpadSummaryResult | { error: Error } | undefined {
		return this._state?.summary.get();
	}

	override render(): unknown {
		const connected = this._state?.connected.get();
		const overlay = this.overlay;

		return html`<gl-popover placement="bottom" trigger="hover focus" ?arrow=${false} .distance=${0}>
			<a
				class="action-button"
				slot="anchor"
				href=${this.openLaunchpadLink}
				aria-haspopup="dialog"
				aria-label=${this.buttonLabel}
				aria-busy=${this._state?.loading.get() ?? false}
			>
				<span class="rocket">
					<code-icon
						class="rocket__icon${overlay != null ? ' rocket__icon--badged' : ''}"
						icon="rocket"
					></code-icon>
					${this.renderOverlay(overlay)}${this.renderDot(connected)}
				</span>
			</a>
			<div slot="content">
				<div class="popover__header">
					<h3 class="popover__heading">Launchpad</h3>
					<gl-button
						appearance="toolbar"
						density="compact"
						tooltip="Refresh Launchpad"
						?disabled=${this._state?.loading.get() ?? false}
						aria-busy=${this._state?.loading.get() ?? false}
						@click=${() => this._state?.refresh()}
					>
						<code-icon icon="refresh"></code-icon>
					</gl-button>
				</div>
				<div class="popover__body">
					${
						connected !== true
							? html`<p class="welcome">
									Launchpad organizes your pull requests into actionable groups to help you focus and
									keep your team unblocked.
								</p>`
							: nothing
					}
					<gl-launchpad-summary
						.summary=${this.summary}
						?has-integrations-connected=${connected === true}
						source="graph-header"
					></gl-launchpad-summary>
				</div>
				<div class="popover__footer">
					<gl-button full appearance="secondary" href=${this.openLaunchpadLink}>Open Launchpad</gl-button>
				</div>
			</div>
		</gl-popover>`;
	}

	/**
	 * Mutually-exclusive rocket overlay, in the same precedence {@link buttonLabel} uses: not-connected wins
	 * over an in-flight first load, which wins over a failed load. `undefined` leaves the rocket to
	 * {@link renderDot}.
	 */
	private get overlay(): RocketOverlay | undefined {
		if (this._state?.connected.get() === false) return 'plug';

		const summary = this.summary;
		// Still resolving — spin only while a fetch is in flight (avoids a bare rocket flash before one starts).
		if (summary == null) return (this._state?.loading.get() ?? false) ? 'spinner' : undefined;

		if (!('total' in summary)) return 'circle-slash';

		// Connected — actionable presence is surfaced by the severity dot on the rocket (see renderDot).
		return undefined;
	}

	/**
	 * State overlay as a corner badge on the rocket — a spinning loader while resolving, otherwise the
	 * failure glyph. Shares the rocket's grid cell, so no state widens the pill.
	 */
	private renderOverlay(overlay: RocketOverlay | undefined): unknown {
		if (overlay == null) return nothing;

		const spinning = overlay === 'spinner';
		return html`<code-icon
			class="rocket__badge"
			icon=${spinning ? 'loading' : overlay}
			modifier=${spinning ? 'spin' : ''}
			aria-hidden="true"
		></code-icon>`;
	}

	/**
	 * Severity dot overlaid on the rocket, replacing the old per-group counts: red when anything is
	 * blocked, otherwise yellow when there's other actionable work (mergeable / follow-up / needs review),
	 * and nothing when disconnected, resolving, errored, or all caught up.
	 */
	private renderDot(connected: boolean | undefined): unknown {
		if (connected !== true) return nothing;

		const summary = this.summary;
		if (summary == null || !('total' in summary)) return nothing;

		if ((summary.blocked?.total ?? 0) > 0) {
			return html`<span class="dot dot--blocked" aria-hidden="true"></span>`;
		}

		const actionable =
			(summary.mergeable?.total ?? 0) + (summary.followUp?.total ?? 0) + (summary.needsReview?.total ?? 0);
		if (actionable > 0) {
			return html`<span class="dot dot--attention" aria-hidden="true"></span>`;
		}

		return nothing; // connected & all caught up → rocket alone
	}

	private getCountGroups(summary: LaunchpadSummaryResult): CountGroup[] {
		const groups: CountGroup[] = [
			{ total: summary.mergeable?.total ?? 0, label: 'can be merged' },
			{ total: summary.blocked?.total ?? 0, label: 'blocked' },
			{ total: summary.followUp?.total ?? 0, label: 'need follow-up' },
			{ total: summary.needsReview?.total ?? 0, label: 'need your review' },
		];
		return groups.filter(g => g.total > 0);
	}

	private get buttonLabel(): string {
		// The badges and spinner are decorative, so every state has to be distinguishable here or a screen
		// reader hears the same bare "Launchpad" for loading, not-connected, and failure alike.
		switch (this.overlay) {
			case 'plug':
				return 'Launchpad — connect an integration to see pull requests';
			case 'spinner':
				return 'Launchpad — loading';
			case 'circle-slash':
				return 'Launchpad — unable to load pull requests';
		}

		const summary = this.summary;
		if (summary == null || !('total' in summary)) return 'Launchpad';

		const groups = this.getCountGroups(summary);
		if (groups.length === 0) return 'Launchpad — all caught up';

		return `Launchpad — ${groups.map(g => `${g.total} ${g.label}`).join(', ')}`;
	}

	private get openLaunchpadLink(): string {
		return `command:gitlens.showLaunchpad?${encodeURIComponent(
			JSON.stringify({ source: 'graph-header' } satisfies Omit<LaunchpadCommandArgs, 'command'>),
		)}`;
	}
}
