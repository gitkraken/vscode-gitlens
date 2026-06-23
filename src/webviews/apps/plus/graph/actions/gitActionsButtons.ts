import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { pausedOperationStatusStringsByType } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import { fromNow } from '@gitlens/utils/date.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { StashSaveCommandArgs } from '../../../../../commands/stashSave.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { BranchState, GraphAutoFetchMode, GraphWorkingTreeStats, State } from '../../../../plus/graph/protocol.js';
import { UpdateGraphConfigurationCommand } from '../../../../plus/graph/protocol.js';
import { inlineCode } from '../../../shared/components/styles/lit/base.css.js';
import { ipcContext } from '../../../shared/contexts/ipc.js';
import type { WebviewContext } from '../../../shared/contexts/webview.js';
import { webviewContext } from '../../../shared/contexts/webview.js';
import { ruleStyles } from '../../shared/components/vscode.css.js';
import { actionButton, linkBase } from '../styles/graph.css.js';
import '../../../shared/components/button.js';
import '../../../shared/components/checkbox/checkbox.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/commit/wip-stats.js';
import '../../../shared/components/menu/menu-divider.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/overlays/tooltip.js';

@customElement('gl-git-actions-buttons')
export class GitActionsButtons extends LitElement {
	static override styles = [
		linkBase,
		actionButton,
		ruleStyles,
		css`
			:host {
				display: contents;
			}

			gl-push-pull-button,
			gl-tooltip {
				flex-shrink: 0;
			}

			gl-fetch-button {
				flex: 0 1 max-content;
				min-width: 3.1rem;
			}

			/* Publish yields its label before Fetch loses a pixel, so the two collapse
	   sequentially (publish → icon, then fetch → icon) instead of both shrinking
	   halfway together and neither reaching its icon-only floor. */
			gl-publish-button {
				flex: 0 1000 max-content;
				min-width: 3.1rem;
			}

			.wip-button {
				gap: 0;
				padding: 0;
				background-color: transparent;
				--commit-stats-pill-line-height: 2.2rem;
			}

			.wip-button:hover {
				background-color: transparent;
			}

			gl-tooltip {
				margin-left: var(--gl-space-4);
			}
		`,
	];

	@property({ type: Object })
	branchState?: BranchState;

	@property({ type: String })
	branchName?: string;

	@property({ type: Object })
	lastFetched?: Date;

	@property({ type: Object })
	workingTreeStats?: GraphWorkingTreeStats;

	@property({ type: Object })
	state!: State;

	private get hasWorkingChanges(): boolean {
		const stats = this.workingTreeStats;
		if (stats == null) return false;
		return stats.added + stats.deleted + stats.modified + (stats.renamed ?? 0) > 0;
	}

	private get lastFetchedDate(): Date | undefined {
		if (!this.lastFetched) return undefined;

		const d = typeof this.lastFetched === 'string' ? new Date(this.lastFetched) : this.lastFetched;
		return d.getTime() !== 0 ? d : undefined;
	}

	private get fetchedText(): string | undefined {
		const d = this.lastFetchedDate;
		return d != null ? fromNow(d) : undefined;
	}

	private get fetchedTextShort(): string | undefined {
		const d = this.lastFetchedDate;
		if (d == null) return undefined;
		if (Date.now() - d.getTime() < 1000) return 'now';
		return `${fromNow(d, true)} ago`;
	}

	private onJumpToWip() {
		this.dispatchEvent(new CustomEvent('jump-to-wip', { bubbles: true, composed: true }));
		if (this.workingTreeStats?.pausedOpStatus != null) {
			this.dispatchEvent(new CustomEvent('show-details', { bubbles: true, composed: true }));
		}
	}

