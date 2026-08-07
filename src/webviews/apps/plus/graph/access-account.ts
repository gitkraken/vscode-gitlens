import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Source } from '../../../../constants.telemetry.js';
import { createCommandLink } from '../../../../system/commands.js';
import type { GraphShowAction } from '../../../plus/graph/protocol.js';
import { CloseGraphWalkthroughBannerCommand } from '../../../plus/graph/protocol.js';
import { ipcContext } from '../../shared/contexts/ipc.js';
import { graphStateContext } from './context.js';
import { getIntentSourceDetail, intentCopyByAction } from './intentCopy.js';
import '../../shared/components/button.js';
import '../../shared/components/card/card.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/gitlens-logo-circle.js';

const src = { source: 'graph', detail: 'signin' } as const satisfies Source;

const resendVerificationCooldownSeconds = 30;
const syncStatusDelayMs = 1500;

@customElement('gl-graph-access-account')
export class GlGraphAccessAccount extends SignalWatcher(LitElement) {
	static override styles = [
		css`
			:host {
				--link-foreground: var(--vscode-textLink-foreground);
				--link-foreground-active: var(--vscode-textLink-activeForeground);

				box-sizing: border-box;
				display: flex;
				align-items: safe center;
				justify-content: center;
				min-height: 100vh;
				padding: var(--gl-space-24);
				overflow: auto;
				background: var(--vscode-editor-background);
			}

			.container {
				display: flex;
				flex-direction: column;
				align-items: center;
				inline-size: 100%;
				max-width: 42ch;
				text-align: center;
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
				animation-delay: 300ms;
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
				.setup {
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

	/** Render the post-sign-in welcome screen. Set by the app when the account wall clears live;
	 *  the app keeps this element mounted while set, so `account` is non-null on that screen. */
	@property({ type: Boolean })
	postSignIn = false;

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

		return this.postSignIn ? 'welcome' : 'verify';
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
		}
		this._lastScreen = screen;
	}

	protected override updated(changedProperties: Map<PropertyKey, unknown>): void {
		super.updated(changedProperties);

		// Keep focus on the primary control whenever the visible view changes — the initial mount, the
		// sign-in <-> verify <-> welcome switches, and the actions <-> "waiting" swap each remove the
		// focused control, which would otherwise drop focus to <body>. Defer a frame so the new
		// control's inner element has rendered (gl-button.focus() delegates to a not-yet-rendered
		// `.control`).
		const screen = this.screen;
		const focusKey = `${screen}:${this.waiting ? 'waiting' : 'idle'}`;
		if (focusKey === this._lastFocusKey) return;

		this._lastFocusKey = focusKey;
		requestAnimationFrame(() => {
			// `gl-button.focus()` delegates to its inner `.control`, which is null while the button is
			// still rendering or being torn down during a screen swap — ignore focus in that window.
			try {
				const selector = screen === 'welcome' ? 'gl-button.continue' : 'gl-button, .cancel';
				this.renderRoot?.querySelector<HTMLElement>(selector)?.focus();
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
			<div class="container">
				<gitlens-logo-circle class="logo"></gitlens-logo-circle>
				<h1 class="heading">${copy?.heading ?? 'Get Started with GitLens'}</h1>
				<p class="body">
					${
						copy?.body ??
						html`Supercharge Git and stay in control of <span class="nowrap">AI-assisted</span> development
							by connecting coding agents, worktrees, commits, and reviews directly into the Git workflow.`
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
		`;
	}

	private renderSignInActions(): unknown {
		return html`
			<div class="actions">
				<gl-button
					full
					href=${createCommandLink<Source>('gitlens.plus.signUp', this.signInSource)}
					@click=${this.onStart}
					>Create Free Account</gl-button
				>
				<gl-button
					full
					appearance="secondary"
					href=${createCommandLink<Source>('gitlens.plus.login', this.signInSource)}
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
			<div class="container">
				<code-icon class="icon-accent" icon="mail" .size=${28}></code-icon>
				<h1 class="heading">Verify your email</h1>
				<p class="body">
					We sent a verification link to your email. Click it to activate your account, then synchronize to
					continue.
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
		`;
	}

	private renderWelcome(): unknown {
		return html`
			<div class="container">
				<gitlens-logo-circle class="logo"></gitlens-logo-circle>
				<p class="success" role="status">
					<code-icon icon="pass-filled"></code-icon>
					You're signed in
				</p>
				<h1 class="heading">Welcome to the Commit Graph</h1>
				<p class="body">
					Where your development and agentic workflows come together &mdash; visualize branches and commits,
					manage parallel work and agents, and run your entire Git workflow from one view.
				</p>
				<gl-button class="walkthrough" appearance="link" @click=${this.onOpenWalkthrough}>
					<code-icon slot="prefix" icon="play-circle"></code-icon>
					Take the Commit Graph Walkthrough
				</gl-button>
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
		`;
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
		this.dispatchEvent(new CustomEvent('gl-continue'));
	};

	private readonly onOpenWalkthrough = (): void => {
		// The banner IPC command is the canonical in-graph walkthrough entry — it records
		// walkthrough-started usage (which also retires the header megaphone highlight) before
		// opening the Get Started view in graph mode.
		this._ipc.sendCommand(CloseGraphWalkthroughBannerCommand, { openWelcome: true });
		this.dispatchEvent(new CustomEvent('gl-continue'));
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
