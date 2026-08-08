import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { PullRequestReviewDecision } from '@gitlens/git/models/pullRequest.js';
import { getStackedMergeCount } from '@gitlens/git/utils/pullRequest.utils.js';
import { pluralize } from '@gitlens/utils/string.js';
import { serializeWebviewItemContext } from '../../../../../system/webview.js';
import type { GraphSidebarPullRequest } from '../../../../plus/graph/protocol.js';
import type { GlPopoverConfirm } from '../../../shared/components/overlays/popover-confirm.js';
import { getAutolinkIcon } from '../../../shared/components/rich/utils.js';
import { sidebarActionsContext } from '../sidebar/sidebarContext.js';
import type { SidebarActions } from '../sidebar/sidebarState.js';
import { SheetWrapper } from './sheetWrapper.js';
import '../../../shared/components/avatar/avatar.js';
import '../../../shared/components/branch-name.js';
import '../../../shared/components/chips/action-chip.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/commit/commit-stats.js';
import '../../../shared/components/formatted-date.js';
import '../../../shared/components/markdown/markdown.js';
import '../../../shared/components/menu/menu-popover.js';
import '../../../shared/components/overlays/detail-sheet.js';
import '../../../shared/components/overlays/popover-confirm.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-pr-sheet': GlGraphPrSheet;
	}
	interface GlobalEventHandlersEventMap {
		'gl-graph-merge-pull-request': CustomEvent<{
			number: string;
			stack?: { number: number; position: number };
			/** Omitted means the provider's own default merge method. */
			mergeMethod?: 'merge' | 'squash' | 'rebase';
			/** The dispatcher already confirmed the blast radius in place (the sheet's popover). */
			confirmed?: boolean;
		}>;
		/** Opens another layer's sheet — `push: true` stacks it on top of this one rather than replacing
		 *  it, so closing returns here. `stackNumber` opens the stack-root summary sheet instead of a
		 *  single layer's. `url` is the fallback when sheet resolution fails — open the pull request on
		 *  the remote instead of silently doing nothing. */
		'gl-graph-show-pr-sheet': CustomEvent<{ number?: string; stackNumber?: number; push?: boolean; url?: string }>;
		/** Compares the pull request's base against its head — the app pushes compare on top of this sheet. */
		'gl-graph-pr-compare': CustomEvent<{ leftRef: string; rightRef: string; rightRefType: 'branch' | 'commit' }>;
		/** Starts the agent review flow for the pull request (Launchpad's Start Review, agent route). */
		'gl-graph-pr-review': CustomEvent<{ url: string }>;
		/** Enters the graph's AI review mode over the pull request's base-to-head changes — the Review
		 *  Changes button, paired with Compare Changes. Same ref shape as `gl-graph-pr-compare`. */
		'gl-graph-pr-review-changes': CustomEvent<{
			leftRef: string;
			rightRef: string;
			rightRefType: 'branch' | 'commit';
		}>;
	}
}

type PrStack = NonNullable<GraphSidebarPullRequest['stack']>;

const reviewSeverity: Record<`${PullRequestReviewDecision}`, number> = {
	Approved: 0,
	ReviewRequired: 1,
	ChangesRequested: 2,
};

/** {@link joinPrNumbers} with emphasis spans on the numbers, for the blast line. */
function joinPrNumbersHtml(numbers: string[]) {
	const parts: unknown[] = [];
	numbers.forEach((n, i) => {
		if (i > 0) {
			parts.push(i === numbers.length - 1 ? (numbers.length === 2 ? ' and ' : ', and ') : ', ');
		}
		parts.push(html`<span class="verdict__num">#${n}</span>`);
	});
	return html`${parts}`;
}

/** "#a", "#a and #b", "#a, #b, and #c" — the blast-radius line's pull request list. */
function joinPrNumbers(numbers: string[]): string {
	if (numbers.length === 0) return '';
	if (numbers.length === 1) return `#${numbers[0]}`;
	if (numbers.length === 2) return `#${numbers[0]} and #${numbers[1]}`;

	return `${numbers
		.slice(0, -1)
		.map(n => `#${n}`)
		.join(', ')}, and #${numbers.at(-1)}`;
}

/**
 * Details sheet for a pull request — identity, branch context, mergeability, and (when it's one layer
 * of a stack, or the stack itself) the stack rail beside it.
 *
 * A details view first: merging is one thing it can offer, not what it is for. Every field rendered here
 * already reaches the webview on {@link GraphSidebarPullRequest}, so opening the sheet costs no fetch.
 *
 * Owns its `gl-detail-sheet` and re-emits `gl-detail-sheet-close` on dismiss, matching the conflict and
 * rebase sheets. Host actions go through the sidebar's own `executeAction`, so a command invoked here is
 * dispatched exactly as the equivalent row action would be.
 */
