import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { GitReference } from '@gitlens/git/models/reference.js';
import { pausedOperationStatusStringsByType } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { ShowInCommitGraphCommandArgs } from '../../../../plus/graph/registration.js';
import type { WebviewContext } from '../../../shared/contexts/webview.js';
import { webviewContext } from '../../../shared/contexts/webview.js';
import '../../../shared/components/actions/action-item.js';
import '../../../shared/components/actions/action-nav.js';
import '../../../shared/components/branch-name.js';
import '../../../shared/components/commit-sha.js';
import '../../../shared/components/overlays/tooltip.js';

@customElement('gl-merge-rebase-status')
export class GlMergeConflictWarning extends LitElement {
	static override styles = [
		css`
			.status {
				--action-item-foreground: #000;
				/* Blend the action hover/active states into the banner instead of the generic
				   grey toolbar hover. currentColor tracks --action-item-foreground, so the
				   conflicts variant (white foreground) tints correctly without redeclaring. */
				--action-item-hover-background: color-mix(in srgb, currentColor 12%, transparent);
				--action-item-active-background: color-mix(in srgb, currentColor 22%, transparent);

				box-sizing: border-box;
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				width: 100%;
				max-width: 100%;
				padding: 0.1rem 0.4rem;
				margin-block: 0;
				color: #000;
				background-color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
				border-radius: var(--gl-radius-sm);
			}

			:host([conflicts]) .status {
				--action-item-foreground: #fff;

				color: #fff;
				background-color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingConflictForegroundColor);
			}

			.label {
				flex: 1;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.icon,
			.steps,
			.actions {
				flex: none;
			}

			.md-code {
				padding: 0 var(--gl-space-4) var(--gl-space-2);
				font-family: var(--vscode-editor-font-family);
				background: var(--vscode-textCodeBlock-background);
				border-radius: var(--gl-radius-sm);
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
				margin-left: var(--gl-space-10);
			}

			.ref-link {
				color: inherit;
				text-decoration: none !important;
				cursor: pointer;
			}
		`,
	];

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	@property({ type: Boolean, reflect: true })
	conflicts = false;

	/** Opt-in for the "Resolve Conflicts with AI" action (fires `ai-resolve-conflicts`). Only hosts
	 *  that can route the event into a resolve flow (the graph WIP details) should enable it —
	 *  otherwise the action would render as a dead button. */
	@property({ type: Boolean, attribute: 'ai-resolve' })
	aiResolve = false;

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
		return this._webview.createCommandLink(`gitlens.pausedOperation.${command}:`, this.pausedOpStatus);
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

		return html`<gl-tooltip content="Show Conflicts">
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

		return html`<gl-tooltip content=${tooltip}>
			<a href=${jumpUrl} class="ref-link">
				${isBranch
					? html`<gl-branch-name .name=${ref.name} .size=${12}></gl-branch-name>`
					: html`<gl-commit-sha .sha=${ref.ref} .size=${12}></gl-commit-sha>`}
			</a>
		</gl-tooltip>`;
	}

	private createJumpUrl(ref: GitReference): string {
		return createCommandLink<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', {
			ref: ref,
			source: { source: 'merge-target' },
		});
	}

	private onResolveWithAI = (e: Event): void => {
		e.preventDefault();
		this.dispatchEvent(new CustomEvent('ai-resolve-conflicts', { bubbles: true, composed: true }));
	};

	private renderActions() {
		if (this.pausedOpStatus == null) return nothing;

		const status = this.pausedOpStatus.type;

		return html`<action-nav class="actions">
			${when(
				this.conflicts && this.aiResolve,
				() =>
					html`<action-item
						label="Resolve Conflicts with AI"
						icon="sparkle"
						@click=${this.onResolveWithAI}
					></action-item>`,
			)}
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
					<action-item label="Continue" icon="gl-continue" href=${this.onContinueUrl}></action-item>
				`,
			)}
			${when(
				status !== 'merge',
				() => html`<action-item label="Skip" icon="gl-skip" href=${this.onSkipUrl}></action-item>`,
			)}
			<action-item label="Abort" href=${this.onAbortUrl} icon="gl-abort"></action-item>
		</action-nav>`;
	}
}