	private renderWipTooltip() {
		const stats = this.workingTreeStats;
		const pausedOp = stats?.pausedOpStatus;
		if (pausedOp != null) {
			const opStrings = pausedOperationStatusStringsByType[pausedOp.type];
			const headline = stats?.hasConflicts === true ? opStrings.conflicts : `${opStrings.label} in progress`;
			return html`${headline}
				<hr />
				Jump to Working Changes`;
		}

		return html`Jump to WIP
		${this.hasWorkingChanges
			? html`
					<hr />
					Working Changes
					<br />
					${stats!.added ? html`${pluralize('file', stats!.added)} added<br />` : nothing}
					${stats!.modified ? html`${pluralize('file', stats!.modified)} modified<br />` : nothing}
					${stats!.deleted ? html`${pluralize('file', stats!.deleted)} deleted<br />` : nothing}
				`
			: html`
					<hr />
					No changes
				`}`;
	}

	override render() {
		return html`
			<gl-push-pull-button
				.branchState=${this.branchState}
				.state=${this.state}
				.fetchedText=${this.fetchedText}
				.branchName=${this.branchName}
			></gl-push-pull-button>
			${this.branchState != null && this.branchState.upstream == null
				? html`<gl-publish-button
						.branchState=${this.branchState}
						.branchName=${this.branchName}
					></gl-publish-button>`
				: nothing}
			<gl-fetch-button
				.branchState=${this.branchState}
				.fetchedText=${this.fetchedText}
				.fetchedTextShort=${this.fetchedTextShort}
				.state=${this.state}
				.autoFetchMode=${this.state.config?.autoFetchMode ?? 'off'}
				.autoFetchIntervalSeconds=${this.state.config?.autoFetchIntervalSeconds ?? 180}
			></gl-fetch-button>
			<gl-tooltip placement="bottom">
				<a class="action-button wip-button" @click=${this.onJumpToWip}>
					<code-icon class="action-button__icon" icon="gl-wip"></code-icon>
					<gl-wip-stats
						.added=${this.workingTreeStats?.added}
						.modified=${this.workingTreeStats?.modified}
						.removed=${this.workingTreeStats?.deleted}
						.pausedOpStatus=${this.workingTreeStats?.pausedOpStatus}
						?has-conflicts=${this.workingTreeStats?.hasConflicts === true}
						.conflictsCount=${this.workingTreeStats?.conflictsCount}
						show-clean
						no-tooltip
					></gl-wip-stats>
				</a>
				<span slot="content">${this.renderWipTooltip()}</span>
			</gl-tooltip>
			${this.hasWorkingChanges
				? html`<gl-button
						appearance="toolbar"
						href=${createCommandLink<StashSaveCommandArgs>('gitlens.stashSave', {
							repoPath: this.state.selectedRepository,
						})}
						aria-label="Stash Changes..."
						tooltip="Stash Changes..."
					>
						<code-icon icon="gl-stash-save"></code-icon>
					</gl-button>`
				: nothing}
		`;
	}
}

