import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { GitReference } from '@gitlens/git/models/reference.js';
import { pausedOperationStatusStringsByType } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import type { ContinueRebaseWithAiCommandArgs } from '../../../../../commands/autoRebase.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { ShowInCommitGraphCommandArgs } from '../../../../plus/graph/registration.js';
import type { WebviewContext } from '../../../shared/contexts/webview.js';
import { webviewContext } from '../../../shared/contexts/webview.js';
import '../../../shared/components/actions/action-item.js';
import '../../../shared/components/actions/action-nav.js';
import '../../../shared/components/branch-name.js';
import '../../../shared/components/code-icon.js';
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

			/* Read-only (mode) banner: baseline-align so the "(N/M)" step counter lines up with the
			   status text. The branch-name chips inflate the label's line-box, so plain center-alignment
			   leaves the counter sitting too low. Keep the warning icon centered. */
			:host([readonly]) .status {
				align-items: baseline;
			}

			:host([readonly]) .icon {
				align-self: center;
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

	/** Opt-in for routing the conflicts status text into Resolve Conflicts mode (fires
	 *  `ai-resolve-conflicts`). Only hosts that can handle the event (the graph WIP details) should
	 *  enable it; elsewhere the text falls back to revealing the conflicts. */
	@property({ type: Boolean, attribute: 'ai-resolve' })
	aiResolve = false;

	/** Opt-in for showing a "Resume with AI" action on a paused rebase — re-engages automatic rebase
	 *  (takeover) to finish the remaining steps. Only enabled by hosts where AI is allowed (graph). */
	@property({ type: Boolean, attribute: 'ai-resume' })
	aiResume = false;

	/** Render the bar as a plain status read-out — no paused-op action buttons and no clickable
	 *  conflicts text. Set by hosts that are in a mode (compose/review/resolve) so the bar doesn't
	 *  compete with the mode's own controls. */
	@property({ type: Boolean, attribute: 'readonly', reflect: true })
	readOnly = false;

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

	private get onContinueWithAiUrl() {
		return createCommandLink<ContinueRebaseWithAiCommandArgs>('gitlens.ai.continueRebase', {
			repoPath: this.pausedOpStatus?.repoPath,
			source: 'graph',
		});
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
		if (!this.conflicts || this.readOnly) return label;

		// With AI resolve available (graph host), clicking the status text enters Resolve Conflicts mode.
		// Elsewhere it falls back to revealing the conflicts in the tree / rebase editor.
		if (this.aiResolve) {
			return html`<gl-tooltip content="Resolve Conflicts">
				<a href="#" class="link" @click=${this.onResolveWithAI}>${label}</a>
			</gl-tooltip>`;
		}

		return html`<gl-tooltip content="Show Conflicts">
			<a href="${this.onShowConflictsUrl}" class="link">${label}</a>
		</gl-tooltip>`;
	}

	private renderReference(ref: GitReference) {
		const isBranch = ref.refType === 'branch';
		const content = isBranch
			? html`<gl-branch-name .name=${ref.name} .size=${12}></gl-branch-name>`
			: html`<gl-commit-sha .sha=${ref.ref} .size=${12}></gl-commit-sha>`;

		// Read-only: plain ref text, no jump-to-branch/commit link or tooltip.
		if (this.readOnly) return content;

		const webviewId = this._webview.webviewId;
		const isInGraph = webviewId === 'gitlens.graph' || webviewId === 'gitlens.views.graph';

		const tooltip = isInGraph
			? isBranch
				? 'Jump to Branch'
				: 'Jump to Commit'
			: isBranch
				? 'Open Branch in Commit Graph'
				: 'Open Commit in Commit Graph';
		const jumpUrl = this.createJumpUrl(ref);

		return html`<gl-tooltip content=${tooltip}>
			<a href=${jumpUrl} class="ref-link">${content}</a>
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
		if (this.pausedOpStatus == null || this.readOnly) return nothing;

		const status = this.pausedOpStatus.type;
		// "Continue with AI" is offered only while the rebase actually has conflicts to resolve — there
		// it's the single continue affordance (standard resume icon), since plain "Continue" is already
		// hidden by the conflicts check below. A rebase paused without conflicts (an interactive
		// edit/break, or once resolutions are staged) keeps plain "Continue" so it can still be advanced
		// — AI has nothing to resolve there, and the takeover would only escalate.
		const aiRebase = status === 'rebase' && this.aiResume && this.conflicts;
		// Plain `<op> --continue` is valid once a rebase has no unresolved conflicts.
		const canContinue = status !== 'revert' && !(status === 'rebase' && this.conflicts);

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
				canContinue,
				() => html`<action-item label="Continue" icon="gl-continue" href=${this.onContinueUrl}></action-item>`,
			)}
			${when(
				aiRebase,
				() =>
					html`<action-item
						label="Continue with AI"
						href=${this.onContinueWithAiUrl}
						icon="gl-continue"
					></action-item>`,
			)}
			${when(
				status !== 'merge',
				() => html`<action-item label="Skip" icon="gl-skip" href=${this.onSkipUrl}></action-item>`,
			)}
			<action-item label="Abort" href=${this.onAbortUrl} icon="gl-abort"></action-item>
		</action-nav>`;
	}
}
