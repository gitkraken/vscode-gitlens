import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { WebviewCommands } from '../../../../../constants.commands';
import type { WebviewOrWebviewViewOrCustomEditorTypeFromId } from '../../../../../constants.views';
import type { GitPausedOperationStatus } from '../../../../../git/models/pausedOperationStatus';
import type { GitReference } from '../../../../../git/models/reference';
import { pausedOperationStatusStringsByType } from '../../../../../git/utils/pausedOperationStatus.utils';
import { createWebviewCommandLink } from '../../../../../system/webview';
import type { ShowInCommitGraphCommandArgs } from '../../../../plus/graph/registration';
import type { WebviewContext } from '../../../shared/contexts/webview';
import { webviewContext } from '../../../shared/contexts/webview';
import '../../../shared/components/actions/action-item';
import '../../../shared/components/actions/action-nav';
import '../../../shared/components/branch-name';
import '../../../shared/components/commit-sha';
import '../../../shared/components/overlays/tooltip';

@customElement('gl-merge-rebase-status')
export class GlMergeConflictWarning extends LitElement {
	static override styles = [
		css`
			.status {
				--action-item-foreground: #000;
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
				--action-item-foreground: #fff;
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

			gl-commit-sha::part(label) {
				font-weight: bold;
			}

			.link {
				color: inherit;
				text-decoration: underline dotted;
				text-underline-offset: 0.3rem;
				opacity: 0.9;

				&:hover {
					text-decoration: none;
					opacity: 1;
				}
			}

			.link--conflicts {
				margin-left: 1rem;
			}

			.ref-link {
				color: inherit;
				cursor: pointer;
				text-decoration: none !important;
			}
		`,
	];

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	@property({ type: Boolean, reflect: true })
	conflicts = false;

	@property({ type: Object })
	pausedOpStatus?: GitPausedOperationStatus;

	private get onSkipUrl() {
		return this.createPausedOperationCommandLink('skip');
	}

	private get onContinueUrl() {
		return this.createPausedOperationCommandLink('continue');
	}

	private get onAbortUrl() {
		return this.createPausedOperationCommandLink('abort');
	}

	private get onOpenEditorUrl() {
		return this.createPausedOperationCommandLink('open');
	}

	private get onShowConflictsUrl() {
		return this.createPausedOperationCommandLink('showConflicts');
	}

	private createPausedOperationCommandLink(
		command: 'abort' | 'continue' | 'open' | 'showConflicts' | 'skip',
	): string {
		const { webviewId, webviewInstanceId } = this._webview;
		const webviewType = webviewId.split('.').at(-1) as WebviewOrWebviewViewOrCustomEditorTypeFromId<
			typeof webviewId
		>;
		if (webviewType !== 'graph' && webviewType !== 'home') {
			debugger;
			return '';
		}

		return createWebviewCommandLink(
			`gitlens.pausedOperation.${command}:${webviewType}` as const,
			webviewId,
			webviewInstanceId,
			this.pausedOpStatus,
		);
	}

	override render(): unknown {
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
			const label = this.conflicts ? strings.conflicts : strings.label;
			return html`<span class="label"
				>${this.renderConflictsLink(label)} ${this.renderReference(pausedOpStatus.incoming)}
				${strings.directionality} ${this.renderReference(pausedOpStatus.current)}</span
			>`;
		}

		const started = pausedOpStatus.steps.total > 0;
		const strings = pausedOperationStatusStringsByType[pausedOpStatus.type];
		const label = this.conflicts ? strings.conflicts : started ? strings.label : strings.pending;
		return html`<span class="label"
				>${this.renderConflictsLink(label)} ${this.renderReference(pausedOpStatus.incoming)}
				${strings.directionality} ${this.renderReference(pausedOpStatus.current ?? pausedOpStatus.onto)}</span
			>${started
				? html`<span class="steps"
						>(${pausedOpStatus.steps.current.number}/${pausedOpStatus.steps.total})</span
					>`
				: nothing}`;
	}

	private renderConflictsLink(label: string) {
		if (!this.conflicts) return label;

		return html`<gl-tooltip hoist content="Show Conflicts">
			<a href="${this.onShowConflictsUrl}" class="link">${label}</a>
		</gl-tooltip>`;
	}

	private renderReference(ref: GitReference) {
		const webviewId = this._webview.webviewId;
		const isInGraph = webviewId === 'gitlens.graph' || webviewId === 'gitlens.views.graph';

		const isBranch = ref.refType === 'branch';
		const tooltip = isInGraph
			? isBranch
				? 'Jump to Branch'
				: 'Jump to Commit'
			: isBranch
				? 'Open Branch in Commit Graph'
				: 'Open Commit in Commit Graph';
		const jumpUrl = this.createJumpUrl(ref);

		return html`<gl-tooltip hoist content=${tooltip}>
			<a href=${jumpUrl} class="ref-link">
				${isBranch
					? html`<gl-branch-name .name=${ref.name} .size=${12}></gl-branch-name>`
					: html`<gl-commit-sha .sha=${ref.ref} .size=${12}></gl-commit-sha>`}
			</a>
		</gl-tooltip>`;
	}

	private createJumpUrl(ref: GitReference): string {
		return createWebviewCommandLink<ShowInCommitGraphCommandArgs>(
			'gitlens.showInCommitGraph' as WebviewCommands,
			this._webview.webviewId,
			this._webview.webviewInstanceId,
			{ ref: ref },
		);
	}

	private renderActions() {
		if (this.pausedOpStatus == null) return nothing;

		const status = this.pausedOpStatus.type;

		return html`<action-nav class="actions">
			${when(
				status === 'rebase',
				() =>
					html`<action-item
						label="Open in Rebase Editor"
						href=${this.onOpenEditorUrl}
						icon="edit"
					></action-item>`,
			)}
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
		</action-nav>`;
	}
}
