import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Source } from '../../../../constants.telemetry.js';
import { createCommandLink } from '../../../../system/commands.js';
import type { AIState, ScopedAiModelInfo } from '../../../rpc/services/types.js';
import { boxSizingBase, linkBase } from '../../shared/components/styles/lit/base.css.js';
import type { SettingsActions } from '../actions.js';
import type { SettingsState } from '../state.js';
import { settingsStateContext } from '../state.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/skeleton-loader.js';

declare global {
	interface HTMLElementTagNameMap {
		['gl-settings-ai']: GlSettingsAI;
	}
}

/** Label + icon per scope, matching the graph WIP header's compose/review/resolve
 * treatment (`gl-details-wip-header.ts`) — except the compose label, which reads
 * "Composing Commits" here since only the commit-composing flow (not all WIP
 * composing) has a scoped model. */
const scopedModelMeta: Record<ScopedAiModelInfo['scope'], { label: string; icon: string }> = {
	compose: { label: 'Composing Commits', icon: 'wand' },
	review: { label: 'Reviewing Changes', icon: 'checklist' },
	resolve: { label: 'Resolving Conflicts', icon: 'gl-merge' },
};

/**
 * The AI integrations panel — the provider/model row, mirroring the Home
 * view's integrations chip.
 *
 * Aside from the category's master switch (`gitlens.ai.enabled`), this isn't
 * a config setting: state comes from the shared AI RPC service and the action
 * runs a command (switch model).
 */
