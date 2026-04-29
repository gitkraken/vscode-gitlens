import type { TemplateResult } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import type { GitFileChangeShape, GitFileChangeStats } from '@gitlens/git/models/fileChange.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import type { ViewFilesLayout, ViewsFilesConfig } from '../../../../../config.js';
import type { FileShowOptions } from '../../../../commitDetails/protocol.js';
import { elementBase } from '../styles/lit/base.css.js';
import type {
	TreeItemAction,
	TreeItemActionDetail,
	TreeItemBase,
	TreeItemCheckedDetail,
	TreeItemDecoration,
	TreeItemSelectionDetail,
	TreeModel,
} from './base.js';
import type { FileGroup } from './file-tree-utils.js';
import {
	buildGroupedTree,
	getStatusDecoration,
	isTreeLayout,
	nextFilterMode,
	renderFilterAction,
	renderLayoutAction,
} from './file-tree-utils.js';
import { fileTreeStyles } from './gl-file-tree-pane.css.js';
import '../badges/badge.js';
import '../webview-pane.js';
import '../actions/action-item.js';
import '../actions/action-nav.js';
import '../code-icon.js';
import '../checkbox/checkbox.js';
import '../overlays/tooltip.js';
import './tree-view.js';

export type FileItem = GitFileChangeShape & { stats?: GitFileChangeStats };
type Files = Mutable<FileItem[]>;

// Can only import types from 'vscode'
const BesideViewColumn = -2; /*ViewColumn.Beside*/

export interface FileChangeListItemDetail extends FileItem {
	showOptions?: FileShowOptions;
}

@customElement('gl-file-tree-pane')
export class GlFileTreePane extends LitElement {
	static override styles = [elementBase, fileTreeStyles];

	@property({ type: Array })
	files?: readonly FileItem[];

	@property({ type: Boolean })
	collapsable = true;

	@property({ type: Boolean, attribute: 'show-file-icons' })
	showFileIcons = false;

	@property({ type: Object, attribute: 'search-context' })
	searchContext?: GitCommitSearchContext;

	@property()
	header = 'Files changed';

	@property({ attribute: 'empty-text' })
	emptyText = 'No Files';

	/**
	 * Actions to display on individual file tree items.
	 * Accepts either a static array or a callback that receives the file and tree options.
	 * When not set, no actions will be shown.
	 */
	@property({ attribute: false })
	fileActions?: TreeItemAction[] | ((file: FileItem, options?: Partial<TreeItemBase>) => TreeItemAction[]);

	/**
	 * Optional callback to generate context data for individual file tree items.
	 * When set, each file's tree model will include the returned contextData string.
	 */
	@property({ attribute: false })
	fileContext?: (file: FileItem) => string | undefined;

	// --- Generic grouping (replaces isUncommitted / staged-unstaged logic) ---

	@property({ attribute: false })
	grouping?: { getGroup: (file: FileItem) => string; groups: FileGroup[] };

	// --- File layout (replaces preferences.files) ---

	@property({ attribute: false })
	filesLayout?: Pick<ViewsFilesConfig, 'layout' | 'threshold' | 'compact'>;

	@property()
	showIndentGuides?: 'none' | 'onHover' | 'always';

	// --- Header ---

	@property()
	badge?: string | number;

	@property({ attribute: false })
	buttons?: ('layout' | 'search' | 'multi-diff')[];

	// --- Checkbox ---

	@property({ type: Boolean })
	checkable = false;

	/**
	 * Per-file checkbox state. Files absent from map fall back to checkableStateDefault.
	 * state and disabled are orthogonal — a file can be checked+disabled.
	 * `disabledReason` overrides the default include/exclude tooltip when the row is disabled
	 * (e.g. "Excluded by AI ignore rules") so users understand WHY they can't toggle it.
	 */
	@property({ attribute: false })
	checkableStates?: Map<string, { state?: 'checked' | 'mixed'; disabled?: boolean; disabledReason?: string }>;

	@property({ attribute: false })
	checkableStateDefault?: { state?: 'checked' | 'mixed'; disabled?: boolean; disabledReason?: string };

	/**
	 * Verb for the "check" action (e.g. "Stage" for WIP, "Include" for Review).
	 * Used in tooltips on unchecked items ("Stage file.ts", "Include All").
	 * Pair with `uncheckVerb` to provide state-reflecting tooltips on the checkboxes.
	 */
	@property({ attribute: 'check-verb' })
	checkVerb?: string;

