import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { Source } from '../../../../constants.telemetry.js';
import { createCommandLink } from '../../../../system/commands.js';
import type { GlButton } from '../../shared/components/button.js';
import { graphStateContext } from './context.js';
import '../../shared/components/button.js';
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
				max-width: 30rem;
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

			.footnote {
				margin-block: var(--gl-space-16) 0;
				font-size: var(--gl-font-sm);
				line-height: 1.5;
				color: var(--vscode-descriptionForeground);
				opacity: 0.7;
				animation: gl-fade-up var(--gl-duration-x-slow) var(--gl-ease-out) 240ms both;
			}

			.sync-status {
				margin-block: var(--gl-space-16) 0;
				font-size: var(--gl-font-sm);
				line-height: 1.5;
				color: var(--vscode-descriptionForeground);
				opacity: 0.7;
				animation: gl-fade-up var(--gl-duration-slow) var(--gl-ease-out) both;
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

			@media (prefers-reduced-motion: reduce) {
				.logo,
				.icon-accent,
				.heading,
				.body,
				.actions,
				.waiting,
				.footnote,
				.sync-status {
					animation: none;
				}
			}
		`,
	];

	@consume({ context: graphStateContext, subscribe: true })
	graphState!: typeof graphStateContext.__context__;

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

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();

		this.clearTimers();
	}

	protected override firstUpdated(): void {
		// Defer a frame so the gl-button's inner control has rendered — focusing it before then
		// throws, since `gl-button.focus()` delegates to a not-yet-rendered `.control`.
		requestAnimationFrame(() => this.renderRoot.querySelector<GlButton>('gl-button')?.focus());
	}

	override render(): unknown {
		const account = this.graphState.subscription?.account;
		return account == null ? this.renderSignIn() : this.renderVerifyEmail();
	}

	private renderSignIn(): unknown {
		return html`
			<div class="container">
				<gitlens-logo-circle class="logo"></gitlens-logo-circle>
				<h1 class="heading">Get Started with GitLens</h1>
				<p class="body">
					Supercharge Git and stay in control of <span class="nowrap">AI-assisted</span> development by
					connecting coding agents, worktrees, commits, and reviews directly into the Git workflow.
				</p>
				${this.waiting ? this.renderWaiting() : this.renderSignInActions()}
				<p class="footnote">
					<code-icon icon="link-external"></code-icon> Sign-in continues on gitkraken.dev in your browser.
				</p>
			</div>
		`;
	}

	private renderSignInActions(): unknown {
		return html`
			<div class="actions">
				<gl-button full href=${createCommandLink<Source>('gitlens.plus.signUp', src)} @click=${this.onStart}
					>Create Account</gl-button
				>
				<gl-button
					full
					appearance="secondary"
					href=${createCommandLink<Source>('gitlens.plus.login', src)}
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
				${this.syncChecked && !this.syncing
					? html`<p class="sync-status" role="status">
							Not verified yet &mdash; check your inbox for the link.
						</p>`
					: nothing}
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
