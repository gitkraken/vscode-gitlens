import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { isUncommitted, shortenRevision } from '../../../../git/utils/revision.utils';
import './code-icon';
import './copy-container';

const styles = css`
	:host {
		display: inline-flex;
		align-items: baseline;
		max-width: 100%;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-inline-end: 0.2rem;
	}

	:host(:focus) {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: 2px;
	}

	.label--uncommitted {
		cursor: default;
	}

	.icon {
		margin-right: 0.3rem;
		align-self: center;
	}
`;

@customElement('gl-commit-sha')
export class GlCommitSha extends LitElement {
	static override styles = styles;

	@property({ type: String })
	sha?: string;

	@property({ type: Number })
	size: number = 12;

	private get label() {
		return shortenRevision(this.sha, {
			strings: { uncommitted: 'Working', uncommittedStaged: 'Staged', working: 'Working' },
		});
	}

	override render(): unknown {
		if (this.sha == null) return nothing;

		if (!this.sha || isUncommitted(this.sha)) {
			return html`<span part="label" class="label--uncommitted">${this.label}</span>`;
		}

		return html`<code-icon part="icon" class="icon" icon="git-commit" size="${this.size}"></code-icon
			><span part="label">${this.label}</span>`;
	}
}

@customElement('gl-commit-sha-copy')
export class GlCommitShaCopy extends LitElement {
	static override styles = styles;

	@property({ type: String })
	sha?: string;

	@property({ type: Number })
	size: number = 12;

	override render(): unknown {
		if (this.sha == null) return nothing;

		return html`<gl-copy-container .content=${this.sha} placement="top">
			<gl-commit-sha exportparts="icon, label" .sha=${this.sha} .size=${this.size}></gl-commit-sha>
		</gl-copy-container>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-commit-sha': GlCommitSha;
		'gl-commit-sha-copy': GlCommitShaCopy;
	}
}
