import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GitTrackingState } from '../../../../git/models/branch';
import { renderBranchName } from './branch-name';
import './overlays/tooltip';

type StatusType = 'synced' | 'diverged' | 'behind' | 'ahead' | 'changes' | 'missingUpstream' | undefined;

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
			--gl-icon-color-status-ahead: var(--vscode-gitlens-decorations\\.branchBehindForegroundColor, #0f5);
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

		svg {
			width: 100%;
			height: 100%;
		}
	`;

	@property({ type: String })
	branch?: string;

	@property({ type: String })
	state?: GitTrackingState;

	@property({ type: Boolean })
	missingUpstream: boolean = false;

	@property({ type: Boolean })
	hasChanges: boolean = false;

	@property({ type: String })
	upstream?: string;

	@property({ type: Boolean })
	worktree: boolean = false;

	private get status(): StatusType {
		if (!this.state) return undefined;

		let status: StatusType;

		if (this.hasChanges) {
			status = 'changes';
		} else if (this.missingUpstream) {
			status = 'missingUpstream';
		} else if (this.state.behind > 0 && this.state.ahead > 0) {
			status = 'diverged';
		} else if (this.state.behind > 0) {
			status = 'behind';
		} else if (this.state.ahead > 0) {
			status = 'ahead';
		} else {
			status = 'synced';
		}
		return status;
	}

	override render() {
		if (!this.state) {
			return html`<code-icon icon=${this.worktree ? 'gl-worktrees-view' : 'git-branch'}></code-icon>`;
		}

		const statusColor = this.getStatusCssColor();

		if (this.worktree) {
			return html`<gl-tooltip placement="bottom">
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16">
					<path
						fill="var(--gl-icon-color-foreground)"
						fill-rule="evenodd"
						d="M13.5 4h.501v1.003h-.2a5.5 5.5 0 0 1 1.2.755V3.5l-.5-.5H13.5v1zm-4 0V3H7.713l-.852-.854L6.507 2H1.511l-.5.5v3.996L1 6.507v6.995l.5.5h6.227a5.528 5.528 0 0 1-.836-1H2V7.496h.01v-.489h4.486l.354-.146.858-.858h.014a5.51 5.51 0 0 1 1.477-1H7.5l-.353.147-.858.857H2.011V3H6.3l.853.853.353.146H9.5z"
						clip-rule="evenodd"
					/>
					<path
						fill="${statusColor}"
						stroke="var(--gl-icon-color-foreground)"
						stroke-linejoin="bevel"
						stroke-width=".5"
						d="M11.5 6.75a3.25 3.25 0 1 1 0 6.5 3.25 3.25 0 0 1 0-6.5z"
					/>
					<path stroke="var(--gl-icon-color-foreground)" d="M11.5 13v3M11.5 1v6" />
				</svg>
				<div slot="content">${this.statusTooltip}</div>
			</gl-tooltip>`;
		}

		return html`<gl-tooltip placement="bottom">
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16">
				<path
					fill="${statusColor}"
					stroke="var(--gl-icon-color-foreground)"
					stroke-linejoin="bevel"
					stroke-width=".5"
					d="M12 10.25a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5z"
				/>
				<path
					fill="var(--gl-icon-color-foreground)"
					fill-rule="evenodd"
					d="M6 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM5 5.95a2.5 2.5 0 1 0-1 0v4.1a2.5 2.5 0 1 0 1.165.04c.168-.38.383-.622.61-.78.327-.227.738-.32 1.214-.31H7c.387 0 .76.03 1.124.059l.026.002c.343.027.694.055 1.003.046.313-.01.661-.06.954-.248.29-.185.466-.466.544-.812a.756.756 0 0 1 .046-.055 2.5 2.5 0 1 0-1.03-.134c-.028.108-.07.14-.1.16-.063.04-.191.08-.446.089a8.783 8.783 0 0 1-.917-.045A14.886 14.886 0 0 0 7.005 8c-.61-.013-1.249.105-1.8.488-.07.05-.14.102-.205.159V5.95zm7-.45a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm-9 7a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z"
					clip-rule="evenodd"
				/>
			</svg>
			<div slot="content">${this.statusTooltip}</div>
		</gl-tooltip>`;
	}

	private get statusTooltip() {
		const branchOrWorktree = html`<span
			>${this.branch ? renderBranchName(this.branch) : 'Branch'}${this.worktree ? ', in a worktree,' : ''}</span
		>`;

		const upstream = this.upstream ? renderBranchName(this.upstream) : 'its upstream';
		switch (this.status) {
			case 'diverged':
				return html`${branchOrWorktree} has diverged from ${upstream}`;
			case 'behind':
				return html`${branchOrWorktree} is behind ${upstream}`;
			case 'ahead':
				return html`${branchOrWorktree} is ahead of ${upstream}`;
			case 'changes':
				return html`${branchOrWorktree} has working changes`;
			case 'missingUpstream':
				return html`${branchOrWorktree} is missing its upstream ${upstream}`;
			case 'synced':
			default:
				return html`${branchOrWorktree} is up to date with ${upstream}`;
		}
	}

	private getStatusCssColor(): string {
		switch (this.status) {
			case 'diverged':
				return 'var(--gl-icon-color-status-diverged)';
			case 'behind':
				return 'var(--gl-icon-color-status-behind)';
			case 'ahead':
				return 'var(--gl-icon-color-status-ahead)';
			case 'changes':
				return 'var(--gl-icon-color-status-changes)';
			case 'missingUpstream':
				return 'var(--gl-icon-color-status-missingUpstream)';
			case 'synced':
			default:
				return 'var(--gl-icon-color-status-synced)';
		}
	}
}
