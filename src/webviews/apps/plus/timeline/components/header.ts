import * as l10n from '@vscode/l10n';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { GitReference } from '@gitlens/git/models/reference.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import type { RepositoryShape } from '../../../../../git/models/repositoryShape.js';
import type { TimelinePeriod, TimelineScopeType, TimelineSliceBy } from '../../../../plus/timeline/protocol.js';
import { compactBreadcrumbsConsumerStyles } from '../../../shared/components/breadcrumbs.js';
import '../../../shared/components/button.js';
import '../../../shared/components/checkbox/checkbox.js';
import '@gitlens/components/components/codeIcon.js';
import '../../../shared/components/copy-container.js';
import '../../../shared/components/file-icon/file-icon.js';
import '../../../shared/components/menu/menu-label.js';
import '../../../shared/components/menu/menu-popover.js';
import '@gitlens/components/components/overlays/popover.js';
import '@gitlens/components/components/overlays/tooltip.js';
import '../../../shared/components/ref-button.js';
import '../../../shared/components/ref-name.js';
import '../../../shared/components/repo-button-group.js';

/** Static fallback labels for the timeframe pill when the chart hasn't reported a live visible
 *  span yet (initial paint, dataset hasn't resolved). Once the chart emits, the pill switches to
 *  `formatVisibleSpan(visibleSpanMs)` so it reflects the actual viewport — including zoom/pan.
 *  Exported so the embedded Graph treemap can reuse the same labels for its own period picker —
 *  both viz modes share `graphState.timelinePeriod`, so their pickers stay in lockstep. */
export const periodLabels: Record<TimelinePeriod, string> = {
	'7|D': l10n.t('1 week'),
	'1|M': l10n.t('1 month'),
	'3|M': l10n.t('3 months'),
	'6|M': l10n.t('6 months'),
	'9|M': l10n.t('9 months'),
	'1|Y': l10n.t('1 year'),
	'2|Y': l10n.t('2 years'),
	'4|Y': l10n.t('4 years'),
	all: l10n.t('All time'),
};

const dayMs = 24 * 60 * 60 * 1000;
const monthDays = 30.4375; // gregorian-year-average month length
const weekDays = 7;

/** Friendly duration for the visible-time-range pill. Snaps to a single unit at the most natural
 *  granularity for the span so the pill always reads like a period label ("3 months", "5 days")
 *  rather than a precise duration. Mirrors the period dropdown's vocabulary. */
function formatVisibleSpan(ms: number): string {
	const days = ms / dayMs;
	if (days < 1) {
		const hours = Math.max(1, Math.round(ms / (60 * 60 * 1000)));
		return formatPlural(l10n.t('{0, plural, one{{0} hour} other{{0} hours}}'), [hours]);
	}
	if (days < 2 * weekDays) {
		const d = Math.max(1, Math.round(days));
		return formatPlural(l10n.t('{0, plural, one{{0} day} other{{0} days}}'), [d]);
	}
	if (days < 2 * monthDays) {
		const w = Math.round(days / weekDays);
		return formatPlural(l10n.t('{0, plural, one{{0} week} other{{0} weeks}}'), [w]);
	}

	const months = days / monthDays;
	if (months < 24) {
		const m = Math.max(1, Math.round(months));
		return formatPlural(l10n.t('{0, plural, one{{0} month} other{{0} months}}'), [m]);
	}

	const years = months / 12;
	const rounded = years >= 10 ? Math.round(years) : Number(years.toFixed(1));
	return formatPlural(l10n.t('{0, plural, one{{0} year} other{{0} years}}'), [rounded]);
}

/** Props that fully describe the timeline header's render state. Both the standalone Visual
 *  History (`gl-timeline-app`) and the embedded Graph timeline mode (`gl-graph-timeline`) hand
 *  these to this component so a single rendering implementation backs both surfaces. */
