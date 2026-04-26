import type { PropertyValues } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { cache } from 'lit/directives/cache.js';
import { repeat } from 'lit/directives/repeat.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import { shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import type { Autolink } from '../../../../../autolinks/models/autolinks.js';
import type { ConnectCloudIntegrationsCommandArgs } from '../../../../../commands/cloudIntegrations.js';
import { createCommandLink } from '../../../../../system/commands.js';
import { serializeWebviewItemContext } from '../../../../../system/webview.js';
import type { CommitFileChange, DetailsItemTypedContext, Preferences } from '../../../../plus/graph/detailsProtocol.js';
import type { BranchComparisonCommit, BranchComparisonContributor } from '../../../../plus/graph/graphService.js';
import type { OpenMultipleChangesArgs } from '../../../shared/actions/file.js';
import { redispatch } from '../../../shared/components/element.js';
import type { GlSplitPanelSnapFunction } from '../../../shared/components/split-panel/split-panel.js';
import {
	elementBase,
	metadataBarVarsBase,
	scrollableBase,
	subPanelEnterStyles,
} from '../../../shared/components/styles/lit/base.css.js';
import type { TreeItemAction } from '../../../shared/components/tree/base.js';
import { compareModePanelStyles } from './gl-details-compare-mode-panel.css.js';
import './gl-commit-row.js';
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

@customElement('gl-details-compare-mode-panel')
export class GlDetailsCompareModePanel extends LitElement {
	static override styles = [
		elementBase,
		metadataBarVarsBase,
		scrollableBase,
		compareModePanelStyles,
		subPanelEnterStyles,
	];

	@property({ attribute: 'branch-name' })
	branchName?: string;

	@property({ attribute: 'repo-path' })
	repoPath?: string;

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

	@property({ type: Boolean, attribute: 'has-worktree' })
	hasWorktree = false;

	@property({ type: Number, attribute: 'ahead-count' })
	aheadCount = 0;

	@property({ type: Number, attribute: 'behind-count' })
	behindCount = 0;

	@property({ type: Number, attribute: 'all-files-count' })
	allFilesCount = 0;

	@property({ type: Array })
	aheadCommits: BranchComparisonCommit[] = [];

	@property({ type: Array })
	behindCommits: BranchComparisonCommit[] = [];

	/** Files for the All Files tab — comes from Phase 1 of the progressive load (counts + 2-dot
	 *  diff). Distinct from the per-side commits so the All tab is renderable as soon as the
	 *  summary lands, before either side's commits arrive. */
	@property({ type: Array })
	allFiles: CommitFileChange[] = [];

	/** Phase 2 loaded flags — per-side. False until that side's commits have been fetched
	 *  (lazy, on first activation). The panel uses these to render a loading state in the
	 *  commit list + file area instead of the empty state. */
	@property({ type: Boolean, attribute: 'ahead-loaded' })
	aheadLoaded = false;

	@property({ type: Boolean, attribute: 'behind-loaded' })
	behindLoaded = false;

	@property({ type: Boolean })
	loading = false;

	@property({ attribute: 'active-tab' })
	activeTab: 'all' | 'ahead' | 'behind' = 'all';

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

	@property({ type: Object })
	preferences?: Preferences;

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

