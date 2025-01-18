import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { Commands } from '../../../../../constants.commands';
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
				box-sizing: border-box;
				display: flex;
				align-items: center;
				gap: 0.6rem;
				width: 100%;
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
				flex: 1;
				min-width: 0;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.icon,
			.steps,
			.actions {
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

	@property()
	skipCommand = 'gitlens.home.skipPausedOperation';

	@property()
	continueCommand = 'gitlens.home.continuePausedOperation';

	@property()
	abortCommand = 'gitlens.home.abortPausedOperation';

	@property()
	openEditorCommand = 'gitlens.home.openRebaseEditor';

	private get onSkipUrl() {
		return createCommandLink(this.skipCommand as Commands, this.pausedOpStatus);
	}

	private get onContinueUrl() {
		return createCommandLink(this.continueCommand as Commands, this.pausedOpStatus);
	}

	private get onAbortUrl() {
		return createCommandLink(this.abortCommand as Commands, this.pausedOpStatus);
	}

	private get onOpenEditorUrl() {
		return createCommandLink(this.openEditorCommand as Commands, this.pausedOpStatus);
	}

	override render() {
		if (this.pausedOpStatus == null) return nothing;

		return html`
			<span class="status" part="base">
				<code-icon icon="warning" class="icon"></code-icon>
				${this.renderStatus(this.pausedOpStatus)}${this.renderActions()}
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

	private renderActions() {
		if (this.pausedOpStatus == null) return nothing;

		const status = this.pausedOpStatus.type;

		return html`<action-nav class="actions">
			${when(
				status !== 'revert' && !(status === 'rebase' && this.conflicts),
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