export interface GlTimelineHeaderEventDetails {
	'gl-timeline-header-period-change': { period: TimelinePeriod };
	'gl-timeline-header-slice-by-change': { sliceBy: TimelineSliceBy };
	'gl-timeline-header-show-all-branches-change': { showAllBranches: boolean };
	'gl-timeline-header-choose-head-ref': { location?: string };
	'gl-timeline-header-choose-base-ref': void;
	'gl-timeline-header-choose-path': { detached: boolean };
	'gl-timeline-header-clear-scope': void;
	'gl-timeline-header-change-scope': { type: TimelineScopeType; value: string | undefined; detached: boolean };
}

@customElement('gl-timeline-header')
export class GlTimelineHeader extends LitElement {
	static override styles = [
		compactBreadcrumbsConsumerStyles,
		css`
			:host {
				display: block;
				min-width: 0;
			}

			.header {
				display: grid;
				flex: none;
				grid-template-areas: 'details toolbox';
				grid-template-columns: 1fr min-content;
				gap: var(--gl-space-10);
				align-items: center;
				min-width: 0;
				margin: 0.5rem 1rem;
				color: var(--vscode-sideBar-foreground, var(--vscode-foreground));
			}

			:host([placement='editor']) .header {
				margin-top: var(--gl-space-10);
				margin-right: 1.5rem;
			}

			/* When embedded inside the Graph webview's Visual History, the surrounding header
* row already supplies horizontal/vertical padding and the visualization-switcher
* sits to our left. Dropping our own margin keeps the two-visualization header
* heights aligned so toggling between Timeline and Treemap doesn't jump the chart. */
			:host([host='graph']) .header {
				margin: 0;
			}

			.details {
				display: flex;
				grid-area: details;
				gap: var(--gl-space-10);
				align-items: center;
				min-width: 0;
				margin-right: var(--gl-space-10);
				font-size: var(--font-size);
			}

			.details gl-breadcrumbs {
				flex: 1;
				min-width: 0;
				padding: 0.1rem 0;
				overflow: hidden;
			}

			.breadcrumb-actions {
				display: inline-flex;
				align-items: center;

				/* Slotted into <gl-breadcrumbs>; the host is display: flex with item orders
 at idx * 2. Push to the end of the chain via flex order. */
				order: 9999;
				margin-left: var(--gl-space-4);

				/* Match the breadcrumbs' compact density: smaller font, smaller icons, tighter
button padding. The buttons sit visually adjacent to the crumb chain so they
need to share its size scale or they look like a different control set. */
				font-size: var(--gl-font-md);
				--code-icon-size: 1.3rem;
			}

			.breadcrumb-actions gl-button {
				--button-compact-padding: 0.1rem 0.3rem;
				--button-line-height: 1.2;

				/* Match the breadcrumb-item's fixed min-height so icon-only buttons (the Clear
 ×) and icon+text buttons (Choose) end up the same height regardless of
 content. Without this, the icon-only one is ~1.4px shorter. */
				min-height: 1.8rem;
			}

			/* Style hr inside slotted tooltip content (e.g. gl-ref-button's "Change Reference..."
tooltip in the View Options popover). Browser default hr is a thick beveled line
that looks wrong inside the dark tooltip body. */
			[slot='tooltip'] hr {
				margin: var(--gl-space-4) 0;
				border: none;
				border-top: var(--gl-border-width) solid var(--color-foreground--25);
			}

			.details__timeframe {
				flex: 0 0 auto;
				margin-right: var(--gl-space-4);
				font-size: var(--gl-font-md);
				color: var(--color-foreground--75);
				white-space: nowrap;
				user-select: none;
			}

			/* Pill renders as a popover-anchor button — strip default <button> chrome so it reads
as the same compact label-with-chevron the static span renders, then add the hover/
focus affordance to advertise interactivity. */
			.details__timeframe--button {
				display: inline-flex;
				gap: var(--gl-space-2);
				align-items: center;
				padding: 0.1rem 0.4rem;
				font: inherit;
				color: inherit;
				cursor: pointer;
				background: transparent;
				border: var(--gl-border-width) solid transparent;
				border-radius: var(--gl-radius-sm);
				transition:
					background var(--gl-duration-x-fast) ease,
					border-color var(--gl-duration-x-fast) ease,
					color var(--gl-duration-x-fast) ease;
			}

			.details__timeframe--button:hover,
			.details__timeframe--button:focus-visible {
				color: var(--vscode-foreground);
				outline: none;
				background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
			}

			.details__timeframe--button:focus-visible {
				border-color: var(--vscode-focusBorder, transparent);
			}

			.details__timeframe--button code-icon {
				font-size: var(--gl-font-micro);
				opacity: 0.75;
			}

			.config__help {
				padding: 0 var(--gl-space-4);
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--50);
			}

			.toolbox {
				display: flex;
				grid-area: toolbox;
				gap: 0.3rem;
				align-items: center;
			}

			.slice-toggle {
				display: inline-flex;
				gap: 0;
				align-items: center;
			}

			.config__content {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-4);
				min-width: 20rem;
				padding: var(--gl-space-4) var(--gl-space-2);
			}

			.config__content section {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-2);
				padding: var(--gl-space-2) var(--gl-space-4);
			}

			.select-container {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-2);
			}

			.select {
				padding: var(--gl-space-2) var(--gl-space-4);
				font: inherit;
				color: var(--vscode-dropdown-foreground);
				background: var(--vscode-dropdown-background);
				border: var(--gl-border-width) solid var(--vscode-dropdown-border, transparent);
			}
		`,
	];

