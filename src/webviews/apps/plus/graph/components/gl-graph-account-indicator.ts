import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import {
	getSubscriptionEntitlement,
	getSubscriptionPlanName,
	isSubscriptionTrial,
} from '../../../../../plus/gk/utils/subscription.utils.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { GlPopover } from '../../../shared/components/overlays/popover.js';
import { focusOutlineButton } from '../../../shared/components/styles/lit/a11y.css.js';
import type { OnboardingState } from '../../../shared/contexts/onboarding.js';
import { getActiveWalkthrough, onboardingContext } from '../../../shared/contexts/onboarding.js';
import type { SubscriptionContextState } from '../../../shared/contexts/subscription.js';
import { subscriptionContext } from '../../../shared/contexts/subscription.js';
import { accountRingStyles } from '../../shared/components/accountRing.css.js';
import { ruleStyles } from '../../shared/components/vscode.css.js';
import { actionButton } from '../styles/graph.css.js';
import '../../../shared/components/avatar/avatar.js';
import '../../../shared/components/badges/badge.js';
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

type AccountRingState = 'loading' | 'unpaid' | 'trial' | 'paid';
/** Tier names the account panel uses, plus the trial variant it substitutes for an in-trial plan. */
type PlanLabel = ReturnType<typeof getSubscriptionPlanName> | 'Pro Trial';

/**
 * Accessible names for the pill. The avatar's ring is a color-only signal, so the bucket it encodes has to
 * reach the accessible name too. The entitled buckets instead interpolate the real tier (see `render`) —
 * `aria-label` overrides element content, so a Business customer reading "Business" under a name of
 * "GitLens Pro" would be unmatchable by voice control. The trial countdown is deliberately absent; that
 * lives in the rollup, one hover away.
 */
/**
 * Short tier codes for the header badge — the toolbar can't spare the room for "Enterprise". The full tier
 * still reaches the accessible name (see `render`), and the badge itself is `aria-hidden`, so these are a
 * visual shorthand rather than a label and nothing depends on a screen reader deciphering them.
 */
const planAbbreviations: Record<PlanLabel, string> = {
	// Spelled out where the others are clipped — a countdown state is worth the extra characters.
	'Pro Trial': 'TRIAL',
	Pro: 'PRO',
	Advanced: 'ADV',
	Business: 'BIZ',
	Enterprise: 'ENT',
	Student: 'STU',
	// Unreachable — the badge only renders for the entitled buckets — but keeps the map exhaustive.
	Community: 'COM',
};

