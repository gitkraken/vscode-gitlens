import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { isUncommitted, shortenRevision } from '../../../../git/utils/revision.utils';
import './code-icon';
import './copy-container';

@customElement('gl-commit-sha')
export class GlCommitSha extends LitElement {
	static override styles = css`
		:host {
			display: inline-block;
			max-width: 100%;
			align-content: center;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			vertical-align: middle;
			margin-top: -3px;
		}

		.icon {
			margin: 0 0.3rem 0.1rem 0.2rem;
		}
	`;

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
			return html`<span style="cursor:default;">${this.label}</span>`;
		}

		return html`<gl-copy-container .content=${this.sha} placement="top">
			<span><code-icon class="icon" icon="git-commit" size="${this.size}"></code-icon>${this.label}</span>
		</gl-copy-container>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-commit-sha': GlCommitSha;
	}
}

export function renderCommitSha(sha: string | undefined, size: number = 12): TemplateResult {
	return html`<gl-commit-sha .sha=${sha} .size=${size}></gl-commit-sha>`;
}
