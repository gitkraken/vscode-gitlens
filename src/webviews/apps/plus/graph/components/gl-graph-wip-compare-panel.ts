import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { serializeWebviewItemContext } from '../../../../../system/webview.js';
import type { CommitFileChange, DetailsItemTypedContext, Preferences } from '../../../../plus/graph/detailsProtocol.js';
import type { BranchComparisonCommit } from '../../../../plus/graph/graphService.js';
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
import { wipComparePanelStyles } from './gl-graph-wip-compare-panel.css.js';
import './gl-commit-row.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/branch-name.js';
import '../../../shared/components/chips/action-chip.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/panes/pane-group.js';
import '../../../shared/components/split-panel/split-panel.js';
import '../../../shared/components/tree/tree.js';
import '../../../shared/components/tree/tree-item.js';
import '../../../shared/components/tree/gl-file-tree-pane.js';

export interface CompareRefsChangeRefDetail {
	side: 'left' | 'right';
}

@customElement('gl-graph-wip-compare-panel')
export class GlGraphWipComparePanel extends LitElement {
	static override styles = [
		elementBase,
		metadataBarVarsBase,
		scrollableBase,
		wipComparePanelStyles,
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

	@property({ type: Array })
	aheadCommits: BranchComparisonCommit[] = [];

	@property({ type: Array })
	behindCommits: BranchComparisonCommit[] = [];

	@property({ type: Array })
	compareFiles: CommitFileChange[] = [];

	@property({ type: Boolean })
	loading = false;

	@property({ attribute: 'active-tab' })
	activeTab: 'ahead' | 'behind' = 'ahead';

	@property({ attribute: 'selected-commit-sha' })
	selectedCommitSha?: string;

	@property({ type: Object })
	preferences?: Preferences;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.setAttribute('role', 'region');
		this.setAttribute('aria-label', 'Compare references');
	}

	override render(): unknown {
		// Always render bar + tabs + split, even when there are zero commits on either side.
		// Tabs show counts of 0; the empty state lives INSIDE the file section so the whole
		// panel fades in uniformly. The ahead/behind list area stays blank during loading —
		// the panel-level loading indicator covers that case so a list-area skeleton would
		// just cause an ugly flash.
		return html`<div class="wip-compare-panel">
			${this.renderComparisonBar()} ${this.renderTabs()}
			<gl-split-panel
				class="wip-compare-split"
				orientation="vertical"
				primary="end"
				position="25"
				.snap=${this.splitSnap}
			>
				<div slot="start" class="wip-compare-split__start">${this.renderCommitList()}</div>
				<div slot="end" class="wip-compare-split__end">${this.renderFileSection()}</div>
			</gl-split-panel>
		</div>`;
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
			${this.renderTab('ahead', 'arrow-up', 'Ahead', this.aheadCount)}
			${this.renderTab('behind', 'arrow-down', 'Behind', this.behindCount)}
		</div>`;
	}

	private renderTab(tab: 'ahead' | 'behind', icon: string, label: string, count: number) {
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
			<code-icon icon=${icon} class="wip-compare-tab__icon"></code-icon>
			<span class="wip-compare-tab__label">${label}</span>
			<span class="wip-compare-tab__count">${count}</span>
		</button>`;
	}

	private renderCommitList() {
		const commits = this.activeTab === 'ahead' ? this.aheadCommits : this.behindCommits;

		if (commits.length === 0) {
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

		return html`<gl-tree-item
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

	private renderFileSection() {
		const isScoped = this.selectedCommitSha != null;
		const containerClass = `wip-compare-files${isScoped ? ' wip-compare-files--scoped' : ''}`;

		// Always render the section (header + tree-view). When there are no files, gl-tree-view
		// shows the `empty-text` message INSIDE the section so the user still sees the header
		// and can switch tabs / change refs without the whole pane vanishing.
		return html`<div class=${containerClass}>
			<webview-pane-group flexible>
				<gl-file-tree-pane
					.files=${this.compareFiles}
					.filesLayout=${this.preferences?.files}
					.showIndentGuides=${this.preferences?.indentGuides}
					.collapsable=${false}
					?show-file-icons=${true}
					.fileActions=${this.fileActions}
					.fileContext=${this._getFileContext}
					.buttons=${this.getMultiDiffRefs() ? ['layout', 'search', 'multi-diff'] : undefined}
					empty-text="No changes"
					@file-compare-previous=${this.redispatch}
					@file-open=${this.redispatch}
					@file-compare-working=${this.redispatch}
					@file-more-actions=${this.redispatch}
					@change-files-layout=${this.redispatch}
					@gl-file-tree-pane-open-multi-diff=${this.handleOpenMultiDiff}
				>
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
				</gl-file-tree-pane>
			</webview-pane-group>
		</div>`;
	}

	private redispatch = redispatch.bind(this);

	private getMultiDiffRefs(): { repoPath: string; lhs: string; rhs: string; title?: string } | undefined {
		const files = this.compareFiles;
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

	private handleOpenMultiDiff = (): void => {
		const refs = this.getMultiDiffRefs();
		const files = this.compareFiles;
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
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			const newTab = this.activeTab === 'ahead' ? 'behind' : 'ahead';
			this.dispatchSwitchTab(newTab);
			const tabEl = this.renderRoot.querySelector<HTMLElement>(`#wip-compare-tab-${newTab}`);
			tabEl?.focus();
		}
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

	private dispatchSwitchTab(tab: 'ahead' | 'behind') {
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
}
