import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { GitPausedOperationStatus } from '../../../../../git/models/pausedOperationStatus';
import { pausedOperationStatusStringsByType } from '../../../../../git/utils/pausedOperationStatus.utils';
import { createCommandLink } from '../../../../../system/commands';
import { getReferenceLabel } from '../../../shared/git-utils';
import '../../../shared/components/actions/action-item';
import '../../../shared/components/actions/action-nav';
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

	private get onSkipUrl() {
		return createCommandLink('gitlens.home.skipPausedOperation', {
			operation: this.pausedOpStatus,
		});
	}

	private get onContinueUrl() {
		return createCommandLink('gitlens.home.continuePausedOperation', {
			operation: this.pausedOpStatus,
		});
	}

	private get onAbortUrl() {
		return createCommandLink('gitlens.home.abortPausedOperation', {
			operation: this.pausedOpStatus,
		});
	}

	private get onOpenEditorUrl() {
		return createCommandLink('gitlens.home.openRebaseEditor', {
			operation: this.pausedOpStatus,
		});
	}

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
					${getReferenceLabel(pausedOpStatus.incoming, { expand: false, icon: false })}
					${strings.directionality}
					${getReferenceLabel(pausedOpStatus.current, { expand: false, icon: false })}</span
				>${this.renderActions()}`;
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
				: nothing}${this.renderActions()}`;
	}

	private renderActions() {
		if (this.pausedOpStatus == null) return nothing;

		const status = this.pausedOpStatus.type;

		return html`<action-nav>
			${when(
				status !== 'revert',
				() => html`
					<action-item label="Continue" icon="debug-continue" href=${this.onContinueUrl}></action-item>
				`,
			)}
			${when(
				status !== 'merge',
				() => html`<action-item label="Skip" icon="debug-step-over" href=${this.onSkipUrl}></action-item>`,
			)}
			<action-item label="Abort" href=${this.onAbortUrl} icon="circle-slash"></action-item>
			${when(
				status === 'rebase',
				() =>
					html`<action-item
						label="Open in Rebase Editor"
						href=${this.onOpenEditorUrl}
						icon="edit"
					></action-item>`,
			)}
		</action-nav>`;
	}
}