@customElement('gl-graph-pr-sheet')
export class GlGraphPrSheet extends SheetWrapper(LitElement) {
	static override styles = css`
		:host {
			display: block;
		}

		.state--opened {
			color: var(--vscode-gitlens-openPullRequestIconColor);
		}

		.state--merged {
			color: var(--vscode-gitlens-mergedPullRequestIconColor);
		}

		.state--closed {
			color: var(--vscode-gitlens-closedPullRequestIconColor);
		}

		.state--draft {
			color: var(--vscode-descriptionForeground);
		}

		.title {
			display: inline-flex;
			gap: var(--gl-space-6);
			align-items: center;
			min-width: 0;
		}

		.title__icon--stack {
			color: var(--vscode-gitlens-graphLane1Color);
		}

		.title__name {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.title__id {
			flex: none;
			color: var(--color-foreground--65);
			font-variant-numeric: tabular-nums;
			font-weight: 400;
		}

		/* The glance-level stacked/unstacked discriminator; the stack rail below carries the detail. */
		.title__count {
			display: inline-flex;
			gap: var(--gl-space-2);
			align-items: center;
			flex: none;
			padding: 0 var(--gl-space-4);
			border-radius: 1rem;
			background: color-mix(in srgb, transparent 88%, var(--color-foreground));
			color: var(--color-foreground--65);
			font-size: var(--gl-font-sm);
			font-variant-numeric: tabular-nums;
			font-weight: 400;
			--code-icon-size: 1.1rem;
		}

		/* The digits have no descenders so their ink rides high in the text box, while the glyph centers
		   in its em box — box-centering alone leaves the icon reading ~1px low (measured). */
		.title__count code-icon {
			margin-top: -0.1rem;
		}

		.subtitle {
			display: flex;
			gap: var(--gl-space-6);
			align-items: center;
			min-width: 0;
			padding-top: var(--gl-space-2);
		}

		.subtitle__state {
			flex: none;
			font-weight: 600;
		}

		.subtitle__author {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.subtitle__date {
			flex: none;
			margin-left: auto;
			white-space: nowrap;
		}

		.subtitle gl-avatar {
			flex: none;
			--gl-avatar-size: 1.6rem;
		}

		.muted {
			color: var(--color-foreground--65);
		}

		.body {
			display: flex;
			flex-direction: column;
			gap: var(--gl-space-10);
			padding: var(--gl-space-10) var(--gl-space-12);
		}

		/* Matches the branch sheet's section heading treatment. */
		.section-label {
			display: flex;
			gap: var(--gl-space-6);
			align-items: baseline;
			justify-content: space-between;
			margin-bottom: var(--gl-space-4);
			color: var(--color-foreground--65);
			font-size: var(--gl-font-sm);
			font-weight: 500;
			text-transform: uppercase;
			letter-spacing: 0.05em;
		}

		/* The heading row's right-side annotation keeps normal casing. */
		.section-label__aside {
			font-weight: 400;
			text-transform: none;
			letter-spacing: normal;
		}

		/* The soft-card fill both card-shaped sections below share — same background formula as the
		   app's gl-card, without pulling in its whole (state-indicator-heavy) style module. A fill
		   reads as "grouped content" without the harder bordered-box look. */
		.meta-card,
		.stack-rail {
			background: var(--gl-card-background, color-mix(in lab, var(--vscode-sideBar-background) 100%, #fff 3%));
			border-radius: var(--gl-radius-sm);
		}

		.meta-card {
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}

		/* Wraps at narrow panel widths: refs row first, stats cluster dropping below it whole. */
		.meta-card__row {
			display: flex;
			flex-wrap: wrap;
			gap: var(--gl-space-4) var(--gl-space-8);
			align-items: center;
			padding: var(--gl-space-4) var(--gl-space-8);
		}

		/* The branch-chain row: pills wrap on the left, the switch/worktree toolbar stays put on the
		   right — the row itself never wraps as a whole. */
		/* Reserves the toolbar's height even when it's hidden (merged/current pull requests) so the
		   row never changes height. */
		.meta-card__row--chain {
			flex-wrap: nowrap;
			min-height: 3.2rem;
		}

		.meta-card__refs {
			display: flex;
			flex: 1 1 auto;
			flex-wrap: wrap;
			gap: var(--gl-space-4);
			align-items: center;
			min-width: 0;
		}

		/* Kept no taller than the branch pills so the chain row's height doesn't change with the
		   toolbar's presence (it hides on merged/current pull requests). */
		.meta-card__toolbar {
			display: flex;
			flex: none;
			gap: var(--gl-space-2);
			align-items: center;
		}

		.meta-card__toolbar gl-button {
			--button-compact-padding: 0.2rem;
			--button-line-height: 1.2;
		}

		.branch-arrow {
			opacity: 0.5;
		}

		.meta-card__ellipsis {
			color: var(--color-foreground--65);
			font-family: var(--vscode-editor-font-family);
			letter-spacing: 0.2rem;
		}

		/* The head pill leads the chain; the accent separates it from the bases it flows into. */
		.meta-card__ref--head {
			--gl-branch-color: var(--vscode-textLink-foreground);
		}

		.meta-card__stats {
			color: var(--color-foreground--65);
			font-size: var(--gl-font-sm);
			font-variant-numeric: tabular-nums;
		}

		.meta-card__stats > * {
			display: inline-flex;
			gap: var(--gl-space-2);
			align-items: center;
		}

		.meta-card__review--ok {
			color: var(--vscode-gitlens-openPullRequestIconColor);
		}

		.meta-card__review--warn {
			color: var(--vscode-gitlens-launchpadIndicatorAttentionColor);
		}

		.meta-card__actions {
			gap: var(--gl-space-4) var(--gl-space-6);
			justify-content: flex-end;
			padding-top: var(--gl-space-6);
		}

		/* Composed from state — the accent stripe and faint fill both key off --verdict-accent. */
		.verdict {
			display: flex;
			flex-direction: column;
			gap: var(--gl-space-4);
			padding: var(--gl-space-8) var(--gl-space-10);
			background: color-mix(in srgb, transparent 92%, var(--verdict-accent));
			border-radius: var(--gl-radius-sm);
			/* stylelint-disable-next-line declaration-property-value-disallowed-list */
			box-shadow: inset 0.3rem 0 0 var(--verdict-accent);
		}

		.verdict--ready {
			--verdict-accent: var(--vscode-gitlens-openPullRequestIconColor);
		}

		.verdict--conflict {
			--verdict-accent: var(--vscode-gitlens-closedPullRequestIconColor);
		}

		.verdict--draft {
			--verdict-accent: var(--vscode-descriptionForeground);
		}

		.verdict--merged {
			--verdict-accent: var(--vscode-gitlens-mergedPullRequestIconColor);
		}

		.verdict__head {
			display: flex;
			gap: var(--gl-space-8);
			align-items: center;
			justify-content: space-between;
		}

		.verdict__title {
			align-self: center;
			color: var(--verdict-accent);
			font-weight: 600;
			line-height: 1.2;
		}

		/* One control, two hit targets: outside radii live on the container's ends, the seam is a
		   hairline of the button's own foreground so it tracks any theme. Host-level radius/border
		   overrides work because author styles on the host element beat shadow :host rules. */
		.split-btn {
			display: inline-flex;
			align-items: stretch;
			flex: none;
		}

		/* The popover wrapper sits between the container and the menu half — stretch through it so
		   both halves share one height. */
		.split-btn gl-menu-popover {
			display: inline-flex;
			align-items: stretch;
		}

		.split-btn__main {
			border-start-end-radius: 0;
			border-end-end-radius: 0;
		}

		.split-btn__menu {
			height: 100%;
			border-start-start-radius: 0;
			border-end-start-radius: 0;
			border-left: var(--gl-border-width) solid
				color-mix(in srgb, transparent 72%, var(--vscode-button-foreground));
			--button-padding-inline: 0.5rem;
		}

		/* The blast-radius count as a badge on the button itself, GitHub-style — a wash of the
		   button's own foreground so it survives any theme's button color. */
		.split-btn__count {
			margin-left: var(--gl-space-4);
			padding: 0 var(--gl-space-4);
			border-radius: 1rem;
			background: color-mix(in srgb, transparent 78%, var(--vscode-button-foreground));
			font-size: var(--gl-font-sm);
			font-variant-numeric: tabular-nums;
		}

		.verdict__reasons {
			display: flex;
			flex-wrap: wrap;
			gap: var(--gl-space-4) var(--gl-space-10);
			color: var(--color-foreground--65);
			font-size: var(--gl-font-sm);
		}

		.verdict__blast {
			color: var(--color-foreground--65);
			font-size: var(--gl-font-sm);
		}

		/* The fine print's load-bearing facts — which pull requests, which branch. */
		.verdict__num {
			color: var(--color-foreground);
			font-variant-numeric: tabular-nums;
			font-weight: 500;
		}

		.verdict__ref {
			color: var(--color-foreground);
			font-family: var(--vscode-editor-font-family);
		}

		.description {
			position: relative;
			overflow: hidden;
		}

		.description--collapsed {
			max-height: 10rem;
		}

		.description__content {
			font-size: var(--gl-font-sm);
		}

		.description__fade {
			position: absolute;
			right: 0;
			bottom: 0;
			left: 0;
			height: 3rem;
			background: linear-gradient(to bottom, transparent, var(--vscode-sideBar-background));
			pointer-events: none;
		}

		.description__toggle {
			padding: 0;
			margin-top: var(--gl-space-4);
			color: var(--vscode-textLink-foreground);
			font-size: var(--gl-font-sm);
			background: none;
			border: none;
			cursor: pointer;
		}

		.description__toggle:hover,
		.description__toggle:focus-visible {
			text-decoration: underline;
		}

		.stack-rail {
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}

		.stack-rail__trunk {
			font-family: var(--vscode-editor-font-family);
		}

		.stack-rail__rows {
			display: flex;
			flex-direction: column;
			padding: var(--gl-space-2) 0;
		}

		.stack-rail__row {
			display: grid;
			grid-template-columns: 2rem 1fr auto auto;
			gap: var(--gl-space-6);
			align-items: center;
			padding: var(--gl-space-4) var(--gl-space-8);
		}

		.stack-rail__row--current {
			background: color-mix(in srgb, transparent 88%, var(--color-foreground));
		}

		.stack-rail__row[role='button'] {
			cursor: pointer;
		}

		.stack-rail__row[role='button']:hover,
		.stack-rail__row[role='button']:focus-visible {
			background: color-mix(in srgb, transparent 88%, var(--color-foreground));
		}

		.stack-rail__dot-col {
			position: relative;
			display: flex;
			align-self: stretch;
			align-items: center;
			justify-content: center;
		}

		.stack-rail__dot-col::before {
			content: '';
			position: absolute;
			top: 0;
			bottom: 0;
			left: 50%;
			width: var(--gl-border-width);
			background: var(--color-foreground--25);
			transform: translateX(-50%);
		}

		.stack-rail__rows > .stack-rail__row:first-child .stack-rail__dot-col::before {
			top: 50%;
		}

		.stack-rail__rows > .stack-rail__row:last-child .stack-rail__dot-col::before {
			bottom: 50%;
		}

		.stack-rail__dot {
			position: relative;
			width: 0.8rem;
			height: 0.8rem;
			background: var(--vscode-sideBar-background);
			border: var(--gl-border-width) solid var(--color-foreground--25);
			border-radius: 50%;
		}

		.stack-rail__dot--landing {
			border-color: var(--vscode-gitlens-openPullRequestIconColor);
		}

		.stack-rail__dot--merged {
			background: var(--vscode-gitlens-mergedPullRequestIconColor);
			border-color: var(--vscode-gitlens-mergedPullRequestIconColor);
		}

		.stack-rail__dot--current {
			background: var(--color-foreground);
			border-color: var(--color-foreground);
		}

		.stack-rail__title {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.stack-rail__position {
			flex: none;
			color: var(--color-foreground--65);
			font-family: var(--vscode-editor-font-family);
			font-size: var(--gl-font-sm);
			font-variant-numeric: tabular-nums;
		}

		.stack-rail__position--current {
			color: var(--color-foreground);
			font-weight: 600;
		}
	`;

