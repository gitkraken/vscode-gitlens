import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '../overlays/popover';
import '../actions/action-item';
import '../code-icon';

@customElement('gl-connect')
export class GlConnect extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = css`
		.inline-popover {
			display: inline-block;
		}
	`;

	@property()
	type: 'text' | 'inline' | 'action' = 'text';

	@property({ type: Boolean })
	account = false;

	@property({ type: Boolean })
	connected = false;

	@property()
	label: string = 'Provider';

	@property()
	integration?: string;

	@property({ attribute: 'connect-url' })
	connectUrl?: string;

	@property()
	url?: string;

	@property()
	icon?: string;

	get connectIntegrationUrl() {
		return this.connectUrl ?? this.url;
	}

	get integrationLabel() {
		return this.integration ?? this.label;
	}

	override render() {
		switch (this.type) {
			case 'inline':
				return this.renderInline();
			case 'action':
				return this.renderAction();
			default:
				return this.renderText();
		}
	}

	private renderText() {
		if (this.account && this.connected) {
			return html`<code-icon icon="check" style="vertical-align: text-bottom"></code-icon> ${this
					.integrationLabel}
				connected &mdash; automatic rich ${this.integrationLabel} autolinks are enabled`;
		}

		return html`<a href="${this.connectIntegrationUrl}">Connect to ${this.integrationLabel}</a> &mdash;
			${this.account ? '' : 'sign up and '}get access to automatic rich ${this.integrationLabel} autolinks`;
	}

	private renderInline() {
		return html`<gl-popover hoist class="inline-popover">
			<span class="tooltip-hint" slot="anchor"
				>${this.label} <code-icon icon="${this.connected ? 'check' : 'gl-unplug'}"></code-icon
			></span>
			<span slot="content">${this.renderText()}</span>
		</gl-popover>`;
	}

	private renderAction() {
		let icon = this.icon ?? 'plug';
		let label = `Connect to ${this.integration ?? this.label}`;
		let href = this.connectIntegrationUrl ?? nothing;
		if (this.account && this.connected) {
			icon = this.icon ?? 'gl-unplug';
			label = `Manage ${this.label}`;
			href = this.url ?? nothing;
		}
		return html`<action-item label="${label}" icon="${icon}" href="${href}"></action-item>`;
	}
}