	@property({ type: String, reflect: true })
	placement: 'editor' | 'view' = 'editor';

	/** Which surface is hosting this header — used for telemetry source attribution. */
	@property({ type: String })
	host: 'timeline' | 'graph' = 'timeline';

	@property({ type: Object })
	repository?: RepositoryShape & { ref: GitReference | undefined };

	@property({ type: Number })
	repositoryCount = 0;

	@property({ type: Object })
	headRef?: GitReference;

	@property({ type: String })
	scopeType: TimelineScopeType = 'repo';

	/** When set, file/folder breadcrumbs render. Empty / undefined → repo-scoped header. */
	@property({ type: String })
	relativePath?: string;

	@property({ type: String })
	period: TimelinePeriod = '1|M';

	/** Actual visible-time-range span (ms) reported by the chart's `gl-visible-range-changed`
	 *  event. When set, the pill shows this instead of the period setting so it stays accurate
	 *  through zoom and pan. Undefined → fall back to the period label (initial state, before
	 *  the chart has emitted). */
	@property({ type: Number })
	visibleSpanMs?: number;

	@property({ type: String })
	sliceBy: TimelineSliceBy = 'author';

	@property({ type: Boolean })
	showAllBranches = false;

	@property({ type: Boolean })
	showAllBranchesSupported = true;

	@property({ type: Boolean })
	sliceBySupported = false;

	/** Repository breadcrumb (always shown standalone; suppressed in graph-embedded since the repo
	 *  is already shown in the Graph's repo picker). */
	private get showRepository(): boolean {
		return this.host === 'timeline';
	}

	/** Branch breadcrumb (same rationale — branch is shown in the Graph's main header in embedded
	 *  mode and controlled by the scope picker). */
	private get showBranch(): boolean {
		return this.host === 'timeline';
	}

	/** Trailing "Choose File / Folder…" / "Clear" actions. Always present in graph-embedded mode
	 *  (the only way to scope the in-graph timeline); in standalone mode only on the editor
	 *  placement (the sidebar view is file-scoped via active-editor follow). */
	private get showFolderPicker(): boolean {
		return this.host === 'graph' || this.placement === 'editor';
	}