@customElement('gl-fetch-button')
export class GlFetchButton extends LitElement {
	static override styles = [
		linkBase,
		inlineCode,
		actionButton,
		ruleStyles,
		css`
			:host {
				display: inline-flex;
				min-width: 0;
				max-width: 100%;
			}

			gl-popover.fetch-popover {
				display: block;
				width: 100%;
				min-width: 0;
				max-width: 100%;
				--gl-popover-anchor-width: 100%;
			}

			/* Use CSS Grid so the text column's min-content is 0,
	   allowing the text to shrink and ellipsize without expanding
	   the parent's intrinsic min-content beyond the icon size. */
			.action-button {
				display: grid;
				grid-template-columns: auto minmax(0, 1fr);
				align-items: center;
				width: 100%;
				max-width: 100%;
				overflow: hidden;
			}

			.action-button__text {
				display: block;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.fetch-popover::part(body) {
				min-width: 24rem;
				max-width: 36rem;
			}

			.fetch-popover__menu {
				display: flex;
				flex-direction: column;
				min-width: 0;
				padding: var(--gl-space-2) 0;
			}

			.fetch-popover__info {
				padding: var(--gl-space-4) var(--gl-space-8);
				font-size: var(--gl-font-md);
				line-height: 1.4;
				color: var(--vscode-menu-foreground);
			}

			.fetch-popover__info-secondary {
				margin-top: var(--gl-space-2);
				font-size: var(--gl-font-sm);
				opacity: 0.7;
			}

			.fetch-popover__divider {
				margin: var(--gl-space-2) 0;
			}

			.fetch-popover__row {
				display: flex;
				gap: var(--gl-space-4);
				align-items: center;
				min-height: 2.4rem;
				padding: 0.3rem 0.4rem 0.3rem 0.8rem;
				color: var(--vscode-menu-foreground);
			}

			.fetch-popover__row gl-checkbox {
				flex: 1;
				min-width: 0;
				margin: 0;
				font-size: var(--gl-font-md);
				--checkbox-foreground: currentcolor;
				--checkbox-background: var(--vscode-checkbox-selectBackground);
				--checkbox-border: var(--vscode-checkbox-selectBorder);
				--checkbox-hover-background: var(--vscode-checkbox-selectBackground);
			}

			.fetch-popover__row .fetch-popover__label-text {
				flex: 1;
				min-width: 0;
				font-size: var(--gl-font-md);
			}

			.fetch-popover__row gl-button {
				flex: none;
				--button-padding: 0.2rem;
				--button-foreground: var(--vscode-menu-foreground, var(--vscode-foreground));
				--button-hover-background: color-mix(in srgb, var(--vscode-menu-foreground) 18%, transparent);

				opacity: 0.7;
			}

			.fetch-popover__row gl-button:hover {
				opacity: 1;
			}

			.fetch-popover__hint {
				padding: 0 0.8rem 0.4rem 2.6rem;
				font-size: var(--gl-font-sm);
				line-height: 1.4;
				color: var(--vscode-menu-foreground);
				opacity: 0.7;
			}

			.fetch-popover__row--info .fetch-popover__label-text {
				display: inline-flex;
				gap: var(--gl-space-4);
				align-items: center;
			}
		`,
	];

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	@consume({ context: ipcContext })
	private _ipc!: typeof ipcContext.__context__;

	@property({ type: Object })
	state!: State;

	@property({ type: String })
	fetchedText?: string;

	@property({ type: String })
	fetchedTextShort?: string;

	@property({ type: Object })
	branchState?: BranchState;

	@property({ type: String })
	autoFetchMode: GraphAutoFetchMode = 'off';

	@property({ type: Number })
	autoFetchIntervalSeconds = 180;

	private get upstream() {
		return this.branchState?.upstream
			? html`<span class="inline-code">${this.branchState.upstream}</span>`
			: 'remote';
	}

	private get intervalLabel(): string {
		const seconds = this.autoFetchIntervalSeconds;
		if (seconds < 60) return pluralize('second', seconds);
		return pluralize('minute', Math.round(seconds / 60));
	}

	private get settingsLink(): string {
		// Only surface `git.autofetch` when it's currently enabled — that's the one case where the user
		// might want to turn it off and revert auto-fetch to GitLens. In off/gitlens modes, the period is
		// the only knob that matters.
		const ids =
			this.autoFetchMode === 'vscode' ? '@id:git.autofetch @id:git.autofetchPeriod' : '@id:git.autofetchPeriod';
		return `command:workbench.action.openSettings?${encodeURIComponent(`"${ids}"`)}`;
	}

	override render() {
		return html`
			<gl-popover class="fetch-popover" placement="bottom" ?arrow=${false} distance=${4}>
				<a
					slot="anchor"
					href=${this._webview.createCommandLink('gitlens.fetch:')}
					class="action-button"
					aria-label="Fetch"
				>
					<code-icon class="action-button__icon" icon="repo-fetch"></code-icon>
					<span class="action-button__text"
						><span class="action-button__label">Fetch</span>${this.fetchedTextShort
							? html` <span class="action-button__small">(${this.fetchedTextShort})</span>`
							: ''}</span
					>
				</a>
				<div slot="content" class="fetch-popover__menu" role="menu">
					<div class="fetch-popover__info">
						Fetch from
						${this.upstream}${this.branchState?.provider?.name
							? html` on ${this.branchState.provider.name}`
							: nothing}
						${this.fetchedText
							? html`<div class="fetch-popover__info-secondary">Last fetched ${this.fetchedText}</div>`
							: nothing}
					</div>
					<menu-divider class="fetch-popover__divider"></menu-divider>
					${this.renderAutoFetchRow()}
				</div>
			</gl-popover>
		`;
	}

