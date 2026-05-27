import type { PropertyValues } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { cache } from 'lit/directives/cache.js';
import { repeat } from 'lit/directives/repeat.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import type { Autolink } from '../../../../../autolinks/models/autolinks.js';
import { serializeWebviewItemContext } from '../../../../../system/webview.js';
import type { DetailsItemTypedContext, Preferences, State } from '../../../../plus/graph/detailsProtocol.js';
import { buildFolderContext } from '../../../../plus/graph/detailsProtocol.js';
import type {
	BranchComparisonCommit,
	BranchComparisonContributor,
	BranchComparisonFile,
} from '../../../../plus/graph/graphService.js';
import type { OpenMultipleChangesArgs } from '../../../shared/actions/file.js';
import { renderLearnAboutAutolinks } from '../../../shared/components/chips/learn-about-autolinks.js';
import { redispatch } from '../../../shared/components/element.js';
import type { GlSplitPanelSnapFunction } from '../../../shared/components/split-panel/split-panel.js';
import {
	elementBase,
	metadataBarVarsBase,
	scrollableBase,
	subPanelEnterStyles,
} from '../../../shared/components/styles/lit/base.css.js';
import type { TreeItemAction } from '../../../shared/components/tree/base.js';
import type { FileChangeListItemDetail } from '../../../shared/components/tree/gl-file-tree-pane.js';
import { compareModePanelStyles } from './gl-details-compare-mode-panel.css.js';
import { panelActionInputStyles } from './shared-panel.css.js';
import './gl-commit-row.js';
import './gl-compare-ai-actions.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/badges/badge.js';
import '../../../shared/components/branch-name.js';
import '../../../shared/components/chips/action-chip.js';
import '../../../shared/components/chips/autolink-chip.js';
import '../../../shared/components/chips/chip-overflow.js';
import '../../../shared/components/menu/menu-divider.js';
import '../../../shared/components/menu/menu-item.js';
import '../../../shared/components/menu/menu-label.js';
import '../../../shared/components/menu/menu-list.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/panes/pane-group.js';
import '../../../shared/components/progress.js';
import '../../../shared/components/webview-pane.js';
import '../../../shared/components/split-panel/split-panel.js';
import '../../../shared/components/tree/tree.js';
import '../../../shared/components/tree/tree-item.js';
import '../../../shared/components/tree/gl-file-tree-pane.js';
import '../../../shared/components/avatar/avatar.js';

export interface CompareRefsChangeRefDetail {
	side: 'left' | 'right';
}

/** Event detail for `file-compare-between` — produced by the compare-mode panel's row-click
 *  handler and consumed by the surrounding details panel to invoke `openFileCompareBetween`. */
export interface FileCompareBetweenDetail extends FileChangeListItemDetail {
	lhsRef: string;
	rhsRef: string;
}

@customElement('gl-details-compare-mode-panel')
export class GlDetailsCompareModePanel extends LitElement {
	static override styles = [
		elementBase,
		metadataBarVarsBase,
		scrollableBase,
		compareModePanelStyles,
		panelActionInputStyles,
		subPanelEnterStyles,
	];

	@property({ attribute: 'branch-name' })
	branchName?: string;

	@property({ attribute: 'repo-path' })
	repoPath?: string;

	/** Persisted preference threaded through to the inner `gl-file-tree-pane`. */
	@property({ type: Boolean, attribute: 'show-search-box' })
	showSearchBox?: boolean;

	/** Persisted preference threaded through to the inner `gl-file-tree-pane`. */
	@property({ type: Boolean, attribute: 'search-box-filter' })
	searchBoxFilter?: boolean;

	@property({ attribute: 'left-ref' })
	leftRef?: string;

	@property({ attribute: 'left-ref-type' })
	leftRefType?: 'branch' | 'tag' | 'commit';

	@property({ attribute: 'right-ref' })
	rightRef?: string;

	@property({ attribute: 'right-ref-type' })
	rightRefType?: 'branch' | 'tag' | 'commit';

	@property({ type: Boolean, attribute: 'include-working-tree' })
	includeWorkingTree = false;

	@property({ type: Boolean })
	stale = false;

	@property({ type: Boolean, attribute: 'has-worktree' })
	hasWorktree = false;

	/** Path of the worktree currently checked out at rightRef (the Compare side), when one exists.
	 *  Used to route WT-touching file operations (single-file diffs, multi-diff, folder context)
	 *  to the worktree's repoPath. Falls back to `repoPath` when undefined. */
	@property({ attribute: 'right-ref-worktree-path' })
	rightRefWorktreePath?: string;

	/** Merge base of leftRef and rightRef, when one exists. Used by per-tab file diff direction:
	 *  - Ahead tab anchors on `mergeBase → rightRef` (what Compare contributed since divergence).
	 *  - Behind tab anchors on `mergeBase → leftRef` (what Base contributed since divergence).
	 *  - All Files tab stays on `leftRef → rightRef` (cumulative latest-of-both).
	 *  Undefined for disjoint refs; tab logic falls back to the 2-dot symmetric form. */
	@property({ attribute: 'merge-base' })
	mergeBase?: string;

	@property({ type: Number, attribute: 'ahead-count' })
	aheadCount = 0;

	@property({ type: Number, attribute: 'behind-count' })
	behindCount = 0;

	@property({ type: Number, attribute: 'all-files-count' })
	allFilesCount = 0;

	@property({ type: Array })
	aheadCommits: BranchComparisonCommit[] = [];

	@property({ type: Array })
	aheadFiles: BranchComparisonFile[] = [];

	@property({ type: Array })
	behindCommits: BranchComparisonCommit[] = [];

	@property({ type: Array })
	behindFiles: BranchComparisonFile[] = [];

	/** Files for the All Files tab — comes from Phase 1 of the progressive load (counts + 2-dot
	 *  diff). Distinct from the per-side commits so the All tab is renderable as soon as the
	 *  summary lands, before either side's commits arrive. */
	@property({ type: Array })
	allFiles: BranchComparisonFile[] = [];

	/** Phase 2 loaded flags — per-side. False until that side's commits have been fetched
	 *  (lazy, on first activation). The panel uses these to render a loading state in the
	 *  commit list + file area instead of the empty state. */
	@property({ type: Boolean, attribute: 'ahead-loaded' })
	aheadLoaded = false;

	@property({ type: Boolean, attribute: 'behind-loaded' })
	behindLoaded = false;

	/** True when the active side has more commits beyond the currently-loaded slice — drives
	 *  the "Load More" row's visibility at the bottom of the commit list. Per-tab; the panel
	 *  consults whichever side matches `activeTab`. */
	@property({ type: Boolean, attribute: 'ahead-has-more' })
	aheadHasMore = false;