const accountButtonLabels: Record<AccountRingState, string> = {
	loading: 'Account',
	unpaid: 'Account — no active GitLens Pro plan',
	trial: 'Account — GitLens Pro Trial',
	paid: 'Account — GitLens Pro',
};

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
		accountRingStyles,
		ruleStyles,
		css`
			:host {
				display: inline-flex;
			}

			/* Account pill: the avatar carries a state ring (which entitlement is active) plus an
			   always-visible chevron signposting that the pill opens something. The ring is painted with
			   box-shadow on the avatar part — same technique as the Visual History rail avatars
			   (timeline/components/chart.ts) — so it takes no layout space and can never nudge the chevron
			   as the subscription resolves. Emphasis is inverted against tier: it tracks how much the user
			   needs to act, so unpaid (the upsell) is boldest and paid is calmest. */
			.account-button {
				/* 2rem, down from 2.2rem: the boldest ring is 0.2rem, and 2rem + 2 × 0.2rem = 2.4rem leaves
				   0.1rem of clearance inside the pill's 2.6rem box instead of sitting flush on its edge. */
				--gl-avatar-size: 2rem;

				/* The ring spends 0.2rem of the shared 0.5rem grid gap, so widen it to keep the apparent
				   avatar-to-chevron gap at what the Start-menu pill's icon/chevron pair reads at. */
				gap: var(--gl-space-8);
			}

			/* gl-avatar's host is inline-block, so its box is a line box: against the pill's 2.2rem strut the
			   circle rides slightly low, which an unringed avatar hides but a ring exposes as unequal
			   clearance. A grid host has no line layout, so the host box IS the circle. Local override —
			   gl-avatar is unchanged for other consumers. */
			.account-button gl-avatar {
				display: grid;
			}

			/* The slotted avatar-less glyph inherits line-height 2.2rem from the .action-button code-icon rule.
			   At a 2rem circle that 22px box would hit the automatic minimum size and stretch the circle
			   into an oval, so pin the glyph's own box. */
			.account-button gl-avatar code-icon {
				line-height: 1;
			}

			.account-button gl-avatar::part(avatar) {
				/* Belt-and-braces against the same automatic-minimum-size trap. */
				min-height: 0;

				/* --vscode-contrastBorder is only set in VS Code's own high-contrast themes, which
				   @media (forced-colors) misses, so this collapses the ramp to one ring there. Nothing is
				   lost — the state is in the button's accessible name. */
				box-shadow: 0 0 0 var(--gl-account-ring-width)
					var(--vscode-contrastBorder, var(--gl-account-ring-color));

				/* The shared avatar zooms on hover (it's normally a standalone link); here it's the header
				   button's glyph, so it must sit still like every other icon in the toolbar row. */
				transform: none;

				/* Softens the loading → resolved handoff into a fade instead of a snap. */
				transition: box-shadow var(--gl-duration-fast) var(--gl-ease-out);
			}

			/* Tier badge, shown only when the titlebar row has room to spare (see the container query below).
			   Neutral by default: TRIAL is a STATUS word, and the account panel deliberately keeps status
			   neutral so an upgrade and a countdown don't read as the same kind of claim — only a real tier
			   takes the accent (below). Leaving TRIAL neutral also stops it competing with its own amber ring.

			   gl-badge's host sets no display of its own, so it would blockify to a box sized by the pill's
			   inherited 2.2rem strut and baseline-place the badge inside it, riding low. Giving the host a
			   display makes its box the badge itself, so the button's align-items can center it. */
			.plan-badge {
				display: none;
				align-items: center;
			}

			/* The accent belongs to TIER — what was bought — matching the account panel's .plan-tier. */
			.account-button[data-entitlement='paid'] .plan-badge {
				--gl-badge-color: var(--vscode-textLink-foreground);
			}

			/* Squared off and tightened from gl-badge's pill default, mirroring how the account panel re-shapes
			   its title badge: at toolbar size the ellipse reads as a control beside the avatar rather than a
			   label on it.

			   line-height sets the badge's height here — the badge would otherwise inherit the pill's 2.2rem
			   strut and pad out to the full pill height. Collapsing to 1 is safe because every tier code is
			   all-caps with no descenders, but it also leaves the caps sitting on the box's floor, so the
			   bottom padding buys back the room the missing descenders would have occupied and optically
			   centers the text. align-items centers the anonymous text item, which gl-badge's inline-flex
			   would otherwise stretch. */
			.plan-badge::part(base) {
				align-items: center;
				padding: 0 var(--gl-space-4) var(--gl-space-2);
				line-height: 1;
				border-radius: var(--gl-radius-sm);
			}

			/* Container queries resolve through shadow boundaries by flat-tree ancestry, so this reaches the
			   graph-titlebar container declared on the row in styles/header.css.ts. No feedback loop: the
			   row's inline size comes from the webview width, not from this label. */
			@container graph-titlebar (min-width: 70rem) {
				.account-button[data-entitlement='trial'] .plan-badge,
				.account-button[data-entitlement='paid'] .plan-badge {
					display: inline-flex;
				}
			}

			/* Always visible so the pill reads as "opens something", but dimmed at rest so it never competes
			   with the avatar. Opacity rather than a foreground token, so it dims whatever color the pill
			   inherits. */
			.account-button .action-button__more {
				opacity: 0.55;
				transition: opacity var(--gl-duration-fast) var(--gl-ease-out);
			}

			/* One selector list for all three "engaged" signals: pointer hover, keyboard focus, and the
			   rollup actually being open. gl-popover reflects its open attribute and triggers on hover+focus, so
			   the pill can be open while the pointer sits on the panel rather than the button — without
			   this the ring would dim under its own popover. */
			.account-button:hover .action-button__more,
			.account-button:focus-visible .action-button__more,
			gl-popover[open] .account-button .action-button__more {
				opacity: 1;
			}

			.account-button:hover,
			.account-button:focus-visible,
			gl-popover[open] .account-button {
				--gl-account-ring-color: var(--color-foreground--85);
			}

			/* Engaged states drop the mute rather than changing hue — the ring brightens to full strength. */
			.account-button[data-entitlement='trial']:hover,
			.account-button[data-entitlement='trial']:focus-visible,
			gl-popover[open] .account-button[data-entitlement='trial'] {
				--gl-account-ring-color: var(--gl-account-ring-expiring);
			}

			.account-button[data-entitlement='unpaid']:hover,
			.account-button[data-entitlement='unpaid']:focus-visible,
			gl-popover[open] .account-button[data-entitlement='unpaid'] {
				--gl-account-ring-color: var(--gl-account-ring-available);
			}

			/* .action-button has no :focus-visible rule of its own, so this pill falls back to the UA ring.
			   Match the header's gl-buttons rather than the inset chip ring: the offset keeps the focus
			   outline clear of the avatar's own ring instead of stacking two strokes 1px apart. */
			.account-button:focus-visible {
				${focusOutlineButton}
			}

			/* Forced-colors mode drops box-shadow, which would erase the ring. Repaint it as an outline —
			   also layout-free, also radius-following, and it survives. */
			@media (forced-colors: active) {
				.account-button gl-avatar::part(avatar) {
					outline: 0.1rem solid ButtonBorder;
					outline-offset: 0.1rem;
				}
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

	/**
	 * Entitlement bucket behind the avatar's ring. Emphasis tracks how much the user needs to act, not tier
	 * prestige, so `unpaid` (the upsell) is boldest and `paid` calmest — a paying customer shouldn't wear a
	 * permanent badge.
	 *
	 * `loading` renders the same calm hairline as `paid`: the subscription context is populated by an async
	 * RPC after first paint (`gl-graph-app` `initAccountContexts`), so an unpaid-by-default mapping would
	 * flash the boldest ring at every paying customer on every cold load. `'unknown'` lands here too — if we
	 * can't read a state we don't assert one.
	 */
	private get ringState(): AccountRingState {
		const subscription = this._subscription?.subscription.get();
		if (subscription == null) return 'loading';

		return getSubscriptionEntitlement(subscription.state) ?? 'loading';
	}

	/** Tier label for the badge, in the same vocabulary the account panel uses so the two can't disagree. */
	private get planLabel(): PlanLabel | undefined {
		const subscription = this._subscription?.subscription.get();
		if (subscription == null) return undefined;

		if (isSubscriptionTrial(subscription)) {
			return subscription.plan.effective.id === 'student' ? 'Student' : 'Pro Trial';
		}

		return getSubscriptionPlanName(subscription.plan.actual.id);
	}

	override render(): unknown {
		const avatar = this._subscription?.avatar.get();
		const state = this.ringState;
		const plan = state === 'trial' || state === 'paid' ? this.planLabel : undefined;

		return html`<gl-popover placement="bottom-end" trigger="hover focus" ?arrow=${false} .distance=${0}>
			<button
				class="action-button account-button"
				slot="anchor"
				type="button"
				data-entitlement=${state}
				aria-haspopup="dialog"
				aria-label=${plan != null ? `Account — GitLens ${plan}` : accountButtonLabels[state]}
				@click=${this.onClick}
			>
				<gl-avatar .src=${avatar ?? undefined}><code-icon icon="gl-gitlens" size="14"></code-icon></gl-avatar>
				${
					plan != null
						? html`<gl-badge class="plan-badge" aria-hidden="true">${planAbbreviations[plan]}</gl-badge>`
						: nothing
				}
				<code-icon class="action-button__more" icon="chevron-down" aria-hidden="true"></code-icon>
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
		this.dispatchEvent(
			new CustomEvent('gl-show-account-modal', {
				bubbles: true,
				composed: true,
			}),
		);
	};
}