	override render(): unknown {
		return html`<header class="header">
			<span class="details">${this.renderBreadcrumbs()}</span>
			<span class="toolbox"
				>${this.renderTimeframe()}${this.renderSliceByToggle()}${this.renderConfigPopover()}<slot
					name="toolbox"
				></slot
			></span>
		</header>`;
	}

	private renderBreadcrumbs() {
		return html`<gl-breadcrumbs density="compact" label=${l10n.t('Visual History scope')}>
			${this.renderRepositoryBreadcrumbItem()}${this.renderBranchBreadcrumbItem()}${this.renderPathItems()}
			${this.showFolderPicker ? this.renderPathActions() : nothing}
		</gl-breadcrumbs>`;
	}

	private renderRepositoryBreadcrumbItem() {
		const repo = this.repository;
		if (repo == null || !this.showRepository) return nothing;

		const source = { source: this.host } as const;

		return html`<gl-breadcrumb-item
			icon="gl-repository"
			label="${repo.name}"
			priority="1"
			shrink="10000000"
			type="repo"
		>
			<gl-repo-button-group
				aria-label=${l10n.t('Visualize Repository History')}
				.connectIcon=${false}
				.hasMultipleRepositories=${this.repositoryCount > 1}
				.icon=${false}
				.repository=${repo}
				.source=${source}
				@gl-click=${this.onChangeScope}
			>
				<span slot="tooltip">
					${l10n.t('Visualize Repository History')}
					<hr />
					${repo.name}
				</span>
			</gl-repo-button-group>
		</gl-breadcrumb-item>`;
	}

	private renderBranchBreadcrumbItem() {
		if (!this.showBranch) return nothing;

		const headRef = this.headRef;
		const showAllBranches = this.showAllBranches;
		return html`<gl-breadcrumb-item
			icon="${showAllBranches ? 'git-branch' : getRefIcon(headRef)}"
			label="${showAllBranches ? l10n.t('All Branches') : (headRef?.name ?? l10n.t('Branch'))}"
			priority="4"
			shrink="100000"
			type="ref"
		>
			<gl-ref-button .ref=${showAllBranches ? undefined : headRef} @click=${this.onChooseHeadRef}>
				<span slot="empty">${l10n.t('All Branches')}</span>
				<span slot="tooltip">
					${l10n.t('Change Reference...')}
					<hr />
					${showAllBranches ? l10n.t('Showing All Branches') : html`<gl-ref-name icon .ref=${headRef}></gl-ref-name>`}
				</span>
			</gl-ref-button>
		</gl-breadcrumb-item>`;
	}