	/**
	 * Verb for the "uncheck" action (e.g. "Unstage" for WIP, "Exclude" for Review).
	 * Used in tooltips on checked items ("Unstage file.ts", "Exclude All").
	 */
	@property({ attribute: 'uncheck-verb' })
	uncheckVerb?: string;

	/**
	 * When `true` (default) and `checkable` is on, the count badge shows "x of y" while only a
	 * subset is checked, and falls back to "y" once everything is checked. Consumers whose
	 * "checked" state means something other than "selected for this operation" (e.g. the WIP
	 * staged/unstaged tree where checked == staged) should set this to `false` to keep the
	 * badge as a simple total.
	 */
	@property({ type: Boolean, attribute: 'selection-badge' })
	selectionBadge = true;

	/**
	 * Optional label appended to the subset badge (e.g. "Staged"). When set, reads as
	 * "x of y <label>" while partial and "y <label>" when fully checked. Ignored when
	 * `selectionBadge` is false.
	 */
	@property({ attribute: 'selection-badge-label' })
	selectionBadgeLabel?: string;

	@state() private _filterMode: 'off' | 'mixed' | 'matched' = 'mixed';
	@state() private _showFilter = false;

	private _cachedTreeModel?: TreeModel[];
	private _pendingScrollRestore?: number;

	override willUpdate(changedProperties: Map<PropertyKey, unknown>): void {
		// Rebuild cached tree model when tree-structure-relevant properties change.
		// Note: fileActions and fileContext are excluded — they're callbacks/arrays
		// consumed during model creation but don't affect tree structure. Including them
		// causes unnecessary rebuilds (losing expansion state) because callers often pass
		// new references on every render.
		if (
			changedProperties.has('files') ||
			changedProperties.has('filesLayout') ||
			changedProperties.has('showFileIcons') ||
			changedProperties.has('grouping') ||
			changedProperties.has('checkable') ||
			changedProperties.has('checkableStates') ||
			changedProperties.has('checkableStateDefault') ||
			changedProperties.has('searchContext') ||
			changedProperties.has('_filterMode')
		) {
			const files = (this.files as Files) ?? [];

			// Only when `files` actually changed: capture scroll position if the new path-set
			// mostly overlaps the old (>50%) — keeps scroll across a re-fetch of the same view,
			// drops it on a real navigation (different commit / repo).
			if (changedProperties.has('files')) {
				const prev = changedProperties.get('files') as readonly FileItem[] | undefined;
				if (prev?.length && files.length) {
					const prevPaths = new Set<string>();
					for (const f of prev) {
						prevPaths.add(f.path);
					}
					let overlap = 0;
					for (const f of files) {
						if (prevPaths.has(f.path)) {
							overlap++;
						}
					}
					if (overlap / Math.max(prevPaths.size, files.length) > 0.5) {
						const scrollable = this.getTreeScrollContainer();
						if (scrollable != null) {
							this._pendingScrollRestore = scrollable.scrollTop;
						}
					}
				}
			}

			this._cachedTreeModel = buildGroupedTree({
				files: files,
				isTree: isTreeLayout(this.fileLayout, files.length, this.filesLayout?.threshold ?? 5),
				compact: this.filesLayout?.compact ?? true,
				grouping: this.grouping,
				checkable: this.checkable,
				filterMode: this._filterMode,
				searchContext: this.searchContext,
				fileToModel: (file, opts, flat) => this.fileToTreeModel(file, opts, flat),
			});
		}
	}

	override updated(): void {
		if (this._pendingScrollRestore != null) {
			const scrollable = this.getTreeScrollContainer();
			if (scrollable != null) {
				scrollable.scrollTop = this._pendingScrollRestore;
			}
			this._pendingScrollRestore = undefined;
		}
	}

	/**
	 * Resolves the actual scroll container inside the inner gl-tree-view. The tree-view's
	 * host has overflow:hidden — the real scroller is the `#tree-list .scrollable` div in
	 * its (open) shadow root. Returns undefined if the tree-view hasn't rendered yet
	 * (e.g. when the file list is empty and the empty-state is shown instead).
	 */
	private getTreeScrollContainer(): HTMLElement | undefined {
		const treeView = this.renderRoot?.querySelector('gl-tree-view');
		const scrollable = treeView?.shadowRoot?.querySelector<HTMLElement>('#tree-list');
		return scrollable ?? undefined;
	}

	private get fileLayout(): ViewFilesLayout {
		return this.filesLayout?.layout ?? 'auto';
	}

