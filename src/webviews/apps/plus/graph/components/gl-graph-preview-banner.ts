import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import * as l10n from '@vscode/l10n';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import { getFeaturePreviewExpiry, getFeaturePreviewStatus } from '../../../../../features.js';
import type { SubscriptionLoginCommandArgs } from '../../../../../plus/gk/models/subscription.js';
import { createCommandLink } from '../../../../../system/commands.js';
import { emitTelemetrySentEvent } from '../../../shared/telemetry.js';
import { graphStateContext } from '../context.js';
import '../../../shared/components/button.js';
import '@gitlens/components/components/codeIcon.js';

/**
 * Persistent (never dismissible) banner strip above the graph column while a signed-out user runs a
 * privately hosted repo on the auto-started preview — says how long is left, offers Sign In, and
 * reassures that public and local repos stay free. Deliberately not opt-in shaped: the preview is
 * already running, there is nothing to accept or dismiss.
 */
@customElement('gl-graph-preview-banner')
export class GlGraphPreviewBanner extends SignalWatcher(LitElement) {
	static override styles = css`
		:host {
			display: block;
			flex: none;
		}

		.strip {
			display: flex;
			gap: var(--gl-space-8);
			align-items: center;
			padding: var(--gl-space-4) var(--gl-space-8);
			font-size: var(--gl-font-md);
			background: color-mix(in lab, var(--vscode-editor-background) 100%, var(--vscode-foreground) 8%);
			border-bottom: var(--gl-border-width) solid var(--vscode-editorWidget-border, transparent);
		}

		.strip__icon {
			flex: none;
			color: var(--color-alert-infoBorder);
		}

		.strip__msg {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.strip__msg strong {
			font-weight: var(--gl-font-weight-semibold);
		}

		.strip__free {
			color: var(--vscode-descriptionForeground);
		}

		.strip__actions {
			display: flex;
			flex: none;
			gap: var(--gl-space-4);
			align-items: center;
			margin-left: auto;
		}

		/* Same treatment as the health banner's action — the graph's banner buttons share one look. */
		.strip__cta {
			flex: none;
			padding: 0.2rem 0.5rem;
			font: inherit;
			font-size: var(--gl-font-md);
			color: var(--vscode-textLink-foreground);
			cursor: pointer;
			background: none;
			border: var(--gl-border-width) solid transparent;
			border-radius: var(--gl-radius-sm);
			transition: color var(--gl-duration-medium) ease;
			text-decoration: none;
		}

		.strip__cta:hover {
			color: var(--vscode-textLink-activeForeground);
			border-color: var(--vscode-textLink-activeForeground);
		}

		.strip__cta:focus-visible {
			outline: var(--gl-border-width) solid var(--vscode-focusBorder);
			outline-offset: 0;
			border-color: var(--vscode-focusBorder);
		}
	`;

	@consume({ context: graphStateContext, subscribe: false })
	private graphState!: typeof graphStateContext.__context__;

	/** Hourly re-render so the remaining-time copy stays honest through long-idle windows — the
	 *  host's expiry timer, not this, is what swaps the screen at the end. */
	private _refreshInterval: ReturnType<typeof setInterval> | undefined;
	private _shownReported = false;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this._refreshInterval = setInterval(() => this.requestUpdate(), 3600000);
	}

	override disconnectedCallback(): void {
		if (this._refreshInterval != null) {
			clearInterval(this._refreshInterval);
			this._refreshInterval = undefined;
		}
		super.disconnectedCallback?.();
	}

	private get shouldShow(): boolean {
		const preview = this.graphState.featurePreview;
		return (
			this.graphState.subscription?.account == null &&
			this.graphState.selectedRepositoryVisibility === 'private' &&
			preview != null &&
			getFeaturePreviewStatus(preview) === 'active'
		);
	}

	/** Whole days remaining (ceiling), 0 when under a day */
	private get daysLeft(): number {
		const expiry = this.graphState.featurePreview && getFeaturePreviewExpiry(this.graphState.featurePreview);
		if (expiry == null) return 0;

		const remaining = expiry.getTime() - Date.now();
		return remaining < 86400000 ? 0 : Math.ceil(remaining / 86400000);
	}

	private get remainingLabel(): string {
		const days = this.daysLeft;
		if (days === 0) return l10n.t('less than a day left');

		return formatPlural(l10n.t('{days, plural, one{{days} day left} other{{days} days left}}'), { days: days });
	}

	/** Hours-and-minutes precision for the under-a-day tail, where the visible label goes vague
	 *  ("less than a day left") exactly when the user most wants the real number. */
	private get remainingTooltip(): string | undefined {
		if (this.daysLeft !== 0) return undefined;

		const expiry = this.graphState.featurePreview && getFeaturePreviewExpiry(this.graphState.featurePreview);
		if (expiry == null) return undefined;

		const remaining = Math.max(0, expiry.getTime() - Date.now());
		const hours = Math.floor(remaining / 3600000);
		const minutes = Math.floor((remaining % 3600000) / 60000);
		if (hours === 0) {
			return formatPlural(l10n.t('{minutes, plural, one{{minutes} minute left} other{{minutes} minutes left}}'), {
				minutes: minutes,
			});
		}

		return formatPlural(
			l10n.t(
				'{hours, plural, one{{hours} hour} other{{hours} hours}} {minutes, plural, one{{minutes} minute} other{{minutes} minutes}} left',
			),
			{ hours: hours, minutes: minutes },
		);
	}

	/** The title text is computed at render time — refresh on hover so its minutes are current rather
	 *  than up to an hour stale (the periodic re-render is hourly). The native tooltip's show delay
	 *  comfortably covers the async re-render. */
	private readonly onHover = (): void => {
		this.requestUpdate();
	};

	private readonly onSignIn = (): void => {
		emitTelemetrySentEvent<'graph/previewBanner/signIn'>(this, {
			name: 'graph/previewBanner/signIn',
			data: { daysLeft: this.daysLeft },
		});
	};

	protected override updated(): void {
		// One impression per Graph instance, reported once the strip actually rendered
		if (!this._shownReported && this.shouldShow) {
			this._shownReported = true;
			emitTelemetrySentEvent<'graph/previewBanner/shown'>(this, {
				name: 'graph/previewBanner/shown',
				data: { daysLeft: this.daysLeft },
			});
		}
	}

	override render(): unknown {
		if (!this.shouldShow) return nothing;

		return html`<div class="strip" role="status" @mouseenter=${this.onHover}>
			<code-icon class="strip__icon" icon="clock"></code-icon>
			<span class="strip__msg" title=${ifDefined(this.remainingTooltip)}>
				<strong
					>${l10n.t('Previewing the Commit Graph on privately hosted repos — {remaining}.', {
						remaining: this.remainingLabel,
					})}</strong
				>
				<span class="strip__free">${l10n.t('Public and local repos stay free.')}</span>
			</span>
			<span class="strip__actions">
				<a
					class="strip__cta"
					href=${createCommandLink<SubscriptionLoginCommandArgs>('gitlens.plus.login', {
						source: 'graph',
						detail: 'preview-banner',
						openAccountView: false,
					})}
					@click=${this.onSignIn}
					>${l10n.t('Sign In')}</a
				>
			</span>
		</div>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-preview-banner': GlGraphPreviewBanner;
	}
}