	private renderPathItems() {
		const path = this.relativePath;
		if (!path) return nothing;

		const breadcrumbs = [];
		const parts = path.split('/');
		const basePart = parts.pop() || '';
		const folders = parts.length;

		// Folder segments — each gets its own flat breadcrumb item. Root folder is `foldable` so
		// the chain collapses cleanly when overflowing; mid-folders use `appearance="segment"` to
		// render the slim chevron-style chip the breadcrumbs component reserves for path runs.
		if (folders) {
			const rootPart = parts.shift()!;
			let fullPath = rootPart;
			breadcrumbs.push(html`
				<gl-breadcrumb-item
					foldable
					icon="folder"
					interactive
					label="${rootPart}"
					priority="3"
					type="${'folder' satisfies TimelineScopeType}"
					value="${rootPart}"
					aria-label=${l10n.t('Visualize folder history of {0}', rootPart)}
					@click=${this.onChangeScope}
				>
					${rootPart}
					<span slot="tooltip">${rootPart}</span>
				</gl-breadcrumb-item>
			`);
			parts.forEach((part, i) => {
				fullPath = `${fullPath}/${part}`;
				const segPath = fullPath;
				// Sub-priority within tier 2: deepest segment (closest to file) collapses first.
				const segPriority = 2 + (parts.length - 1 - i) * 0.01;
				breadcrumbs.push(html`
					<gl-breadcrumb-item
						appearance="segment"
						interactive
						label="${part}"
						priority="${segPriority}"
						type="${'folder' satisfies TimelineScopeType}"
						value="${segPath}"
						aria-label=${l10n.t('Visualize folder history of {0}', segPath)}
						@click=${this.onChangeScope}
					>
						${part}
						<span slot="tooltip">${segPath}</span>
					</gl-breadcrumb-item>
				`);
			});
		}

		// Base item (file or final folder).
		const isFile = this.scopeType !== 'folder';
		const folderIcon = this.scopeType === 'folder' && !folders ? 'folder' : undefined;
		breadcrumbs.push(html`
			<gl-breadcrumb-item
				icon="${ifDefined(folderIcon)}"
				label="${basePart}"
				priority="5"
				shrink="0"
				type="${(this.scopeType === 'folder' ? 'folder' : 'file') satisfies TimelineScopeType}"
				value="${path}"
			>
				${isFile ? html`<gl-file-icon slot="start" filename="${basePart}"></gl-file-icon>` : nothing}
				<gl-copy-container
					tabindex="0"
					copyLabel=${l10n.t('Copy Path\n\n{0}', path)}
					.content=${path}
					placement="bottom"
				>
					<span>${basePart}</span>
				</gl-copy-container>
			</gl-breadcrumb-item>
		`);

		return breadcrumbs;
	}

	private renderPathActions() {
		// If the picker is shown (caller decided picking is allowed), clearing back to repo
		// scope is also allowed — no separate placement gate needed. Standalone sidebar mode
		// passes showFolderPicker=false so we never reach this code path there.
		const canClear = this.scopeType !== 'repo';
		// Clear (×) sits adjacent to the breadcrumbs it ejects; Choose follows as the
		// always-available "open picker" action.
		return html`<span class="breadcrumb-actions">
			${
				canClear
					? html`<gl-button
							appearance="toolbar"
							density="compact"
							@click=${this.onClearScope}
							tooltip=${l10n.t('Clear File / Folder Filter')}
							aria-label=${l10n.t('Clear File / Folder Filter')}
							><code-icon icon="close"></code-icon
						></gl-button>`
					: nothing
			}
			<gl-button
				appearance="toolbar"
				density="compact"
				@click=${this.onChoosePath}
				tooltip=${l10n.t('Choose File or Folder to Visualize...')}
				aria-label=${l10n.t('Choose File or Folder to Visualize...')}
				><code-icon slot="prefix" icon="folder-opened"></code-icon
				>${l10n.t('Choose File / Folder...')}</gl-button
			>
		</span>`;
	}

	private renderTimeframe() {
		// Prefer the chart's reported visible span so the pill stays accurate through zoom/pan.
		// Falls back to the period label until the chart has emitted (initial paint). The pill
		// itself is a popover trigger — clicking it opens a focused menu of the supported time
		// ranges anchored at the pill so users can change the range without trekking across the
		// toolbar to the gear icon. The gear popover keeps the full View Options (which uses a
		// `<select>` for the period for compactness alongside the other controls).
		const label =
			this.visibleSpanMs != null && this.visibleSpanMs > 0
				? formatVisibleSpan(this.visibleSpanMs)
				: periodLabels[this.period];
		if (label == null) return nothing;

		const items = (Object.entries(periodLabels) as [TimelinePeriod, string][]).map(([value, optionLabel]) => ({
			value: value,
			label: optionLabel,
			selected: this.period === value,
		}));
		// `keep-open-on-select` — the menu stays open after a pick so the user can sweep through
		// ranges; outside-click / Escape still dismiss it.
		return html`<gl-menu-popover
			class="details__timeframe-popover"
			placement="bottom-end"
			keep-open-on-select
			.items=${items}
			@gl-menu-select=${this.onPeriodMenuSelect}
		>
			<button
				slot="anchor"
				class="details__timeframe details__timeframe--button"
				type="button"
				aria-label=${l10n.t('Change default time range')}
			>
				${label}<code-icon icon="chevron-down"></code-icon>
			</button>
		</gl-menu-popover>`;
	}