	private get indentGuides(): 'none' | 'onHover' | 'always' {
		return this.showIndentGuides ?? 'none';
	}

	private get fileCount(): number {
		return this.files?.length ?? 0;
	}

	override render() {
		const treeModel = this._cachedTreeModel ?? [];
		const fileCount = this.fileCount;
		const effectiveBadge = this.badge ?? (fileCount > 0 ? fileCount : undefined);
		const showLayout = this.buttons?.includes('layout') ?? true;
		const showSearch = this.buttons?.includes('search') ?? true;
		const showMultiDiff = (this.buttons?.includes('multi-diff') ?? false) && fileCount > 0;

		return html`
			<webview-pane exportparts="header, content" .collapsable=${this.collapsable} expanded flexible>
				<span slot="title"
					>${this.checkable
						? this.renderCheckboxTitle(fileCount, effectiveBadge)
						: this.renderTitle(effectiveBadge)}</span
				>
				<slot name="subtitle" slot="subtitle"></slot>
				<div class="header-actions" slot="actions">
					<slot name="leading-actions" class="leading-actions"></slot>
					<action-nav>
						${showMultiDiff
							? html`<action-item
									data-action="multi-diff"
									label="Open All Changes"
									icon="diff-multiple"
									@click=${this.onOpenMultiDiff}
								></action-item>`
							: nothing}
						${this.searchContext != null
							? renderFilterAction(
									this._filterMode,
									this.searchContext.matchedFiles?.length ?? 0,
									fileCount,
									e => this.onToggleFilter(e),
								)
							: nothing}
						${showLayout ? renderLayoutAction(this.fileLayout, e => this.onToggleFilesLayout(e)) : nothing}
						${showSearch
							? html`<action-item
									data-action="search"
									label="${this._showFilter ? 'Hide Search' : 'Search'}"
									icon="search"
									class="${this._showFilter ? 'active-toggle' : ''}"
									@click=${this.onToggleSearch}
								></action-item>`
							: nothing}
						<slot name="actions"></slot>
					</action-nav>
				</div>
				<slot name="before-tree"></slot>
				${this.renderTreeFileModel(treeModel)}
			</webview-pane>
		`;
	}

	private renderTitle(badge?: string | number): TemplateResult {
		return html`<slot name="title-content"><span>${this.header}</span></slot
			>${badge != null ? html`<gl-badge appearance="filled">${badge}</gl-badge>` : nothing}<slot
				name="header-badge"
			></slot>`;
	}

	private renderCheckboxTitle(_fileCount: number, badge?: string | number): TemplateResult {
		// Count unique paths so a mixed file (which appears twice in `files` — once staged, once
		// unstaged) doesn't double-count and stick the header in indeterminate state. Disabled
		// rows still count toward the total (so the badge shows "x of <visible>") but are
		// excluded from the toggleable-path list so check-all never instructs consumers to
		// toggle a disabled row — and `allChecked` naturally stays false while any disabled row
		// exists, leaving the header indeterminate (an honest signal that not everything is in).
		const seen = new Set<string>();
		const enabledPaths: string[] = [];
		let checkedCount = 0;
		let mixedCount = 0;

		if (this.files) {
			for (const file of this.files) {
				if (seen.has(file.path)) continue;
				seen.add(file.path);
				const entry = this.checkableStates?.get(file.path);
				const disabled = entry?.disabled ?? this.checkableStateDefault?.disabled ?? false;
				if (!disabled) {
					enabledPaths.push(file.path);
				}
				const s = entry?.state ?? this.checkableStateDefault?.state;
				if (s === 'checked') {
					checkedCount++;
				} else if (s === 'mixed') {
					mixedCount++;
				}
			}
		}

		const totalFiles = seen.size;
		const allChecked = totalFiles > 0 && checkedCount === totalFiles && mixedCount === 0;
		const noneChecked = checkedCount === 0 && mixedCount === 0;
		const indeterminate = !allChecked && !noneChecked;

		// In selection-badge mode, surface "x of y" while only a subset is checked so users see
		// the running selection size without opening the tree. Once everything is checked, fall
		// back to the simple total (or "y <label>" if a label is set so the count keeps its
		// semantic identity). Mixed (partially staged) files count as checked for this display
		// so the count tracks what an "include all" action would actually act on.
		let effectiveBadge = badge;
		if (this.selectionBadge && this.checkable && totalFiles > 0) {
			const selected = checkedCount + mixedCount;
			const label = this.selectionBadgeLabel;
			if (selected < totalFiles) {
				effectiveBadge = label ? `${selected} of ${totalFiles} ${label}` : `${selected} of ${totalFiles}`;
			} else if (label) {
				effectiveBadge = `${totalFiles} ${label}`;
			}
		}

		// `live()` because gl-checkbox mutates `checked` on click — without it, a re-render with the
		// unchanged `allChecked` would skip reassignment and leave the locally-toggled state stuck.
		const checkbox = html`<gl-checkbox
			.checked=${live(allChecked)}
			.indeterminate=${live(indeterminate)}
			@gl-change-value=${(e: Event) => {
				const box = e.target as HTMLElement & { checked: boolean };
				this.dispatchEvent(
					new CustomEvent('gl-check-all', {
						detail: { checked: box.checked, paths: enabledPaths },
						bubbles: true,
						composed: true,
					}),
				);
			}}
		></gl-checkbox>`;

		const checkVerb = this.checkVerb;
		const uncheckVerb = this.uncheckVerb;
		const tooltipText =
			checkVerb && uncheckVerb
				? allChecked
					? `${uncheckVerb} All`
					: indeterminate
						? `${checkVerb} Remaining`
						: `${checkVerb} All`
				: undefined;

		const label =
			effectiveBadge == null
				? html`${this.header}`
				: html`${this.header} <gl-badge appearance="filled">${effectiveBadge}</gl-badge>`;

		return html`<span class="checkbox-header" @click=${(e: Event) => e.stopPropagation()}>
			${tooltipText
				? html`<gl-tooltip hoist placement="bottom"
						>${checkbox}<span slot="content">${tooltipText}</span></gl-tooltip
					>`
				: checkbox}
			<span class="checkbox-header__label">${label}<slot name="header-badge"></slot></span>
		</span>`;
	}

