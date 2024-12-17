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
				display: inline-flex;
				align-items: center;
				gap: 0.6rem;
				max-width: 100%;
				margin-block: 0;
			}

			.icon {
				color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
			}

			:host([conflicts]) .icon {
				color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingConflictForegroundColor);
			}

			.label {
				flex-grow: 1;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
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
			<gl-tooltip>
				<span class="status">
					<code-icon icon="warning" class="icon"></code-icon>
					<span class="label">
						${when(
							this.merge != null,
							() => html`Merge in progress`,
							() => html`Rebase in progress`,
						)}
					</span>
				</span>
				<span slot="content">
					${when(
						this.merge != null,
						() => this.renderMergeTooltip(),
						() => this.renderRebaseTooltip(),
					)}
				</span>
			</gl-tooltip>
		`;
	}

	private renderMergeTooltip() {
		return html`${this.conflicts ? 'Resolve conflicts before merging' : 'Merging'}
			${this.merge!.incoming != null
				? html`<span class="md-code"
						>${getReferenceLabel(this.merge!.incoming, { expand: false, icon: false })}</span
				  > `
				: ''}into
			<span class="md-code">${getReferenceLabel(this.merge!.current, { expand: false, icon: false })}</span>`;
	}

	private renderRebaseTooltip() {
		const started = this.rebase!.steps.total > 0;
		return html`${this.conflicts
				? 'Resolve conflicts to continue rebasing'
				: started
				  ? 'Rebasing'
				  : 'Pending rebase of'}
			${this.rebase!.incoming != null
				? html`<span class="md-code"
						>${getReferenceLabel(this.rebase!.incoming, { expand: false, icon: false })}</span
				  > `
				: ''}
			onto
			<span class="md-code"
				>${getReferenceLabel(this.rebase!.current ?? this.rebase!.onto, {
					expand: false,
					icon: false,
				})}</span
			>${started ? ` (${this.rebase!.steps.current.number}/${this.rebase!.steps.total})` : ''}`;
	}
}
