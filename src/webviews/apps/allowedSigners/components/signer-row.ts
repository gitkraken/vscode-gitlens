import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { CandidateSigner, SignerProvider } from '../../../allowedSigners/protocol.js';
import type { Checkbox } from '../../shared/components/checkbox/checkbox.js';
import '../../shared/components/checkbox/checkbox.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/overlays/tooltip.js';

@customElement('gl-signer-row')
export class GlSignerRow extends LitElement {
	static override styles = css`
		:host {
			display: block;
		}

		.row {
			display: grid;
			grid-template-columns: auto auto 1fr auto;
			align-items: center;
			gap: 1rem;
			padding: 0.8rem 1.2rem;
			cursor: pointer;
		}

		.row:hover {
			background: var(--vscode-list-hoverBackground);
		}

		.row--present {
			cursor: default;
			opacity: 0.6;
		}

		.in-file-icon {
			color: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
		}

		.avatar {
			width: 2.4rem;
			height: 2.4rem;
			border-radius: 50%;
			color: var(--vscode-descriptionForeground);
		}

		.identity {
			display: flex;
			flex-direction: column;
			gap: 0.1rem;
			min-width: 0;
		}

		.name {
			font-weight: 600;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.email {
			color: var(--vscode-descriptionForeground);
			font-size: 1.2rem;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.keyinfo {
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 1.1rem;
			color: var(--vscode-descriptionForeground);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			max-width: 100%;
		}

		.details {
			display: flex;
			align-items: center;
			gap: 0.8rem;
			font-size: 1.1rem;
			color: var(--vscode-descriptionForeground);
			white-space: nowrap;
		}

		.provider-icon {
			color: var(--vscode-foreground);
		}

		.provider-icon--unverified {
			color: var(--vscode-descriptionForeground);
			opacity: 0.6;
		}
	`;

	@property({ type: Object })
	signer!: CandidateSigner;

	@property({ type: Boolean })
	included = true;

	/** Whether this signer is already in the target file; such rows are read-only (no add checkbox). */
	@property({ type: Boolean })
	present = false;

	/** The connected integration's provider, used to render the provider icon on provider-verified signers. */
	@property({ type: Object })
	provider?: SignerProvider;

	/** Whether a git-host integration is connected, to word the "not registered" tooltip accurately. */
	@property({ type: Boolean })
	integrationConnected = false;

	private onToggle(e: Event) {
		this.dispatchToggle((e.target as Checkbox).checked);
	}

	// Clicking anywhere on the row toggles the checkbox (the row is no longer a <label>, since wrapping a gl-checkbox —
	// which has its own internal <label> — in another <label> is invalid). The checkbox stops its own click from
	// bubbling here so a direct click isn't counted twice; keyboard activation goes through `onToggle` only.
	private onRowClick() {
		this.dispatchToggle(!this.included);
	}

	private dispatchToggle(included: boolean) {
		this.dispatchEvent(
			new CustomEvent('gl-toggle-signer', {
				detail: { id: this.signer.id, included: included },
				bubbles: true,
				composed: true,
			}),
		);
	}

	/**
	 * The right-side indicator of whether this signer's key is registered with the connected provider: the provider's
	 * own icon (with a "Registered with …" tooltip) when it is, or a muted "unverified" icon otherwise.
	 */
	private renderProviderIndicator(): unknown {
		const registered = this.signer.provenance === 'provider' || this.signer.provenance === 'both';
		if (registered) {
			const name = this.provider?.name;
			return html`<gl-tooltip .content=${name ? `Registered with ${name}` : 'Registered with a provider'}>
				<code-icon
					class="provider-icon"
					icon=${this.provider != null ? `gl-provider-${this.provider.icon}` : 'verified'}
				></code-icon>
			</gl-tooltip>`;
		}

		const content = this.integrationConnected
			? 'Not registered with a provider'
			: 'Connect an integration to verify registration';
		return html`<gl-tooltip .content=${content}>
			<code-icon class="provider-icon provider-icon--unverified" icon="unverified"></code-icon>
		</gl-tooltip>`;
	}

	override render(): unknown {
		const s = this.signer;
		const content = html`
			${this.present
				? html`<code-icon
						class="in-file-icon"
						icon="pass-filled"
						title="Already in your allowed_signers"
					></code-icon>`
				: html`<gl-checkbox
						.checked=${this.included}
						@gl-change-value=${this.onToggle}
						@click=${(e: Event) => e.stopPropagation()}
					></gl-checkbox>`}
			${s.avatarUrl
				? html`<img class="avatar" src=${s.avatarUrl} alt="" />`
				: html`<code-icon class="avatar" icon="account"></code-icon>`}
			<div class="identity">
				<span class="name">${s.name ?? s.email}</span>
				<span class="email">${s.email}</span>
				<span class="keyinfo" title="${s.keyType} ${s.keyData}">${s.keyType} · ${s.fingerprint}</span>
			</div>
			<div class="details">
				${s.commitCount
					? html`<span class="count">${s.commitCount} signed commit${s.commitCount === 1 ? '' : 's'}</span>`
					: nothing}
				${this.renderProviderIndicator()}
			</div>
		`;

		// Already-present rows are read-only (no checkbox), so they're a plain, non-interactive container.
		return this.present
			? html`<div class="row row--present">${content}</div>`
			: html`<div class="row" @click=${this.onRowClick}>${content}</div>`;
	}
}