	@property({ type: Boolean, attribute: 'behind-has-more' })
	behindHasMore = false;

	/** True while the side's load-more fetch is in flight. Disables the load-more button and
	 *  swaps its icon to a spinner so users don't double-click. Per-tab. */
	@property({ type: Boolean, attribute: 'ahead-loading-more' })
	aheadLoadingMore = false;

	@property({ type: Boolean, attribute: 'behind-loading-more' })
	behindLoadingMore = false;

	@property({ type: Boolean })
	loading = false;

	@property()
	errorMessage?: string;

	@property({ attribute: 'active-tab' })
	activeTab: 'all' | 'ahead' | 'behind' = 'ahead';

	@property({ attribute: 'selected-commit-sha' })
	selectedCommitSha?: string;

	@property({ attribute: 'active-view' })
	activeView: 'files' | 'contributors' = 'files';

	@property({ type: Array })
	autolinks: Autolink[] = [];

	@property({ type: Array })
	enrichedItems: IssueOrPullRequest[] = [];

	@property({ type: Boolean, attribute: 'enrichment-loading' })
	enrichmentLoading = false;

	@property({ type: Boolean, attribute: 'enrichment-requested' })
	enrichmentRequested = false;

	@property({ type: Boolean, attribute: 'autolinks-enabled' })
	autolinksEnabled = false;

	@property({ type: Boolean, attribute: 'has-integrations-connected' })
	hasIntegrationsConnected = false;

	@property({ type: Boolean, attribute: 'has-account' })
	hasAccount = false;

	@property({ type: Array })
	contributors: BranchComparisonContributor[] = [];

	@property({ type: Boolean, attribute: 'contributors-loading' })
	contributorsLoading = false;

	/** Map<sha, true> for commit-file fetches in flight. Used to show a "Loading changes…" state
	 *  in the file pane while the lazy fetch for the selected commit is pending. */
	@property({ type: Object })
	commitFilesLoadingByShas?: Map<string, boolean>;

	@property({ type: Object })
	preferences?: Preferences;

	@property({ type: Object })
	orgSettings?: State['orgSettings'];

	@property({ type: Boolean })
	explainBusy = false;

	@property({ type: Boolean })
	generateChangelogBusy = false;