	@consume({ context: sidebarActionsContext, subscribe: true })
	private _sidebarActions?: SidebarActions;

	@property({ attribute: false })
	pullRequest?: GraphSidebarPullRequest;

	/** The stack's members, top layer first — set whenever this pull request is one layer of a stack,
	 *  or (with {@link stackRoot}) the stack itself. */
	@property({ attribute: false })
	layers?: GraphSidebarPullRequest[];

	@property()
	dateFormat?: string;

	/** Gates the agent-review action — mirrored from the host's AI availability. */
	@property({ type: Boolean, attribute: 'ai-enabled' })
	aiEnabled = false;

	/** Renders the stack's own summary — every layer's branch in the chain, summed stats, and a
	 *  whole-stack verdict — instead of one layer's. Only ever set alongside a full {@link layers} load,
	 *  with {@link pullRequest} itself the stack's top layer. */
	@property({ type: Boolean })
	stackRoot = false;

	@state()
	private _descriptionExpanded = false;

	@state()
	private _descriptionOverflows = false;

	/** The pull request number the overflow measurement below last ran for — lets a re-render for a
	 *  different pull request know a fresh measurement is owed. */
	private _descriptionMeasuredFor?: string;

	@query('.description__content')
	private _descriptionContentEl?: HTMLElement;