	private renderAutoFetchRow() {
		const intervalLabel = this.intervalLabel;
		if (this.autoFetchMode === 'vscode') {
			return html`
				<div class="fetch-popover__row fetch-popover__row--info">
					<span class="fetch-popover__label-text">
						<code-icon icon="check"></code-icon>
						Auto-fetch handled by VS Code Git
					</span>
					${this.renderSettingsCog()}
				</div>
				<div class="fetch-popover__hint">Every ${intervalLabel}</div>
			`;
		}

		const checked = this.autoFetchMode === 'gitlens';
		return html`
			<div class="fetch-popover__row">
				<gl-checkbox
					value="autoFetchEnabled"
					?checked=${checked}
					@gl-change-value=${this.handleAutoFetchToggle}
				>
					Auto-fetch
				</gl-checkbox>
				${this.renderSettingsCog()}
			</div>
			<div class="fetch-popover__hint">Every ${intervalLabel} while in view</div>
		`;
	}

	private renderSettingsCog() {
		// No wrapping <gl-tooltip>: its body positions above the gear and ends up occluding the
		// popover content the user is already reading. The aria-label below covers screen-reader needs.
		return html`
			<gl-button
				appearance="toolbar"
				density="compact"
				href=${this.settingsLink}
				aria-label="Open Git Auto-fetch Settings"
			>
				<code-icon icon="gear"></code-icon>
			</gl-button>
		`;
	}

	private handleAutoFetchToggle(e: CustomEvent) {
		const $el = e.target as HTMLInputElement | null;
		if ($el == null) return;

		this._ipc.sendCommand(UpdateGraphConfigurationCommand, { changes: { autoFetchEnabled: $el.checked } });
	}
}

@customElement('gl-push-pull-button')
export class PushPullButton extends LitElement {
	static override styles = [
		linkBase,
		inlineCode,
		actionButton,
		ruleStyles,
		css`
			:host {
				display: contents;
			}

			.pill {
				display: inline-flex;
				gap: 0.5rem;
				align-items: center;
				padding: 0.2rem 0.5rem;
				font-size: var(--gl-font-micro);
				font-weight: 500;
				line-height: 1.2;
				color: var(--vscode-foreground);
				text-transform: uppercase;
				background-color: var(--vscode-editorWidget-background);
				border-radius: var(--gl-radius-sm);
			}

			.pill > span {
				display: inline-flex;
				gap: 0;
				align-items: center;
			}

			.pill code-icon {
				font-size: inherit !important;
				line-height: inherit !important;
			}
		`,
	];

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	@property({ type: Object })
	branchState?: BranchState;

	@property({ type: Object })
	state!: State;

	@property({ type: String })
	fetchedText?: string;

	@property({ type: String })
	branchName?: string;

	private get isBehind(): boolean {
		return (this.branchState?.behind ?? 0) > 0;
	}

	private get isAhead(): boolean {
		return (this.branchState?.ahead ?? 0) > 0;
	}

	private get upstream() {
		return this.branchState?.upstream
			? html`<span class="inline-code">${this.branchState.upstream}</span>`
			: 'remote';
	}

	private renderBranchPrefix() {
		return html`<span class="inline-code">${this.branchName}</span> is`;
	}

	private renderTooltipContent(action: 'pull' | 'push') {
		if (!this.branchState) return nothing;

		const providerSuffix = this.branchState.provider?.name ? html` on ${this.branchState.provider.name}` : '';

		if (action === 'pull') {
			const mainContent = html`Pull ${pluralize('commit', this.branchState.behind)} from
			${this.upstream}${providerSuffix}`;

			if (this.isAhead) {
				return html`
					${mainContent}
					<hr />
					${this.renderBranchPrefix()} ${pluralize('commit', this.branchState.behind)} behind and
					${pluralize('commit', this.branchState.ahead)} ahead of ${this.upstream}${providerSuffix}
				`;
			}

			return html`
				${mainContent}
				<hr />
				${this.renderBranchPrefix()} ${pluralize('commit', this.branchState.behind)} behind
				${this.upstream}${providerSuffix}
			`;
		}

		return html`
			Push ${pluralize('commit', this.branchState.ahead)} to ${this.upstream}${providerSuffix}
			<hr />
			${this.renderBranchPrefix()} ${pluralize('commit', this.branchState.ahead)} ahead of ${this.upstream}
		`;
	}

