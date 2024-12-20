import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { GitMergeStatus } from '../../../../../git/models/merge';
import type { GitRebaseStatus } from '../../../../../git/models/rebase';
import { getReferenceLabel } from '../../../shared/git-utils';
import '../../../shared/components/overlays/tooltip';

@customElement('gl-merge-rebase-status')
export class GlMergeConflictWarning extends LitElement {
	static override styles = [
		css`
			.status {
				display: flex;
				align-items: center;
				gap: 0.6rem;
				max-width: 100%;
				margin-block: 0;
				background-color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
				color: #000;
				border-radius: 0.3rem;
				padding: 0.1rem 0.4rem;
			}

			:host([conflicts]) .status {
				background-color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingConflictForegroundColor);
				color: #fff;
			}

			.label {
				flex-grow: 1;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.icon,
			.steps {
				flex: none;
			}

			.md-code {
				background: var(--vscode-textCodeBlock-background);
				border-radius: 3px;
				padding: 0px 4px 2px 4px;
				font-family: var(--vscode-editor-font-family);
			}
		`,
	];

	@property({ type: Boolean, reflect: true })
	conflicts = false;

	@property({ type: Object })
	merge?: GitMergeStatus;

	@property({ type: Object })
	rebase?: GitRebaseStatus;

	override render() {
		if (this.merge == null && this.rebase == null) return nothing;

		return html`
			<span class="status">
				<code-icon icon="warning" class="icon"></code-icon>
				${when(
					this.merge != null,
					() => this.renderMerge(),
					() => this.renderRebase(),
				)}
			</span>
		`;
	}

	private renderMerge() {
		return html`<span class="label"
			>${this.conflicts ? 'Resolve conflicts before merging' : 'Merging'} into
			${getReferenceLabel(this.merge!.current, { expand: false, icon: false })}</span
		>`;
	}

	private renderRebase() {
		const started = this.rebase!.steps.total > 0;
		return html`<span class="label"
				>${this.conflicts ? 'Resolve conflicts to continue rebasing' : started ? 'Rebasing' : 'Pending rebase'}
				onto
				${getReferenceLabel(this.rebase!.current ?? this.rebase!.onto, {
					expand: false,
					icon: false,
				})}</span
			>${started
				? html`<span class="steps">(${this.rebase!.steps.current.number}/${this.rebase!.steps.total})</span>`
				: nothing}`;
	}
}
