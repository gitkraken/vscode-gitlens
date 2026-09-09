import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import * as l10n from '@vscode/l10n';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import type { GlPopover } from '@gitlens/components/components/overlays/popover.js';
import { focusableBaseStyles, focusOutlineButton } from '@gitlens/components/components/styles/lit/a11y.css.js';
import { boxSizingBase } from '@gitlens/components/components/styles/lit/base.css.js';
import type { GlExtensionCommands } from '../../../../../constants.commands.js';
import type { SubscriptionPlanIds } from '../../../../../plus/gk/models/subscription.js';
import {
	getSubscriptionEntitlement,
	getSubscriptionPlanName,
	isSubscriptionTrial,
} from '../../../../../plus/gk/utils/subscription.utils.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { AgentsState } from '../../../shared/contexts/agents.js';
import { agentsContext } from '../../../shared/contexts/agents.js';
import type { AIContextState } from '../../../shared/contexts/ai.js';
import { aiContext } from '../../../shared/contexts/ai.js';
import type { IntegrationsState } from '../../../shared/contexts/integrations.js';
import { integrationsContext } from '../../../shared/contexts/integrations.js';
import type { OnboardingState } from '../../../shared/contexts/onboarding.js';
import { getActiveWalkthrough, onboardingContext } from '../../../shared/contexts/onboarding.js';
import type { SubscriptionContextState } from '../../../shared/contexts/subscription.js';
import { subscriptionContext } from '../../../shared/contexts/subscription.js';
import { accountRingStyles } from '../../shared/components/accountRing.css.js';
import { rollupItemStyles } from '../../shared/components/rollupItem.css.js';
import { ruleStyles } from '../../shared/components/vscode.css.js';
import { actionButton } from '../styles/graph.css.js';
import '../../../shared/components/avatar/avatar.js';
import '../../../shared/components/badges/badge.js';
import '../../../shared/components/button.js';
import '@gitlens/components/components/codeIcon.js';
import '@gitlens/components/components/overlays/popover.js';
import '../../../shared/components/progress-ring.js';
import './account/account-chip.js';
import './account/agents-chip.js';
import './account/ai-chip.js';
import './account/integrations-chip.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-account-indicator': GlGraphAccountIndicator;
	}

	interface GlobalEventHandlersEventMap {
		/** Relayed from the account panel's "Send Feedback" action — this indicator has no feedback
		 *  dialog of its own, so it hands the request up to `gl-graph-app`. */
		'gl-graph-show-feedback': CustomEvent<void>;
	}
}

type AccountRingState = 'loading' | 'unpaid' | 'trial' | 'paid';
/** Stable plan identity, including the badge's trial variant. */
type BadgePlanId = SubscriptionPlanIds | 'trial';

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
const planAbbreviations: Record<BadgePlanId, string> = {
	// Spelled out where the others are clipped — a countdown state is worth the extra characters.
	trial: l10n.t({ message: 'TRIAL', comment: ['Short account badge abbreviation for GitLens Pro Trial.'] }),
	pro: l10n.t({ message: 'PRO', comment: ['Short account badge abbreviation for GitLens Pro.'] }),
	advanced: l10n.t({ message: 'ADV', comment: ['Short account badge abbreviation for GitLens Advanced.'] }),
	teams: l10n.t({ message: 'BIZ', comment: ['Short account badge abbreviation for GitLens Business.'] }),
	enterprise: l10n.t({ message: 'ENT', comment: ['Short account badge abbreviation for GitLens Enterprise.'] }),
	student: l10n.t({ message: 'STU', comment: ['Short account badge abbreviation for GitLens Student.'] }),
	// Unreachable — the badge only renders for the entitled buckets — but keeps the map exhaustive.
	'community-with-account': l10n.t({
		message: 'COM',
		comment: ['Short account badge abbreviation for GitLens Community.'],
	}),
	community: l10n.t({ message: 'COM', comment: ['Short account badge abbreviation for GitLens Community.'] }),
};

const accountButtonLabels: Record<AccountRingState, string> = {
	loading: l10n.t('Account'),
	unpaid: l10n.t('Account — no active GitLens Pro plan'),
	trial: l10n.t('Account — GitLens Pro Trial'),
	paid: l10n.t('Account — GitLens Pro'),
};

/**
 * Graph header account pill — collapses the old account bar down to an avatar. Hovering opens a rollup
 * popover (account summary + walkthrough progress + integration icons); clicking navigates to the
 * Account section of the GitLens Settings view.
 *
 * Consumes the shared subscription + onboarding contexts owned by `gl-graph-app`.
 */
