import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { CandidateSigner, SignerProvenance } from '../../../allowedSigners/protocol.js';
import '../../shared/components/code-icon.js';

const provenanceLabels: Record<SignerProvenance, string> = {
	both: 'Signed here & registered with provider',
	commits: 'Signed commits here',
	provider: 'Registered with provider',
};

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

		.key {
			display: flex;
			flex-direction: column;
			align-items: flex-end;
			gap: 0.2rem;
			text-align: right;
			min-width: 0;
		}

		.fingerprint {
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 1.1rem;
			color: var(--vscode-descriptionForeground);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			max-width: 100%;
		}

		.meta {
			display: flex;
			gap: 0.8rem;
			align-items: center;
			font-size: 1.1rem;
		}

		.provenance {
			padding: 0.1rem 0.6rem;
			border-radius: 1rem;
			font-size: 1.1rem;
			white-space: nowrap;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
		}

		/* Both are verified identity bindings from the host, so they share the same filled-green treatment. */
		.provenance--both,
		.provenance--provider {
			background: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
			color: var(--vscode-editor-background);
		}

		.present {
			display: inline-flex;
			align-items: center;
			gap: 0.3rem;
			color: var(--vscode-descriptionForeground);
		}
	`;

	@property({ type: Object })
	signer!: CandidateSigner;

	@property({ type: Boolean })
	included = true;

	/** Whether this signer is already in the target file; such rows are read-only (no add checkbox). */
	@property({ type: Boolean })
	present = false;

	private onToggle(e: Event) {
		const included = (e.target as HTMLInputElement).checked;
		this.dispatchEvent(
			new CustomEvent('gl-toggle-signer', {
				detail: { id: this.signer.id, included: included },
				bubbles: true,
				composed: true,
			}),
		);
	}

	override render(): unknown {
		const s = this.signer;
		return html`
			<label class="row ${this.present ? 'row--present' : ''}">
				${this.present
					? html`<code-icon
							class="in-file-icon"
							icon="pass-filled"
							title="Already in your allowed_signers"
						></code-icon>`
					: html`<input type="checkbox" .checked=${this.included} @change=${this.onToggle} />`}
				${s.avatarUrl
					? html`<img class="avatar" src=${s.avatarUrl} alt="" />`
					: html`<code-icon class="avatar" icon="account"></code-icon>`}
				<div class="identity">
					<span class="name">${s.name ?? s.email}</span>
					<span class="email">${s.email}</span>
				</div>
				<div class="key">
					<div class="meta">
						<span class="provenance provenance--${s.provenance}">${provenanceLabels[s.provenance]}</span>
						${s.commitCount
							? html`<span>${s.commitCount} signed commit${s.commitCount === 1 ? '' : 's'}</span>`
							: nothing}
						${this.present ? html`<span class="present">In file</span>` : nothing}
					</div>
					<span class="fingerprint" title="${s.keyType} ${s.keyData}">${s.keyType} · ${s.fingerprint}</span>
				</div>
			</label>
		`;
	}
}