	private get glyph(): { icon: string; modifier: string } {
		const pr = this.pullRequest;
		return getAutolinkIcon('pr', pr?.state, pr?.isDraft);
	}

	/** The state token shared by the tinted icon and the subtitle's state word. */
	private get stateModifier(): string {
		return this.glyph.modifier.replace('pr-', '');
	}

	/** Base/head refs the compare button acts on: `headSha` when known (navigates to the exact tip),
	 *  the branch name otherwise. */
	private compareRefs(
		pr: GraphSidebarPullRequest,
	): { leftRef: string; rightRef: string; rightRefType: 'branch' | 'commit' } | undefined {
		const { baseBranch, headBranch } = pr;
		if (baseBranch == null || headBranch == null) return undefined;

		const rightRef = pr.headSha ?? headBranch;
		const rightRefType: 'branch' | 'commit' = pr.headSha != null ? 'commit' : 'branch';
		return { leftRef: baseBranch, rightRef: rightRef, rightRefType: rightRefType };
	}

	private dispatchCompare = (e: Event): void => {
		const pr = this.pullRequest;
		if (pr == null) return;

		const refs = this.compareRefs(pr);
		if (refs == null) return;

		e.stopPropagation();
		this.dispatchEvent(
			new CustomEvent('gl-graph-pr-compare', {
				detail: refs,
				bubbles: true,
				composed: true,
			}),
		);
	};

	/** Resets (and re-measures) the description clamp per opened pull request — a re-render for the
	 *  same pull request (any other prop change) keeps the user's expanded/collapsed choice. */
	protected override updated(changedProperties: Map<string, unknown>): void {
		super.updated(changedProperties);

		if (changedProperties.has('pullRequest')) {
			this._descriptionExpanded = false;
			this._descriptionOverflows = false;
			this._descriptionMeasuredFor = undefined;
		}

		const pr = this.pullRequest;
		if (pr == null || this.stackRoot || !pr.body || this._descriptionMeasuredFor === pr.number) return;

		this._descriptionMeasuredFor = pr.number;
		requestAnimationFrame(() => {
			if (!this.isConnected || this._descriptionMeasuredFor !== pr.number) return;

			const contentEl = this._descriptionContentEl;
			const clampEl = contentEl?.parentElement;
			if (contentEl == null || clampEl == null) return;

			this._descriptionOverflows = contentEl.scrollHeight > clampEl.clientHeight + 1;
		});
	}

	override render(): unknown {
		const pr = this.pullRequest;
		if (pr == null) return nothing;

		return html`<gl-detail-sheet
			esc-managed
			aria-label="Pull request details"
			close-label="Close"
			@gl-detail-sheet-close=${this.handleInnerClose}
		>
			${this.renderTitleRow(pr)} ${this.renderSubtitleRow(pr)}
			${
				pr.url
					? html`<gl-action-chip
							slot="actions"
							icon="globe"
							label="Open Pull Request on Remote"
							alt-icon="copy"
							alt-label="Copy Pull Request URL"
							overlay="tooltip"
							@click=${this.onOpenOnRemote}
						></gl-action-chip>`
					: nothing
			}
			<div class="body">
				${this.renderMetaCard(pr)} ${this.renderVerdict(pr)} ${this.renderDescription(pr)}
				${this.renderStackRail(pr)}
			</div>
		</gl-detail-sheet>`;
	}