@customElement('gl-graph-account-indicator')
export class GlGraphAccountIndicator extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		focusableBaseStyles,
		actionButton,
		accountRingStyles,
		rollupItemStyles,
		ruleStyles,
		css`
			:host {
				display: inline-flex;
			}

			gl-popover {
				--max-width: 85vw;
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

				/* Never gate this on --vscode-contrastBorder: any theme can set it, and setting it to the
   theme's own background is the standard way to suppress VS Code's default hairlines, which
   would paint the ring in the background color and erase the state. High contrast is covered
   by the forced-colors outline below, and the state is in the button's accessible name
   regardless. */
				box-shadow: 0 0 0 var(--gl-account-ring-width) var(--gl-account-ring-color);

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

			/* font-size anchors the whole panel's type scale. The popover has no base size of its own, so
  without this every --gl-font-* here would be measured against the 13px --gl-font-base while
  the panel actually renders at the 12px gl-popover inherits from --wa-tooltip-font-size. Setting
  --gl-font-md states that 12px explicitly, so the scale's steps now sit around what the panel
  really is instead of around a size borrowed from a tooltip. */
			.rollup {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
				/* Comfortable 30rem target, but yield on narrow viewports: the popover body is capped to the
   available viewport width and clips overflow, so a hard min-width would get cut off (≤~650px).
   min-width:0 + max-width:100% lets the rollup shrink to the body instead of overflowing it. */
				width: 30rem;
				min-width: 0;
				max-width: min(34rem, 100%);
				padding: var(--gl-space-4);
				font-size: var(--gl-font-md);
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

	@consume({ context: aiContext })
	private _ai?: AIContextState;

	@consume({ context: agentsContext })
	private _agents?: AgentsState;

	@consume({ context: integrationsContext })
	private _integrations?: IntegrationsState;

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
	private get badgePlanId(): BadgePlanId | undefined {
		const subscription = this._subscription?.subscription.get();
		if (subscription == null) return undefined;

		if (isSubscriptionTrial(subscription)) {
			return subscription.plan.effective.id === 'student' ? 'student' : 'trial';
		}

		return subscription.plan.actual.id;
	}

	/** Mirrors the chip's own skeleton guard: until the subscription resolves, every section renders its
	 *  chip (which shows its own skeleton) rather than a Settings CTA. */
	private get loaded(): boolean {
		return this._subscription?.subscription.get() !== undefined;
	}

	private get hasAccount(): boolean {
		return this._subscription?.subscription.get()?.account != null;
	}

	private get aiEnabled(): boolean {
		const state = this._ai?.state.get();
		return (state?.enabled ?? false) && (state?.orgEnabled ?? false);
	}

	/** Empty ⇒ offer the "Set up AI" CTA alongside the AI chip (see `renderAI`), and suppress the Agents
	 *  section entirely (see `renderAgents`). */
	private get aiEmpty(): boolean {
		if (!this.loaded) return false;

		return !(this.aiEnabled && this._ai?.model.get() != null);
	}

	/** The roster hasn't arrived yet — distinct from an empty one. It's seeded at `gl-graph-app` init, so this
	 *  window is brief, but a heading over nothing looks broken where a delay looks like nothing at all. */
	private get agentsUnloaded(): boolean {
		return this._agents?.agents.get() === undefined;
	}

	/** Empty ⇒ render the "Set up agents" CTA instead of the roster: the roster has loaded and holds no
	 *  detected agent. Undetected rows are excluded here for the same reason the chip drops them — a roster of
	 *  agents the user doesn't have installed is a catalogue, not a status. */
	private get agentsEmpty(): boolean {
		if (!this.loaded || this.agentsUnloaded) return false;

		return !(this._agents?.agents.get() ?? []).some(a => a.detected !== false);
	}

	/** Empty ⇒ render the "Set up integrations" CTA instead of the Integrations chip. */
	private get integrationsEmpty(): boolean {
		if (!this.loaded) return false;

		const integrations = this._integrations?.integrations.get() ?? [];
		return !(this.hasAccount && integrations.some(i => i.connected));
	}

	override render(): unknown {
		const avatar = this._subscription?.avatar.get();
		const state = this.ringState;
		const plan = state === 'trial' || state === 'paid' ? this.badgePlanId : undefined;

		return html`<gl-popover placement="bottom-end" trigger="focus click" ?arrow=${false} .distance=${0}>
			<button
				class="action-button account-button"
				type="button"
				slot="anchor"
				aria-haspopup="true"
				data-entitlement=${state}
				aria-label=${plan != null ? l10n.t('Account — GitLens {plan}', { plan: plan === 'trial' ? l10n.t('Pro Trial') : getSubscriptionPlanName(plan) }) : accountButtonLabels[state]}
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
				<gl-account-chip
					display="panel"
					settings-nav
					feedback
					@gl-account-chip-feedback=${this.handleFeedbackClick}
				></gl-account-chip>
				${this.renderWalkthrough()}
				<hr />
				${this.renderAI()} ${this.renderAgents()}
				<div class="rollup__section">
					<p class="rollup__heading">${l10n.t('Integrations')}</p>
					${
						this.integrationsEmpty
							? this.renderSetupCta(
									'gitlens.showSettingsPage!integrations',
									l10n.t('Set up integrations'),
								)
							: html`<a
									class="rollup__item"
									href=${createCommandLink('gitlens.showSettingsPage!integrations')}
									aria-label="Integrations — manage in GitLens Settings"
									><gl-integrations-chip></gl-integrations-chip
								></a>`
					}
				</div>
			</div>
		</gl-popover>`;
	}

	/** The panel's "Send Feedback" action has no dialog of its own — hide the rollup popover (it would
	 *  otherwise float over the feedback dialog) and hand the request up to `gl-graph-app`, which owns
	 *  the single `gl-graph-feedback-dialog` instance. */
	private handleFeedbackClick = (): void => {
		void this._popover?.hide();
		this.dispatchEvent(new CustomEvent('gl-graph-show-feedback', { bubbles: true, composed: true }));
	};

	/** Deep-links to the matching Settings section when a rollup section has nothing set up. */
	private renderSetupCta(command: GlExtensionCommands, label: string): unknown {
		return html`<gl-button
			appearance="secondary"
			full
			density="compact"
			href=${createCommandLink(command)}
			aria-label=${label}
			>${label}</gl-button
		>`;
	}

	/**
	 * AI section — the chip (model row, credits row) and, when AI is off, a CTA alongside it.
	 *
	 * The CTA is ADDITIVE rather than a replacement, which is why this section doesn't gate on `aiEmpty`
	 * the way Agents does: the credits row is subscription entitlement and has nothing to do with the
	 * `gitlens.ai.enabled` setting, so gating the section would hide a user's remaining GitKraken AI
	 * credits the moment they turned AI off — which is exactly when they might go looking for them. The
	 * chip decides internally which of its two rows apply, so `aiEmpty` here only decides whether the
	 * user is also offered a way to turn AI on.
	 *
	 * The CTA renders BEFORE the chip so it occupies the slot the model row would have taken, leaving the
	 * credits row last either way — a CTA sitting under a populated row reads as applying to it.
	 */
	private renderAI(): unknown {
		if (!this.loaded) return nothing;

		return html`<div class="rollup__section">
			<p class="rollup__heading">${l10n.t('AI')}</p>
			${this.aiEmpty ? this.renderSetupCta('gitlens.showSettingsPage!ai', l10n.t('Set up AI')) : nothing}
			<gl-ai-chip></gl-ai-chip>
		</div>`;
	}

	/**
	 * Agents section — the roster matrix, or one CTA, or nothing at all.
	 *
	 * Suppressed entirely (heading included) when AI is off, rather than showing its own CTA:
	 * `gitlens:agents:enabled` is `ai.enabled && org-enabled && providers.length > 0` (see
	 * `Container.updateAiStatus`), so with AI off the roster is always empty and the section would stack a
	 * second "Set up agents" button under "Set up AI" for a single underlying cause. Agents ride on the AI
	 * toggle, so the AI CTA is the one that fixes both.
	 */
	private renderAgents(): unknown {
		if (this.aiEmpty || this.agentsUnloaded) return nothing;

		return html`<div class="rollup__section">
			<p class="rollup__heading">${l10n.t('Agents')}</p>
			${
				this.agentsEmpty
					? this.renderSetupCta('gitlens.showSettingsPage!agents', l10n.t('Set up agents'))
					: html`<a
							class="rollup__item"
							href=${createCommandLink('gitlens.showSettingsPage!agents')}
							aria-label=${l10n.t('Agents — manage in GitLens Settings')}
							><gl-agents-chip></gl-agents-chip
						></a>`
			}
		</div>`;
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
				class="rollup__item rollup__walkthrough"
				href=${createCommandLink('gitlens.showWelcomeView', graph ? { mode: 'graph' } : undefined)}
			>
				<gl-progress-ring
					count-placement="sr-only"
					.value=${progress.doneCount}
					.max=${progress.allCount}
				></gl-progress-ring>
				<span
					>${graph ? l10n.t('Graph Walkthrough {done}/{total}', { done: progress.doneCount, total: progress.allCount }) : l10n.t('GitLens Walkthrough {done}/{total}', { done: progress.doneCount, total: progress.allCount })}</span
				>
			</a>`;
	}
}
