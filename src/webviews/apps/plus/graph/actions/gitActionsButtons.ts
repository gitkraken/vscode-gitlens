import type { Remote } from '@eamodio/supertalk';
import { consume } from '@lit/context';
import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import { pausedOperationStatusStringsByType } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import { fromNow } from '@gitlens/utils/date.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { StashSaveCommandArgs } from '../../../../../commands/stashSave.js';
import { isSubscriptionTrialOrPaidFromState } from '../../../../../plus/gk/utils/subscription.utils.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { GraphServices } from '../../../../plus/graph/graphService.js';
import type { BranchState, GraphAutoFetchMode, GraphWipState, State } from '../../../../plus/graph/protocol.js';
import { UpdateGraphConfigurationCommand } from '../../../../plus/graph/protocol.js';
import type { PullConflictPreview } from '../../../../rpc/services/branches.js';
import type { GlPopover } from '../../../shared/components/overlays/popover.js';
import { inlineCode } from '../../../shared/components/styles/lit/base.css.js';
import { ipcContext } from '../../../shared/contexts/ipc.js';
import type { WebviewContext } from '../../../shared/contexts/webview.js';
import { webviewContext } from '../../../shared/contexts/webview.js';
import {
	getBranchNameWithoutRemote,
	getRemoteNameFromBranchName,
	providerIconName,
} from '../../../shared/git-utils.js';
import { ruleStyles } from '../../shared/components/vscode.css.js';
import type { AppState } from '../context.js';
import { graphServicesContext, graphStateContext } from '../context.js';
import { actionButton, linkBase } from '../styles/graph.css.js';
import { getSelectedRepoPath } from '../utils/repository.utils.js';
import { isUnpublishedRow, isUnpulledRow } from '../utils/rowContext.utils.js';
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

			gl-tooltip {
				flex-shrink: 0;
			}

			/* Each action yields its label completely before the next one loses a pixel — publish, then
			   fetch, then pull/push — instead of all three shrinking halfway together and none reaching
			   its icon-only floor. 2.4rem is that floor: the icon plus the anchor's padding. Pull/push
			   sets its own tier on its wrappers, since its host is display: contents. */
			gl-publish-button {
				flex: 0 1000000 max-content;
				min-width: 2.4rem;
			}

			gl-fetch-button {
				flex: 0 1000 max-content;
				min-width: 2.4rem;
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

			/* Room-gated, not state-gated (state gating is hasWorkingChanges in the template): hidden until
			   the titlebar has space to spare for a fourth action button. */
			.git-actions__stash {
				display: none;
			}

			@container graph-titlebar (min-width: 58rem) {
				.git-actions__stash {
					display: inline-block;
				}
			}
		`,
	];

	@property({ type: Object })
	branchState?: BranchState;

	@property({ type: String })
	branchName?: string;

	@property({ type: Object })
	lastFetched?: Date;

	/** The graph's own worktree's hot WIP state — its entry in the row-keyed `wipStateById` plane. */
	@property({ type: Object })
	wipState?: GraphWipState;

	@property({ type: Object })
	state!: State;

	private get hasWorkingChanges(): boolean {
		const stats = this.wipState?.workDirStats;
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
		if (this.wipState?.pausedOpStatus != null) {
			this.dispatchEvent(new CustomEvent('show-details', { bubbles: true, composed: true }));
		}
	}

	private renderWipTooltip() {
		const state = this.wipState;
		const stats = state?.workDirStats;
		const pausedOp = state?.pausedOpStatus;
		if (pausedOp != null) {
			const opStrings = pausedOperationStatusStringsByType[pausedOp.type];
			const headline = state?.hasConflicts === true ? opStrings.conflicts : `${opStrings.label} in progress`;
			return html`${headline}
				<hr />
				Jump to Working Changes`;
		}

		return html`Jump to WIP
		${
			this.hasWorkingChanges
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
					`
		}`;
	}

	override render() {
		return html`
			<gl-push-pull-button
				.branchState=${this.branchState}
				.state=${this.state}
				.fetchedTextShort=${this.fetchedTextShort}
				.branchName=${this.branchName}
				.wipState=${this.wipState}
			></gl-push-pull-button>
			${
				this.branchState != null && this.branchState.upstream == null
					? html`<gl-publish-button
							.branchState=${this.branchState}
							.branchName=${this.branchName}
						></gl-publish-button>`
					: nothing
			}
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
						.added=${this.wipState?.workDirStats?.added}
						.modified=${this.wipState?.workDirStats?.modified}
						.removed=${this.wipState?.workDirStats?.deleted}
						.pausedOpStatus=${this.wipState?.pausedOpStatus}
						?has-conflicts=${this.wipState?.hasConflicts === true}
						.conflictsCount=${this.wipState?.conflictsCount}
						show-clean
						no-tooltip
					></gl-wip-stats>
				</a>
				<span slot="content">${this.renderWipTooltip()}</span>
			</gl-tooltip>
			${
				this.hasWorkingChanges
					? html`<gl-button
							class="git-actions__stash"
							appearance="toolbar"
							href=${createCommandLink<StashSaveCommandArgs>('gitlens.stashSave', {
								repoPath: this.state.selectedRepository,
							})}
							aria-label="Stash Changes..."
							tooltip="Stash Changes..."
						>
							<code-icon icon="gl-stash-save"></code-icon>
						</gl-button>`
					: nothing
			}
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

				/* The icon↔text separation lives on the text, not in a column gap: a gap survives even
				   when the text column reaches 0, leaving a dead strip beside the icon at the floor. As
				   padding it overflows the zero-width track and is clipped, so the floor is a true icon. */
				column-gap: 0;
			}

			.action-button__text {
				display: block;
				padding-inline-start: 0.5rem;
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
			<gl-popover class="fetch-popover" placement="bottom" ?arrow=${false} .distance=${4}>
				<a
					slot="anchor"
					href=${this._webview.createCommandLink('gitlens.fetch:')}
					class="action-button"
					aria-label="Fetch"
				>
					<code-icon class="action-button__icon" icon="repo-fetch"></code-icon>
					<span class="action-button__text"
						><span class="action-button__label">Fetch</span>${
							this.fetchedTextShort
								? html` <span class="action-button__small">(${this.fetchedTextShort})</span>`
								: ''
						}</span
					>
				</a>
				<div slot="content" class="fetch-popover__menu" role="menu">
					<div class="fetch-popover__info">
						Fetch from
						${this.upstream}${
							this.branchState?.provider?.name ? html` on ${this.branchState.provider.name}` : nothing
						}
						${
							this.fetchedText
								? html`<div class="fetch-popover__info-secondary">
										Last fetched ${this.fetchedText}
									</div>`
								: nothing
						}
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

/** How long the pull popover must stay open before it spends any git work. Guards the keyboard path:
 *  `<gl-popover>` applies its `--show-delay` only to the *hover* trigger, so `focus-visible` opens
 *  instantly — tabbing across the header would otherwise fire a merge simulation per button passed through. */
const conflictSettleDelay = 150;

function samePullConflictPreview(a: PullConflictPreview | undefined, b: PullConflictPreview | undefined): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;
	if (a.kind !== b.kind) return false;

	return (
		(a.kind === 'clean' || a.kind === 'unavailable' ? undefined : a.count) ===
		(b.kind === 'clean' || b.kind === 'unavailable' ? undefined : b.count)
	);
}

/** One footer-bar destination. `resolve` runs lazily, only when the leg is actually clicked — the ones
 *  that scan rows (oldest unpushed/unpulled) never pay that cost just because the popover opened.
 *  `label` is omitted for an icon-only leg (HEAD); `tooltip` still carries the full `Jump to …` text for
 *  `aria-label`, matching the overview bar's ref-leg convention. */
type FooterJumpLeg = { resolve: () => string | undefined; label?: string; tooltip?: string; icon: string };

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

			/* The host is display: contents, so the pull popover / push tooltip are themselves the flex
			   items in the header's action group — they carry the shrink tier. Pull/push yields last:
			   it's the action you're most likely to still want named. */
			:host > gl-popover,
			:host > gl-tooltip {
				display: block;
				flex: 0 1 max-content;
				max-width: 100%;
				--gl-popover-anchor-width: 100%;
			}

			/* Grid so the label column's min-content is 0 and the label can ellipsize away without
			   holding the button above icon width. The pill keeps an auto column — ahead/behind counts
			   survive the collapse. Separation lives on the items rather than in a column gap so it
			   collapses with the label instead of leaving a dead strip beside the icon. */
			.action-button {
				display: grid;
				grid-template-columns: auto minmax(0, 1fr) auto;
				align-items: center;
				width: 100%;
				max-width: 100%;
				overflow: hidden;
				column-gap: 0;
			}

			.action-button__text {
				display: block;
				padding-inline-start: 0.5rem;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.action-button__pill-slot {
				padding-inline-start: 0.5rem;
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

			/* Match the tooltip this popover replaced — a header you sweep across shouldn't pop cards at
			   120ms — while the hide delay gives you a beat to move into it. */
			gl-popover {
				--show-delay: 500ms;
				--hide-delay: 180ms;
				/* Without a cap the popover defaults to 70vw and simply grows to fit its widest line, so a long
				   "Fetched 3 weeks ago" would stretch the whole card instead of yielding. Capping it is what
				   makes the footer's degradation reachable at all. */
				--max-width: 34rem;
				/* Regions own their padding (see .pull-popover). */
				--wa-tooltip-padding: 0;
			}

			/* Zero the popover's own body padding and let each region supply its own, so the banner and footer
			   run edge to edge. Overriding the custom property is exact; a negative margin guessing at
			   the padding's value is not. Shared by both Pull and Push cards. */
			.action-popover {
				display: flex;
				flex-direction: column;
			}

			.action-popover__body {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-4);
				padding: var(--gl-space-8) var(--gl-space-10);
			}

			.action-popover__status {
				color: var(--vscode-descriptionForeground);
			}

			/* Solid fill, deliberately darkened so a fixed light foreground clears contrast in BOTH themes.
			   Knocking out to the editor background (the ref-pill convention) can't work here: in a dark theme
			   that resolves to near-black text on a dark red fill. */
			/* Slides the verdict open instead of popping it. Animating a grid track (0fr to 1fr) is the only
			   way to transition to a content-derived height; the inner wrapper needs min-height: 0 and a clip
			   or the 0fr track can't actually collapse it. Same technique as the graph's row-marker rail. */
			.banner-slot {
				display: grid;
				grid-template-rows: 0fr;
				transition: grid-template-rows 240ms ease;
			}

			.banner-slot.is-open {
				grid-template-rows: 1fr;
			}

			.banner-slot__inner {
				min-height: 0;
				overflow: hidden;
			}

			/* Trails the slide slightly so the text fades in over an already-opening band rather than
			   arriving with it. */
			.banner-slot .banner {
				opacity: 0;
				transition: opacity 180ms ease 60ms;
			}

			.banner-slot.is-open .banner {
				opacity: 1;
			}

			@media (prefers-reduced-motion: reduce) {
				.banner-slot,
				.banner-slot .banner {
					transition: none;
				}
			}

			/* Inline flow, NOT flex — code-icon aligns itself with vertical-align: text-bottom, which flex
			   discards, and baseline-aligning an inline-block box against text rides the glyph too high.
			   Matches how gl-merge-target-status renders the same kind of conflict line. */
			.banner {
				margin-block: 0;
				padding: var(--gl-space-8) var(--gl-space-10);
				font-weight: 500;
				color: #fff;
				background-color: color-mix(in srgb, var(--banner-color) 82%, #000);
			}

			.banner code-icon {
				margin-right: var(--gl-space-4);
			}

			.banner--blocked {
				--banner-color: var(--vscode-editorError-foreground);
			}

			.banner--conflict {
				--banner-color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingConflictForegroundColor);
			}

			.footerbar {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				container-type: inline-size;
				overflow: hidden;
				/* A touch more below than above — the button otherwise sits hard against the card's edge. */
				padding: var(--gl-space-8) var(--gl-space-10) var(--gl-space-10);
				background-color: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
				border-top: 1px solid var(--vscode-menu-separatorBackground);
			}

			/* The timestamp is the only thing here that yields — the action never shrinks, wraps, or gets
			   pushed. It shrinks first, then drops out entirely rather than leaving a truncated stub; a stale
			   repo ("Fetched 3 weeks ago") is exactly when this line is longest. */
			.footerbar__fetched {
				flex: 0 1 auto;
				min-width: 0;
				margin-left: auto;
				overflow: hidden;
				color: var(--vscode-descriptionForeground);
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			/* Threshold = the legs' own width plus a gap; below it there's no room for a useful timestamp.
			   Lower than before Pull's Upstream leg lost its full inline "Jump to Upstream" text for a short
			   label and Push's HEAD leg lost its label entirely — both cards' legs are narrower now. */
			@container (max-width: 24rem) {
				.footerbar__fetched {
					display: none;
				}
			}

			.jump {
				display: flex;
				flex: 0 0 auto;
				gap: var(--gl-space-4);
				align-items: center;
				padding: var(--gl-space-2) var(--gl-space-8);
				font: inherit;
				color: inherit;
				white-space: nowrap;
				cursor: pointer;
				background-color: var(--vscode-list-hoverBackground);
				border: 1px solid color-mix(in srgb, var(--vscode-foreground) 30%, transparent);
				border-radius: var(--gl-radius-sm);
			}

			.jump:hover {
				background-color: color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
			}
		`,
	];

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	@consume({ context: graphServicesContext, subscribe: true })
	private _services?: Remote<GraphServices> | undefined;

	@consume({ context: graphStateContext, subscribe: true })
	private _graphState?: AppState;

	@property({ type: Object })
	branchState?: BranchState;

	@property({ type: Object })
	state!: State;

	/** Compact form ("4m ago"). The pull popover's footer is a status chip, not prose, so it takes this —
	 *  matching the Fetch button beside it, which already uses short on its label and long in its popover. */
	@property({ type: String })
	fetchedTextShort?: string;

	@property({ type: String })
	branchName?: string;

	/** The conflict verdict depends on the working tree, not just on ahead/behind. */
	@property({ type: Object })
	wipState?: GraphWipState;

	@query('gl-popover') private _popover?: GlPopover;

	@state() private _conflicts?: PullConflictPreview;
	/** The branch state the current `_conflicts` describes — refetches only when this changes, so
	 *  re-hovering an unchanged branch costs nothing. */
	private _conflictsKey?: string;
	/** Monotonic token: a branch-state change mid-flight must not let the older answer win. */
	private _conflictRequestId = 0;
	private _settleTimer?: ReturnType<typeof setTimeout>;
	private _popoverOpen = false;

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

	/** `selectedRepository` is a repository *id*, not a path — resolve it through `repositories` rather
	 *  than passing it straight to a service that wants a path. */
	private get repoPath(): string | undefined {
		return getSelectedRepoPath(this.state ?? {});
	}

	/** The tip of the upstream — the newest commit a pull would bring in, and so where the jump lands. */
	private get incomingSha(): string | undefined {
		return this.isBehind ? this.branchState?.upstreamSha : undefined;
	}

	/** HEAD's own sha — the ref a push moves *from*, mirroring `incomingSha`'s "moves to". Already on
	 *  the wire (`graph-app.ts` feeds the overview bar's HEAD leg from the same field), so no resolution
	 *  step is needed. */
	private get headSha(): string | undefined {
		return this.state.branch?.sha;
	}

	/** Identity of the branch state a verdict describes. Undefined whenever there's nothing to check. */
	private get conflictsKey(): string | undefined {
		const repoPath = this.repoPath;
		const branchState = this.branchState;
		if (repoPath == null || branchState == null || !this.isBehind) return undefined;

		return `${repoPath}|${this.branchName ?? ''}|${branchState.behind}|${branchState.ahead}|${branchState.upstreamSha ?? ''}|${this.workDirStatsFingerprint}`;
	}

	/** Working-tree fingerprint folded into `conflictsKey` so stash/discard/restore bust a pinned verdict —
	 *  the counts are only a proxy, so swapping one dirty file for another at identical counts won't. */
	private get workDirStatsFingerprint(): string {
		const stats = this.wipState?.workDirStats;
		if (stats == null) return '-';

		return `${stats.added}.${stats.modified}.${stats.deleted}.${stats.renamed ?? 0}`;
	}

	override disconnectedCallback(): void {
		this.cancelSettle();
		super.disconnectedCallback?.();
	}

	override updated(changed: PropertyValues<this>): void {
		if (!changed.has('branchState') && !changed.has('wipState')) return;

		// Drop a verdict the moment it stops describing the current branch state — otherwise switching
		// branches (or pulling) leaves the previous answer on screen until the next fetch resolves, which is
		// worse than showing nothing.
		if (this._conflictsKey !== this.conflictsKey) {
			this._conflictsKey = undefined;
			this._conflicts = undefined;
		}

		// An open popover has to keep up with a fetch landing underneath it. `ensureConflictsFetched` dedupes
		// on the key, so re-arming when nothing actually moved costs a timer and no git.
		if (this._popoverOpen) {
			this.armSettle();
		}
	}

	private cancelSettle(): void {
		if (this._settleTimer != null) {
			clearTimeout(this._settleTimer);
			this._settleTimer = undefined;
		}
	}

	private armSettle(): void {
		// Never restart a countdown already in flight. `updated()` re-arms on every WIP push, and a watcher
		// pushing faster than the settle delay would otherwise reset the timer forever and starve the fetch.
		if (this._settleTimer != null) return;

		this._settleTimer = setTimeout(() => {
			this._settleTimer = undefined;
			if (!this._popoverOpen) return;

			void this.ensureConflictsFetched();
		}, conflictSettleDelay);
	}

	private onPopoverShow(): void {
		this._popoverOpen = true;
		this.armSettle();
	}

	private onPopoverHide(): void {
		this._popoverOpen = false;
		this.cancelSettle();
	}

	private async ensureConflictsFetched(): Promise<void> {
		const repoPath = this.repoPath;
		const key = this.conflictsKey;
		if (repoPath == null || key == null) return;
		if (this._conflictsKey === key) return;

		// Pro-only, like the merge-target chip. The host gates too — this just avoids spending a roundtrip
		// and a merge simulation on a verdict that wouldn't render.
		const subState = this._graphState?.subscription?.state;
		if (subState != null && !isSubscriptionTrialOrPaidFromState(subState)) return;

		const services = this._services;
		if (services == null) return;

		this._conflictsKey = key;
		const requestId = ++this._conflictRequestId;

		let result: PullConflictPreview | undefined;
		try {
			const branches = await services.branches;
			result = await branches.getPullConflictPreview(repoPath);
		} catch {
			result = undefined;
		}

		// A newer request superseded this one while it was in flight.
		if (requestId !== this._conflictRequestId) return;

		// Nothing came back (a transient failure, or the host's own gate) — drop the key so a later hover
		// retries rather than pinning "no verdict" to this branch state forever.
		if (result == null) {
			this._conflictsKey = undefined;
		}

		// Value-compare so an identical answer doesn't reflow an open popover.
		if (samePullConflictPreview(this._conflicts, result)) return;

		this._conflicts = result;
	}

	/** Bounded forward scan for the oldest row matching `predicate`: walks `state.rows` from the top
	 *  counting hits and stops as soon as the count reaches `target` — that row is the answer, so this
	 *  never sweeps the whole graph. Falls back to the last matching row seen if the count never gets
	 *  there (a filtered/scoped graph, or rows still loading), and to `undefined` if none matched at all
	 *  (drop the leg rather than retarget it at the tip). Only ever called from a click handler — see
	 *  {@link FooterJumpLeg.resolve}. Shared by the unpushed scan (counts to `ahead`) and its behind-side
	 *  mirror, the unpulled scan (counts to `behind`). */
	private resolveOldestRowSha(predicate: (row: GitGraphRow) => boolean, target: number): string | undefined {
		// Nothing to count to means no row can match. Without this the loop below sweeps every loaded row
		// looking for a hit that can't exist.
		if (target === 0) return undefined;

		let lastSha: string | undefined;
		let count = 0;

		for (const row of this.state.rows ?? []) {
			if (!predicate(row)) continue;

			lastSha = row.sha;
			count++;
			if (count >= target) return row.sha;
		}

		return lastSha;
	}

	private resolveOldestUnpushedSha(): string | undefined {
		return this.resolveOldestRowSha(isUnpublishedRow, this.branchState?.ahead ?? 0);
	}

	private resolveOldestUnpulledSha(): string | undefined {
		return this.resolveOldestRowSha(isUnpulledRow, this.branchState?.behind ?? 0);
	}

	private jumpTo(sha: string): void {
		// Same path the WIP row's jump and the overview bar's legs use — it pages the row in when it isn't
		// loaded, then selects and reveals it.
		//
		// A landing: this fires from a popover in the HEADER, so the user isn't looking at the rows, and a
		// target that happens to already be on screen would otherwise answer the click with nothing.
		document.dispatchEvent(new CustomEvent('gl-jump-to-commit', { detail: { sha: sha, flash: true } }));
	}

	private onJumpClick(e: MouseEvent, resolve: () => string | undefined): void {
		// Resolved on click, not up front — a scanning leg (oldest unpushed/unpulled) pays for its walk
		// only when actually clicked. No target: leave the popover open rather than dismiss into nothing.
		const sha = resolve();
		if (sha == null) return;

		e.preventDefault();
		e.stopPropagation();
		// Dismiss on activation — you're navigating away, and a hover card left pinned over the header
		// covers the rows you just jumped to (the same convention `gl-commit-row-item` follows).
		void this._popover?.hide();
		this.jumpTo(sha);
	}

	private onPullClick(e: MouseEvent): void {
		// Alt+click aims the graph at the incoming commits instead of pulling — the header's established
		// alternate-action convention. The anchor is a `command:` link, so without `preventDefault` the pull
		// fires anyway.
		if (!e.altKey || this.incomingSha == null) return;

		e.preventDefault();
		e.stopPropagation();
		this.jumpTo(this.incomingSha);
	}

	private onPushClick(e: MouseEvent): void {
		// Mirrors onPullClick, but targets Oldest Outgoing — HEAD is nearly always already on screen, so
		// the shortcut should do the thing you can't get for free. Gated on altKey FIRST so an ordinary
		// push click never pays for the scan.
		if (!e.altKey) return;

		const sha = this.resolveOldestUnpushedSha();
		if (sha == null) return;

		e.preventDefault();
		e.stopPropagation();
		this.jumpTo(sha);
	}

	/** The severity banner. Leads the card because it's the only thing here you can't read off the button
	 *  itself, and it's silent unless there's something to say: clean, undetectable (Git < 2.33, a provider
	 *  without merge-tree, a failed simulation), and still-pending all render nothing rather than putting a
	 *  reassurance or an error into a hover.
	 *
	 *  Copy stays pull-first — never "merging"/"rebasing". Which operation runs is mechanism the user didn't
	 *  ask about, and they're looking at a button labeled Pull. The *check* stays operation-aware regardless
	 *  (see `getPullConflictPreview`) or the file count would be wrong for rebasing users. */
	private renderConflictBanner() {
		const conflicts = this._conflicts;

		let banner;
		if (conflicts != null && conflicts.kind !== 'clean' && conflicts.kind !== 'unavailable') {
			const files = pluralize('file', conflicts.count);
			// A blocked pull outranks a predicted one: it's a fact rather than a simulation, and it tells you
			// the click won't do anything at all. It takes `editorError` rather than the rust conflict color so
			// that `statusMergingOrRebasingConflict` keeps describing actual conflicts for anyone retheming it.
			const blocked = conflicts.kind === 'dirty-overlap';

			banner = html`<p class="banner ${blocked ? 'banner--blocked' : 'banner--conflict'}">
				<code-icon icon=${blocked ? 'error' : 'warning'}></code-icon>${
					blocked
						? html`Unable to pull &mdash; uncommitted changes in ${files}`
						: html`Pulling will cause conflicts in ${files}`
				}
			</p>`;
		}

		// The slot is rendered even while empty so its collapsed height is an established value to animate
		// FROM — the verdict arrives a beat after the popover opens (settle delay + a merge simulation), and an
		// element inserted straight at full height can't transition, it can only pop.
		return html`<div class="banner-slot${banner != null ? ' is-open' : ''}">
			<div class="banner-slot__inner">${banner ?? nothing}</div>
		</div>`;
	}

	/** Footer bar: doing on the left, status on the right. Both cards pass two legs, following the overview
	 *  bar's ref-leg convention: HEAD/Upstream are the primary leg (Upstream keeps an icon + short label,
	 *  HEAD drops to icon-only since it has nothing left to say — see {@link renderPush}), and the second,
	 *  scanning leg (Oldest Outgoing/Oldest Incoming) always carries a label. Every leg's `Jump to …` text
	 *  lives in a `gl-tooltip` rather than inline, and doubles as its `aria-label`. */
	private renderFooterBar(legs: readonly FooterJumpLeg[]) {
		const fetched = this.fetchedTextShort
			? html`<span class="footerbar__fetched">Fetched ${this.fetchedTextShort}</span>`
			: nothing;

		// Nothing to jump to — keep the bar for the timestamp alone rather than dropping the fact off the card.
		if (legs.length === 0) {
			return this.fetchedTextShort ? html`<div class="footerbar">${fetched}</div>` : nothing;
		}

		return html`<div class="footerbar">
			${legs.map(leg => {
				const button = html`<button
					class="jump"
					type="button"
					aria-label=${leg.tooltip ?? leg.label}
					@click=${(e: MouseEvent) => this.onJumpClick(e, leg.resolve)}
				>
					<code-icon icon=${leg.icon}></code-icon>${
						leg.label != null ? html`<span class="jump__label">${leg.label}</span>` : nothing
					}
				</button>`;

				return leg.tooltip
					? html`<gl-tooltip placement="bottom"
							>${button}<span slot="content">${leg.tooltip}</span></gl-tooltip
						>`
					: button;
			})}
			${fetched}
		</div>`;
	}

	/** The button itself. `slotted` puts it in `<gl-popover>`'s anchor slot; `<gl-tooltip>` takes its anchor
	 *  as the default slot, so the push path passes nothing. */
	private renderActionAnchor(action: 'pull' | 'push', slotted: boolean) {
		const icon = action === 'pull' ? 'repo-pull' : 'repo-push';
		const label = action === 'pull' ? 'Pull' : 'Push';

		return html`<a
			slot=${slotted ? 'anchor' : nothing}
			href=${this._webview.createCommandLink(`gitlens.graph.${action}`)}
			class="action-button${this.isBehind ? ' is-behind' : ''}${this.isAhead ? ' is-ahead' : ''}"
			aria-label=${label}
			@click=${action === 'pull' ? this.onPullClick : this.onPushClick}
		>
			<code-icon class="action-button__icon" icon=${icon}></code-icon>
			<span class="action-button__text"><span class="action-button__label">${label}</span></span>
			<span class="action-button__pill-slot">
				<span class="pill action-button__pill">
					${
						this.isBehind
							? html`<span>${this.branchState?.behind}<code-icon icon="arrow-down"></code-icon></span>`
							: ''
					}
					${
						this.isAhead
							? html`<span>${this.branchState?.ahead}<code-icon icon="arrow-up"></code-icon></span>`
							: ''
					}
				</span>
			</span>
		</a>`;
	}

	/** Pull gets an interactive popover rather than a tooltip: it's the only surface where a click target can
	 *  live without competing with the button's own click, which must keep pulling. Severity banner on top
	 *  (the one thing you can't read off the button), prose in the middle, doing in the footer. */
	private renderPull() {
		const branchState = this.branchState;
		const providerSuffix = branchState?.provider?.name ? html` on ${branchState.provider.name}` : '';
		const behind = branchState?.behind ?? 0;
		const ahead = branchState?.ahead ?? 0;

		const legs: FooterJumpLeg[] = [];
		const upstreamName = branchState?.upstream;
		if (upstreamName != null) {
			// Bare remote name (`origin`) when the upstream tracks a same-named branch — the pill already
			// shows that name. Otherwise the full `origin/other`. Same rule as the overview bar's leg.
			const remote = getRemoteNameFromBranchName(upstreamName);
			const upstreamLegLabel =
				remote.length > 0 && getBranchNameWithoutRemote(upstreamName) === this.branchName
					? remote
					: upstreamName;
			legs.push({
				resolve: () => this.incomingSha,
				label: upstreamLegLabel,
				tooltip: `Jump to Upstream (${upstreamName})`,
				icon: providerIconName(branchState?.provider?.icon),
			});
		}
		// "Incoming"/"Outgoing" is the vocabulary GitLens's own tracking-status nodes use for these two sets
		// (`branchTrackingStatusNode.ts`), and what the SCM view calls them. "Unpulled" isn't idiomatic —
		// you pull a branch, not a commit — and the pair has to read symmetrically. The `Unpublished`/
		// `Unpulled` flag bits keep the git layer's naming; this is user-facing copy only.
		legs.push({
			resolve: () => this.resolveOldestUnpulledSha(),
			label: 'Oldest Incoming',
			tooltip: 'Jump to Oldest Incoming Commit',
			icon: 'arrow-down',
		});

		return html`<gl-popover
			placement="bottom"
			trigger="hover focus-visible"
			@gl-popover-show=${this.onPopoverShow}
			@gl-popover-after-hide=${this.onPopoverHide}
		>
			${this.renderActionAnchor('pull', true)}
			<div slot="content" class="action-popover">
				${this.renderConflictBanner()}
				<div class="action-popover__body">
					<span>Pull ${pluralize('commit', behind)} from ${this.upstream}${providerSuffix}</span>
					<span class="action-popover__status"
						>${this.renderBranchPrefix()} ${pluralize('commit', behind)} behind
						${
							this.isAhead ? html`and ${pluralize('commit', ahead)} ahead of ` : ''
						}${this.upstream}${providerSuffix}</span
					>
				</div>
				${this.renderFooterBar(legs)}
			</div>
		</gl-popover>`;
	}

	/** No banner slot at all here — nothing to animate in. Whether the remote moved since the last fetch
	 *  is unknowable without fetching, so there's no divergence to predict the way Pull's conflict banner
	 *  does; the value is structural parity with Pull plus the two jump legs. */
	private renderPush() {
		const branchState = this.branchState;
		const providerSuffix = branchState?.provider?.name ? html` on ${branchState.provider.name}` : '';
		const ahead = branchState?.ahead ?? 0;

		const legs: FooterJumpLeg[] = [];
		const headSha = this.headSha;
		if (headSha != null) {
			// Icon-only, matching the overview bar's HEAD leg — there's no ref to name beyond "HEAD" itself,
			// so a label would only repeat the icon. The ref stays in parentheses in the tooltip the way the
			// overview bar's legs name theirs — but only when there is one to name, or a detached/unresolved
			// branch reads "Jump to HEAD (undefined)".
			legs.push({
				resolve: () => this.headSha,
				tooltip: this.branchName ? `Jump to HEAD (${this.branchName})` : 'Jump to HEAD',
				icon: 'vm-active',
			});
		}

		// Renders unconditionally — resolved lazily on click, so there's no upfront scan to gate on.
		// "Oldest" (a property of the commit) rather than "First" (which reads as newest, since the graph
		// renders newest-at-top — the opposite end from where this leg lands).
		legs.push({
			resolve: () => this.resolveOldestUnpushedSha(),
			label: 'Oldest Outgoing',
			tooltip: 'Jump to Oldest Outgoing Commit',
			icon: 'arrow-down',
		});

		return html`<gl-popover
			placement="bottom"
			trigger="hover focus-visible"
			@gl-popover-show=${this.onPopoverShow}
			@gl-popover-after-hide=${this.onPopoverHide}
		>
			${this.renderActionAnchor('push', true)}
			<div slot="content" class="action-popover">
				<div class="action-popover__body">
					<span>Push ${pluralize('commit', ahead)} to ${this.upstream}${providerSuffix}</span>
					<span class="action-popover__status"
						>${this.renderBranchPrefix()} ${pluralize('commit', ahead)} ahead of
						${this.upstream}${providerSuffix}</span
					>
				</div>
				${this.renderFooterBar(legs)}
			</div>
		</gl-popover>`;
	}

	override render() {
		if (!this.branchState || (!this.isAhead && !this.isBehind)) {
			return nothing;
		}

		const action = this.isBehind ? 'pull' : 'push';

		return html`
			${action === 'pull' ? this.renderPull() : this.renderPush()}
			${
				this.isAhead && this.isBehind
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
					: ''
			}
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

				/* Separation lives on the text rather than in a column gap so it collapses with the
				   label instead of leaving a dead strip beside the icon at the floor. */
				column-gap: 0;
			}

			.publish-button__text {
				display: block;
				padding-inline-start: 0.5rem;
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