	/**
	 * True when the user has just changed the comparison identity (refs / worktree / repo) and
	 * the new fetch hasn't returned yet. We treat this differently than other "loading" events
	 * (e.g., autolinks refresh) because the *current* counts and content are now wrong, not just
	 * stale. Drives the badge spinner and content placeholders.
	 */
	@state()
	private _comparisonChanging = false;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.setAttribute('role', 'region');
		this.setAttribute('aria-label', 'Compare references');
	}

	protected override willUpdate(changedProperties: PropertyValues): void {
		super.willUpdate?.(changedProperties);

		// `mergeBase` is included here because per-tab `getActiveTabRefs` and `getFileContext`
		// produce different `(lhs, rhs)` and `(sha, comparisonSha)` pairs depending on whether
		// it's defined — a late-arriving mergeBase silently swaps the file-context behind the
		// user's cursor (e.g. between hovering a row and right-clicking it). Treating its change
		// as identity-changing flashes the loading state so the swap is at least visible.
		const identityChanged =
			changedProperties.has('leftRef') ||
			changedProperties.has('rightRef') ||
			changedProperties.has('mergeBase') ||
			changedProperties.has('includeWorkingTree') ||
			changedProperties.has('branchName') ||
			changedProperties.has('repoPath');

		if (identityChanged && this.loading) {
			this._comparisonChanging = true;
		} else if (changedProperties.has('loading') && !this.loading) {
			this._comparisonChanging = false;
		}
	}

	override render(): unknown {
		// Always render bar + tabs, even when there are zero commits on either side.
		// Tabs show counts of 0; the empty state lives INSIDE the file section so the whole
		// panel fades in uniformly.
		//
		// All Files tab is a "two refs, no history" view — full-width file tree, no commit
		// pane. Ahead/Behind keep the split layout (commits left, files right). The ahead/behind
		// list area stays blank during loading — the panel-level loading indicator covers that
		// case so a list-area skeleton would just cause an ugly flash.
		//
		// The view selector (Files Changed ↔ Contributors) swaps the right-side pane only — the
		// commit list on Ahead/Behind stays put so users keep their commit context when toggling.
		//
		// `cache()` keys on template literal identity, so each branch below is at its own source
		// location → distinct template → cache() preserves each branch's DOM (scroll position,
		// tree expand state, file-tree filter input, gl-split-panel position) independently when
		// the user toggles between tabs. Coming back to a previously-active tab restores its
		// prior gl-file-tree-pane instance instead of mounting a fresh one.
		return html`<div class="compare-panel">
			<progress-indicator position="top" ?active=${this.loading}></progress-indicator>
			${this.renderComparisonBar()} ${this.renderTabs()} ${this.renderStaleBanner()} ${this.renderError()}
			${cache(
				this.activeTab === 'all'
					? this.renderAllFilesTab()
					: this.activeTab === 'ahead'
						? this.renderAheadTab()
						: this.renderBehindTab(),
			)}
		</div>`;
	}

	private renderError() {
		if (!this.errorMessage) return nothing;
		return html`<div class="compare-error" role="alert">
			<code-icon icon="error"></code-icon>
			<span>${this.errorMessage}</span>
		</div>`;
	}

	private renderStaleBanner() {
		if (!this.stale) return nothing;
		return html`<div class="compare-stale" role="status">
			<code-icon icon="warning"></code-icon>
			<span>Working tree data changed since this comparison was loaded.</span>
			<gl-action-chip
				icon="sync"
				label="Refresh Comparison"
				overlay="tooltip"
				@click=${this.dispatchRefreshCompare}
				><span>Refresh</span></gl-action-chip
			>
		</div>`;
	}

	private renderRightPane(files: BranchComparisonFile[]) {
		return this.activeView === 'contributors' ? this.renderContributorsSection() : this.renderFileSection(files);
	}

	private renderEmbeddedAIActions() {
		if (this.orgSettings?.ai === false) return nothing;

		return html`<gl-compare-ai-actions
			.explainBusy=${this.explainBusy}
			.generateChangelogBusy=${this.generateChangelogBusy}
			.orgSettings=${this.orgSettings}
		></gl-compare-ai-actions>`;
	}

	private renderAllFilesTab() {
		// No autolinks row on the All Files tab — autolinks are derived from commits, and this
		// tab shows only files. Ahead/Behind tabs each render their own scoped autolinks row.
		// Notice band telegraphs that this tab is the unified view (no commit list) and points
		// users at the Ahead/Behind tabs for per-commit breakdowns.
		return html`<div class="compare-all" data-tab="all">
			<div class="compare-all-notice">
				<code-icon icon="files"></code-icon>
				<span><strong>Cumulative Files</strong> — Select Ahead or Behind to browse commits</span>
			</div>
			${this.renderEmbeddedAIActions()}${this.renderRightPane(this.allFiles)}
		</div>`;
	}

	private renderAheadTab() {
		if (!this.aheadLoaded) {
			return html`<div class="compare-side-loading" data-tab="ahead" aria-busy="true">
				<code-icon icon="loading" modifier="spin"></code-icon>
				<span>Loading commits…</span>
			</div>`;
		}

		const files = this.filesForSelection(this.aheadCommits, this.aheadFiles);
		return html`<gl-split-panel
			class="compare-split"
			data-tab="ahead"
			orientation="vertical"
			primary="end"
			position="25"
			.snap=${this.splitSnap}
		>
			<div slot="start" class="compare-split__start">${this.renderCommitList(this.aheadCommits)}</div>
			<div slot="end" class="compare-split__end">
				${this.renderAutolinksRow()}${this.renderEmbeddedAIActions()}${this.renderRightPane(files)}
			</div>
		</gl-split-panel>`;
	}

	private renderBehindTab() {
		if (!this.behindLoaded) {
			return html`<div class="compare-side-loading" data-tab="behind" aria-busy="true">
				<code-icon icon="loading" modifier="spin"></code-icon>
				<span>Loading commits…</span>
			</div>`;
		}

		const files = this.filesForSelection(this.behindCommits, this.behindFiles);
		return html`<gl-split-panel
			class="compare-split"
			data-tab="behind"
			orientation="vertical"
			primary="end"
			position="25"
			.snap=${this.splitSnap}
		>
			<div slot="start" class="compare-split__start">${this.renderCommitList(this.behindCommits)}</div>
			<div slot="end" class="compare-split__end">
				${this.renderAutolinksRow()}${this.renderEmbeddedAIActions()}${this.renderRightPane(files)}
			</div>
		</gl-split-panel>`;
	}

	/** Derive the file list to show on a side: scoped to the active tab's selected commit when
	 *  one is set (instant client-side filter after fetch), otherwise the overall files for the side. */
	private filesForSelection(
		commits: BranchComparisonCommit[],
		overallFiles: BranchComparisonFile[],
	): BranchComparisonFile[] {
		const sel = this.selectedCommitSha;
		if (sel) return commits.find(c => c.sha === sel)?.files ?? [];

		return overallFiles;
	}

	// Clamp to sensible mins so neither pane collapses; otherwise follow the user's drag directly.
	private splitSnap: GlSplitPanelSnapFunction = ({ pos, size }) => {
		if (size <= 0) return pos;

		const minStart = 80;
		const minEnd = 120;
		const startPx = (pos / 100) * size;
		if (startPx < minStart) return (minStart / size) * 100;
		if (size - startPx < minEnd) return ((size - minEnd) / size) * 100;
		return pos;
	};

	private static readonly _fileActions: TreeItemAction[] = [
		{
			icon: 'go-to-file',
			label: 'Open File',
			action: 'file-open',
		},
		{
			icon: 'git-compare',
			label: 'Open Changes with Working File',
			action: 'file-compare-working',
		},
	];

	private renderComparisonBar() {
		// Convention: leftRef = Base (target / older), rightRef = Compare (feature / newer).
		// The current branch (`branchName`) defaults to rightRef when unset — it's the side the
		// user is typically inspecting against a base.
		const leftRef = this.leftRef ?? '';
		const rightRef = this.rightRef ?? this.branchName ?? '';
		const showWorkingTreeToggle = this.hasWorktree;
		const leftTooltip = leftRef || 'Choose a Reference';
		const rightTooltip = rightRef || 'Choose a Reference';

		return html`<div class="compare-bar">
			<div class="compare-bar__refs">
				<gl-tooltip placement="bottom">
					<code-icon class="compare-role-icon" icon="target"></code-icon>
					<span slot="content">Base Reference Branch (the target or baseline for the comparison)</span>
				</gl-tooltip>
				<gl-tooltip placement="bottom">
					<gl-branch-name
						class="compare-ref compare-ref--behind"
						appearance="button"
						chevron
						.name=${leftRef || 'Choose…'}
						.icon=${this.getRefIcon(this.leftRefType)}
						@click=${() => this.dispatchChangeRef('left')}
					></gl-branch-name>
					<span slot="content">${leftTooltip}</span>
				</gl-tooltip>
				<gl-action-chip
					class="compare-swap"
					icon="arrow-swap"
					label="Swap Direction"
					overlay="tooltip"
					@click=${this.dispatchSwapRefs}
				></gl-action-chip>
				<gl-tooltip placement="bottom">
					<code-icon class="compare-role-icon" icon="git-compare"></code-icon>
					<span slot="content">Compare Branch (the feature or topic branch containing the changes)</span>
				</gl-tooltip>
				<gl-tooltip placement="bottom">
					<gl-branch-name
						class="compare-ref compare-ref--ahead"
						appearance="button"
						chevron
						.name=${rightRef || 'Choose…'}
						.icon=${this.getRefIcon(this.rightRefType)}
						@click=${() => this.dispatchChangeRef('right')}
					></gl-branch-name>
					<span slot="content">${rightTooltip}</span>
				</gl-tooltip>
				${showWorkingTreeToggle
					? html`<gl-action-chip
							class=${this.includeWorkingTree
								? 'compare-wt-toggle compare-wt-toggle--active'
								: 'compare-wt-toggle'}
							icon="edit"
							label="${this.includeWorkingTree ? 'Exclude' : 'Include'} Working Tree Changes"
							overlay="tooltip"
							@click=${this.dispatchToggleWorkingTree}
						></gl-action-chip>`
					: nothing}
			</div>
			<div class="compare-bar__actions">
				<gl-action-chip
					class="compare-refresh"
					icon="refresh"
					label="Refresh Comparison"
					overlay="tooltip"
					@click=${this.dispatchRefreshCompare}
				></gl-action-chip>
				<gl-action-chip
					class="compare-open-in-sac"
					icon="link-external"
					label="Open in Search &amp; Compare"
					overlay="tooltip"
					@click=${this.dispatchOpenInSearchAndCompare}
				></gl-action-chip>
			</div>
		</div>`;
	}

	private renderTabs() {
		const leftRef = this.leftRef ?? '';
		const rightRef = this.rightRef ?? '';
		const baseLabel = leftRef || 'Base';
		const compareLabel = rightRef || 'Compare';
		return html`<div class="compare-tabs" role="tablist" @keydown=${this.handleTabKeydown}>
			${this.renderTab(
				'ahead',
				'Ahead',
				this.aheadCount,
				`Commits in ${compareLabel} that are missing from ${baseLabel}`,
			)}
			${this.renderTab(
				'behind',
				'Behind',
				this.behindCount,
				`Commits in ${baseLabel} that are missing from ${compareLabel}`,
			)}
			${this.renderTab(
				'all',
				'All Files',
				this.allFilesCount,
				'File differences between the latest commits of both branches',
			)}
		</div>`;
	}

	/** Ahead tab carries a synthetic WIP row when there are working-tree changes, even when the
	 *  commit count is 0. Used by `isEmpty` styling and the up-to-date check so the tab isn't
	 *  grayed out / labeled "up to date" when uncommitted changes are visible inside it. */
	private get aheadHasWip(): boolean {
		return this.aheadCommits[0]?.sha === uncommitted;
	}

	private renderTab(tab: 'all' | 'ahead' | 'behind', label: string, count: number, tooltip: string) {
		const isActive = this.activeTab === tab;
		const isEmpty = count === 0 && !(tab === 'ahead' && this.aheadHasWip);
		const classes = [
			'compare-tab',
			`compare-tab--${tab}`,
			isActive ? `compare-tab--active-${tab}` : '',
			isEmpty ? 'compare-tab--empty' : '',
		]
			.filter(Boolean)
			.join(' ');

		return html`<gl-tooltip placement="bottom">
			<button
				id="compare-tab-${tab}"
				class=${classes}
				role="tab"
				aria-selected=${isActive}
				aria-controls="compare-tabpanel-${tab}"
				tabindex=${isActive ? 0 : -1}
				@click=${() => this.dispatchSwitchTab(tab)}
			>
				<span class="compare-tab__label">${label}</span>
				<span class="compare-tab__count">
					${this._comparisonChanging
						? html`<code-icon icon="sync" class="compare-tab__count-spinner"></code-icon>`
						: count}
				</span>
			</button>
			<span slot="content">${tooltip}</span>
		</gl-tooltip>`;
	}

	private renderCommitList(commits: BranchComparisonCommit[]) {
		if (commits.length === 0) {
			// Suppress "Up to date" / "No commits" while the comparison itself is changing — the
			// panel-level progress strip + spinning tab badges already convey "calculating".
			// Once the new comparison settles, the real empty message takes over. We don't suppress
			// for tab-switch refreshes (cached or not) because the panel still has a settled
			// comparison; a brief "No commits" flash on cache miss is preferable to a stale
			// "Up to date" claim from another comparison.
			if (this._comparisonChanging) {
				return html`<div
					id="compare-tabpanel-${this.activeTab}"
					role="tabpanel"
					aria-labelledby="compare-tab-${this.activeTab}"
					aria-busy="true"
				></div>`;
			}

			const isUpToDate = this.aheadCount === 0 && this.behindCount === 0 && !this.aheadHasWip;
			const baseLabel = this.leftRef ?? 'Base';
			if (isUpToDate) {
				return html`<div
					id="compare-tabpanel-${this.activeTab}"
					class="compare-empty"
					role="tabpanel"
					aria-labelledby="compare-tab-${this.activeTab}"
				>
					<code-icon icon="check"></code-icon>
					<span>Up to date with ${baseLabel}</span>
				</div>`;
			}

			// Empty-side phrasing from the Compare side's perspective: "ahead of [base]" /
			// "behind [base]" reads naturally and matches the natural git mental model. Only
			// Ahead/Behind reach `renderCommitList`; the All Files tab uses `renderAllFilesTab`.
			const emptyText =
				this.activeTab === 'behind' ? `No commits behind ${baseLabel}` : `No commits ahead of ${baseLabel}`;
			return html`<div
				id="compare-tabpanel-${this.activeTab}"
				class="compare-empty compare-empty--no-commits"
				role="tabpanel"
				aria-labelledby="compare-tab-${this.activeTab}"
			>
				<span>${emptyText}</span>
			</div>`;
		}

		const hasMore = this.activeTab === 'behind' ? this.behindHasMore : this.aheadHasMore;
		const loadingMore = this.activeTab === 'behind' ? this.behindLoadingMore : this.aheadLoadingMore;
		// Load-more row sits inside the scrollable container as the last child — behaves like
		// another row in the list, so scrolling reaches it naturally. `box-sizing: border-box`
		// on the button (see CSS) keeps `width: 100%` honest so the button doesn't push past
		// the scroll container and trigger a horizontal scrollbar.
		return html`<div
			id="compare-tabpanel-${this.activeTab}"
			class="compare-commits scrollable"
			role="tabpanel"
			aria-labelledby="compare-tab-${this.activeTab}"
		>
			<gl-tree>
				${repeat(
					commits,
					commit => commit.sha,
					commit => this.renderCommitRow(commit),
				)}
			</gl-tree>
			${hasMore ? this.renderLoadMoreRow(loadingMore) : nothing}
		</div>`;
	}

	/** "Load More" row that pulls the next page of commits for the active side. Styled to mirror
	 *  the scope-pane's load-more row (`gl-commits-scope-pane.renderLoadMore`) so users see the
	 *  same affordance pattern across surfaces. Disabled while the fetch is in flight; the icon
	 *  swaps to a spinner so the visual state matches the action's progress. */
	private renderLoadMoreRow(loadingMore: boolean) {
		return html`<button class="compare-load-more" ?disabled=${loadingMore} @click=${this.dispatchLoadMore}>
			<code-icon
				icon=${loadingMore ? 'loading' : 'fold-down'}
				?modifier=${loadingMore ? 'spin' : false}
			></code-icon>
			<span>${loadingMore ? 'Loading…' : 'Load More Commits'}</span>
		</button>`;
	}

	private renderCommitRow(commit: BranchComparisonCommit) {
		const isSelected = this.selectedCommitSha === commit.sha;

		// showIcon=false suppresses tree-item's empty 1.6rem icon column (+ 0.6rem button gap)
		// — gl-commit-row has its own avatar slot, so the tree-item's icon column would just add
		// dead space to the left of the avatar.
		//
		// `.selected` (property binding) drives gl-tree-item's internal `@state selected` field,
		// which is what updates `aria-selected` and thus the default selection background. A
		// `?selected` (attribute binding) would NOT — `@state` doesn't reflect from attribute, so
		// the host's selected state would only ever flip TRUE (on user click) and never back to
		// FALSE when the parent re-renders with a different/no scope.
		return html`<gl-tree-item
			rich
			.showIcon=${false}
			class="compare-commit ${isSelected ? 'compare-commit--selected' : ''}"
			.selected=${isSelected}
			@gl-tree-item-selected=${() => this.dispatchSelectCommit(commit.sha)}
		>
			<gl-commit-row .commit=${commit} .preferences=${this.preferences}></gl-commit-row>
		</gl-tree-item>`;
	}

	private _getFileContext = (file: BranchComparisonFile) => this.getFileContext(file);

	private getFileContext(file: BranchComparisonFile): string | undefined {
		const leftRef = this.leftRef;
		const rightRef = this.rightRef;
		const repoPath = this.repoPath;
		if (!leftRef || !rightRef || !repoPath) return undefined;

		// Per the file-context convention shared with multicommit/review-compare panels:
		//   `sha` = rhs (newer / "to" side of the diff)
		//   `comparisonSha` = lhs (older / "from" side of the diff)
		// Every comparison-using file handler in `detailsFileCommands.ts` reads this convention.
		//
		// Tab-aware so the file's right-click actions (Open Changes, Apply, Restore Previous, Copy
		// Patch, etc.) follow the same diff direction the file row visually represents:
		//  - Ahead: `mergeBase → rightRef` — what Compare added since divergence.
		//  - Behind: `mergeBase → leftRef` — what Base added since divergence.
		//  - All Files: `leftRef → rightRef` — cumulative latest-of-both.
		// Falls back to the 2-dot symmetric form when there's no merge base (disjoint refs).
		//
		// `file.repoPath` follows the worktree when the host routed it there; falls back to the
		// panel's `repoPath` for committed-only rows so file actions resolve against the right
		// working directory.
		let sha: string;
		let comparisonSha: string;
		if (this.activeTab === 'ahead') {
			sha = rightRef;
			comparisonSha = this.mergeBase ?? leftRef;
		} else if (this.activeTab === 'behind') {
			sha = leftRef;
			comparisonSha = this.mergeBase ?? rightRef;
		} else {
			sha = rightRef;
			comparisonSha = leftRef;
		}

		const context: DetailsItemTypedContext = {
			webviewItem: 'gitlens:file:comparison',
			webviewItemValue: {
				type: 'file',
				path: file.path,
				repoPath: file.repoPath || repoPath,
				sha: sha,
				comparisonSha: comparisonSha,
				status: file.status,
			},
		};

		return serializeWebviewItemContext(context);
	}

	private renderFileSection(files: BranchComparisonFile[]) {
		const isScoped = this.selectedCommitSha != null;
		const containerClass = `compare-files${isScoped ? ' compare-files--scoped' : ''}`;
		const stats = this.computeFileStats(files);
		// Folder-context repoPath follows the resolved worktree when the active state is WT-touching
		// (cumulative IWT All tab or WIP pseudo-commit scope), so folder right-click commands run
		// against the working directory that actually owns the files.
		const activeRefs = this.getActiveTabRefs();
		const isWtTouching = activeRefs?.wip === true || activeRefs?.rhs === '';
		const folderRepoPath = isWtTouching ? (this.rightRefWorktreePath ?? this.repoPath) : this.repoPath;
		// Show the loading state when the comparison itself is changing (initial load,
		// ref/worktree change) OR when a per-commit file fetch is in flight for the selected sha.
		// For tab switches with cache misses we briefly show the pane's "No changes" empty state,
		// preferring a tiny flash over a misleading spinner during what's usually a fast cached
		// transition.
		const isFetchingSelectedFiles =
			this.selectedCommitSha != null
				? (this.commitFilesLoadingByShas?.get(this.selectedCommitSha) ?? false)
				: false;
		const isLoadingEmpty = (this._comparisonChanging || isFetchingSelectedFiles) && !files.length;

		// Always render the section (header + tree-view). When there are no files, gl-tree-view
		// shows the `empty-text` message INSIDE the section so the user still sees the header
		// and can switch tabs / change refs without the whole pane vanishing.
		// While loading and empty, suppress `empty-text` and render a spinner+label via the
		// `before-tree` slot so users don't read "No changes" as a final answer.
		return html`<div class=${containerClass}>
			<webview-pane-group flexible>
				<gl-file-tree-pane
					.files=${files}
					.filesLayout=${this.preferences?.files}
					.showIndentGuides=${this.preferences?.indentGuides}
					.collapsable=${false}
					?show-file-icons=${true}
					.fileActions=${GlDetailsCompareModePanel._fileActions}
					.fileContext=${this._getFileContext}
					.folderContext=${(folder: { relativePath: string }) => buildFolderContext(folderRepoPath, folder)}
					.buttons=${this.getMultiDiffRefs(files) ? ['layout', 'search', 'multi-diff'] : undefined}
					selection-action="file-compare-range"
					.showSearchBox=${this.showSearchBox}
					.searchBoxFilter=${this.searchBoxFilter}
					empty-text=${isLoadingEmpty ? '' : 'No changes'}
					@file-compare-range=${this.handleFileCompareRange}
					@file-compare-previous=${this.redispatch}
					@file-open=${this.redispatch}
					@file-compare-working=${this.redispatch}
					@file-more-actions=${this.redispatch}
					@change-files-layout=${this.redispatch}
					@gl-file-tree-pane-open-multi-diff=${this.handleOpenMultiDiff}
				>
					<span slot="title-content">${this.renderViewSelector()}</span>
					${isLoadingEmpty
						? html`<div slot="before-tree" class="compare-files--loading" aria-busy="true">
								<code-icon icon="loading" modifier="spin"></code-icon>
								<span>Loading changes…</span>
							</div>`
						: nothing}
					${isScoped
						? (() => {
								const isWipScope = this.selectedCommitSha === uncommitted;
								const label = isWipScope ? 'Working' : this.selectedCommitSha!.substring(0, 7);
								const icon = isWipScope ? 'edit' : 'git-commit';
								const clearLabel = isWipScope ? 'Clear Working Changes Filter' : 'Clear Commit Filter';
								const headerTooltip = isWipScope
									? 'Showing Only Working Changes'
									: 'Showing Only Commit Changes';
								return html`<gl-tooltip slot="header-badge" placement="top">
									<span class="compare-scope-tag">
										<code-icon icon=${icon}></code-icon>
										${label}
										<gl-tooltip placement="bottom">
											<button
												class="compare-scope-tag__close"
												aria-label=${clearLabel}
												@click=${(e: MouseEvent) => {
													e.stopPropagation();
													this.dispatchSelectCommit(this.selectedCommitSha!);
												}}
											>
												<code-icon icon="close"></code-icon>
											</button>
											<span slot="content">${clearLabel}</span>
										</gl-tooltip>
									</span>
									<span slot="content">${headerTooltip}</span>
								</gl-tooltip>`;
							})()
						: nothing}
					${stats != null && (stats.additions > 0 || stats.deletions > 0)
						? html`<span slot="header-badge" class="compare-stats">
								<span class="compare-stats__additions">+${stats.additions.toLocaleString()}</span>
								<span class="compare-stats__deletions">−${stats.deletions.toLocaleString()}</span>
							</span>`
						: nothing}
				</gl-file-tree-pane>
			</webview-pane-group>
		</div>`;
	}

	private computeFileStats(files: BranchComparisonFile[]): { additions: number; deletions: number } | undefined {
		if (!files?.length) return undefined;

		let additions = 0;
		let deletions = 0;
		for (const f of files) {
			if (f.stats?.additions != null) {
				additions += f.stats.additions;
			}
			if (f.stats?.deletions != null) {
				deletions += f.stats.deletions;
			}
		}
		return { additions: additions, deletions: deletions };
	}

	private _cachedMergedAutolinks?: {
		autolinksRef: Autolink[] | undefined;
		enrichedRef: IssueOrPullRequest[] | undefined;
		out: { autolinks: Autolink[]; enriched: IssueOrPullRequest[] };
	};

	private getMergedAutolinks() {
		const autolinks = this.autolinks;
		const enriched = this.enrichedItems;

		const cached = this._cachedMergedAutolinks;
		if (cached?.autolinksRef === autolinks && cached.enrichedRef === enriched) {
			return cached.out;
		}

		let out: { autolinks: Autolink[]; enriched: IssueOrPullRequest[] };
		if (!enriched?.length) {
			out = { autolinks: autolinks ?? [], enriched: [] };
		} else {
			const enrichedIds = new Set(enriched.map(i => i.id));
			const remaining = autolinks?.filter(a => !enrichedIds.has(a.id)) ?? [];
			out = { autolinks: remaining, enriched: enriched };
		}
		this._cachedMergedAutolinks = { autolinksRef: autolinks, enrichedRef: enriched, out: out };
		return out;
	}

	private renderAutolinksRow() {
		if (!this.autolinksEnabled) return nothing;

		const { autolinks, enriched } = this.getMergedAutolinks();
		const hasAutolinks = autolinks.length > 0;
		const hasEnriched = enriched.length > 0;
		const hasChips = hasAutolinks || hasEnriched;
		// Only show the loading state when the comparison itself is changing — for tab switches
		// with cached data the chips render immediately, and for cache misses a brief "No autolinks
		// found" flash is preferable to a spinner that flips back to a stale answer.
		const isLoadingEmpty = this._comparisonChanging && !hasChips;

		// Single-row layout — `gl-chip-overflow`'s default. Excess autolinks collapse into the
		// component's "+N" overflow affordance instead of wrapping the strip onto multiple rows.
		return html`<div class="compare-enrichment">
			<gl-chip-overflow>
				${hasChips
					? nothing
					: isLoadingEmpty
						? html`<span slot="prefix" class="compare-enrichment__loading" aria-busy="true">
								<code-icon icon="loading" modifier="spin"></code-icon>
								<span>Loading autolinks…</span>
							</span>`
						: renderLearnAboutAutolinks({
								hasIntegrationsConnected: this.hasIntegrationsConnected,
								hasAccount: this.hasAccount,
								showLabel: true,
								slotName: 'prefix',
							})}
				${hasAutolinks
					? autolinks.map(autolink => {
							const name = autolink.description ?? autolink.title ?? `${autolink.prefix}${autolink.id}`;
							return html`<gl-autolink-chip
								type="autolink"
								name=${name}
								url=${autolink.url}
								identifier="${autolink.prefix}${autolink.id}"
								openOnRemote
							></gl-autolink-chip>`;
						})
					: nothing}
				${hasEnriched
					? enriched.map(
							item =>
								html`<gl-autolink-chip
									type=${item.type === 'pullrequest' ? 'pr' : 'issue'}
									name=${item.title}
									url=${item.url}
									identifier="#${item.id}"
									status=${item.state}
									.date=${item.closed ? item.closedDate : item.createdDate}
									.dateFormat=${this.preferences?.dateFormat}
									.dateStyle=${this.preferences?.dateStyle}
									.itemId=${item.id}
									.providerId=${item.provider?.id}
									?details=${item.type === 'pullrequest'}
									openOnRemote
								></gl-autolink-chip>`,
						)
					: nothing}
				${this.renderAutolinksPopover(autolinks, enriched)} ${this.renderEnrichButton()}
				${hasChips
					? renderLearnAboutAutolinks({
							hasIntegrationsConnected: this.hasIntegrationsConnected,
							hasAccount: this.hasAccount,
							slotName: 'suffix',
						})
					: nothing}
			</gl-chip-overflow>
		</div>`;
	}

	private renderAutolinksPopover(autolinks: Autolink[], enriched: IssueOrPullRequest[]) {
		if (!autolinks.length && !enriched.length) return nothing;

		const enrichedPrs = enriched.filter(i => i.type === 'pullrequest');
		const enrichedIssues = enriched.filter(i => i.type !== 'pullrequest');
		let needsDivider = false;

		return html`<div slot="popover">
			${enrichedPrs.length > 0
				? html`<menu-label>Pull Requests</menu-label> ${enrichedPrs.map(
							pr =>
								html`<menu-item href=${pr.url}>
									<code-icon icon="git-pull-request"></code-icon> #${pr.id}
									${pr.title ? ` — ${pr.title}` : ''}
								</menu-item>`,
						)}${((needsDivider = true), nothing)}`
				: nothing}
			${enrichedIssues.length > 0
				? html`${needsDivider ? html`<menu-divider></menu-divider>` : nothing}
						<menu-label>Issues</menu-label>
						${enrichedIssues.map(
							issue =>
								html`<menu-item href=${issue.url}>
									<code-icon icon="issues"></code-icon> #${issue.id}
									${issue.title ? ` — ${issue.title}` : ''}
								</menu-item>`,
						)}${((needsDivider = true), nothing)}`
				: nothing}
			${autolinks.length > 0
				? html`${needsDivider ? html`<menu-divider></menu-divider>` : nothing}
						<menu-label>Autolinks</menu-label>
						${autolinks.map(
							a =>
								html`<menu-item href=${a.url}>
									<code-icon icon="link"></code-icon> ${a.prefix}${a.id}${a.provider?.name
										? ` on ${a.provider.name}`
										: ''}
								</menu-item>`,
						)}`
				: nothing}
		</div>`;
	}

	private renderEnrichButton() {
		if (!this.hasIntegrationsConnected) return nothing;
		// Once enrichment has been requested for this comparison we leave the chip strip alone —
		// fresh enriched items appear inline as they resolve.
		if (this.enrichmentRequested && !this.enrichmentLoading) return nothing;

		if (this.enrichmentLoading) {
			return html`<gl-action-chip
				slot="suffix"
				icon="loading"
				label="Loading Issues and Pull Requests..."
				overlay="tooltip"
				disabled
			></gl-action-chip>`;
		}

		return html`<gl-action-chip
			slot="suffix"
			icon="sync"
			label="Load Associated Issues and Pull Requests"
			overlay="tooltip"
			@click=${this.dispatchRequestEnrichment}
		></gl-action-chip>`;
	}

	private renderViewSelector() {
		const label = this.activeView === 'files' ? 'Files Changed' : 'Contributors';
		return html`<gl-popover
			class="compare-view-selector"
			trigger="click"
			placement="bottom-start"
			appearance="menu"
			?arrow=${false}
			hoist
		>
			<button slot="anchor" class="compare-view-trigger" type="button">
				<span class="compare-view-trigger__label">${label}</span>
				<code-icon icon="chevron-down"></code-icon>
			</button>
			<menu-list slot="content" class="compare-view-menu">
				<menu-item @click=${() => this.dispatchSwitchView('files')} ?disabled=${this.activeView === 'files'}>
					<code-icon icon="files"></code-icon><span>Files Changed</span>
				</menu-item>
				<menu-item
					@click=${() => this.dispatchSwitchView('contributors')}
					?disabled=${this.activeView === 'contributors'}
				>
					<code-icon icon="organization"></code-icon><span>Contributors</span>
				</menu-item>
			</menu-list>
		</gl-popover>`;
	}

	private renderContributorsSection() {
		const contributors = this.contributors;
		const showCount = contributors.length > 0 ? contributors.length : nothing;

		const body =
			this.contributorsLoading && contributors.length === 0
				? html`<div class="compare-contributors compare-contributors--loading">
						<code-icon icon="loading" modifier="spin"></code-icon>
						<span>Loading contributors…</span>
					</div>`
				: !contributors.length
					? html`<div class="compare-contributors compare-contributors--empty">
							<span>No contributors in scope</span>
						</div>`
					: html`<div class="compare-contributors scrollable">
							${repeat(
								contributors,
								c => `${c.email ?? ''}|${c.name}`,
								c => this.renderContributorRow(c),
							)}
						</div>`;

		return html`<div class="compare-files">
			<webview-pane-group flexible>
				<webview-pane expanded flexible .collapsable=${false}>
					<span slot="title" class="compare-contributors-title">
						${this.renderViewSelector()}
						${showCount !== nothing ? html`<gl-badge appearance="filled">${showCount}</gl-badge>` : nothing}
					</span>
					${body}
				</webview-pane>
			</webview-pane-group>
		</div>`;
	}

	private renderContributorRow(contributor: BranchComparisonContributor) {
		const { name, email, avatarUrl, commits, additions, deletions, files } = contributor;
		return html`<div class="compare-contributor">
			<gl-avatar src=${avatarUrl ?? nothing} name=${email ?? name}></gl-avatar>
			<div class="compare-contributor__info">
				<div class="compare-contributor__name">
					${name}${contributor.current ? html` <span class="compare-contributor__you">you</span>` : nothing}
				</div>
				<div class="compare-contributor__stats">
					<span>${commits.toLocaleString()} ${commits === 1 ? 'commit' : 'commits'}</span>
					${files > 0
						? html`<span>${files.toLocaleString()} ${files === 1 ? 'file' : 'files'}</span>`
						: nothing}
					${additions > 0 || deletions > 0
						? html`<span class="compare-contributor__diffstat">
								<span class="compare-contributor__additions">+${additions.toLocaleString()}</span>
								<span class="compare-contributor__deletions">−${deletions.toLocaleString()}</span>
							</span>`
						: nothing}
				</div>
			</div>
		</div>`;
	}

	private redispatch = redispatch.bind(this);

	/** Tab-aware `(lhs, rhs)` for the active state of the compare panel. Multi-diff and single-file
	 *  click both consume this so they always agree on direction — and on whether the right side
	 *  is committed, the working tree, or per-file WIP semantics.
	 *
	 *  Convention: leftRef = Base, rightRef = Compare. The merge base anchors per-side diffs so
	 *  Ahead/Behind reflect each side's contribution since divergence — distinct from All Files,
	 *  which stays on the cumulative 2-dot diff between the latest commits.
	 *
	 *  - **WIP scope** (`selectedCommitSha === uncommitted`): `lhs = rightRef, rhs = '', wip: true`.
	 *    The WIP belongs to the Compare side (rightRef is checked out); host renders HEAD↔index↔
	 *    working per file from there.
	 *  - **All tab + IWT on, unscoped**: `lhs = leftRef, rhs = ''` (S&C-style cumulative
	 *    `base → working tree`). Gated to the All tab because Ahead/Behind file lists stay
	 *    committed-only when IWT is on, so their direction must match their stat pills.
	 *  - **Ahead tab**: `lhs = mergeBase, rhs = rightRef` (what Compare added since divergence).
	 *    Falls back to `lhs = leftRef` when no merge base exists (disjoint refs).
	 *  - **Behind tab**: `lhs = mergeBase, rhs = leftRef` (what Base added since divergence).
	 *    Falls back to `lhs = rightRef` when no merge base exists.
	 *  - **All Files tab** (no IWT): `lhs = leftRef, rhs = rightRef` (cumulative latest-of-both).
	 *
	 *  Returns `undefined` if leftRef/rightRef aren't set yet (refs still loading). */
	private getActiveTabRefs(): { lhs: string; rhs: string; wip?: boolean } | undefined {
		const leftRef = this.leftRef;
		const rightRef = this.rightRef;
		if (!leftRef || !rightRef) return undefined;

		if (this.selectedCommitSha === uncommitted) {
			return { lhs: rightRef, rhs: '', wip: true };
		}

		const cumulative = this.includeWorkingTree && this.selectedCommitSha == null && this.activeTab === 'all';
		if (cumulative) {
			return { lhs: leftRef, rhs: '' };
		}

		if (this.activeTab === 'ahead') {
			return { lhs: this.mergeBase ?? leftRef, rhs: rightRef };
		}
		if (this.activeTab === 'behind') {
			return { lhs: this.mergeBase ?? rightRef, rhs: leftRef };
		}
		// All Files tab (committed) — cumulative 2-dot between the latest commits.
		return { lhs: leftRef, rhs: rightRef };
	}

	private getDiffTitle(refs: { lhs: string; rhs: string; wip?: boolean }): string {
		if (refs.wip) return `Working tree changes from ${shortenRevision(refs.lhs)}`;
		if (refs.rhs === '') return `Changes from ${shortenRevision(refs.lhs)} to working tree`;
		return `Changes from ${shortenRevision(refs.lhs)} to ${shortenRevision(refs.rhs)}`;
	}

	private getMultiDiffRefs(
		files: BranchComparisonFile[],
	): { repoPath: string; lhs: string; rhs: string; wip?: boolean; title: string } | undefined {
		if (!files?.length) return undefined;

		const repoPath = this.repoPath;
		if (!repoPath) return undefined;

		const refs = this.getActiveTabRefs();
		if (refs == null) return undefined;

		// WT-touching diffs (per-file WIP or cumulative `base → working tree`) must be anchored
		// to the worktree where leftRef is checked out so URIs resolve against the right files.
		const isWtTouching = refs.wip === true || refs.rhs === '';
		const effectiveRepoPath = isWtTouching ? (this.rightRefWorktreePath ?? repoPath) : repoPath;
		return { repoPath: effectiveRepoPath, ...refs, title: this.getDiffTitle(refs) };
	}

	/** The active tab's files — used by event handlers (e.g. multi-diff) which only fire from the
	 *  visible tab. Mirrors the per-tab render branches' file derivation. */
	private get activeFiles(): BranchComparisonFile[] {
		if (this.activeTab === 'all') return this.allFiles;

		const commits = this.activeTab === 'ahead' ? this.aheadCommits : this.behindCommits;
		const files = this.activeTab === 'ahead' ? this.aheadFiles : this.behindFiles;
		return this.filesForSelection(commits, files);
	}

	private handleOpenMultiDiff = (): void => {
		const files = this.activeFiles;
		const refs = this.getMultiDiffRefs(files);
		if (!refs || !files?.length) return;

		this.dispatchEvent(
			new CustomEvent('open-multiple-changes', {
				detail: { files: files, ...refs } satisfies OpenMultipleChangesArgs,
				bubbles: true,
				composed: true,
			}),
		);
	};

	/** Single-click handler for compare-mode file rows. State-based routing via `getActiveTabRefs()`:
	 *
	 *  - **Any commit-scoped state** (real commit OR WIP pseudo-commit) → legacy
	 *    `file-compare-previous`. Host's `ref === uncommitted` branch gives HEAD ↔ working tree for
	 *    WIP scope; otherwise commit~1 ↔ commit for a real commit.
	 *  - **All tab + IWT on, unscoped** → `file-compare-between` with `rhsRef === ''`; host's
	 *    extended `openFileCompareBetween` produces cumulative `rightRef ↔ working tree`.
	 *  - **Otherwise** → `file-compare-between` with the tab-aware committed range. */
	private handleFileCompareRange = (e: CustomEvent<FileChangeListItemDetail>): void => {
		const detail = e.detail;
		if (this.selectedCommitSha != null) {
			this.dispatchEvent(
				new CustomEvent('file-compare-previous', { detail: detail, bubbles: true, composed: true }),
			);
			return;
		}

		const refs = this.getActiveTabRefs();
		if (refs == null) return;

		this.dispatchEvent(
			new CustomEvent('file-compare-between', {
				detail: { ...detail, lhsRef: refs.lhs, rhsRef: refs.rhs } satisfies FileCompareBetweenDetail,
				bubbles: true,
				composed: true,
			}),
		);
	};

	private getRefIcon(refType?: 'branch' | 'tag' | 'commit'): string {
		switch (refType) {
			case 'tag':
				return 'tag';
			case 'commit':
				return 'git-commit';
			default:
				return 'git-branch';
		}
	}

	private handleTabKeydown(e: KeyboardEvent) {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

		e.preventDefault();

		const order: ('all' | 'ahead' | 'behind')[] = ['ahead', 'behind', 'all'];
		const currentIndex = order.indexOf(this.activeTab);
		const delta = e.key === 'ArrowRight' ? 1 : -1;
		const newTab = order[(currentIndex + delta + order.length) % order.length];

		this.dispatchSwitchTab(newTab);
		const tabEl = this.renderRoot.querySelector<HTMLElement>(`#compare-tab-${newTab}`);
		tabEl?.focus();
	}

	private dispatchChangeRef(side: 'left' | 'right') {
		this.dispatchEvent(
			new CustomEvent<CompareRefsChangeRefDetail>('change-ref', {
				detail: { side: side },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private dispatchOpenInSearchAndCompare() {
		this.dispatchEvent(new CustomEvent('open-in-search-and-compare', { bubbles: true, composed: true }));
	}

	private dispatchSwapRefs() {
		this.dispatchEvent(new CustomEvent('swap-refs', { bubbles: true, composed: true }));
	}

	private dispatchToggleWorkingTree() {
		this.dispatchEvent(new CustomEvent('toggle-working-tree', { bubbles: true, composed: true }));
	}

	private dispatchRefreshCompare = () => {
		this.dispatchEvent(new CustomEvent('refresh-compare', { bubbles: true, composed: true }));
	};

	private dispatchLoadMore = () => {
		const side = this.activeTab === 'behind' ? 'behind' : 'ahead';
		this.dispatchEvent(
			new CustomEvent('load-more-compare-commits', {
				detail: { side: side },
				bubbles: true,
				composed: true,
			}),
		);
	};

	private dispatchSwitchTab(tab: 'all' | 'ahead' | 'behind') {
		this.dispatchEvent(
			new CustomEvent('switch-tab', {
				detail: { tab: tab },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private dispatchSelectCommit(sha: string) {
		// Scopes the compare panel to a specific commit within the ahead/behind list, or
		// clears the scope (sha: undefined) when the currently-scoped commit is re-clicked.
		// Distinct from the top-level `select-commit` which selects the row in the graph.
		const newSha = this.selectedCommitSha === sha ? undefined : sha;
		this.dispatchEvent(
			new CustomEvent('scope-to-commit', {
				detail: { sha: newSha },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private dispatchSwitchView(view: 'files' | 'contributors') {
		const popover = this.shadowRoot?.querySelector<HTMLElement & { hide(): void }>('.compare-view-selector');
		if (popover != null) {
			popover.hide();
		}

		if (this.activeView === view) return;

		this.dispatchEvent(
			new CustomEvent('switch-view', {
				detail: { view: view },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private dispatchRequestEnrichment = () => {
		this.dispatchEvent(new CustomEvent('request-enrichment', { bubbles: true, composed: true }));
	};
}