	private onToggleSearch(e: Event) {
		e.preventDefault();
		e.stopPropagation();
		this._showFilter = !this._showFilter;
	}

	private onOpenMultiDiff(e: Event) {
		e.preventDefault();
		e.stopPropagation();
		this.dispatchEvent(new CustomEvent('gl-file-tree-pane-open-multi-diff', { bubbles: true, composed: true }));
	}

	private onToggleFilter(e: Event) {
		e.preventDefault();
		e.stopPropagation();
		this._filterMode = nextFilterMode(this._filterMode);
	}

	private onToggleFilesLayout(e: Event) {
		e.preventDefault();
		e.stopPropagation();

		const layout = (e.currentTarget as HTMLElement)?.dataset?.filesLayout as ViewFilesLayout | undefined;
		if (layout == null) return;

		this.dispatchEvent(
			new CustomEvent('change-files-layout', {
				detail: { layout: layout },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private getFileDecorations(file: FileItem): TreeItemDecoration[] {
		const decorations: TreeItemDecoration[] = [];

		// Stats decorations (additions/deletions)
		if (file.stats) {
			decorations.push(
				{
					type: 'text' as const,
					label: `+${file.stats.additions}`,
					color: 'var(--vscode-gitDecoration-addedResourceForeground)',
					position: 'before' as const,
				},
				{
					type: 'text' as const,
					label: `−${file.stats.deletions}`,
					color: 'var(--vscode-gitDecoration-deletedResourceForeground)',
					position: 'before' as const,
				},
			);
		}

		// Status letter decoration (when using file icons)
		if (this.showFileIcons) {
			const statusInfo = getStatusDecoration(file.status);
			if (statusInfo != null) {
				decorations.push({
					type: 'text' as const,
					label: statusInfo.letter,
					tooltip: statusInfo.tooltip,
					color: statusInfo.color,
					position: 'after' as const,
				});
			}
		}

		return decorations;
	}

	private fileToTreeModel(
		file: FileItem,
		options?: Partial<TreeItemBase>,
		flat = false,
		glue = '/',
	): TreeModel<FileItem[]> {
		const pathIndex = file.path.lastIndexOf(glue);
		const fileName = pathIndex !== -1 ? file.path.substring(pathIndex + 1) : file.path;
		const filePath = flat && pathIndex !== -1 ? file.path.substring(0, pathIndex) : '';

		// Check if this file matches the search criteria (always set based on data, not filterMode)
		const isMatchedFile = this.searchContext?.matchedFiles?.find(f => f.path === file.path) != null;

		const decorations = this.getFileDecorations(file);

		const actions =
			typeof this.fileActions === 'function' ? this.fileActions(file, options) : (this.fileActions ?? []);

		// Derive checkbox state from checkableStates / checkableStateDefault
		let checkableOverrides: Partial<TreeItemBase> | undefined;
		if (this.checkable) {
			const entry = this.checkableStates?.get(file.path);
			const s = entry?.state ?? this.checkableStateDefault?.state;
			const disabled = entry?.disabled ?? this.checkableStateDefault?.disabled ?? false;
			const disabledReason = entry?.disabledReason ?? this.checkableStateDefault?.disabledReason;

			const checkVerb = this.checkVerb;
			const uncheckVerb = this.uncheckVerb;
			const tooltip = disabled
				? disabledReason
				: checkVerb && uncheckVerb
					? s === 'checked'
						? `${uncheckVerb} ${fileName}`
						: `${checkVerb} ${fileName}`
					: undefined;

			checkableOverrides = {
				checked: s === 'mixed' ? ('indeterminate' as const) : s === 'checked',
				disableCheck: disabled,
				checkableTooltip: tooltip,
			};
		}

		return {
			branch: false,
			expanded: true,
			path: file.path,
			level: 1,
			checkable: this.checkable,
			checked: false,
			icon: this.showFileIcons ? { type: 'file-icon' as const, filename: fileName } : undefined,
			label: fileName,
			description: `${flat === true ? filePath : ''}${file.status === 'R' ? ` ← ${file.originalPath}` : ''}`,
			context: [file],
			actions: actions,
			decorations: decorations.length > 0 ? decorations : undefined,
			contextData: this.fileContext?.(file),
			matched: isMatchedFile,
			...options,
			...checkableOverrides,
		};
	}

	private renderTreeFileModel(treeModel: TreeModel[]): TemplateResult<1> {
		// In matched-filter mode the search context is what's filtering the list, so when nothing
		// passes through, "No matching files" reads more accurately than the generic empty-text.
		const matchedEmpty = this._filterMode === 'matched' && this.searchContext != null;
		const emptyText = matchedEmpty ? 'No matching files' : this.emptyText;
		return html`<gl-tree-view
			.model=${treeModel}
			.guides=${this.indentGuides}
			.filtered=${this.searchContext != null && this._filterMode !== 'off'}
			filter-mode=${this._filterMode === 'mixed' ? 'highlight' : 'filter'}
			?filterable=${this._showFilter}
			filter-placeholder="Filter files..."
			empty-text=${emptyText}
			style="--gl-decoration-before-font-size: 0.9em; --gl-decoration-before-opacity: 0.8; --gl-decoration-after-font-size: 0.9em; --gl-decoration-after-opacity: 0.8"
			@gl-tree-generated-item-action-clicked=${this.onTreeItemActionClicked}
			@gl-tree-generated-item-checked=${this.onTreeItemChecked}
			@gl-tree-generated-item-selected=${this.onTreeItemSelected}
		></gl-tree-view>`;
	}

	private onTreeItemActionClicked(e: CustomEvent<TreeItemActionDetail>): void {
		if (!e.detail.action) return;

		const context = e.detail.context;
		// If context contains a file object, dispatch as a file event
		if (context?.[0] && typeof context[0] === 'object' && 'path' in context[0]) {
			const file = context[0] as FileItem;
			this.dispatchFileEvent(e.detail.action.action, file, e.detail);
		} else {
			// For non-file actions (e.g., group header actions), dispatch generically
			this.dispatchEvent(
				new CustomEvent(e.detail.action.action, {
					detail: e.detail,
					bubbles: true,
					composed: true,
				}),
			);
		}
	}

	private onTreeItemChecked(e: CustomEvent<TreeItemCheckedDetail>): void {
		this.dispatchEvent(new CustomEvent('file-checked', { detail: e.detail, bubbles: true, composed: true }));
	}

	private onTreeItemSelected(e: CustomEvent<TreeItemSelectionDetail>): void {
		if (!e.detail.context) return;

		this.dispatchFileEvent('file-compare-previous', e.detail.context[0], e.detail);
	}

	private dispatchFileEvent(name: string, file: FileItem, e?: { dblClick?: boolean; altKey?: boolean }): void {
		this.dispatchEvent(
			new CustomEvent(name, {
				detail: {
					path: file.path,
					repoPath: file.repoPath,
					status: file.status,
					staged: file.staged,
					showOptions: e
						? {
								preview: !e.dblClick,
								viewColumn: e.altKey ? BesideViewColumn : undefined,
							}
						: undefined,
				} satisfies FileChangeListItemDetail,
				bubbles: true,
				composed: true,
			}),
		);
	}
}