	private renderTitleRow(pr: GraphSidebarPullRequest) {
		const state = this.stateModifier;
		const { icon } = this.glyph;
		const stack = pr.stack;

		const titleIcon = this.stackRoot
			? html`<code-icon class="title__icon--stack" icon="layers"></code-icon>`
			: html`<code-icon class="state--${state}" icon=${icon}></code-icon>`;

		const titleText = this.stackRoot && stack != null ? `Stack #${stack.number}` : pr.title;

		const chip =
			stack != null
				? html`<span
						class="title__count"
						title=${
							this.stackRoot
								? `${stack.size} layers in stack #${stack.number}`
								: `Layer ${stack.position} of ${stack.size} in stack #${stack.number}`
						}
						><code-icon icon="layers"></code-icon>${
							this.stackRoot ? html`${stack.size} layers` : html`${stack.position}/${stack.size}`
						}</span
					>`
				: nothing;

		return html`<span slot="title" class="title">
			${titleIcon}
			<span class="title__name">${titleText}</span>
			${!this.stackRoot ? html`<span class="title__id">#${pr.number}</span>` : nothing} ${chip}
		</span>`;
	}

	private renderSubtitleRow(pr: GraphSidebarPullRequest) {
		const state = this.stateModifier;
		const stateLabel =
			state === 'opened' ? 'Open' : state === 'draft' ? 'Draft' : state === 'merged' ? 'Merged' : 'Closed';

		return html`<span slot="subtitle" class="subtitle">
			<span class="subtitle__state state--${state}">${stateLabel}</span>
			${
				pr.authorAvatarUrl || pr.authorName
					? html`<gl-avatar
							src=${pr.authorAvatarUrl ?? nothing}
							name=${pr.authorName ?? nothing}
						></gl-avatar>`
					: nothing
			}
			${pr.authorName ? html`<span class="subtitle__author">${pr.authorName}</span>` : nothing}
			${
				pr.date != null
					? html`<span class="subtitle__date muted"
							>updated
							<formatted-date .date=${new Date(pr.date)} .format=${this.dateFormat}></formatted-date
						></span>`
					: nothing
			}
		</span>`;
	}

	/** Head → base (→ trunk) and what can be done with them. For a stack-root sheet the whole stack's
	 *  chain renders instead — every layer's head, top to bottom, ending at the trunk. */
	private renderMetaCard(pr: GraphSidebarPullRequest) {
		return html`<div class="meta-card">
			<div class="meta-card__row meta-card__row--chain">
				<div class="meta-card__refs">${this.renderChain(pr)}</div>
				${this.renderMetaCardToolbar(pr)}
			</div>
			<div class="meta-card__row meta-card__stats">${this.renderStats()}</div>
			${this.renderMetaCardActions(pr)}
		</div>`;
	}

	/** The switch/worktree corner toolbar, right-aligned on the chain row's first line — icon-only so it
	 *  reads as chrome rather than competing with the branch pills for attention. */
	private renderMetaCardToolbar(pr: GraphSidebarPullRequest) {
		const canSwitch = pr.state === 'opened' && pr.headUrl != null && !pr.current;
		if (!canSwitch) return nothing;

		return html`<div class="meta-card__toolbar">
			<gl-button
				appearance="toolbar"
				density="compact"
				tooltip=${pr.worktree ? 'Open Worktree in New Window...' : 'Switch to Branch...'}
				aria-label=${pr.worktree ? 'Open Worktree in New Window...' : 'Switch to Branch...'}
				@click=${this.switchToBranch}
			>
				<code-icon icon=${pr.worktree ? 'empty-window' : 'gl-switch'}></code-icon>
			</gl-button>
			${
				!pr.worktree
					? html`<gl-button
							appearance="toolbar"
							density="compact"
							tooltip="Open in Worktree..."
							aria-label="Open in Worktree..."
							@click=${this.openInWorktree}
						>
							<code-icon icon="empty-window"></code-icon>
						</gl-button>`
					: nothing
			}
		</div>`;
	}

	private switchToBranch = (e: Event): void => {
		e.stopPropagation();
		const pr = this.pullRequest;
		if (pr == null) return;

		const context = pr.context;
		this._sidebarActions?.executeAction(
			pr.worktree ? 'gitlens.graph.openInWorktree' : 'gitlens.switchToPullRequest:graph',
			context != null ? serializeWebviewItemContext(context) : undefined,
		);
	};

	private openInWorktree = (e: Event): void => {
		e.stopPropagation();
		const pr = this.pullRequest;
		if (pr == null) return;

		const context = pr.context;
		this._sidebarActions?.executeAction(
			'gitlens.graph.openInWorktree',
			context != null ? serializeWebviewItemContext(context) : undefined,
		);
	};

	private renderChain(pr: GraphSidebarPullRequest) {
		if (this.stackRoot) {
			const layers = this.layers ?? [];
			const trunk = pr.stack?.baseRef;
			if (layers.length > 0) {
				const pills: unknown[] = [];
				layers.forEach((l, i) => {
					if (i > 0) {
						pills.push(html`<code-icon class="branch-arrow" icon="arrow-right"></code-icon>`);
					}
					pills.push(this.renderBranchPill(l.headBranch, i === 0));
				});
				if (trunk != null) {
					pills.push(
						html`<code-icon class="branch-arrow" icon="arrow-right"></code-icon>`,
						this.renderBranchPill(trunk, false),
					);
				}
				return pills;
			}
		}

		const headBranch = pr.headBranch;
		const baseBranch = pr.baseBranch;
		if (headBranch == null || baseBranch == null) return nothing;

		const trunk = pr.stack?.baseRef;
		const pills: unknown[] = [
			this.renderBranchPill(headBranch, true),
			html`<code-icon class="branch-arrow" icon="arrow-right"></code-icon>`,
			this.renderBranchPill(baseBranch, false),
		];
		if (trunk != null && trunk !== baseBranch) {
			pills.push(
				html`<code-icon class="branch-arrow" icon="arrow-right"></code-icon>
					<span class="meta-card__ellipsis">&middot;&middot;&middot;</span>
					<code-icon class="branch-arrow" icon="arrow-right"></code-icon>`,
				this.renderBranchPill(trunk, false),
			);
		}
		return pills;
	}

	private renderBranchPill(name: string | undefined, accent: boolean) {
		// A class, not an inline style — the webview's CSP blocks style attributes.
		return html`<gl-branch-name
			appearance="pill"
			class=${accent ? 'meta-card__ref--head' : ''}
			.name=${name}
		></gl-branch-name>`;
	}

	/** Per-pull-request stats, or (for a stack-root sheet) their sum across every loaded layer — missing
	 *  numbers count as 0 so a partial load doesn't drop the whole total. Review state is the pull
	 *  request's own decision, or the worst across layers for a stack root. */
	private renderStats() {
		const pr = this.pullRequest!;

		let commitCount: number | undefined;
		let filesChanged: number | undefined;
		let additions: number | undefined;
		let deletions: number | undefined;
		let reviewState: `${PullRequestReviewDecision}` | undefined;

		if (!this.stackRoot) {
			({ commitCount, filesChanged, additions, deletions, reviewDecision: reviewState } = pr);
		} else {
			commitCount = 0;
			filesChanged = 0;
			additions = 0;
			deletions = 0;
			for (const l of this.layers ?? []) {
				commitCount += l.commitCount ?? 0;
				filesChanged += l.filesChanged ?? 0;
				additions += l.additions ?? 0;
				deletions += l.deletions ?? 0;

				const rs = l.reviewDecision;
				if (rs != null && (reviewState == null || reviewSeverity[rs] > reviewSeverity[reviewState])) {
					reviewState = rs;
				}
			}
		}

		return html`${
			commitCount != null
				? html`<span><code-icon icon="git-commit"></code-icon>${pluralize('commit', commitCount)}</span>`
				: nothing
		}
		${
			filesChanged
				? html`<span><code-icon icon="files"></code-icon>${pluralize('file', filesChanged)}</span>`
				: nothing
		}
		${
			additions != null || deletions != null
				? html`<commit-stats no-tooltip added=${additions ?? 0} removed=${deletions ?? 0}></commit-stats>`
				: nothing
		}
		${this.renderReviewChip(reviewState)}`;
	}

	private renderReviewChip(state: `${PullRequestReviewDecision}` | undefined) {
		if (state === 'Approved') {
			return html`<span class="meta-card__review--ok"><code-icon icon="check"></code-icon> Approved</span>`;
		}
		if (state === 'ChangesRequested') {
			return html`<span class="meta-card__review--warn"
				><code-icon icon="warning"></code-icon> Changes requested</span
			>`;
		}
		if (state === 'ReviewRequired') {
			return html`<span class="meta-card__review--warn"
				><code-icon icon="warning"></code-icon> Review required</span
			>`;
		}
		return nothing;
	}

	/** The inspection row: Compare Changes and (when AI is enabled) both reviews — Review Changes is
	 *  the graph's own AI review mode over the same comparison; Review with Agent is Launchpad's Start
	 *  Review, agent route, handing the pull request off to an agent session. */
	private renderMetaCardActions(pr: GraphSidebarPullRequest) {
		return html`<div class="meta-card__row meta-card__actions">
			<gl-button appearance="secondary" density="compact" @click=${this.dispatchCompare}>
				<code-icon icon="git-compare" slot="prefix"></code-icon>Compare Changes
			</gl-button>
			${
				this.aiEnabled && pr.state === 'opened'
					? html`<gl-button appearance="secondary" density="compact" @click=${this.dispatchReviewChanges}>
							<code-icon icon="checklist" slot="prefix"></code-icon>Review Changes
						</gl-button>`
					: nothing
			}
			${
				this.aiEnabled && pr.state === 'opened' && pr.url
					? html`<gl-button appearance="secondary" density="compact" @click=${this.startReview}>
							<code-icon icon="robot" slot="prefix"></code-icon>Review with Agent...
						</gl-button>`
					: nothing
			}
		</div>`;
	}

	private startReview = (e: Event): void => {
		e.stopPropagation();
		const pr = this.pullRequest;
		if (pr?.url == null) return;

		this.dispatchEvent(
			new CustomEvent('gl-graph-pr-review', {
				detail: { url: pr.url },
				bubbles: true,
				composed: true,
			}),
		);
	};

	/** Review Changes — opens the graph's AI review mode over the pull request's base-to-head
	 *  comparison. Distinct from `startReview`'s Launchpad agent-review flow. */
	private dispatchReviewChanges = (e: Event): void => {
		const pr = this.pullRequest;
		if (pr == null) return;

		const refs = this.compareRefs(pr);
		if (refs == null) return;

		e.stopPropagation();
		this.dispatchEvent(
			new CustomEvent('gl-graph-pr-review-changes', {
				detail: refs,
				bubbles: true,
				composed: true,
			}),
		);
	};

	/** The pull requests that land, and (for a single-layer sheet) the one that retargets, when THIS
	 *  pull request's merge button is used — position semantics rather than a status re-check, since the
	 *  layers already carry theirs. `undefined` when the layers aren't loaded — callers fall back to a
	 *  count-only line. */
	private computeStackImpact(stack: PrStack): { landing: string[]; retargeting?: string } | undefined {
		const layers = this.layers;
		if (layers == null || layers.length === 0) return undefined;

		const position = this.stackRoot ? stack.size : stack.position;
		const landing = layers
			.filter(l => (l.stack?.position ?? 0) <= position)
			.sort((a, b) => (a.stack?.position ?? 0) - (b.stack?.position ?? 0))
			.map(l => l.number);
		if (landing.length === 0) return undefined;

		const retargeting = this.stackRoot
			? undefined
			: layers.find(l => (l.stack?.position ?? 0) === position + 1)?.number;

		return { landing: landing, retargeting: retargeting };
	}

	/** The blast-radius clause — "#a and #b on <trunk>", "#a and #b on <trunk> — #c retargets to <trunk>",
	 *  "on <trunk> — the whole stack" for a stack root, or a bare count when the layers aren't loaded.
	 *  Numbers and the trunk carry emphasis so the fine print's load-bearing facts read at a glance. */
	private landsClause(stack: PrStack, impact: { landing: string[]; retargeting?: string } | undefined) {
		const trunk = html`<span class="verdict__ref">${stack.baseRef}</span>`;
		if (impact != null) {
			const landing = joinPrNumbersHtml(impact.landing);
			if (this.stackRoot) {
				return html`${landing} on ${trunk} &mdash; the whole stack`;
			}
			if (impact.retargeting != null) {
				return html`${landing} on ${trunk} &mdash;
					<span class="verdict__num">#${impact.retargeting}</span> retargets to ${trunk}`;
			}
			return html`${landing} on ${trunk}`;
		}

		const count = this.stackRoot ? stack.size : stack.position;
		return html`${pluralize('pull request', count)} on ${trunk}`;
	}

	private renderChecksReason(pr: GraphSidebarPullRequest) {
		if (pr.statusCheckRollup === 'success') {
			return html`<span><code-icon icon="check"></code-icon> Checks passed</span>`;
		}

		if (pr.statusCheckRollup === 'failed' || pr.launchpad?.failingCI) {
			return html`<span><code-icon icon="close"></code-icon> Checks failing</span>`;
		}

		if (pr.statusCheckRollup === 'pending') {
			return html`<span><code-icon icon="warning"></code-icon> Checks running</span>`;
		}
		return nothing;
	}

	private renderNoConflictsReason(pr: GraphSidebarPullRequest) {
		const ms = pr.mergeableState;
		if (ms === 'Mergeable' || ms === 'FailingChecks' || ms === 'BlockedByPolicy') {
			return html`<span><code-icon icon="check"></code-icon> No conflicts</span>`;
		}
		return nothing;
	}

	/** The verdict box — mergeability read, merge controls, and (when stacked) the blast-radius line.
	 *  A closed-unmerged pull request gets no box at all. */
	private renderVerdict(pr: GraphSidebarPullRequest) {
		if (pr.state === 'merged') return this.renderVerdictMerged(pr);
		if (pr.state !== 'opened') return nothing;

		if (pr.isDraft) {
			return html`<div class="verdict verdict--draft">
				<div class="verdict__head"><span class="verdict__title">Draft &mdash; not ready to merge</span></div>
				<div class="verdict__reasons">
					<span
						><code-icon icon="warning"></code-icon> Mark ready for review on the remote to enable
						merging</span
					>
				</div>
			</div>`;
		}

		const conflicting = pr.mergeableState === 'Conflicting' || pr.launchpad?.hasConflicts;
		const stack = pr.stack;
		const impact = stack != null ? this.computeStackImpact(stack) : undefined;
		return conflicting
			? this.renderVerdictConflicting(pr, stack, impact)
			: this.renderVerdictReady(pr, stack, impact);
	}

	private renderVerdictReady(
		pr: GraphSidebarPullRequest,
		stack: PrStack | undefined,
		impact: ReturnType<GlGraphPrSheet['computeStackImpact']>,
	) {
		const count = getStackedMergeCount(stack, { wholeStack: this.stackRoot });
		// GitHub's own stacked button reads "Merge stack" with the count as a badge, not prose.
		const label =
			count > 1
				? html`Merge Stack...<span class="split-btn__count">${count}</span>`
				: html`Merge Pull Request...`;

		return html`<div class="verdict verdict--ready">
			<div class="verdict__head">
				<span class="verdict__title">Ready to merge</span>
				<span class="split-btn">
					<gl-popover-confirm
						heading=${count > 1 ? 'Merge Stack' : 'Merge Pull Request'}
						message=${this.mergeConfirmMessage(pr, count)}
						confirm=${this.mergeConfirmLabel(count)}
						placement="top-end"
						@gl-confirm=${this.onMergeConfirmed}
						@gl-cancel=${this.onMergeCancelled}
					>
						<gl-button class="split-btn__main" slot="anchor">${label}</gl-button>
					</gl-popover-confirm>
					<gl-menu-popover
						.items=${[
							{ label: 'Squash and Merge...', value: 'squash' },
							{ label: 'Rebase and Merge...', value: 'rebase' },
							{ label: 'Create a Merge Commit...', value: 'merge' },
						]}
						@gl-menu-select=${this.onMergeMethodSelect}
					>
						<gl-button class="split-btn__menu" slot="anchor" aria-label="Merge Options">
							<code-icon icon="chevron-down"></code-icon>
						</gl-button>
					</gl-menu-popover>
				</span>
			</div>
			<div class="verdict__reasons">${this.renderChecksReason(pr)} ${this.renderNoConflictsReason(pr)}</div>
			${stack != null ? html`<div class="verdict__blast">Lands ${this.landsClause(stack, impact)}</div>` : nothing}
		</div>`;
	}

	private renderVerdictConflicting(
		pr: GraphSidebarPullRequest,
		stack: PrStack | undefined,
		impact: ReturnType<GlGraphPrSheet['computeStackImpact']>,
	) {
		return html`<div class="verdict verdict--conflict">
			<div class="verdict__head">
				<span class="verdict__title">Has conflicts with ${pr.baseBranch ?? 'base'}</span>
			</div>
			<div class="verdict__reasons">
				<span><code-icon icon="close"></code-icon> Conflicting files</span> ${this.renderChecksReason(pr)}
			</div>
			${
				stack != null && pr.headBranch != null
					? html`<div class="verdict__blast">
							Resolve on ${pr.headBranch}, then merging lands ${this.landsClause(stack, impact)}
						</div>`
					: nothing
			}
		</div>`;
	}

	private renderVerdictMerged(pr: GraphSidebarPullRequest) {
		const stack = pr.stack;
		const trunk = stack?.baseRef ?? pr.baseBranch;
		const impact = stack != null ? this.computeStackImpact(stack) : undefined;

		const reasons: unknown[] = [];
		if (impact != null) {
			reasons.push(
				html`<span><code-icon icon="check"></code-icon> Landed ${joinPrNumbers(impact.landing)}</span>`,
			);
			if (impact.retargeting != null) {
				reasons.push(
					html`<span
						><code-icon icon="warning"></code-icon> #${impact.retargeting} retargeted to ${trunk}</span
					>`,
				);
			}
		}

		return html`<div class="verdict verdict--merged">
			<div class="verdict__head">
				<span class="verdict__title"
					>Merged into
					${trunk ?? 'base'}${
						pr.date != null
							? html` <formatted-date
									.date=${new Date(pr.date)}
									.format=${this.dateFormat}
								></formatted-date>`
							: nothing
					}</span
				>
			</div>
			${reasons.length > 0 ? html`<div class="verdict__reasons">${reasons}</div>` : nothing}
		</div>`;
	}

	/** The pull request's description, rendered as markdown and clamped to ~10 lines with a bottom fade
	 *  and a "Show more" toggle — only when it actually overflows the clamp (measured in `updated()`).
	 *  Never rendered for a stack-root sheet, which has no single description of its own. */
	private renderDescription(pr: GraphSidebarPullRequest) {
		if (this.stackRoot || !pr.body) return nothing;

		const collapsed = !this._descriptionExpanded;
		return html`<div>
			<span class="section-label">Description</span>
			<div class="description ${collapsed ? 'description--collapsed' : ''}">
				<div class="description__content">
					<gl-markdown density="compact" .markdown=${pr.body}></gl-markdown>
				</div>
				${collapsed && this._descriptionOverflows ? html`<div class="description__fade"></div>` : nothing}
			</div>
			${
				this._descriptionOverflows
					? html`<button type="button" class="description__toggle" @click=${this.toggleDescription}>
							${collapsed ? 'Show more' : 'Show less'}
						</button>`
					: nothing
			}
		</div>`;
	}

	private readonly toggleDescription = (): void => {
		this._descriptionExpanded = !this._descriptionExpanded;
	};

	/** The stack rail — every layer (top-first) plus a trunk row, each layer clickable to open its own
	 *  sheet except the current one. */
	private renderStackRail(pr: GraphSidebarPullRequest) {
		const stack = pr.stack;
		const layers = this.layers;
		if (stack == null || layers == null || layers.length === 0) return nothing;

		const currentPosition = this.stackRoot ? stack.size : stack.position;
		const currentOpen = pr.state === 'opened';

		return html`<div>
			<span class="section-label"
				>Stack #${stack.number}
				<span class="section-label__aside stack-rail__trunk">lands on ${stack.baseRef}</span></span
			>
			<div class="stack-rail">
				<div class="stack-rail__rows">
					${layers.map(l => this.renderStackRailRow(l, pr, currentPosition, currentOpen))}
					<div class="stack-rail__row">
						<span class="stack-rail__dot-col"><span class="stack-rail__dot"></span></span>
						<span class="stack-rail__title stack-rail__trunk">${stack.baseRef}</span>
						<span></span>
						<span></span>
					</div>
				</div>
			</div>
		</div>`;
	}

	private renderStackRailRow(
		layer: GraphSidebarPullRequest,
		current: GraphSidebarPullRequest,
		currentPosition: number,
		currentOpen: boolean,
	) {
		// The stack-root sheet is the stack summary, not any one layer's — so no row reads as "current"
		// there, and the top layer's row becomes clickable like the rest. Its dot still anchors the rail.
		const isAnchor = layer.number === current.number;
		const isCurrent = !this.stackRoot && isAnchor;
		const position = layer.stack?.position;
		const size = current.stack?.size;

		const dotClass =
			layer.state === 'merged'
				? 'stack-rail__dot stack-rail__dot--merged'
				: isAnchor
					? 'stack-rail__dot stack-rail__dot--current'
					: currentOpen && (position ?? 0) <= currentPosition
						? 'stack-rail__dot stack-rail__dot--landing'
						: 'stack-rail__dot';

		// GitHub's stack navigator links between layers; every non-current row does the same here.
		const interactive = !isCurrent;
		const activate = (e: Event): void => {
			if (e.type === 'keydown') {
				const key = (e as KeyboardEvent).key;
				if (key !== 'Enter' && key !== ' ') return;

				e.preventDefault();
			}

			e.stopPropagation();
			this.dispatchEvent(
				new CustomEvent('gl-graph-show-pr-sheet', {
					detail: { number: layer.number, push: true },
					bubbles: true,
					composed: true,
				}),
			);
		};

		return html`<div
			class="stack-rail__row ${isCurrent ? 'stack-rail__row--current' : ''}"
			role=${interactive ? 'button' : nothing}
			tabindex=${interactive ? '0' : nothing}
			aria-label=${interactive ? `Open pull request #${layer.number}` : nothing}
			@click=${interactive ? activate : nothing}
			@keydown=${interactive ? activate : nothing}
		>
			<span class="stack-rail__dot-col"><span class=${dotClass}></span></span>
			<span class="stack-rail__title">${layer.title}</span>
			<span class="muted">#${layer.number}</span>
			<span class="stack-rail__position ${isCurrent ? 'stack-rail__position--current' : ''}"
				>${position != null && size != null ? `${position}/${size}` : nothing}</span
			>
		</div>`;
	}

	/** Same command and same serialized context the row's own action sends, so the host resolves this
	 *  exactly as if the action had been clicked in the pull requests panel. Alt copies the url instead,
	 *  matching the row chip's own alt action. */
	private onOpenOnRemote = (e: MouseEvent) => {
		e.stopPropagation();
		const context = this.pullRequest?.context;
		this._sidebarActions?.executeAction(
			e.altKey ? 'gitlens.copyRemotePullRequestUrl:graph' : 'gitlens.openPullRequestOnRemote:graph',
			context != null ? serializeWebviewItemContext(context) : undefined,
		);
	};

	/** The merge confirmation, shared by both split-button halves — the strategy menu stores its pick
	 *  here and opens the same confirm the primary side anchors. */
	@query('gl-popover-confirm')
	private _mergeConfirmEl?: GlPopoverConfirm;

	/** Strategy chosen from the menu, consumed when the confirmation is accepted. Reactive so the
	 *  confirmation's button names the chosen strategy rather than a generic "Merge". */
	@state()
	private _pendingMergeMethod?: 'merge' | 'squash' | 'rebase';

	/** The confirm button carries the chosen strategy (the how); the heading keeps naming what merges. */
	private mergeConfirmLabel(count: number): string {
		const verb =
			this._pendingMergeMethod === 'squash'
				? 'Squash and Merge'
				: this._pendingMergeMethod === 'rebase'
					? 'Rebase and Merge'
					: 'Merge';
		return count > 1 ? `${verb} ${count} Pull Requests` : verb;
	}

	/** Mirrors the Launchpad confirmation's copy — the sheet confirms in place instead of dropping a
	 *  quick pick over the command palette. */
	private mergeConfirmMessage(pr: GraphSidebarPullRequest, count: number): string {
		const head = pr.headBranch ?? 'this pull request';
		if (count > 1) {
			const below = count - 1;
			const trunk = pr.stack?.baseRef ?? pr.baseBranch ?? 'its base';
			return `Merging ${head} also merges the ${pluralize('pull request', below)} below it in the stack, into ${trunk}. This cannot be undone.`;
		}
		return `Are you sure you want to merge ${head}${pr.baseBranch ? ` into ${pr.baseBranch}` : ''}? This cannot be undone.`;
	}

	private onMergeConfirmed = (): void => {
		const method = this._pendingMergeMethod;
		this._pendingMergeMethod = undefined;
		this.dispatchMerge(method);
	};

	private onMergeCancelled = (): void => {
		this._pendingMergeMethod = undefined;
	};

	private dispatchMerge(mergeMethod: 'merge' | 'squash' | 'rebase' | undefined): void {
		const pr = this.pullRequest;
		if (pr == null) return;

		this.dispatchEvent(
			new CustomEvent('gl-graph-merge-pull-request', {
				detail: {
					number: pr.number,
					stack: pr.stack != null ? { number: pr.stack.number, position: pr.stack.position } : undefined,
					mergeMethod: mergeMethod,
					confirmed: true,
				},
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onMergeMethodSelect = async (e: CustomEvent<{ value: string }>): Promise<void> => {
		// The strategy still rides the same confirmation as the primary side — a picked method is a
		// choice, not a commitment to the blast radius.
		this._pendingMergeMethod = e.detail.value as 'merge' | 'squash' | 'rebase';
		// Let the confirmation re-render with the strategy-specific label before it opens
		await this.updateComplete;
		void this._mergeConfirmEl?.show();
	};
}
