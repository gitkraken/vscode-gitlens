import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing, svg } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Source } from '../../../../constants.telemetry.js';
import type { SubscriptionLoginCommandArgs } from '../../../../plus/gk/models/subscription.js';
import { createCommandLink } from '../../../../system/commands.js';
import type { GraphShowAction } from '../../../plus/graph/protocol.js';
import { CloseGraphWalkthroughBannerCommand } from '../../../plus/graph/protocol.js';
import { boxSizingBase, scrollableBase } from '../../shared/components/styles/lit/base.css.js';
import { ipcContext } from '../../shared/contexts/ipc.js';
import { graphStateContext } from './context.js';
import '../../shared/components/button.js';
import '../../shared/components/card/card.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/gitlens-logo-circle.js';
import { getIntentSourceDetail, intentCopyByAction } from './intentCopy.js';

const src = { source: 'graph', detail: 'signin' } as const satisfies Source;

const resendVerificationCooldownSeconds = 30;
const syncStatusDelayMs = 1500;

@customElement('gl-graph-access-account')
export class GlGraphAccessAccount extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		scrollableBase,
		css`
			:host {
				--link-foreground: var(--vscode-textLink-foreground);
				--link-foreground-active: var(--vscode-textLink-activeForeground);
			}

			/* No justify-content here on purpose: .content centers itself with margin-block: auto (which
			   yields the free space back to flex-start on overflow, so the top stays scrollable). A
			   justify-content: center would re-center the overflow once those auto margins zero out,
			   clipping the top of tall content in short viewports. */
			.container {
				display: flex;
				flex-direction: column;
				align-items: center;
				height: 100vh;
				padding: var(--gitlens-gutter-width);
				overflow: auto;
				background: var(--vscode-editor-background);
			}

			.content {
				display: flex;
				flex-direction: column;
				align-items: center;
				inline-size: 100%;
				max-width: 42ch;
				block-size: fit-content;
				margin-block: auto;
				text-align: center;
			}

			/* Slim, subtly-tinted notice pinned to the top of the sign-in screen for users upgrading
			   from before v19 (the Commit Graph's move to an account-gated home). flex: none keeps it
			   at its natural size at the top while .content's auto margins take the remaining space. */
			.upgrade-banner {
				display: flex;
				flex: none;
				gap: var(--gl-space-8);
				align-items: center;
				inline-size: 100%;
				padding: var(--gl-space-8) var(--gl-space-12);
				margin-inline: auto;
				font-size: var(--gl-font-md);
				line-height: 1.4;
				color: var(--color-foreground--85);
				text-align: start;
				text-wrap: pretty;
				background: color-mix(in lab, var(--vscode-editor-background) 100%, var(--vscode-foreground) 12%);
				border-inline-start: 0.2rem solid var(--color-alert-infoBorder);
				border-radius: var(--gl-radius-sm);
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) both;
			}

			.upgrade-banner code-icon {
				flex: none;
				color: var(--color-alert-infoBorder);
			}

			.logo {
				margin-block: var(--gl-space-4) var(--gl-space-10);
				transform: scale(1.22);
				/* Dedicated keyframe: the shared gl-fade-up ends at translateY(0), which would overwrite the logo's scale (transform is a single property). This one carries the scale through both keyframes so the logo stays at ~56px. */
				animation: gl-fade-up-logo var(--gl-duration-x-slow) var(--gl-ease-out) both;
			}

			.icon-accent {
				color: var(--vscode-charts-blue);
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) both;
			}

			.success {
				display: flex;
				gap: var(--gl-space-4);
				align-items: center;
				margin-block: 0 var(--gl-space-6);
				font-size: var(--gl-font-md);
				color: var(--vscode-descriptionForeground);
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) both;
			}

			.success code-icon {
				color: var(--vscode-charts-green);
			}

			.heading {
				margin-block: 0;
				font-size: var(--gl-font-lg);
				font-weight: 600;
				color: var(--vscode-foreground);
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) 60ms both;
			}

			.body {
				margin-block: var(--gl-space-8) 0;
				font-size: var(--gl-font-base);
				line-height: 1.5;
				color: var(--vscode-descriptionForeground);
				text-wrap: pretty;
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) 120ms both;
			}

			.nowrap {
				white-space: nowrap;
			}

			.actions {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
				inline-size: 100%;
				margin-block-start: var(--gl-space-20);
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) 180ms both;
			}

			.waiting {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-10);
				align-items: center;
				inline-size: 100%;
				margin-block-start: var(--gl-space-20);
				animation: gl-fade-up var(--gl-duration-slow) var(--gl-ease-out) both;
			}

			.waiting code-icon {
				--code-icon-size: 1.8rem;

				color: var(--vscode-descriptionForeground);
			}

			.waiting__status {
				font-size: var(--gl-font-md);
				line-height: 1.5;
				color: var(--vscode-descriptionForeground);
			}

			.cancel {
				padding: 0;
				font-family: inherit;
				font-size: var(--gl-font-md);
				color: var(--link-foreground);
				appearance: none;
				cursor: pointer;
				background: none;
				border: none;
			}

			.cancel:hover,
			.cancel:focus-visible {
				color: var(--link-foreground-active);
				text-decoration: underline;
			}

			.cancel:focus-visible {
				outline: var(--gl-border-width) solid var(--color-focus-border);
				outline-offset: 2px;
				border-radius: var(--gl-radius-xs);
			}

			.sync-status {
				margin-block: var(--gl-space-16) 0;
				font-size: var(--gl-font-sm);
				line-height: 1.5;
				color: var(--vscode-descriptionForeground);
				opacity: 0.7;
				animation: gl-fade-up var(--gl-duration-slow) var(--gl-ease-out) both;
			}

			.learn-more {
				--button-gap: var(--gl-space-4);

				margin-block-start: var(--gl-space-16);
				font-size: var(--gl-font-sm);
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) 300ms both;
			}

			.walkthrough {
				--button-gap: var(--gl-space-4);

				margin-block-start: var(--gl-space-12);
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) 180ms both;
			}

			.setup {
				/* The component's card surface defaults derive from the sidebar background; re-derive it
				   here since this screen sits on the editor background instead. */
				--gl-card-background: color-mix(
					in lab,
					var(--vscode-editor-background) 100%,
					var(--vscode-foreground) 4%
				);
				--gl-card-hover-background: color-mix(
					in lab,
					var(--vscode-editor-background) 100%,
					var(--vscode-foreground) 8%
				);

				display: flex;
				flex-direction: column;
				inline-size: 100%;
				margin-block-start: var(--gl-space-16);
				text-align: start;
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) 240ms both;
			}

			.setup__label {
				margin-block: 0 var(--gl-space-6);
				font-size: var(--gl-font-sm);
				font-weight: 600;
				color: var(--vscode-foreground);
			}

			.setup-card {
				display: flex;
				gap: var(--gl-space-10);
				align-items: center;
			}

			.setup-card__icon {
				flex: none;
				color: var(--vscode-charts-blue);
			}

			.setup-card__content {
				display: flex;
				flex: 1;
				flex-direction: column;
				gap: var(--gl-space-2);
			}

			.setup-card__title {
				font-weight: 600;
				color: var(--vscode-foreground);
			}

			.setup-card__hint {
				font-size: var(--gl-font-sm);
				line-height: 1.4;
				color: var(--vscode-descriptionForeground);
			}

			.setup-card__chevron {
				flex: none;
				color: var(--vscode-descriptionForeground);
			}

			.actions--last {
				position: sticky;
				bottom: calc(var(--gl-space-20) * -1);
				padding-block: var(--gl-space-8) var(--gl-space-10);
				margin-block-start: var(--gl-space-12);
				background: var(--color-background);
				animation-delay: 300ms;
			}

			.layout {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
				inline-size: 100%;
				margin-block-start: var(--gl-space-16);
				text-align: start;
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) 270ms both;
			}

			.layout__question {
				margin: 0;
				font-size: var(--gl-font-sm);
				font-weight: 600;
				color: var(--vscode-foreground);
			}

			.layout__options {
				display: flex;
				gap: var(--gl-space-8) 0;
				justify-content: center;
			}

			.layout__option {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
				align-items: center;
				padding: var(--gl-space-16);
				font-family: inherit;
				font-size: inherit;
				color: inherit;
				appearance: none;
				cursor: pointer;
				background: none;
				border: 1px solid var(--vscode-widget-border);
				border-radius: var(--gl-radius-sm);
			}

			.layout__option:hover,
			.layout__option:focus-visible {
				outline: none;
				background-color: var(--vscode-list-hoverBackground);
				border-color: var(--vscode-focusBorder);
			}

			.layout__option.selected {
				background-color: var(--vscode-list-hoverBackground);
				border-color: var(--vscode-focusBorder);
				box-shadow: inset 0 0 0 var(--gl-border-width) var(--vscode-focusBorder);
			}

			.layout__option-text {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-4);
				align-items: center;
			}

			.layout__option-label {
				font-weight: 600;
			}

			.layout__option-caption {
				max-width: 11.8rem;
				font-size: var(--gl-font-sm);
				color: var(--vscode-descriptionForeground);
			}

			.layout__illustration {
				display: block;
				width: 11.8rem;
				height: auto;
			}

			/* Designed illustrations ship as dark/light exports differing only in these colors — one
			   markup, themed via custom properties (host body carries the vscode-* theme class) */
			:host {
				--lp-frame-bg: #121212;
				--lp-frame-stroke: #363636;
				--lp-shell-bg: #2a2a2c;
				--lp-dot-fill: #d9d9d9;
				--lp-row: #808080;
				--lp-purple: #aa5bf5;
				--lp-green: #00a02e;
			}

			:host-context(.vscode-light),
			:host-context(.vscode-high-contrast-light) {
				--lp-frame-bg: #fefefe;
				--lp-frame-stroke: #dddddd;
				--lp-shell-bg: #e3e3e3;
				--lp-dot-fill: #9c9c9c;
				--lp-row: #b4b4b4;
				--lp-purple: #c180ff;
				--lp-green: #37d865;
			}

			@keyframes gl-fade-up {
				from {
					opacity: 0;
					transform: translateY(0.6rem);
				}

				to {
					opacity: 1;
					transform: translateY(0);
				}
			}

			@keyframes gl-fade-up-logo {
				from {
					opacity: 0;
					transform: translateY(0.6rem) scale(1.22);
				}

				to {
					opacity: 1;
					transform: translateY(0) scale(1.22);
				}
			}

			/* Compact tier for short viewports (e.g. the default bottom-panel height ~265px), where the
			   comfortable spacing pushes the sign-in actions below the fold. A media query (not a container
			   query) is intentional: this screen fills the webview viewport and the host is the scroll
			   surface, so 'container-type: size' would change scroll ownership. */
			@media (height <= 360px) {
				:host {
					padding-block: var(--gl-space-12);
				}

				/* The fill-mode animation carries the 1.22 upscale, so switching to the plain keyframes is
				   what actually drops it; the static transform only applies under reduced motion. */
				.logo {
					margin-block: 0 var(--gl-space-6);
					transform: none;
					animation-name: gl-fade-up;
				}

				.actions,
				.waiting {
					margin-block-start: var(--gl-space-12);
				}

				.sync-status {
					margin-block-start: var(--gl-space-8);
				}

				.walkthrough {
					margin-block-start: var(--gl-space-8);
				}

				.setup {
					margin-block-start: var(--gl-space-10);
				}

				.layout {
					margin-block-start: var(--gl-space-10);
				}
			}

			@media (width <= 419px) or (height <= 419px) {
				.layout__illustration {
					width: 9.6rem;
				}

				.layout__option-caption {
					max-width: 10.8rem;
				}
			}

			@media (width <= 479px) {
				.layout__options {
					flex-wrap: wrap;
					gap: var(--gl-space-2);
					align-items: center;
				}

				.layout__option {
					padding: var(--gl-space-12);
				}
			}

			@media (height <= 419px) {
				.layout__option-caption {
					display: none;
				}
			}

			@media (prefers-reduced-motion: reduce) {
				.logo,
				.icon-accent,
				.success,
				.heading,
				.body,
				.actions,
				.waiting,
				.sync-status,
				.learn-more,
				.walkthrough,
				.setup,
				.layout,
				.upgrade-banner {
					animation: none;
				}
			}
		`,
	];

	@consume({ context: graphStateContext, subscribe: true })
	graphState!: typeof graphStateContext.__context__;

	@consume({ context: ipcContext })
	private readonly _ipc!: typeof ipcContext.__context__;

	/** The task that brought the user here (parked by the app while gated) — selects the
	 *  sign-in copy; actions without task copy fall back to the generic pitch. */
	@property({ attribute: false })
	intentAction?: GraphShowAction;

	/** Selects the welcome copy variant — true keeps the "You're signed in" framing; false
	 *  (already signed in on first entry) drops it. */
	@property({ type: Boolean })
	liveSignIn = false;

	/** Render the first-run welcome screen (the `graph:intro` surface). Set by the app when
	 *  `shouldShowWelcome` holds; the app keeps this element mounted while set, so `account` is
	 *  non-null on that screen. */
	@property({ type: Boolean })
	welcome = false;

	/** Show the Side Bar vs Bottom Panel layout picker within the welcome (view host only; fed by the
	 *  host's `layoutPromptNeeded`). */
	@property({ type: Boolean, attribute: 'show-layout-options' })
	showLayoutOptions = false;

	/** Upgraded from a pre-19 version — surfaces a subtle "new home for the Commit Graph" notice atop
	 *  the sign-in screen so returning users understand why the Graph now asks for an account. */
	@property({ type: Boolean })
	upgradedFromPreV19 = false;

	@state()
	private _selectedLayout?: 'sidebar' | 'panel';

	@state()
	private waiting = false;

	@state()
	private cooldown = 0;

	@state()
	private syncing = false;

	@state()
	private syncChecked = false;

	private _cooldownInterval: ReturnType<typeof setInterval> | undefined;
	private _syncTimer: ReturnType<typeof setTimeout> | undefined;
	private _lastScreen: 'signin' | 'verify' | 'welcome' | undefined;
	private _lastFocusKey: string | undefined;

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();

		this.clearTimers();
	}

	private get screen(): 'signin' | 'verify' | 'welcome' {
		const account = this.graphState.subscription?.account;
		if (account == null) return 'signin';
		if (account.verified === false) return 'verify';

		return this.welcome ? 'welcome' : 'verify';
	}

	protected override willUpdate(changedProperties: Map<PropertyKey, unknown>): void {
		super.willUpdate(changedProperties);

		const screen = this.screen;
		// The sign-in, verify, and welcome sub-screens share one reused element instance; drop
		// transient UI state when switching between them so a stale spinner, cooldown, or "not
		// verified" note can't leak across the transition (including waiting -> welcome).
		if (this._lastScreen != null && this._lastScreen !== screen) {
			this.clearTimers();
			this.waiting = false;
			this.syncing = false;
			this.syncChecked = false;
			this.cooldown = 0;
			this._selectedLayout = undefined;
		}
		this._lastScreen = screen;
	}

	protected override updated(changedProperties: Map<PropertyKey, unknown>): void {
		super.updated(changedProperties);

		// Keep focus on the primary control whenever the visible view changes — the initial mount, the
		// sign-in <-> verify switches, and the actions <-> "waiting" swap each remove the focused
		// control, which would otherwise drop focus to <body>. Defer a frame so the new control's
		// inner element has rendered (gl-button.focus() delegates to a not-yet-rendered `.control`).
		const screen = this.screen;
		const focusKey = `${screen}:${this.waiting ? 'waiting' : 'idle'}`;
		if (focusKey === this._lastFocusKey) return;

		this._lastFocusKey = focusKey;
		// The welcome screen is an informational interstitial — don't auto-focus its Continue button;
		// stealing focus there is disruptive (and reads abruptly to screen readers).
		if (screen === 'welcome') return;

		requestAnimationFrame(() => {
			// `gl-button.focus()` delegates to its inner `.control`, which is null while the button is
			// still rendering or being torn down during a screen swap — ignore focus in that window.
			try {
				this.renderRoot?.querySelector<HTMLElement>('gl-button, .cancel')?.focus();
			} catch {
				/* control not ready yet */
			}
		});
	}

	override render(): unknown {
		switch (this.screen) {
			case 'signin':
				return this.renderSignIn();
			case 'welcome':
				return this.renderWelcome();
			default:
				return this.renderVerifyEmail();
		}
	}

	private get signInCopy(): { heading: string; body: string } | undefined {
		return this.intentAction != null ? intentCopyByAction[this.intentAction] : undefined;
	}

	private get signInSource(): Source {
		return { source: 'graph', detail: getIntentSourceDetail('signin', this.intentAction) };
	}

	private renderSignIn(): unknown {
		const copy = this.signInCopy;
		return html`
			<div class="container scrollable">
				${
					this.upgradedFromPreV19
						? html`<div class="upgrade-banner" role="note">
								<code-icon icon="info"></code-icon>
								<span>The all-new Commit Graph has moved here, replacing the Home view.</span>
							</div>`
						: nothing
				}
				<div class="content">
					<gitlens-logo-circle class="logo"></gitlens-logo-circle>
					<h1 class="heading">${copy?.heading ?? 'Get Started with GitLens'}</h1>
					<p class="body">
						${
							copy?.body ??
							html`Supercharge Git and stay in control of
								<span class="nowrap">AI-assisted</span> development by connecting coding agents,
								worktrees, commits, and reviews directly into the Git workflow.`
						}
					</p>
					${this.waiting ? this.renderWaiting() : this.renderSignInActions()}
					<gl-button
						class="learn-more"
						appearance="link"
						href=${createCommandLink('gitlens.showWelcomeView', { mode: 'main' })}
					>
						<code-icon slot="prefix" icon="book"></code-icon>
						Learn More
					</gl-button>
				</div>
			</div>
		`;
	}

	private renderSignInActions(): unknown {
		return html`
			<div class="actions">
				<gl-button
					full
					href=${createCommandLink<SubscriptionLoginCommandArgs>('gitlens.plus.signUp', {
						...this.signInSource,
						openAccountView: false,
					})}
					@click=${this.onStart}
					>Create Free Account</gl-button
				>
				<gl-button
					full
					appearance="secondary"
					href=${createCommandLink<SubscriptionLoginCommandArgs>('gitlens.plus.login', {
						...this.signInSource,
						openAccountView: false,
					})}
					@click=${this.onStart}
					>Sign In</gl-button
				>
			</div>
		`;
	}

	private renderWaiting(): unknown {
		return html`
			<div class="waiting">
				<code-icon icon="sync" modifier="spin"></code-icon>
				<div class="waiting__status" role="status" aria-live="polite">
					Waiting for sign-in to complete in your browser&hellip;
				</div>
				<button type="button" class="cancel" @click=${this.onCancel}>Cancel</button>
			</div>
		`;
	}

	private renderVerifyEmail(): unknown {
		return html`
			<div class="container scrollable">
				<div class="content">
					<code-icon class="icon-accent" icon="mail" .size=${28}></code-icon>
					<h1 class="heading">Verify your email</h1>
					<p class="body">
						We sent a verification link to your email. Click it to activate your account, then synchronize
						to continue.
					</p>
					<div class="actions">
						<gl-button
							full
							href=${createCommandLink<Source>('gitlens.plus.resendVerification', src)}
							?disabled=${this.cooldown > 0}
							@click=${this.onResend}
							>${this.cooldown > 0 ? `Email Sent · ${this.cooldown}s` : 'Resend Email'}</gl-button
						>
						<gl-button
							full
							appearance="secondary"
							href=${createCommandLink<Source>('gitlens.plus.validate', src)}
							@click=${this.onSync}
						>
							<code-icon slot="prefix" icon="sync" modifier=${this.syncing ? 'spin' : ''}></code-icon>
							Synchronize Status
						</gl-button>
					</div>
					${
						this.syncChecked && !this.syncing
							? html`<p class="sync-status" role="status">
									Not verified yet &mdash; check your inbox for the link.
								</p>`
							: nothing
					}
				</div>
			</div>
		`;
	}

	private renderWelcome(): unknown {
		return html`
			<div class="container scrollable">
				<div class="content">
					<gitlens-logo-circle class="logo"></gitlens-logo-circle>
					${
						this.liveSignIn
							? html`<p class="success" role="status">
									<code-icon icon="pass-filled"></code-icon>
									You're signed in
								</p>`
							: nothing
					}
					<h1 class="heading">Welcome to the Commit Graph</h1>
					<p class="body">
						Where your development and agentic workflows come together &mdash; visualize branches and
						commits, manage parallel work and agents, and run your entire Git workflow from one view.
					</p>
					${this.showLayoutOptions ? this.renderLayoutOptions() : nothing}
					<div class="setup">
						<h2 class="setup__label">Set up your workflow</h2>
						<gl-card class="setup__card" href=${createCommandLink('gitlens.showSettingsPage!ai')}>
							<div class="setup-card">
								<code-icon class="setup-card__icon" icon="sparkle"></code-icon>
								<div class="setup-card__content">
									<span class="setup-card__title">Set up AI</span>
									<span class="setup-card__hint"
										>Compose commits, review changes, and resolve conflicts with AI</span
									>
								</div>
								<code-icon class="setup-card__chevron" icon="chevron-right"></code-icon>
							</div>
						</gl-card>
						<gl-card class="setup__card" href=${createCommandLink('gitlens.showSettingsPage!agents')}>
							<div class="setup-card">
								<code-icon class="setup-card__icon" icon="robot"></code-icon>
								<div class="setup-card__content">
									<span class="setup-card__title">Set up Agents</span>
									<span class="setup-card__hint"
										>Choose your default coding agent and install the GitKraken MCP</span
									>
								</div>
								<code-icon class="setup-card__chevron" icon="chevron-right"></code-icon>
							</div>
						</gl-card>
						<gl-card class="setup__card" href=${createCommandLink('gitlens.showSettingsPage!integrations')}>
							<div class="setup-card">
								<code-icon class="setup-card__icon" icon="plug"></code-icon>
								<div class="setup-card__content">
									<span class="setup-card__title">Connect Integrations</span>
									<span class="setup-card__hint"
										>See and act on PRs and issues from GitHub, Jira, and more</span
									>
								</div>
								<code-icon class="setup-card__chevron" icon="chevron-right"></code-icon>
							</div>
						</gl-card>
					</div>
					<div class="actions actions--last">
						<gl-button full class="continue" @click=${this.onContinue}>Continue to Commit Graph</gl-button>
					</div>
				</div>
			</div>
		`;
	}

	private renderLayoutOptions(): unknown {
		return html`
			<div class="layout">
				<h2 class="layout__question">Would you like to change the Graph location?</h2>
				<div class="layout__options">
					<button
						type="button"
						class="layout__option ${this._selectedLayout === 'sidebar' ? 'selected' : ''}"
						aria-pressed=${this._selectedLayout === 'sidebar'}
						@click=${() => this.onSelectLayout('sidebar')}
					>
						${this.renderSidebarIllustration()}
						<span class="layout__option-text">
							<span class="layout__option-label">Side Bar</span>
							<span class="layout__option-caption">Compact, alongside your editor</span>
						</span>
					</button>
					<button
						type="button"
						class="layout__option ${this._selectedLayout === 'panel' ? 'selected' : ''}"
						aria-pressed=${this._selectedLayout === 'panel'}
						@click=${() => this.onSelectLayout('panel')}
					>
						${this.renderPanelIllustration()}
						<span class="layout__option-text">
							<span class="layout__option-label">Bottom Panel</span>
							<span class="layout__option-caption">Full width, below your editor</span>
						</span>
					</button>
				</div>
			</div>
		`;
	}

	/** Designed window mock: highlighted side bar hosting a vertical commit graph */
	private renderSidebarIllustration() {
		return svg`<svg class="layout__illustration" width="138" height="75" viewBox="0 0 138 75" fill="none" aria-hidden="true">
			<rect x="0.336586" y="0.336586" width="137.327" height="74.0488" rx="1.00976" fill="var(--lp-frame-bg)" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M0.5 0.999999C0.5 0.447715 0.947715 0 1.5 0H37.5V74H1.5C0.947715 74 0.5 73.5523 0.5 73V0.999999Z" fill="var(--lp-shell-bg)"/>
			<rect x="114.837" y="5.33659" width="18.3268" height="10.3268" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="101.837" y="21.3366" width="22.3268" height="33.3268" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="101.837" y="59.3366" width="31.3268" height="10.3268" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="127.566" y="63.6147" width="3.36585" height="3.36585" rx="1.68293" fill="var(--lp-dot-fill)" stroke="#D9D9D9" stroke-width="0.673171"/>
			<path d="M37.4707 0L37.4707 74.722" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M96.1536 0L96.1536 74.722" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M9.11255 74.4023L9.11255 62.0884" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<path d="M9.11255 45.2381L9.11255 10.8887" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<path d="M9.11255 51.7189L9.11255 49.1265" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<path d="M9.11255 58.1998L9.11255 55.6074" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<path d="M15.5935 74.4025L15.5935 42.6455" stroke="var(--lp-green)" stroke-width="0.812499"/>
			<path d="M15.5935 38.4579L15.5935 17.0706" stroke="var(--lp-green)" stroke-width="0.812499"/>
			<path d="M22.0745 74.4026L22.0745 23.8506" stroke="#40AAA3" stroke-width="0.812499"/>
			<path d="M28.5557 74.4023L28.5557 30.3313" stroke="#8A743A" stroke-width="0.812499"/>
			<circle cx="28.5556" cy="28.3874" r="1.94431" stroke="#8A743A" stroke-width="0.812499"/>
			<circle cx="22.0747" cy="21.9062" r="1.94431" stroke="#40AAA3" stroke-width="0.812499"/>
			<circle cx="15.5937" cy="15.4253" r="1.94431" stroke="var(--lp-green)" stroke-width="0.812499"/>
			<circle cx="15.5937" cy="40.7014" r="1.94431" stroke="var(--lp-green)" stroke-width="0.812499"/>
			<circle cx="9.11276" cy="8.94431" r="1.94431" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<circle cx="9.11276" cy="60.1443" r="1.94431" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<circle cx="9.11276" cy="53.6633" r="1.94431" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<circle cx="9.11276" cy="47.1823" r="1.94431" stroke="var(--lp-purple)" stroke-width="0.812499"/>
			<path d="M37.3506 8.94385L11.0569 8.94385" stroke="#AA5BF5" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 47.1821H11.0569" stroke="#AA5BF5" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 53.6631H11.0569" stroke="#AA5BF5" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 15.4248L17.5379 15.4248" stroke="#00A02E" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 40.7012H17.5379" stroke="#00A02E" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 21.906H24.0189" stroke="#309FC7" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 28.3872H30.4999" stroke="#C7B830" stroke-opacity="0.3" stroke-width="2.75444"/>
			<path d="M37.3506 60.7925H11.0569" stroke="#C7308B" stroke-opacity="0.3" stroke-width="2.75444"/>
		</svg>`;
	}

	/** Designed window mock: highlighted bottom panel hosting the commit graph */
	private renderPanelIllustration() {
		return svg`<svg class="layout__illustration" width="138" height="75" viewBox="0 0 138 75" fill="none" aria-hidden="true">
			<rect x="0.336586" y="0.336586" width="137.327" height="74.0488" rx="1.00976" fill="var(--lp-frame-bg)" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M1.5 75C0.947712 75 0.5 74.5523 0.5 74L0.499998 40L102.5 40L102.5 74C102.5 74.5523 102.052 75 101.5 75L1.5 75Z" fill="var(--lp-shell-bg)"/>
			<rect x="118.815" y="5.04899" width="14.8098" height="10.7707" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="106.697" y="21.205" width="14.8098" height="33.6586" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="106.697" y="58.9025" width="26.9268" height="10.7707" rx="1.00976" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<rect x="127.566" y="63.6149" width="3.36585" height="3.36585" rx="1.68293" fill="var(--lp-dot-fill)" stroke="#D9D9D9" stroke-width="0.673171"/>
			<path d="M102.5 40L0.499999 40" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M102.154 0L102.154 74.722" stroke="var(--lp-frame-stroke)" stroke-width="0.673171"/>
			<path d="M37.3188 63.404L37.3188 63.2017" stroke="var(--lp-purple)" stroke-width="0.673171"/>
			<g clip-path="url(#lp-panel-clip)">
				<path d="M12.3188 76.2404L12.3188 47.7812" stroke="var(--lp-purple)" stroke-width="0.673171"/>
				<path d="M60 46.1702H13.9299" stroke="#AA5BF5" stroke-opacity="0.3" stroke-width="2.2821"/>
				<path d="M60 51.5398H19.2996" stroke="#00A02E" stroke-opacity="0.3" stroke-width="2.2821"/>
				<path d="M60 72.4817H19.2996" stroke="#00A02E" stroke-opacity="0.3" stroke-width="2.2821"/>
				<path d="M60 56.9094H24.6692" stroke="#309FC7" stroke-opacity="0.3" stroke-width="2.2821"/>
				<path d="M60 62.2793H30.0389" stroke="#C7B830" stroke-opacity="0.3" stroke-width="2.2821"/>
				<path d="M17.6885 70.6232L17.6885 52.9033" stroke="var(--lp-green)" stroke-width="0.673171"/>
				<path d="M23.0581 100.404L23.0581 58.5205" stroke="#40AAA3" stroke-width="0.673171"/>
				<path d="M28.4282 100.404L28.4282 63.8901" stroke="#8A743A" stroke-width="0.673171"/>
				<circle cx="28.4278" cy="62.2794" r="1.6109" stroke="#8A743A" stroke-width="0.673171"/>
				<circle cx="23.0582" cy="56.9097" r="1.6109" stroke="#40AAA3" stroke-width="0.673171"/>
				<circle cx="17.6885" cy="51.5401" r="1.6109" stroke="var(--lp-green)" stroke-width="0.673171"/>
				<circle cx="17.6885" cy="72.4817" r="1.6109" stroke="var(--lp-green)" stroke-width="0.673171"/>
				<circle cx="12.3189" cy="46.1705" r="1.6109" stroke="var(--lp-purple)" stroke-width="0.673171"/>
			</g>
			<path d="M88.8481 47.1704H65.7586" stroke="var(--lp-row)" stroke-width="0.673171"/>
			<path d="M80.7939 52.54H65.7589" stroke="var(--lp-row)" stroke-width="0.673171"/>
			<path d="M88.8481 57.9097H65.7586" stroke="var(--lp-row)" stroke-width="0.673171"/>
			<path d="M80.7939 63.2793H65.7589" stroke="var(--lp-row)" stroke-width="0.673171"/>
			<path d="M88.8481 68.6489H65.7586" stroke="var(--lp-row)" stroke-width="0.673171"/>
			<defs>
				<clipPath id="lp-panel-clip">
					<rect width="51" height="30" fill="white" transform="translate(9.5 44)"/>
				</clipPath>
			</defs>
		</svg>`;
	}

	private readonly onStart = (): void => {
		this.waiting = true;
	};

	private readonly onCancel = (): void => {
		this.waiting = false;
	};

	private readonly onResend = (): void => {
		if (this.cooldown > 0) return;

		this.cooldown = resendVerificationCooldownSeconds;
		this._cooldownInterval = setInterval(() => {
			this.cooldown -= 1;
			if (this.cooldown <= 0) {
				this.cooldown = 0;
				this.clearCooldownTimer();
			}
		}, 1000);
	};

	private readonly onSync = (): void => {
		if (this.syncing) return;

		this.syncing = true;
		this._syncTimer = setTimeout(() => {
			this.syncing = false;
			this.syncChecked = true;
			this._syncTimer = undefined;
		}, syncStatusDelayMs);
	};

	private readonly onContinue = (): void => {
		this._ipc.sendCommand(CloseGraphWalkthroughBannerCommand, { openWelcome: true });
		this.dispatchEvent(
			new CustomEvent('gl-continue', {
				detail: { layoutChoice: this._selectedLayout ?? 'dismissed' },
			}),
		);
	};

	private readonly onSelectLayout = (choice: 'sidebar' | 'panel'): void => {
		this._selectedLayout = choice;
	};

	private clearCooldownTimer(): void {
		if (this._cooldownInterval == null) return;

		clearInterval(this._cooldownInterval);
		this._cooldownInterval = undefined;
	}

	private clearSyncTimer(): void {
		if (this._syncTimer == null) return;

		clearTimeout(this._syncTimer);
		this._syncTimer = undefined;
	}

	private clearTimers(): void {
		this.clearCooldownTimer();
		this.clearSyncTimer();
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-access-account': GlGraphAccessAccount;
	}
}
