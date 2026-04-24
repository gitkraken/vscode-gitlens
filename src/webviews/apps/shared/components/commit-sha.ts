import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { isUncommitted, shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import './code-icon.js';
import './copy-container.js';

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

	@property({ type: String })
	icon: string = 'git-commit';

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

		return html`<code-icon part="icon" class="icon" icon="${this.icon}" size="${this.size}"></code-icon
			><span part="label">${this.label}</span>`;
	}
}

@customElement('gl-commit-sha-copy')
export class GlCommitShaCopy extends LitElement {
	static override styles = [
		styles,
		css`
			:host(:focus) {
				outline: none;
			}
		`,
	];

	@property({ type: String })
	sha?: string;

	@property({ type: String })
	icon: string = 'git-commit';

	@property({ type: Number })
	size: number = 12;

	@property({ reflect: true })
	appearance?: 'toolbar';

	@property({ type: String, attribute: 'copy-label' })
	copyLabel: string = 'Copy';

	@property({ type: String, attribute: 'copied-label' })
	copiedLabel: string = 'Copied!';

	@property({ type: String, attribute: 'tooltip-placement' })
	tooltipPlacement: string = 'top';

	override render(): unknown {
		if (this.sha == null) return nothing;

		return html`<gl-copy-container
			.content=${this.sha}
			placement="${this.tooltipPlacement}"
			.copyLabel=${this.copyLabel}
			.copiedLabel=${this.copiedLabel}
			.appearance=${this.appearance}
		>
			<gl-commit-sha
				exportparts="icon, label"
				.sha=${this.sha}
				.icon=${this.icon}
				.size=${this.size}
			></gl-commit-sha>
		</gl-copy-container>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-commit-sha': GlCommitSha;
		'gl-commit-sha-copy': GlCommitShaCopy;
	}
}