@customElement('gl-settings-ai')
export class GlSettingsAI extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		linkBase,
		css`
			:host {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-12);

				/* Semantic success token so custom/high-contrast themes keep contrast */
				--status-color--connected: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
			}

			.note {
				display: flex;
				gap: var(--gl-space-8);
				padding: var(--gl-space-10) var(--gl-space-12);
				font-size: 1.2rem;
				line-height: 1.5;
				color: var(--color-foreground--85);
				background-color: color-mix(in srgb, var(--color-alert-infoBackground) 60%, transparent);
				border: var(--gl-border-width) solid color-mix(in srgb, var(--color-alert-infoBorder) 70%, transparent);
				border-radius: var(--gl-radius-md);
			}

			.note code-icon {
				flex: none;
				margin-block-start: var(--gl-space-2);
			}

			.rows {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
				padding: 0;
				margin: 0;
				list-style: none;
			}

			.row {
				display: flex;
				gap: var(--gl-space-10);
				align-items: center;
				padding: 0.9rem 1.1rem;
				border: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
				border-radius: var(--gl-radius-md);
			}

			.row__icon {
				flex: none;
				font-size: 1.6rem;
			}

			.row--disconnected .row__icon {
				color: var(--color-foreground--25);
			}

			.row__content {
				flex: 1 1 auto;
				min-width: 0;
			}

			.row__title {
				display: block;
				font-size: 1.25rem;
				color: var(--color-foreground);
			}

			.row__details {
				display: block;
				font-size: 1.1rem;
				color: var(--color-foreground--65);
			}

			.row--sub {
				margin-inline-start: var(--gl-space-24);
			}

			.row--sub .row__title {
				font-size: 1.15rem;
				color: var(--color-foreground--85);
			}

			.row--disconnected .row__title,
			.row--disconnected .row__details {
				color: var(--color-foreground--50);
			}

			.row__actions {
				display: flex;
				flex: none;
				gap: var(--gl-space-6);
				align-items: center;
			}

			.row__status {
				display: flex;
				gap: 0.5rem;
				align-items: center;
				font-size: 1.15rem;
				color: var(--status-color--connected);
			}

			.error {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				padding: var(--gl-space-10) var(--gl-space-12);
				font-size: 1.2rem;
				line-height: 1.5;
				color: var(--color-foreground--85);
				background-color: color-mix(in srgb, var(--color-alert-errorBackground) 60%, transparent);
				border: var(--gl-border-width) solid color-mix(in srgb, var(--color-alert-errorBorder) 70%, transparent);
				border-radius: var(--gl-radius-md);
			}

			.error span {
				flex: 1;
			}
		`,
	];

	@consume({ context: settingsStateContext })
	private _state!: SettingsState;

	@property({ attribute: false })
	actions?: SettingsActions;

	private get ai(): AIState | undefined {
		return this._state.aiState.get();
	}

	override render(): unknown {
		const ai = this.ai;
		if (ai == null) {
			// A failed fetch must not skeleton forever — offer a retry
			if (this._state.serviceErrors.get().ai) {
				return html`<div class="error" role="alert">
					<code-icon icon="error" aria-hidden="true"></code-icon>
					<span>Couldn’t load AI status.</span>
					<gl-button appearance="secondary" @click=${() => void this.actions?.loadSharedServices()}
						>Retry</gl-button
					>
				</div>`;
			}
			return html`<skeleton-loader lines="1"></skeleton-loader>`;
		}

		if (!ai.orgEnabled) {
			return html`<p class="note">
				<code-icon icon="org" aria-hidden="true"></code-icon>
				<span>AI features have been disabled by your GitKraken admin.</span>
			</p>`;
		}

		if (!ai.enabled) {
			return html`<p class="note">
				<code-icon icon="info" aria-hidden="true"></code-icon>
				<span>AI features are currently disabled — use the switch above to enable them.</span>
			</p>`;
		}

		return html`<ul class="rows">
			${this.renderModelRow()}${this.renderScopedModelRows()}
		</ul>`;
	}

	private renderModelRow() {
		const model = this._state.aiModel.get();
		// A failed model fetch must not masquerade as "no model selected"
		const failed = model == null && this._state.serviceErrors.get().ai;

		return html`<li class="row row--${model != null ? 'connected' : 'disconnected'}">
			<code-icon
				class="row__icon"
				icon="${model != null ? 'sparkle-filled' : 'sparkle'}"
				aria-hidden="true"
			></code-icon>
			<span class="row__content">
				<span class="row__title">Default AI Provider & Model</span>
				<span class="row__details"
					>${
						model?.name != null
							? `${model?.provider.name} — ${model?.name}`
							: failed
								? "Couldn't load the current model"
								: 'Select an AI model to enable AI features'
					}</span
				>
			</span>
			<span class="row__actions">
				<gl-button
					appearance="secondary"
					href="${createCommandLink<Source>('gitlens.ai.switchProvider', {
						source: 'settings',
						detail: 'integrations',
					})}"
					tooltip="Switch AI Provider/Model"
					><code-icon icon="arrow-swap" slot="prefix" aria-hidden="true"></code-icon> Switch</gl-button
				>
			</span>
		</li>`;
	}

	/** Renders the compose/review/resolve scope-override rows, or nothing while they're
	 * still loading — the panel already skeletons the whole list until `ai` resolves, and a
	 * partial list (top-level rows present, these absent) is better than a second mid-list
	 * skeleton. A fetch failure also renders nothing here; the top-level `serviceErrors.ai`
	 * retry (above) is the only recovery affordance, same as the provider/model row. */
	private renderScopedModelRows() {
		const scopedModels = this._state.scopedAiModels.get();
		if (scopedModels == null) return nothing;

		return scopedModels.map(info => this.renderScopedModelRow(info));
	}

	private renderScopedModelRow(info: ScopedAiModelInfo) {
		const { scope, model, isOverride } = info;
		const meta = scopedModelMeta[scope];
		// The scoped fallback isn't necessarily the global default model (it prefers a
		// faster model), so naming it here is deliberate — "same as above" would be wrong.
		// "select a default above" rather than a bare "unavailable": with no default and no override
		// there's nothing to inherit, and the default row directly above is the only way out
		const details =
			model == null ? 'No model — select a default above' : isOverride ? model.name : `Default — ${model.name}`;

		return html`<li class="row row--${model != null ? 'connected' : 'disconnected'}">
			<code-icon class="row__icon" icon="${meta.icon}" aria-hidden="true"></code-icon>
			<span class="row__content">
				<span class="row__title">${meta.label}</span>
				<span class="row__details">${details}</span>
			</span>
			<span class="row__actions">
				<gl-button
					appearance="secondary"
					aria-label="Switch AI Model for ${meta.label}"
					tooltip="Switch AI Model for ${meta.label}"
					@click=${() => void this.actions?.switchAiModel(scope)}
					><code-icon icon="arrow-swap" slot="prefix" aria-hidden="true"></code-icon> Switch</gl-button
				>
				${
					isOverride
						? html`<gl-button
								appearance="secondary"
								aria-label="Use Default AI Model for ${meta.label}"
								tooltip="Use Default AI Model for ${meta.label}"
								@click=${() => void this.actions?.resetAiModel(scope)}
								><code-icon icon="discard" slot="prefix" aria-hidden="true"></code-icon> Use
								Default</gl-button
							>`
						: nothing
				}
			</span>
		</li>`;
	}
}