		const identityChanged =
			changedProperties.has('leftRef') ||
			changedProperties.has('rightRef') ||
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
		// In Contributors view, the right pane is always full-width regardless of tab —
		// the active tab still scopes which commits' contributors are shown, but there's
		// no commit-list interplay so the split layout would just waste space.
		//
		// `cache()` keys on template literal identity, so each branch below is at its own source
		// location → distinct template → cache() preserves each branch's DOM (scroll position,
		// tree expand state, file-tree filter input, gl-split-panel position) independently when
		// the user toggles between tabs / views. Coming back to a previously-active tab restores
		// its prior gl-file-tree-pane instance instead of mounting a fresh one.
		return html`<div class="wip-compare-panel">
			<progress-indicator position="top" ?active=${this.loading}></progress-indicator>
			${this.renderComparisonBar()} ${this.renderTabs()}
			${cache(
				this.activeView === 'contributors'
					? this.renderContributorsTab()
					: this.activeTab === 'all'
						? this.renderAllFilesTab()
						: this.activeTab === 'ahead'
							? this.renderAheadTab()
							: this.renderBehindTab(),
			)}
		</div>`;
	}

	private renderContributorsTab() {
		return html`<div class="wip-compare-all" data-tab="contributors">
			${this.renderAutolinksRow()}${this.renderContributorsSection()}
		</div>`;
	}

	private renderAllFilesTab() {
		return html`<div class="wip-compare-all" data-tab="all">
			${this.renderAutolinksRow()}${this.renderFileSection(this.allFiles)}
		</div>`;
	}

	private renderAheadTab() {
		if (!this.aheadLoaded) {
			return html`<div class="wip-compare-side-loading" data-tab="ahead" aria-busy="true">
				<code-icon icon="loading" modifier="spin"></code-icon>
				<span>Loading commits…</span>
			</div>`;
		}
		const files = this.filesForSelection(this.aheadCommits);
		return html`<gl-split-panel
			class="wip-compare-split"
			data-tab="ahead"
			orientation="vertical"
			primary="end"
			position="25"
			.snap=${this.splitSnap}
		>
			<div slot="start" class="wip-compare-split__start">${this.renderCommitList(this.aheadCommits)}</div>
			<div slot="end" class="wip-compare-split__end">
				${this.renderAutolinksRow()}${this.renderFileSection(files)}
			</div>
		</gl-split-panel>`;
	}

	private renderBehindTab() {
		if (!this.behindLoaded) {
			return html`<div class="wip-compare-side-loading" data-tab="behind" aria-busy="true">
				<code-icon icon="loading" modifier="spin"></code-icon>
				<span>Loading commits…</span>
			</div>`;
		}
		const files = this.filesForSelection(this.behindCommits);
		return html`<gl-split-panel
			class="wip-compare-split"
			data-tab="behind"
			orientation="vertical"
			primary="end"
			position="25"
			.snap=${this.splitSnap}
		>
			<div slot="start" class="wip-compare-split__start">${this.renderCommitList(this.behindCommits)}</div>
			<div slot="end" class="wip-compare-split__end">
				${this.renderAutolinksRow()}${this.renderFileSection(files)}
			</div>
		</gl-split-panel>`;
	}

	/** Derive the file list to show on a side: scoped to the active tab's selected commit when
	 *  one is set (instant client-side filter — no fetch), otherwise the union of all commits'
	 *  files deduped by path. Per-file stats are summed across commits in the union case so the
	 *  row reflects cumulative churn over the side's range. */
	private filesForSelection(commits: BranchComparisonCommit[]): CommitFileChange[] {
		const sel = this.selectedCommitSha;
		if (sel) return commits.find(c => c.sha === sel)?.files ?? [];

		const map = new Map<string, CommitFileChange>();
		for (const c of commits) {
			for (const f of c.files) {
				const existing = map.get(f.path);
				if (existing == null) {
					map.set(f.path, { ...f, stats: f.stats ? { ...f.stats } : undefined });
					continue;
				}
				if (existing.stats && f.stats) {
					existing.stats = {
						additions: (existing.stats.additions ?? 0) + (f.stats.additions ?? 0),
						deletions: (existing.stats.deletions ?? 0) + (f.stats.deletions ?? 0),
						changes: (existing.stats.changes ?? 0) + (f.stats.changes ?? 0),
					};
				}
			}
		}
		return [...map.values()];
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

	private get fileActions(): TreeItemAction[] {
		return [
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
	}

	private renderComparisonBar() {
		const leftRef = this.leftRef ?? this.branchName ?? 'HEAD';
		const rightRef = this.rightRef ?? '';
		const showWorkingTreeToggle = this.hasWorktree;
		const leftTooltip = leftRef;
		const rightTooltip = rightRef || 'Choose a Reference';

		return html`<div class="wip-compare-bar">
			<div class="wip-compare-bar__group">
				<gl-tooltip hoist placement="bottom">
					<gl-branch-name
						class="wip-compare-ref wip-compare-ref--ahead"
						appearance="button"
						chevron
						.name=${leftRef}
						.icon=${this.getRefIcon(this.leftRefType)}
						@click=${() => this.dispatchChangeRef('left')}
					></gl-branch-name>
					<span slot="content">${leftTooltip}</span>
				</gl-tooltip>
				${showWorkingTreeToggle
					? html`<gl-action-chip
							class=${this.includeWorkingTree
								? 'wip-compare-wt-toggle wip-compare-wt-toggle--active'
								: 'wip-compare-wt-toggle'}
							icon="folder-opened"
							label="${this.includeWorkingTree ? 'Exclude' : 'Include'} Working Tree Changes"
							overlay="tooltip"
							@click=${this.dispatchToggleWorkingTree}
						></gl-action-chip>`
					: nothing}
			</div>
			<gl-action-chip
				class="wip-compare-swap"
				icon="arrow-swap"
				label="Swap Direction"
				overlay="tooltip"
				@click=${this.dispatchSwapRefs}
			></gl-action-chip>
			<gl-tooltip hoist placement="bottom">
				<gl-branch-name
					class="wip-compare-ref wip-compare-ref--behind"
					appearance="button"
					chevron
					.name=${rightRef || 'Choose…'}
					.icon=${this.getRefIcon(this.rightRefType)}
					@click=${() => this.dispatchChangeRef('right')}
				></gl-branch-name>
				<span slot="content">${rightTooltip}</span>
			</gl-tooltip>
		</div>`;
	}

	private renderTabs() {
		return html`<div class="wip-compare-tabs" role="tablist" @keydown=${this.handleTabKeydown}>
			${this.renderTab('all', undefined, 'All', this.allFilesCount)}
			${this.renderTab('ahead', 'arrow-up', 'Ahead', this.aheadCount)}
			${this.renderTab('behind', 'arrow-down', 'Behind', this.behindCount)}
		</div>`;
	}

	private renderTab(tab: 'all' | 'ahead' | 'behind', icon: string | undefined, label: string, count: number) {
		const isActive = this.activeTab === tab;
		const isEmpty = count === 0;
		const classes = [
			'wip-compare-tab',
			`wip-compare-tab--${tab}`,
			isActive ? `wip-compare-tab--active-${tab}` : '',
			isEmpty ? 'wip-compare-tab--empty' : '',
		]
			.filter(Boolean)
			.join(' ');

		return html`<button
			id="wip-compare-tab-${tab}"
			class=${classes}
			role="tab"
			aria-selected=${isActive}
			aria-controls="wip-compare-tabpanel-${tab}"
			tabindex=${isActive ? 0 : -1}
			@click=${() => this.dispatchSwitchTab(tab)}
		>
			${icon ? html`<code-icon icon=${icon} class="wip-compare-tab__icon"></code-icon>` : nothing}
			<span class="wip-compare-tab__label">${label}</span>
			<span class="wip-compare-tab__count">
				${this._comparisonChanging
					? html`<code-icon icon="sync" class="wip-compare-tab__count-spinner"></code-icon>`
					: count}
			</span>
		</button>`;
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
					id="wip-compare-tabpanel-${this.activeTab}"
					role="tabpanel"
					aria-labelledby="wip-compare-tab-${this.activeTab}"
					aria-busy="true"
				></div>`;
			}

			const isUpToDate = this.aheadCount === 0 && this.behindCount === 0;
			const rightRef = this.rightRef ?? '';
			if (isUpToDate) {
				return html`<div
					id="wip-compare-tabpanel-${this.activeTab}"
					class="wip-compare-empty"
					role="tabpanel"
					aria-labelledby="wip-compare-tab-${this.activeTab}"
				>
					<code-icon icon="check"></code-icon>
					<span>Up to date with ${rightRef}</span>
				</div>`;
			}
			return html`<div
				id="wip-compare-tabpanel-${this.activeTab}"
				class="wip-compare-empty wip-compare-empty--no-commits"
				role="tabpanel"
				aria-labelledby="wip-compare-tab-${this.activeTab}"
			>
				<span>No commits ${this.activeTab} ${rightRef}</span>
			</div>`;
		}

		return html`<div
			id="wip-compare-tabpanel-${this.activeTab}"
			class="wip-compare-commits scrollable"
			role="tabpanel"
			aria-labelledby="wip-compare-tab-${this.activeTab}"
		>
			<gl-tree>
				${repeat(
					commits,
					commit => commit.sha,
					commit => this.renderCommitRow(commit),
				)}
			</gl-tree>
		</div>`;
	}

	private renderCommitRow(commit: BranchComparisonCommit) {
		const isSelected = this.selectedCommitSha === commit.sha;

		// showIcon=false suppresses tree-item's empty 1.6rem icon column (+ 0.6rem button gap)
		// — gl-commit-row has its own avatar slot, so the tree-item's icon column would just add
		// dead space to the left of the avatar.
		return html`<gl-tree-item
			rich
			.showIcon=${false}
			class="wip-compare-commit ${isSelected ? 'wip-compare-commit--selected' : ''}"
			?selected=${isSelected}
			@gl-tree-item-selected=${() => this.dispatchSelectCommit(commit.sha)}
		>
			<gl-commit-row .commit=${commit} .preferences=${this.preferences}></gl-commit-row>
		</gl-tree-item>`;
	}

	private _getFileContext = (file: CommitFileChange) => this.getFileContext(file);

	private getFileContext(file: CommitFileChange): string | undefined {
		const leftRef = this.leftRef;
		const rightRef = this.rightRef;
		const repoPath = this.repoPath;
		if (!leftRef || !rightRef || !repoPath) return undefined;

		const context: DetailsItemTypedContext = {
			webviewItem: 'gitlens:file:comparison',
			webviewItemValue: {
				type: 'file',
				path: file.path,
				repoPath: repoPath,
				sha: leftRef,
				comparisonSha: rightRef,
				status: file.status,
			},
		};

		return serializeWebviewItemContext(context);
	}

	private renderFileSection(files: CommitFileChange[]) {
		const isScoped = this.selectedCommitSha != null;
		const containerClass = `wip-compare-files${isScoped ? ' wip-compare-files--scoped' : ''}`;
		const stats = this.computeFileStats(files);
		// Only show the loading state when the comparison itself is changing (initial load,
		// ref/worktree change). For tab switches with cache misses we briefly show the pane's
		// "No changes" empty state, preferring a tiny flash over a misleading spinner during
		// what's usually a fast cached transition.
		const isLoadingEmpty = this._comparisonChanging && !files.length;

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
					.fileActions=${this.fileActions}
					.fileContext=${this._getFileContext}
					.buttons=${this.getMultiDiffRefs(files) ? ['layout', 'search', 'multi-diff'] : undefined}
					empty-text=${isLoadingEmpty ? '' : 'No changes'}
					@file-compare-previous=${this.redispatch}
					@file-open=${this.redispatch}
					@file-compare-working=${this.redispatch}
					@file-more-actions=${this.redispatch}
					@change-files-layout=${this.redispatch}
					@gl-file-tree-pane-open-multi-diff=${this.handleOpenMultiDiff}
				>
					<span slot="title-content">${this.renderViewSelector()}</span>
					${isLoadingEmpty
						? html`<div slot="before-tree" class="wip-compare-files--loading" aria-busy="true">
								<code-icon icon="loading" modifier="spin"></code-icon>
								<span>Loading changes…</span>
							</div>`
						: nothing}
					${isScoped
						? html`<gl-tooltip slot="header-badge" hoist placement="top">
								<span class="wip-compare-scope-tag">
									<code-icon icon="git-commit"></code-icon>
									${this.selectedCommitSha!.substring(0, 7)}
									<gl-tooltip hoist placement="bottom">
										<button
											class="wip-compare-scope-tag__close"
											aria-label="Clear commit filter"
											@click=${(e: MouseEvent) => {
												e.stopPropagation();
												this.dispatchSelectCommit(this.selectedCommitSha!);
											}}
										>
											<code-icon icon="close"></code-icon>
										</button>
										<span slot="content">Clear Commit Filter</span>
									</gl-tooltip>
								</span>
								<span slot="content">Showing Only Commit Changes</span>
							</gl-tooltip>`
						: nothing}
					${stats != null && (stats.additions > 0 || stats.deletions > 0)
						? html`<span slot="header-badge" class="wip-compare-stats">
								<span class="wip-compare-stats__additions">+${stats.additions.toLocaleString()}</span>
								<span class="wip-compare-stats__deletions">−${stats.deletions.toLocaleString()}</span>
							</span>`
						: nothing}
				</gl-file-tree-pane>
			</webview-pane-group>
		</div>`;
	}

	private computeFileStats(files: CommitFileChange[]): { additions: number; deletions: number } | undefined {
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

	private getMergedAutolinks() {
		const enriched = this.enrichedItems;
		if (!enriched?.length) {
			return { autolinks: this.autolinks ?? [], enriched: [] as IssueOrPullRequest[] };
		}
		const enrichedIds = new Set(enriched.map(i => i.id));
		const remaining = this.autolinks?.filter(a => !enrichedIds.has(a.id)) ?? [];
		return { autolinks: remaining, enriched: enriched };
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

		return html`<div class="wip-compare-enrichment">
			<gl-chip-overflow max-rows="99">
				${hasChips
					? nothing
					: isLoadingEmpty
						? html`<span slot="prefix" class="wip-compare-enrichment__loading" aria-busy="true">
								<code-icon icon="loading" modifier="spin"></code-icon>
								<span>Loading autolinks…</span>
							</span>`
						: html`<span slot="prefix">${this.renderLearnAboutAutolinks(true)}</span>`}
				${hasAutolinks
					? autolinks.map(autolink => {
							const name = autolink.description ?? autolink.title ?? `${autolink.prefix}${autolink.id}`;
							return html`<gl-autolink-chip
								type="autolink"
								name=${name}
								url=${autolink.url}
								identifier="${autolink.prefix}${autolink.id}"
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
								></gl-autolink-chip>`,
						)
					: nothing}
				${this.renderAutolinksPopover(autolinks, enriched)} ${this.renderEnrichButton()}
				${hasChips ? html`<span slot="suffix">${this.renderLearnAboutAutolinks()}</span>` : nothing}
			</gl-chip-overflow>
		</div>`;
	}

	private renderLearnAboutAutolinks(showLabel = false) {
		const autolinkSettingsLink = createCommandLink('gitlens.showSettingsPage!autolinks', {
			showOptions: { preserveFocus: true },
		});

		let label =
			'Configure autolinks to linkify external references, like Jira or Zendesk tickets, in commit messages.';
		if (!this.hasIntegrationsConnected) {
			label = `<a href="${autolinkSettingsLink}">Configure autolinks</a> to linkify external references, like Jira or Zendesk tickets, in commit messages.`;
			label += `\n\n<a href="${createCommandLink<ConnectCloudIntegrationsCommandArgs>(
				'gitlens.plus.cloudIntegrations.connect',
				{
					source: { source: 'inspect', detail: { action: 'connect' } },
				},
			)}">Connect an Integration</a> &mdash;`;

			if (!this.hasAccount) {
				label += ' sign up and';
			}

			label += ' to get access to automatic rich autolinks for services like Jira, GitHub, and more.';
		}

		return html`<gl-action-chip
			href=${autolinkSettingsLink}
			data-action="autolink-settings"
			icon="info"
			.label=${label}
			overlay=${this.hasIntegrationsConnected ? 'tooltip' : 'popover'}
			>${showLabel ? html`<span class="mq-hide-sm">&nbsp;No autolinks found</span>` : nothing}</gl-action-chip
		>`;
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
			class="wip-compare-view-selector"
			trigger="click"
			placement="bottom-start"
			appearance="menu"
			?arrow=${false}
			hoist
		>
			<button slot="anchor" class="wip-compare-view-trigger" type="button">
				<span class="wip-compare-view-trigger__label">${label}</span>
				<code-icon icon="chevron-down"></code-icon>
			</button>
			<menu-list slot="content" class="wip-compare-view-menu">
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
				? html`<div class="wip-compare-contributors wip-compare-contributors--loading">
						<code-icon icon="loading" modifier="spin"></code-icon>
						<span>Loading contributors…</span>
					</div>`
				: !contributors.length
					? html`<div class="wip-compare-contributors wip-compare-contributors--empty">
							<span>No contributors in scope</span>
						</div>`
					: html`<div class="wip-compare-contributors scrollable">
							${repeat(
								contributors,
								c => `${c.email ?? ''}|${c.name}`,
								c => this.renderContributorRow(c),
							)}
						</div>`;

		return html`<div class="wip-compare-files">
			<webview-pane-group flexible>
				<webview-pane expanded flexible .collapsable=${false}>
					<span slot="title">${this.renderViewSelector()}</span>
					${showCount !== nothing ? html`<gl-badge slot="title">${showCount}</gl-badge>` : nothing} ${body}
				</webview-pane>
			</webview-pane-group>
		</div>`;
	}

	private renderContributorRow(contributor: BranchComparisonContributor) {
		const { name, email, avatarUrl, commits, additions, deletions, files } = contributor;
		return html`<div class="wip-compare-contributor">
			<gl-avatar src=${avatarUrl ?? nothing} name=${email ?? name}></gl-avatar>
			<div class="wip-compare-contributor__info">
				<div class="wip-compare-contributor__name">
					${name}${contributor.current
						? html` <span class="wip-compare-contributor__you">you</span>`
						: nothing}
				</div>
				<div class="wip-compare-contributor__stats">
					<span>${commits.toLocaleString()} ${commits === 1 ? 'commit' : 'commits'}</span>
					${files > 0
						? html`<span>${files.toLocaleString()} ${files === 1 ? 'file' : 'files'}</span>`
						: nothing}
					${additions > 0 || deletions > 0
						? html`<span class="wip-compare-contributor__diffstat">
								<span class="wip-compare-contributor__additions">+${additions.toLocaleString()}</span>
								<span class="wip-compare-contributor__deletions">−${deletions.toLocaleString()}</span>
							</span>`
						: nothing}
				</div>
			</div>
		</div>`;
	}

	private redispatch = redispatch.bind(this);

	private getMultiDiffRefs(
		files: CommitFileChange[],
	): { repoPath: string; lhs: string; rhs: string; title?: string } | undefined {
		if (!files?.length) return undefined;
		const repoPath = this.repoPath;
		const lhs = this.leftRef;
		const rhs = this.rightRef;
		if (!repoPath || !lhs || !rhs) return undefined;

		return {
			repoPath: repoPath,
			lhs: lhs,
			rhs: rhs,
			title: `Changes between ${shortenRevision(lhs)} and ${shortenRevision(rhs)}`,
		};
	}

	/** The active tab's files — used by event handlers (e.g. multi-diff) which only fire from the
	 *  visible tab. Mirrors the per-tab render branches' file derivation. */
	private get activeFiles(): CommitFileChange[] {
		if (this.activeTab === 'all') return this.allFiles;
		const commits = this.activeTab === 'ahead' ? this.aheadCommits : this.behindCommits;
		return this.filesForSelection(commits);
	}

	private handleOpenMultiDiff = (): void => {
		const files = this.activeFiles;
		const refs = this.getMultiDiffRefs(files);
		if (!refs || !files?.length) return;

		this.dispatchEvent(
			new CustomEvent('open-multiple-changes', {
				detail: {
					files: files,
					repoPath: refs.repoPath,
					lhs: refs.lhs,
					rhs: refs.rhs,
					title: refs.title,
				} satisfies OpenMultipleChangesArgs,
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

		const order: ('all' | 'ahead' | 'behind')[] = ['all', 'ahead', 'behind'];
		const currentIndex = order.indexOf(this.activeTab);
		const delta = e.key === 'ArrowRight' ? 1 : -1;
		const newTab = order[(currentIndex + delta + order.length) % order.length];

		this.dispatchSwitchTab(newTab);
		const tabEl = this.renderRoot.querySelector<HTMLElement>(`#wip-compare-tab-${newTab}`);
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

	private dispatchSwapRefs() {
		this.dispatchEvent(new CustomEvent('swap-refs', { bubbles: true, composed: true }));
	}

	private dispatchToggleWorkingTree() {
		this.dispatchEvent(new CustomEvent('toggle-working-tree', { bubbles: true, composed: true }));
	}

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
		const popover = this.shadowRoot?.querySelector<HTMLElement & { hide(): void }>('.wip-compare-view-selector');
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
