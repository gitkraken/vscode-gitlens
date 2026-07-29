import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { GlPopover } from '../../../shared/components/overlays/popover.js';
import type { OnboardingState } from '../../../shared/contexts/onboarding.js';
import { getActiveWalkthrough, onboardingContext } from '../../../shared/contexts/onboarding.js';
import type { SubscriptionContextState } from '../../../shared/contexts/subscription.js';
import { subscriptionContext } from '../../../shared/contexts/subscription.js';
import { ruleStyles } from '../../shared/components/vscode.css.js';
import { actionButton } from '../styles/graph.css.js';
import '../../../shared/components/avatar/avatar.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/progress-ring.js';
import '../../shared/components/account-chip.js';
import '../../shared/components/integrations-chip.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-account-indicator': GlGraphAccountIndicator;
	}
}

/**
 * Graph header account pill — collapses the old account bar down to an avatar. Hovering opens a rollup
 * popover (account summary + walkthrough progress + integration icons); clicking opens the full account
 * modal via `gl-show-account-modal` (handled by `gl-graph-app`).
 *
 * Consumes the shared subscription + onboarding contexts owned by `gl-graph-app`.
 */
@customElement('gl-graph-account-indicator')
export class GlGraphAccountIndicator extends SignalWatcher(LitElement) {
	static override styles = [
		actionButton,
		ruleStyles,
		css`
			:host {
				display: inline-flex;
			}

			.account-button {
				--gl-avatar-size: 2.2rem;
			}

			/* The shared avatar zooms on hover (it's normally a standalone link); here it's the header
			   button's glyph, so it must sit still like every other icon in the toolbar row. */
			.account-button gl-avatar::part(avatar) {
				transform: none;
			}

			.rollup {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
				min-width: 30rem;
				max-width: 34rem;
				padding: var(--gl-space-4);
			}

			.rollup__section {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-4);
			}

			.rollup__heading {
				margin: 0;
				font-size: var(--gl-font-sm);
				font-weight: 500;
				color: var(--color-foreground--65);
				text-transform: uppercase;
				letter-spacing: 0.05em;
			}

			.rollup__walkthrough {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				padding: var(--gl-space-4);
				color: inherit;
				text-decoration: none;
				border-radius: var(--gl-radius-sm);
			}

			.rollup__walkthrough:hover {
				background: var(--vscode-toolbar-hoverBackground);
			}

			hr {
				width: 100%;
				margin: 0;
				border: none;
				border-top: var(--gl-border-width) solid var(--color-foreground--25);
			}
		`,
	];

	@consume({ context: subscriptionContext, subscribe: true })
	private _subscription?: SubscriptionContextState;

	@consume({ context: onboardingContext, subscribe: true })
	private _onboarding?: OnboardingState;

	@query('gl-popover')
	private _popover?: GlPopover;

	override render(): unknown {
		const avatar = this._subscription?.avatar.get();

		return html`<gl-popover placement="bottom-end" trigger="hover focus" ?arrow=${false} .distance=${0}>
			<button
				class="action-button account-button"
				slot="anchor"
				type="button"
				aria-haspopup="dialog"
				aria-label="Account"
				@click=${this.onClick}
			>
				<gl-avatar .src=${avatar ?? undefined}><code-icon icon="gl-gitlens"></code-icon></gl-avatar>
			</button>
			<div slot="content" class="rollup">
				<gl-account-chip display="panel"></gl-account-chip>
				${this.renderWalkthrough()}
				<hr />
				<div class="rollup__section">
					<p class="rollup__heading">AI / Agents</p>
					<gl-integrations-chip display="ai-icons"></gl-integrations-chip>
				</div>
				<div class="rollup__section">
					<p class="rollup__heading">Integrations</p>
					<gl-integrations-chip display="icons"></gl-integrations-chip>
				</div>
			</div>
		</gl-popover>`;
	}

	private renderWalkthrough(): unknown {
		if (this._onboarding == null) return nothing;

		// The rollup mirrors the header pill — only the active walkthrough; the modal shows both
		const active = getActiveWalkthrough(this._onboarding);
		if (active == null) return nothing;

		const graph = active.mode === 'graph';
		const { progress } = active;
		return html`<hr />
			<a
				class="rollup__walkthrough"
				href=${createCommandLink('gitlens.showWelcomeView', graph ? { mode: 'graph' } : undefined)}
			>
				<gl-progress-ring
					count-placement="sr-only"
					.value=${progress.doneCount}
					.max=${progress.allCount}
				></gl-progress-ring>
				<span>${graph ? 'Graph' : 'GitLens'} Walkthrough ${progress.doneCount}/${progress.allCount}</span>
			</a>`;
	}

	private onClick = (e: MouseEvent): void => {
		e.preventDefault();
		void this._popover?.hide();
		this.dispatchEvent(new CustomEvent('gl-show-account-modal', { bubbles: true, composed: true }));
	};
}
