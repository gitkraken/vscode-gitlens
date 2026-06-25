import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { LaunchpadCommandArgs } from '../../../../../plus/launchpad/launchpad.js';
import type { LaunchpadSummaryResult } from '../../../../../plus/launchpad/launchpadIndicator.js';
import { ruleStyles } from '../../shared/components/vscode.css.js';
import { actionButton } from '../styles/graph.css.js';
import type { GraphLaunchpadState } from '../graphLaunchpadState.js';
import { graphLaunchpadContext } from '../graphLaunchpadState.js';
import './gl-launchpad-summary.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/popover.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-launchpad-indicator': GlGraphLaunchpadIndicator;
	}
}

type CountGroup = { total: number; icon: string; cls: string; label: string };

/**
 * Graph header Launchpad presence — replaces the old rocket + Home buttons. Always leads with the
 * rocket; the trailing element reflects the shared store state: per-group counts (connected, has
 * actionable PRs), a spinning loader, a `plug` (not connected), or a `circle-slash` (error). Clicking
 * opens a popover with the full summary (`gl-launchpad-summary`) and an "Open Launchpad" action.
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

			.counts {
				display: inline-flex;
				gap: var(--gl-space-6);
				align-items: center;
			}

			.count {
				display: inline-flex;
				gap: 0.2rem;
				align-items: center;
				font-size: var(--gl-font-md);
				font-variant-numeric: tabular-nums;
				color: var(--gl-launchpad-item-color, inherit);
			}

			.count--mergeable {
				--gl-launchpad-item-color: var(--vscode-gitlens-launchpadIndicatorMergeableColor);
			}

			.count--blocked {
				--gl-launchpad-item-color: var(--vscode-gitlens-launchpadIndicatorBlockedColor);
			}

			.count--attention {
				--gl-launchpad-item-color: var(--vscode-gitlens-launchpadIndicatorAttentionColor);
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

			/* Not-connected welcome blurb — constrain width so the popover wraps to a readable column
			   instead of stretching to the single-line max-content width. */
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
		`,
	];

	@consume({ context: graphLaunchpadContext, subscribe: true })
	private _state?: GraphLaunchpadState;

	private get summary(): LaunchpadSummaryResult | { error: Error } | undefined {
		return this._state?.summary.get();
	}

	override render(): unknown {
		const connected = this._state?.connected.get();

		return html`<gl-popover placement="bottom" trigger="click focus" ?arrow=${false} distance=${0}>
			<button
				type="button"
				class="action-button"
				slot="anchor"
				aria-haspopup="dialog"
				aria-label=${this.buttonLabel}
			>
				<code-icon icon="rocket"></code-icon>
				${this.renderTrailing(connected)}
			</button>
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
					${connected !== true
						? html`<p class="welcome">
								Launchpad organizes your pull requests into actionable groups to help you focus and keep
								your team unblocked.
							</p>`
						: nothing}
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

	private renderTrailing(connected: boolean | undefined): unknown {
		if (connected === false) {
			return html`<code-icon icon="plug" aria-hidden="true"></code-icon>`;
		}

		const summary = this.summary;
		if (summary == null) {
			// Still resolving — show a spinner only while a fetch is in flight (avoids a bare rocket flash).
			return (this._state?.loading.get() ?? false)
				? html`<code-icon icon="loading" modifier="spin" aria-hidden="true"></code-icon>`
				: nothing;
		}

		if (!('total' in summary)) {
			return html`<code-icon icon="circle-slash" aria-hidden="true"></code-icon>`;
		}

		const groups = this.getCountGroups(summary);
		if (groups.length === 0) return nothing; // connected & all caught up → rocket alone

		return html`<span class="counts">
			${groups.map(
				g =>
					html`<span class="count count--${g.cls}"
						><code-icon icon=${g.icon} aria-hidden="true"></code-icon>${g.total}</span
					>`,
			)}
		</span>`;
	}

	private getCountGroups(summary: LaunchpadSummaryResult): CountGroup[] {
		const groups: CountGroup[] = [
			{ total: summary.mergeable?.total ?? 0, icon: 'rocket', cls: 'mergeable', label: 'can be merged' },
			{ total: summary.blocked?.total ?? 0, icon: 'error', cls: 'blocked', label: 'blocked' },
			{ total: summary.followUp?.total ?? 0, icon: 'report', cls: 'attention', label: 'need follow-up' },
			{
				total: summary.needsReview?.total ?? 0,
				icon: 'comment-unresolved',
				cls: 'attention',
				label: 'need your review',
			},
		];
		return groups.filter(g => g.total > 0);
	}

	private get buttonLabel(): string {
		const connected = this._state?.connected.get();
		if (connected === false) return 'Launchpad — connect an integration to see pull requests';

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
