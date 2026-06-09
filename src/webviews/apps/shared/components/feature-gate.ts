import type { PropertyValues } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import type { SubscriptionState } from '../../../../constants.subscription.js';
import type { Source } from '../../../../constants.telemetry.js';
import type { FeaturePreview } from '../../../../features.js';
import { isSubscriptionTrialOrPaidFromState } from '../../../../plus/gk/utils/subscription.utils.js';
import { linkStyles } from '../../plus/shared/components/vscode.css.js';
import { featureGateBaseStyles } from './feature-gate.css.js';
import { focusableBaseStyles } from './styles/lit/a11y.css.js';
import { scrollableBase } from './styles/lit/base.css.js';
import './button.js';
import './code-icon.js';
import '../../plus/shared/components/feature-gate-plus-state.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-feature-gate': GlFeatureGate;
	}

	interface GlobalEventHandlersEventMap {
		'gl-switch-repos': CustomEvent<void>;
	}
}

@customElement('gl-feature-gate')
export class GlFeatureGate extends LitElement {
	static override styles = [focusableBaseStyles, linkStyles, scrollableBase, featureGateBaseStyles];

	@query('dialog')
	private readonly dialogEl!: HTMLDialogElement | null;

	@property({ type: Boolean })
	allowRepoSwitch = false;

	@property({ reflect: true })
	appearance?: 'alert' | 'default';

	@property({ type: Object })
	featurePreview?: FeaturePreview;

	@property({ type: String })
	featurePreviewCommandLink?: string;

	@property()
	featureRestriction?: 'all' | 'private-repos';

	@property()
	featureWithArticleIfNeeded?: string;

	@property({ type: Object })
	source?: Source;

	@property({ attribute: false, type: Number })
	state?: SubscriptionState;

	@property({ type: String })
	webroot?: string;

	override disconnectedCallback(): void {
		// Defensively tear down the modal so an unmounted gate can never leave a stuck top-layer backdrop.
		this.dialogEl?.close();
		super.disconnectedCallback?.();
	}

	protected override updated(_changedProperties: PropertyValues): void {
		// Promote the dialog into the top layer once it's rendered. Consumers mount the gate only while it
		// should show, so the dialog opens here on mount; unmounting (or a Pro-state re-render that returns
		// nothing) removes it from the DOM, which tears the modal back down.
		const dialog = this.dialogEl;
		if (dialog != null && !dialog.open) {
			dialog.showModal();
		}
	}

	override render(): unknown {
		if (isSubscriptionTrialOrPaidFromState(this.state)) return undefined;

		const appearance =
			(this.appearance ?? (document.body.getAttribute('data-placement') ?? 'editor') === 'editor')
				? 'alert'
				: 'default';

		return html`
			<dialog part="section" @cancel=${this.onCancel} @keydown=${this.onKeydown}>
				<div class="content scrollable">
					<slot></slot>
					<gl-feature-gate-plus-state
						appearance=${appearance}
						.featurePreview=${this.featurePreview}
						.featurePreviewCommandLink=${this.featurePreviewCommandLink}
						.featureRestriction=${this.featureRestriction}
						.featureWithArticleIfNeeded=${this.featureWithArticleIfNeeded}
						.source=${this.source}
						.state=${this.state}
						.webroot=${this.webroot}
					>
						<slot name="feature" slot="feature"></slot>
					</gl-feature-gate-plus-state>
				</div>
				${this.allowRepoSwitch
					? html`<gl-button
							class="switch-repos"
							appearance="toolbar"
							tooltip="Switch to a different repository"
							@click=${this.onSwitchRepos}
							><code-icon icon="gl-switch" slot="prefix"></code-icon> Switch Repos</gl-button
						>`
					: nothing}
			</dialog>
		`;
	}

	private onKeydown(e: KeyboardEvent): void {
		// The gate is a hard access block, so Escape must not dismiss it. The `cancel` handler below
		// isn't enough on its own: the gate opens via showModal() with no user gesture, which makes it a
		// Chromium "free" close watcher — Escape closes it and cancel's preventDefault() is ignored (an
		// anti-abuse measure against un-dismissable dialogs). Preventing the Escape keydown's default
		// stops the close request from ever being generated, which holds regardless of user activation.
		if (e.key === 'Escape') {
			e.preventDefault();
		}
	}

	private onCancel(e: Event): void {
		// Defense-in-depth for non-keyboard close requests (e.g. a system back gesture) — only effective
		// when the dialog has user activation; the keyboard path is handled in onKeydown above.
		e.preventDefault();
	}

	private onSwitchRepos(): void {
		this.dispatchEvent(new CustomEvent('gl-switch-repos', { bubbles: true, composed: true }));
	}
}
