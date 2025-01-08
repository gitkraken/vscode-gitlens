import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GitPausedOperationStatus } from '../../../../../git/models/pausedOperationStatus';
import { pausedOperationStatusStringsByType } from '../../../../../git/utils/pausedOperationStatus.utils';
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
	pausedOpStatus?: GitPausedOperationStatus;

	override render() {
		if (this.pausedOpStatus == null) return nothing;

		return html`
			<span class="status">
				<code-icon icon="warning" class="icon"></code-icon>
				${this.renderStatus(this.pausedOpStatus)}
			</span>
		`;
	}

	private renderStatus(pausedOpStatus: GitPausedOperationStatus) {
		if (pausedOpStatus.type !== 'rebase') {
			const strings = pausedOperationStatusStringsByType[pausedOpStatus.type];
			return html`<span class="label"
				>${this.conflicts ? strings.conflicts : strings.label}
				<code-icon
					icon="${pausedOpStatus.incoming.refType === 'branch' ? 'git-branch' : 'git-commit'}"
					class="icon"
				></code-icon>
				${getReferenceLabel(pausedOpStatus.incoming, { expand: false, icon: false })} ${strings.directionality}
				${getReferenceLabel(pausedOpStatus.current, { expand: false, icon: false })}</span
			>`;
		}

		const started = pausedOpStatus.steps.total > 0;
		const strings = pausedOperationStatusStringsByType[pausedOpStatus.type];
		return html`<span class="label"
				>${this.conflicts ? strings.conflicts : started ? strings.label : strings.pending}
				<code-icon
					icon="${pausedOpStatus.incoming.refType === 'branch' ? 'git-branch' : 'git-commit'}"
					class="icon"
				></code-icon>
				${getReferenceLabel(pausedOpStatus.incoming, { expand: false, icon: false })} ${strings.directionality}
				${getReferenceLabel(pausedOpStatus.current ?? pausedOpStatus.onto, {
					expand: false,
					icon: false,
				})}</span
			>${started
				? html`<span class="steps"
						>(${pausedOpStatus.steps.current.number}/${pausedOpStatus.steps.total})</span
				  >`
				: nothing}`;
	}
}