	private readonly onPeriodMenuSelect = (e: CustomEvent<{ value: string }>): void => {
		const period = e.detail.value as TimelinePeriod;
		if (this.period !== period) {
			this.emit('gl-timeline-header-period-change', { period: period });
		}
	};

	private renderConfigPopover() {
		return html`<gl-popover placement="bottom" trigger="hover focus click">
			<gl-button slot="anchor" appearance="toolbar" aria-label=${l10n.t('Timeline Options')}>
				<code-icon icon="settings"></code-icon>
			</gl-button>
			<div slot="content" class="config__content">
				<menu-label>${l10n.t('View Options')}</menu-label>
				${this.renderConfigHead()} ${this.renderConfigShowAllBranches()} ${this.renderPeriodSelect()}
			</div>
		</gl-popover>`;
	}

	private renderConfigHead() {
		// In the graph integration the branch is controlled by the Graph's scope picker, so the
		// timeline doesn't expose its own — same reasoning as the suppressed branch breadcrumb.
		if (!this.showBranch) return nothing;

		const headRef = this.headRef;
		const showAllBranches = this.showAllBranches;
		const disabled = showAllBranches && this.sliceBy !== 'branch';

		return html`<section>
			<label for="head" ?disabled=${disabled}>${l10n.t('Branch')}</label>
			<gl-ref-button
				name="head"
				?disabled=${disabled}
				icon
				.ref=${headRef}
				location="config"
				@click=${this.onChooseHeadRef}
			>
				<span slot="tooltip">
					${l10n.t('Change Reference...')}
					<hr />
					${showAllBranches ? l10n.t('Showing All Branches') : html`<gl-ref-name icon .ref=${headRef}></gl-ref-name>`}
				</span>
			</gl-ref-button>
		</section>`;
	}

	private renderConfigShowAllBranches() {
		if (!this.showAllBranchesSupported) return nothing;
		return html`<section>
			<gl-checkbox value="all" .checked=${this.showAllBranches} @gl-change-value=${this.onShowAllBranchesChanged}
				>${l10n.t('View All Branches')}</gl-checkbox
			>
		</section>`;
	}

	private renderPeriodSelect() {
		const period = this.period;
		return html`<section>
			<span class="select-container">
				<label for="periods">${l10n.t('Default time range')}</label>
				<select class="select" name="periods" .value=${period} @change=${this.onPeriodChanged}>
					<option value="7|D" ?selected=${period === '7|D'}>${l10n.t('1 week')}</option>
					<option value="1|M" ?selected=${period === '1|M'}>${l10n.t('1 month')}</option>
					<option value="3|M" ?selected=${period === '3|M'}>${l10n.t('3 months')}</option>
					<option value="6|M" ?selected=${period === '6|M'}>${l10n.t('6 months')}</option>
					<option value="9|M" ?selected=${period === '9|M'}>${l10n.t('9 months')}</option>
					<option value="1|Y" ?selected=${period === '1|Y'}>${l10n.t('1 year')}</option>
					<option value="2|Y" ?selected=${period === '2|Y'}>${l10n.t('2 years')}</option>
					<option value="4|Y" ?selected=${period === '4|Y'}>${l10n.t('4 years')}</option>
					<option value="all" ?selected=${period === 'all'}>${l10n.t('Full history')}</option>
				</select>
			</span>
			<small class="config__help">${l10n.t('Older history loads dynamically as you scroll')}</small>
		</section>`;
	}