	override render() {
		if (!this.branchState || (!this.isAhead && !this.isBehind)) {
			return nothing;
		}

		const action = this.isBehind ? 'pull' : 'push';
		const icon = this.isBehind ? 'repo-pull' : 'repo-push';
		const label = this.isBehind ? 'Pull' : 'Push';

		return html`
			<gl-tooltip placement="bottom">
				<a
					href=${this._webview.createCommandLink(`gitlens.graph.${action}`)}
					class="action-button${this.isBehind ? ' is-behind' : ''}${this.isAhead ? ' is-ahead' : ''}"
				>
					<code-icon class="action-button__icon" icon=${icon}></code-icon>
					${label}
					<span>
						<span class="pill action-button__pill">
							${this.isBehind
								? html`<span>${this.branchState.behind}<code-icon icon="arrow-down"></code-icon></span>`
								: ''}
							${this.isAhead
								? html`<span>${this.branchState.ahead}<code-icon icon="arrow-up"></code-icon></span>`
								: ''}
						</span>
					</span>
				</a>
				<div slot="content">
					${this.renderTooltipContent(action)}
					${this.fetchedText
						? html`<hr />
								Last fetched ${this.fetchedText}`
						: ''}
				</div>
			</gl-tooltip>
			${this.isAhead && this.isBehind
				? html`
						<gl-button
							appearance="toolbar"
							href=${this._webview.createCommandLink('gitlens.graph.pushWithForce')}
							aria-label="Force Push"
							tooltipPlacement="top"
						>
							<code-icon icon="repo-force-push" aria-hidden="true"></code-icon>
							<span slot="tooltip">
								Force Push ${pluralize('commit', this.branchState?.ahead)} to ${this.upstream}
								${this.branchState?.provider?.name ? html` on ${this.branchState.provider.name}` : ''}
							</span>
						</gl-button>
					`
				: ''}
		`;
	}
}

@customElement('gl-publish-button')
export class GlPublishButton extends LitElement {
	static override styles = [
		linkBase,
		actionButton,
		css`
			:host {
				display: inline-flex;
				min-width: 0;
				max-width: 100%;
			}

			gl-tooltip {
				display: block;
				width: 100%;
				min-width: 0;
				max-width: 100%;
			}

			.action-button {
				display: grid;
				grid-template-columns: auto minmax(0, 1fr);
				align-items: center;
				width: 100%;
				max-width: 100%;
				overflow: hidden;
			}

			.publish-button__text {
				display: block;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
		`,
	];

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	@property({ type: Object })
	branchState?: BranchState;

	@property({ type: String })
	branchName?: string;

	override render() {
		// Only when the current branch has no upstream (unpublished)
		if (this.branchState == null || this.branchState.upstream != null) return nothing;

		return html`
			<gl-tooltip placement="bottom">
				<a
					href=${this._webview.createCommandLink('gitlens.publishBranch:')}
					class="action-button"
					aria-label="Publish Branch"
				>
					<code-icon class="action-button__icon" icon="cloud-upload"></code-icon>
					<span class="publish-button__text">Publish Branch</span>
				</a>
				<span slot="content">
					Publish (push) ${this.branchName ? html`<strong>${this.branchName}</strong>` : 'this branch'} to a
					remote
				</span>
			</gl-tooltip>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-git-actions-buttons': GitActionsButtons;
		'gl-fetch-button': GlFetchButton;
		'gl-publish-button': GlPublishButton;
		'gl-push-pull-button': PushPullButton;
	}
}
