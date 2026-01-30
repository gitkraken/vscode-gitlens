import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { CommitSignatureShape } from '../../../../commitDetails/protocol.js';
import { getSignatureIcon, getSignatureState } from './signature.utils.js';
import '../code-icon.js';

@customElement('gl-signature-badge')
export class GlSignatureBadge extends LitElement {
	static override styles = css`
		:host {
			display: inline-flex;
			align-items: center;
		}

		.badge {
			display: inline-flex;
			align-items: center;

			& code-icon {
				margin-top: 0.1rem;
			}
		}

		.badge--trusted {
			color: var(--vscode-charts-green);
		}

		.badge--unknown {
			color: var(--color-foreground--65);
		}

		.badge--untrusted {
			color: var(--vscode-charts-red);
		}
	`;

	@property({ type: String })
	committerEmail?: string;

	@property({ type: Object })
	signature?: CommitSignatureShape;

	override render() {
		if (this.signature == null) return nothing;

		const state = getSignatureState(this.signature, this.committerEmail);
		const icon = getSignatureIcon(state);

		return html`
			<span class="badge badge--${state}">
				<code-icon icon="${icon}"></code-icon>
			</span>
		`;
	}
}