	/** Top-level slice-by toggle in the toolbox — two icon buttons (Author / Branch) with the
	 *  active one painted via `gl-button`'s built-in `aria-checked='true'` styling
	 *  (--vscode-inputOption-active*). Always rendered for discoverability; disabled at repo
	 *  scope with a wrapping tooltip that explains what's needed. */
	private renderSliceByToggle() {
		const disabled = !this.sliceBySupported;
		const isAuthor = this.sliceBy === 'author';
		return html`<gl-tooltip ?disabled=${!disabled} placement="bottom" .distance=${6}>
			<span class="slice-toggle">
				<gl-button
					appearance="toolbar"
					role="switch"
					aria-checked=${isAuthor ? 'true' : 'false'}
					aria-label=${l10n.t('Slice by Author')}
					tooltip=${disabled ? '' : l10n.t('Slice by Author')}
					?disabled=${disabled}
					@click=${this.onSliceByAuthor}
				>
					<code-icon icon="account"></code-icon>
				</gl-button>
				<gl-button
					appearance="toolbar"
					role="switch"
					aria-checked=${!isAuthor ? 'true' : 'false'}
					aria-label=${l10n.t('Slice by Branch')}
					tooltip=${disabled ? '' : l10n.t('Slice by Branch')}
					?disabled=${disabled}
					@click=${this.onSliceByBranch}
				>
					<code-icon icon="git-branch"></code-icon>
				</gl-button>
			</span>
			<span slot="content">${l10n.t('Choose a file or folder to slice by branches')}</span>
		</gl-tooltip>`;
	}

	private onPeriodChanged = (e: Event): void => {
		const value = (e.target as HTMLSelectElement).value as TimelinePeriod;
		this.emit('gl-timeline-header-period-change', { period: value });
	};

	private onSliceByAuthor = (): void => {
		if (this.sliceBy === 'author') return;

		this.emit('gl-timeline-header-slice-by-change', { sliceBy: 'author' });
	};

	private onSliceByBranch = (): void => {
		if (this.sliceBy === 'branch') return;

		this.emit('gl-timeline-header-slice-by-change', { sliceBy: 'branch' });
	};

	private onShowAllBranchesChanged = (e: CustomEvent): void => {
		const checked = (e.target as HTMLInputElement).checked;
		this.emit('gl-timeline-header-show-all-branches-change', { showAllBranches: checked });
	};

	private onChooseHeadRef = (e: MouseEvent): void => {
		const target = e.currentTarget as HTMLElement | null;
		if ((target as HTMLButtonElement | null)?.disabled) return;

		const location = target?.getAttribute('location') ?? undefined;
		this.emit('gl-timeline-header-choose-head-ref', { location: location });
	};

	private onChoosePath = (e: MouseEvent): void => {
		e.stopImmediatePropagation();
		const detached = this.placement === 'view' || e.altKey || e.shiftKey;
		this.emit('gl-timeline-header-choose-path', { detached: detached });
	};

	private onClearScope = (e: MouseEvent): void => {
		e.stopImmediatePropagation();
		this.emit('gl-timeline-header-clear-scope', undefined);
	};

	private onChangeScope = (e: MouseEvent): void => {
		const el = (e.target as HTMLElement)?.closest('gl-breadcrumb-item');
		const type = el?.getAttribute('type') as TimelineScopeType | null;
		if (type == null) return;

		const value = el?.getAttribute('value') ?? undefined;
		const detached = this.placement === 'view' || e.altKey || e.shiftKey;
		this.emit('gl-timeline-header-change-scope', { type: type, value: value, detached: detached });
	};

	private emit<K extends keyof GlTimelineHeaderEventDetails>(name: K, detail: GlTimelineHeaderEventDetails[K]): void {
		this.dispatchEvent(new CustomEvent(name, { detail: detail, bubbles: true, composed: true }));
	}
}

function getRefIcon(ref: GitReference | undefined): string {
	switch (ref?.refType) {
		case 'branch':
			return 'git-branch';
		case 'tag':
			return 'tag';
		default:
			return 'git-commit';
	}
}
