import { css, html, LitElement, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GitBranchStatus } from '../../../../git/models/branch';
import { renderBranchName } from './branch-name';
import './overlays/tooltip';

@customElement('gl-branch-icon')
export class GlBranchIcon extends LitElement {
	static override styles = css`
		:host {
			display: inline-flex;
			width: 16px;
			height: 16px;

			--gl-icon-color-foreground: var(--vscode-foreground, #c5c5c5);

			--gl-icon-color-status-synced: var(
				--gl-icon-color-foreground,
				var(--vscode-gitlens-decoration\\.branchUpToDateForegroundColor)
			);
			--gl-icon-color-status-diverged: var(--vscode-gitlens-decorations\\.branchDivergedForegroundColor, #ff5);
			--gl-icon-color-status-behind: var(--vscode-gitlens-decorations\\.branchBehindForegroundColor, #f05);
			--gl-icon-color-status-ahead: var(--vscode-gitlens-decorations\\.branchAheadForegroundColor, #0f5);
			--gl-icon-color-status-missingUpstream: var(
				--vscode-gitlens-decorations\\.branchMissingUpstreamForegroundColor,
				#c74e39
			);
			--gl-icon-color-status-changes: #1a79ff;
		}

		:host-context(.vscode-dark),
		:host-context(.vscode-high-contrast) {
			--gl-icon-color-foreground: #c5c5c5;
		}

		:host-context(.vscode-light),
		:host-context(.vscode-high-contrast-light) {
			--gl-icon-color-foreground: #424242;
		}

		p {
			margin: 0;
		}

		p + p {
			margin-top: 0.4rem;
		}

		svg {
			width: 100%;
			height: 100%;
			margin-top: -0.2rem;
			vertical-align: middle;
		}
	`;

	@property({ type: String })
	branch?: string;

	@property({ type: String })
	status?: GitBranchStatus;

	@property({ type: Boolean })
	hasChanges: boolean = false;

	@property({ type: String })
	upstream?: string;

	@property({ type: Boolean })
	worktree: boolean = false;

	override render() {
		return html`<gl-tooltip placement="bottom"
			>${this.renderIcon()}<span slot="content">${this.renderTooltipContent()}</span></gl-tooltip
		>`;
	}

	private renderIcon() {
		if (!this.worktree && (!this.status || this.status === 'local')) {
			return html`<code-icon icon="git-branch"></code-icon>`;
		} else if (this.status === 'detached') {
			return html`<code-icon icon="git-commit"></code-icon>`;
		}

		let cssColor;
		let strokeWidth = '0.5';
		switch (this.status) {
			case 'diverged':
				cssColor = 'var(--gl-icon-color-status-diverged)';
				break;
			case 'behind':
				cssColor = 'var(--gl-icon-color-status-behind)';
				break;
			case 'ahead':
				cssColor = 'var(--gl-icon-color-status-ahead)';
				break;
			case 'missingUpstream':
				cssColor = 'var(--gl-icon-color-status-missingUpstream)';
				break;
			case 'upToDate':
				cssColor = `var(--gl-icon-color-status-${this.hasChanges ? 'changes' : 'synced'})`;
				break;
			default:
				if (this.hasChanges) {
					cssColor = 'var(--gl-icon-color-status-changes)';
				} else {
					cssColor = 'transparent';
					strokeWidth = '1';
				}
				break;
		}

		if (this.worktree) {
			return svg`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16">
				<path
					fill="var(--gl-icon-color-foreground, #c5c5c5)"
					d="M13.5 4h.501v1.003h-.2a5.5 5.5 0 0 1 1.2.755V3.5l-.5-.5H13.5v1zm-4 0V3H7.713l-.852-.854L6.507 2H1.511l-.5.5v3.996L1 6.507v6.995l.5.5h6.227a5.528 5.528 0 0 1-.836-1H2V7.496h.01v-.489h4.486l.354-.146.858-.858h.014a5.51 5.51 0 0 1 1.477-1H7.5l-.353.147-.858.857H2.011V3H6.3l.853.853.353.146H9.5z"
				/>
				<path
					fill="${cssColor}"
					stroke="var(--gl-icon-color-foreground, #c5c5c5)"
					stroke-width="${strokeWidth}"
					d="M11.5 6.75a3.25 3.25 0 1 1 0 6.5 3.25 3.25 0 0 1 0-6.5z"
				/>
				<path stroke="var(--gl-icon-color-foreground, #c5c5c5)" d="M11.5 13v3M11.5 1v6" />
			</svg>`;
		}

		return svg`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16">
			<path
				fill="${cssColor}"
				stroke="var(--gl-icon-color-foreground, #c5c5c5)"
				stroke-width="${strokeWidth}"
				d="M12 10.25a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5z"
			/>
			<path
				fill="var(--gl-icon-color-foreground, #c5c5c5)"
				d="M6 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM5 5.95a2.5 2.5 0 1 0-1 0v4.1a2.5 2.5 0 1 0 1.165.04c.168-.38.383-.622.61-.78.327-.227.738-.32 1.214-.31H7c.387 0 .76.03 1.124.059l.026.002c.343.027.694.055 1.003.046.313-.01.661-.06.954-.248.29-.185.466-.466.544-.812a.756.756 0 0 1 .046-.055 2.5 2.5 0 1 0-1.03-.134c-.028.108-.07.14-.1.16-.063.04-.191.08-.446.089a8.783 8.783 0 0 1-.917-.045A14.886 14.886 0 0 0 7.005 8c-.61-.013-1.249.105-1.8.488-.07.05-.14.102-.205.159V5.95zm7-.45a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm-9 7a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z"
			/>
		</svg>`;
	}

	private renderTooltipContent() {
		const branchName = this.branch ? renderBranchName(this.branch) : 'Branch';

		let tooltip;
		const upstream = this.upstream ? renderBranchName(this.upstream) : 'its upstream';
		switch (this.status) {
			case 'diverged':
				tooltip = html`${branchName} has diverged from ${upstream}`;
				break;
			case 'behind':
				tooltip = html`${branchName} is behind ${upstream}`;
				break;
			case 'ahead':
				tooltip = html`${branchName} is ahead of ${upstream}`;
				break;
			case 'missingUpstream':
				tooltip = html`${branchName} is missing its upstream ${upstream}`;
				break;
			case 'upToDate':
				tooltip = html`${branchName} is up to date with ${upstream}`;
				break;
			case 'local':
				tooltip = html`${branchName} is a local branch which has't been published`;
				break;
			case 'remote':
				tooltip = html`${branchName} is a remote branch`;
				break;
			case 'detached':
				tooltip = html`${branchName} is in a detached state, i.e. checked out to a commit or tag`;
				break;
			default:
				tooltip = html`${branchName} is in an unknown state`;
				break;
		}

		tooltip = html`<p>${tooltip}</p>`;
		if (this.worktree) {
			if (this.hasChanges) {
				tooltip = html`${tooltip}
					<p>Checked out in a worktree and has working (uncommitted) changes</p>`;
			} else {
				tooltip = html`${tooltip}
					<p>Checked out in a worktree</p>`;
			}
		} else if (this.hasChanges) {
			tooltip = html`${tooltip}
				<p>Has working (uncommitted) changes</p>`;
		}
		return tooltip;
	}
}
