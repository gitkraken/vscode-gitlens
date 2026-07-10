import type { TemplateResult } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { getAltKeySymbol } from '@env/platform.js';
import type { AgentSessionPhase } from '@gitlens/agents/types.js';
import type { GitFileChangeShape, GitFileChangeStats } from '@gitlens/git/models/fileChange.js';
import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import { isConflictStatus } from '@gitlens/git/utils/fileStatus.utils.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { ViewFilesLayout, ViewsFilesConfig } from '../../../../../config.js';
import type { WebviewItemContext } from '../../../../../system/webview.js';
import {
	mergeWebviewItems,
	mergeWebviewItemsUnion,
	serializeWebviewItemContext,
} from '../../../../../system/webview.js';
import type { FileShowOptions, WorkingFileSorting } from '../../../../commitDetails/protocol.js';
import { ModifierKeysController } from '../../controllers/modifier-keys.js';
import { elementBase } from '../styles/lit/base.css.js';
import type {
	TreeItemAction,
	TreeItemActionDetail,
	TreeItemBase,
	TreeItemCheckedDetail,
	TreeItemDecoration,
	TreeItemSelectionDetail,
	TreeModel,
	TreeSelectionChangedDetail,
} from './base.js';
import { getConflictDecorations, getConflictTooltip } from './conflictRendering.js';
import type { FileGroup } from './file-tree-utils.js';
import {
	buildFileTooltip,
	buildGroupedTree,
	getLayoutInfo,
	getStatusDecoration,
	isTreeLayout,
	nextContextMatchVisibility,
	renderContextMatchVisibilityAction,
	renderLayoutAction,
} from './file-tree-utils.js';
import { fileTreeStyles } from './gl-file-tree-pane.css.js';
import '../badges/badge.js';
import '../webview-pane.js';
import '../chips/action-chip.js';
import '../actions/action-nav.js';
import '../code-icon.js';
import '../checkbox/checkbox.js';
import '../overlays/tooltip.js';
import './tree-view.js';

export type FileItem = GitFileChangeShape & { stats?: GitFileChangeStats; conflictMarkers?: number };
type Files = Mutable<FileItem[]>;

// Can only import types from 'vscode'
const BesideViewColumn = -2; /*ViewColumn.Beside*/

export interface FileChangeListItemDetail extends FileItem {
	showOptions?: FileShowOptions;
	/** Set when the originating click held Alt. Surfaced so consumers like gl-wip-tree-pane
	 * can fork dispatch on modifier state without reverse-engineering `showOptions.viewColumn`. */
	altKey?: boolean;
	/** Present when a `batch` inline action fires on a multi-selection — the full selected set so the
	 * consumer can act once (e.g. one combined discard confirm) instead of per-file. */
	files?: readonly FileItem[];
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
	fileContext?: (file: FileItem, options?: Partial<TreeItemBase>) => string | undefined;

	/**
	 * Optional callback to generate context data for folder tree items. When set, each folder's
	 * tree model will include the returned contextData string so VS Code's webview menu system
	 * can target it via `webviewItem` regex matchers.
	 */
	@property({ attribute: false })
	folderContext?: (folder: { name: string; relativePath: string; repoPath?: string }) => string | undefined;

	// --- Generic grouping (replaces isUncommitted / staged-unstaged logic) ---

	@property({ attribute: false })
	grouping?: { getGroup: (file: FileItem) => string; groups: FileGroup[] };

	// --- File layout (replaces preferences.files) ---

	@property({ attribute: false })
	filesLayout?: Pick<ViewsFilesConfig, 'layout' | 'threshold' | 'compact'>;

	/**
	 * Working-files sort order (VS Code's `scm.defaultViewSortKey`). Honored only in list layout,
	 * matching VS Code. Left undefined by non-WIP consumers, which keep the default name sort.
	 */
	@property({ attribute: false })
	orderBy?: WorkingFileSorting;

	/**
	 * When set (the WIP `gitlens.sortWorkingChangesBy: stage` mode), the list-layout sort floats files
	 * staged → mixed → unstaged ahead of `orderBy`. List layout only, like `orderBy`.
	 */
	@property({ type: Boolean, attribute: 'sort-by-stage' })
	sortByStage = false;

	/** Paths with both staged + unstaged hunks; lets the stage sort rank a file as "mixed". */
	@property({ attribute: false })
	mixedPaths?: ReadonlySet<string>;

	@property()
	showIndentGuides?: 'none' | 'onHover' | 'always';

	// --- Header ---

	@property()
	badge?: string | number;

	@property({ attribute: false })
	buttons?: ('layout' | 'search')[];

	// --- Multi-select ---

	/**
	 * Opt-in native row multi-select (Ctrl/Cmd+click toggle, Shift+click range). Forwarded to
	 * `gl-tree-view`. When on, the pane emits `file-selection-changed` with the selected file set;
	 * a plain click still fires the per-row `selectionAction` event so click-to-open is preserved.
	 * Orthogonal to `checkable`.
	 */
	@property({ type: Boolean, attribute: 'multi-selectable' })
	multiSelectable = false;

	/** Opt-in: makes file rows draggable (native drag carrying the file `path`). Off by default;
	 *  set by consumers that support dropping files elsewhere (e.g. compose file→commit move). */
	@property({ type: Boolean, attribute: 'draggable-files' })
	draggableFiles = false;

	@state() private _selectedFiles: readonly FileItem[] = [];

	/** The currently multi-selected files (empty when `multiSelectable` is off or nothing selected). */
	get selectedFiles(): readonly FileItem[] {
		return this._selectedFiles;
	}

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

	/**
	 * Event name dispatched when a file row is selected (default click).
	 * Defaults to `'file-compare-previous'` to preserve historical SCM-style behavior.
	 * Consumers like the WIP tree pass `'file-open'` so a row click opens the file directly,
	 * or `'file-compare-wip'` so a row click opens a per-staged-flag working-tree diff.
	 * Compare-mode panels pass `'file-compare-range'` so the diff matches the panel's
	 * leftRef/rightRef context instead of the file's git history.
	 */
	@property({ attribute: 'selection-action' })
	selectionAction: 'file-open' | 'file-compare-previous' | 'file-compare-wip' | 'file-compare-range' =
		'file-compare-previous';

	/**
	 * Repo-relative normalized file paths the connected agent(s) are actively editing right now,
	 * mapped to the agent's phase. When set, matching file rows get an agent decoration in
	 * `getFileDecorations`. Map (not Set) so the phase can drive icon + color.
	 */
	@property({ attribute: false })
	agentTouchedFiles?: ReadonlyMap<string, AgentSessionPhase>;

	@state() private _contextMatchVisibility: 'off' | 'mixed' | 'matched' = 'mixed';
	@state() private _showSearchBox = false;
	@state() private _searchBoxFilter = true;

	/**
	 * Controlled-when-bound: parent supplies the search-box visibility (e.g. the graph state
	 * provider persists it across reloads). Falls back to the internal `_showSearchBox` state
	 * when undefined so uncontrolled consumers (e.g. standalone commit details) keep working.
	 */
	@property({ type: Boolean, attribute: 'show-search-box' })
	showSearchBox?: boolean;

	/**
	 * Controlled-when-bound: parent supplies the search-box filter mode. `true` = filter (hide
	 * non-matches), `false` = highlight (dim non-matches). Falls back to the internal
	 * `_searchBoxFilter` state when undefined.
	 */
	@property({ type: Boolean, attribute: 'search-box-filter' })
	searchBoxFilter?: boolean;

	private _cachedTreeModel?: TreeModel[];
	/**
	 * Row identities (`key ?? path`) of folders the user has collapsed. The tree model is rebuilt
	 * from scratch (default-expanded) on every `files`/preference change, so we re-apply this set
	 * after each rebuild to keep collapse state across refreshes. Storing only collapsed *deviations*
	 * (not expanded ids) means folders that first appear after a refresh default to expanded.
	 * In-memory only — persists while this element lives (data refreshes, commit switches), resets on
	 * a full webview reload.
	 */
	private readonly _collapsedIds = new Set<string>();
	private _pendingScrollRestore?: number;
	// Drives a re-render when alt is pressed/released so the header tooltip can swap between
	// the primary and alt-action labels. Per-file checkbox tooltips swap inside `gl-tree-item`,
	// which has its own subscription.
	private readonly _modifiers = new ModifierKeysController(this);

	override connectedCallback(): void {
		super.connectedCallback?.();
		// Bubble-phase listener fires before the ancestor ContextMenuProxyController (inner→outer), so
		// it can enrich the right-clicked row's data-vscode-context with the active multi-selection
		// just-in-time — before the proxy copies it to the light-DOM host for VS Code's menu.
		this.addEventListener('contextmenu', this.onContextMenuEnrichSelection);
	}

	override disconnectedCallback(): void {
		this.removeEventListener('contextmenu', this.onContextMenuEnrichSelection);
		super.disconnectedCallback?.();
	}

	/**
	 * When a row that's part of a multi-selection is right-clicked, enrich its data-vscode-context with
	 * `listMultiSelection` + merged `webviewItems` + `webviewItemsValues` so VS Code's `.multi` file
	 * commands gate and resolve over the whole selection. The single-row context is restored shortly
	 * after the menu reads it (mirrors ContextMenuProxyController's 100ms window).
	 */
	private onContextMenuEnrichSelection = (e: MouseEvent): void => {
		if (!this.multiSelectable || this._selectedFiles.length <= 1 || this.fileContext == null) return;

		const treeItem = e
			.composedPath()
			.find(
				(el): el is HTMLElement =>
					el instanceof HTMLElement &&
					el.tagName === 'GL-TREE-ITEM' &&
					el.hasAttribute('data-vscode-context'),
			);
		if (treeItem == null) return;

		const raw = treeItem.getAttribute('data-vscode-context');
		if (raw == null) return;

		let single: WebviewItemContext;
		try {
			single = JSON.parse(raw) as WebviewItemContext;
		} catch {
			return;
		}

		// Only enrich when the right-clicked row is itself part of the selection.
		const path = (single.webviewItemValue as { path?: string } | undefined)?.path;
		if (path == null || !this._selectedFiles.some(f => f.path === path)) return;

		const values: { webviewItem: string; webviewItemValue: unknown }[] = [];
		for (const file of this._selectedFiles) {
			const ctx = this.fileContext(file);
			if (ctx == null) continue;

			try {
				const parsed = JSON.parse(ctx) as WebviewItemContext;
				values.push({ webviewItem: parsed.webviewItem, webviewItemValue: parsed.webviewItemValue });
			} catch {
				continue;
			}
		}
		if (values.length <= 1) return;

		// Omit `webviewItem` (the singular row key) so single-file menus auto-hide on a multi-selection
		// and only the `.multi` menus (gated on `webviewItems` + `listMultiSelection`) show — matching
		// the graph's multi-selection context. `webviewItemValue` is kept as the right-clicked anchor.
		const enriched = {
			webview: single.webview,
			webviewInstance: single.webviewInstance,
			webviewItemValue: single.webviewItemValue,
			listMultiSelection: true,
			webviewItems: mergeWebviewItems(values.map(v => v.webviewItem)),
			webviewItemsUnion: mergeWebviewItemsUnion(values.map(v => v.webviewItem)),
			webviewItemsValues: values,
		};
		treeItem.setAttribute('data-vscode-context', serializeWebviewItemContext(enriched));
		setTimeout(() => treeItem.setAttribute('data-vscode-context', raw), 100);
	};

	override willUpdate(changedProperties: Map<PropertyKey, unknown>): void {
		// Rebuild cached tree model when tree-structure-relevant properties change.
		// Note: fileActions, fileContext, and folderContext are excluded — they're
		// callbacks/arrays consumed during model creation but don't affect tree structure.
		// Including them causes unnecessary rebuilds (losing expansion state) because
		// callers often pass new references on every render.
		if (
			changedProperties.has('files') ||
			changedProperties.has('filesLayout') ||
			changedProperties.has('orderBy') ||
			changedProperties.has('sortByStage') ||
			changedProperties.has('mixedPaths') ||
			changedProperties.has('showFileIcons') ||
			changedProperties.has('grouping') ||
			changedProperties.has('checkable') ||
			changedProperties.has('checkableStates') ||
			changedProperties.has('checkableStateDefault') ||
			changedProperties.has('searchContext') ||
			changedProperties.has('agentTouchedFiles') ||
			changedProperties.has('_contextMatchVisibility')
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

				// Reconcile the multi-selection against the new files: drop paths that are gone and
				// re-point survivors to the new FileItem objects. The tree's own prune only re-emits
				// when its id-set actually changes, so a model swap whose paths overlap would otherwise
				// leave `_selectedFiles` holding the previous commit's file shapes (wrong diff refs).
				if (this._selectedFiles.length) {
					const byPath = new Map(files.map(f => [f.path, f]));
					const reconciled = this._selectedFiles
						.map(f => byPath.get(f.path))
						.filter((f): f is FileItem => f != null);
					if (
						reconciled.length !== this._selectedFiles.length ||
						reconciled.some((f, i) => f !== this._selectedFiles[i])
					) {
						this._selectedFiles = reconciled;
					}
				}
			}

			this._cachedTreeModel = buildGroupedTree({
				files: files,
				isTree: isTreeLayout(this.fileLayout, files.length, this.filesLayout?.threshold ?? 5),
				compact: this.filesLayout?.compact ?? true,
				grouping: this.grouping,
				checkable: this.checkable,
				contextMatchVisibility: this._contextMatchVisibility,
				searchContext: this.searchContext,
				fileToModel: (file, opts, flat) => this.fileToTreeModel(file, opts, flat),
				folderToContextData: this.folderContext,
				orderBy: this.orderBy,
				sortByStage: this.sortByStage,
				mixedPaths: this.mixedPaths,
			});
			this.applyCollapsedState(this._cachedTreeModel);
		}
	}

	/** Re-applies remembered folder collapse state onto a freshly-built (default-expanded) model. */
	private applyCollapsedState(nodes: TreeModel[]): void {
		if (this._collapsedIds.size === 0) return;

		for (const node of nodes) {
			if (node.branch && this._collapsedIds.has(node.key ?? node.path)) {
				node.expanded = false;
			}
			if (node.children != null) {
				this.applyCollapsedState(node.children);
			}
		}
	}

	private onTreeExpansionChanged = (e: CustomEvent<{ path: string; key: string; expanded: boolean }>): void => {
		if (e.detail.expanded) {
			this._collapsedIds.delete(e.detail.key);
		} else {
			this._collapsedIds.add(e.detail.key);
		}
	};

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
	 * Resolves the actual scroll container inside the inner gl-tree-view. The `lit-virtualizer`
	 * (rendered with the `scroller` attribute) owns the scrollbar — the outer `#tree-list`
	 * wrapper is sized to fit and never overflows, so writing scrollTop on it is a no-op.
	 * Returns undefined if the tree-view hasn't rendered yet (e.g. when the file list is empty
	 * and the empty-state is shown instead).
	 */
	private getTreeScrollContainer(): HTMLElement | undefined {
		const treeView = this.renderRoot?.querySelector('gl-tree-view');
		return treeView?.shadowRoot?.querySelector<HTMLElement>('lit-virtualizer') ?? undefined;
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

	private get effectiveShowSearchBox(): boolean {
		return this.showSearchBox ?? this._showSearchBox;
	}

	private get effectiveSearchBoxFilter(): boolean {
		return this.searchBoxFilter ?? this._searchBoxFilter;
	}

	override render() {
		const treeModel = this._cachedTreeModel ?? [];
		const fileCount = this.fileCount;
		const effectiveBadge = this.badge ?? (fileCount > 0 ? fileCount : undefined);
		const showLayout = this.buttons?.includes('layout') ?? true;
		const showSearch = this.buttons?.includes('search') ?? true;
		const showSearchBox = this.effectiveShowSearchBox;

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
						${this.searchContext != null
							? renderContextMatchVisibilityAction(
									this._contextMatchVisibility,
									this.searchContext.matchedFiles?.length ?? 0,
									fileCount,
									e => this.onCycleContextMatchVisibility(e),
								)
							: nothing}
						${showLayout ? renderLayoutAction(this.fileLayout, e => this.onToggleFilesLayout(e)) : nothing}
						${showSearch
							? html`<gl-action-chip
									data-action="search"
									label="${showSearchBox ? 'Hide Search' : 'Show Search'}"
									icon="search"
									class="${showSearchBox ? 'active-toggle' : ''}"
									@click=${this.onToggleSearch}
								></gl-action-chip>`
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
		return html`<slot name="title-content"><span class="file-tree-pane__title">${this.header}</span></slot
			>${badge != null
				? html`<gl-badge appearance="filled"
						><span class="checkbox-header__badge-text">${badge}</span></gl-badge
					>`
				: nothing}<slot name="header-badge"></slot>`;
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

		// Conflicted files take precedence over the selection-badge — when the user has
		// unresolved conflicts that's the most important number to surface.
		let conflictCount = 0;
		if (this.files) {
			const seenConflicts = new Set<string>();
			for (const file of this.files) {
				if (!isConflictStatus(file.status) || seenConflicts.has(file.path)) continue;

				seenConflicts.add(file.path);
				conflictCount++;
			}
		}

		// In selection-badge mode, surface "x of y" while only a subset is checked so users see
		// the running selection size without opening the tree. Once everything is checked, fall
		// back to the simple total (or "y <label>" if a label is set so the count keeps its
		// semantic identity). Mixed (partially staged) files are NOT counted as checked here —
		// they aren't fully staged — and instead get their own "+N Mixed" sub-badge.
		let effectiveBadge = badge;
		let badgeAppearance: 'filled' | 'warning' = 'filled';
		let showMixedBadge = false;
		if (conflictCount > 0) {
			effectiveBadge = pluralize('conflict', conflictCount);
			badgeAppearance = 'warning';
		} else if (this.selectionBadge && this.checkable && totalFiles > 0) {
			const selected = checkedCount;
			const label = this.selectionBadgeLabel;
			if (selected < totalFiles) {
				effectiveBadge = label ? `${selected} of ${totalFiles} ${label}` : `${selected} of ${totalFiles}`;
			} else if (label) {
				effectiveBadge = `${totalFiles} ${label}`;
			}
			showMixedBadge = mixedCount > 0;
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
		let tooltipText: string | undefined;
		if (checkVerb && uncheckVerb) {
			if (allChecked) {
				tooltipText = `${uncheckVerb} All`;
			} else if (indeterminate) {
				// Alt+click on the indeterminate header flips from "stage remaining" to
				// "unstage all currently staged" — surface that as a discoverable hint.
				const baseLabel = `${checkVerb} Remaining`;
				const altLabel = `${uncheckVerb} All`;
				tooltipText = this._modifiers.altKey ? altLabel : `${baseLabel}\n[${getAltKeySymbol()}] ${altLabel}`;
			} else {
				tooltipText = `${checkVerb} All`;
			}
		}

		// Mixed chip nests INSIDE the primary badge as a recessed sub-segment.
		const mixedBadge = showMixedBadge
			? html`<gl-badge appearance="muted" class="checkbox-header__badge-mixed">+${mixedCount} Mixed</gl-badge>`
			: nothing;

		const label =
			effectiveBadge == null
				? html`<span class="checkbox-header__title">${this.header}</span>`
				: html`<span class="checkbox-header__title">${this.header}</span>
						<gl-badge appearance=${badgeAppearance}
							><span class="checkbox-header__badge-text">${effectiveBadge}</span>${mixedBadge}</gl-badge
						>`;

		return html`<span class="checkbox-header" @click=${(e: Event) => e.stopPropagation()}>
			${tooltipText
				? html`<gl-tooltip placement="bottom" content=${tooltipText}>${checkbox}</gl-tooltip>`
				: checkbox}
			<span class="checkbox-header__label">${label}<slot name="header-badge"></slot></span>
		</span>`;
	}

	private onToggleSearch(e: Event) {
		e.preventDefault();
		e.stopPropagation();
		const next = !this.effectiveShowSearchBox;
		// Mutate the fallback so uncontrolled consumers keep working; controlled consumers ignore
		// this and update via the property on the next render.
		this._showSearchBox = next;
		this.dispatchEvent(
			new CustomEvent('gl-show-search-box-change', {
				detail: next,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onTreeSearchBoxFilterChanged(e: CustomEvent<boolean>) {
		// The user owns the search-box filter/highlight mode independently of context-match
		// visibility now (mixed dims via `dimUnmatched`, not by forcing this off), so always honor it.
		this._searchBoxFilter = e.detail;
		this.dispatchEvent(
			new CustomEvent<boolean>('gl-search-box-filter-change', {
				detail: e.detail,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onCycleContextMatchVisibility(e: Event) {
		e.preventDefault();
		e.stopPropagation();
		this._contextMatchVisibility = nextContextMatchVisibility(this._contextMatchVisibility);
	}

	private onToggleFilesLayout(e: Event) {
		e.preventDefault();
		e.stopPropagation();

		// Compute the next layout from our own state; reading it back off the chip's data-attribute
		// broke after the action-chip conversion.
		const layout = getLayoutInfo(this.fileLayout).value as ViewFilesLayout;
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

		// Rich conflict rendering — status code + "Modified (Both)" muted label + warning + count.
		// Mirrors the rebase editor's treatment via the shared conflictRendering helpers.
		// Surfaced regardless of `showFileIcons` so unresolved conflicts are always visible.
		if (isConflictStatus(file.status)) {
			const conflictDecorations = getConflictDecorations(
				file.status as GitFileConflictStatus,
				file.conflictMarkers,
			);
			if (conflictDecorations != null) {
				decorations.push(...conflictDecorations);
			}
		}

		// Stats decorations (additions/deletions)
		if (file.stats) {
			decorations.push(
				{
					type: 'text' as const,
					label: `+${file.stats.additions}`,
					kind: 'added' as const,
					position: 'before' as const,
				},
				{
					type: 'text' as const,
					label: `−${file.stats.deletions}`,
					kind: 'deleted' as const,
					position: 'before' as const,
				},
			);
		}

		// Status letter decoration (when using file icons). Skipped for conflicts — those
		// already get the richer status-code decoration above.
		if (this.showFileIcons && !isConflictStatus(file.status)) {
			const statusInfo = getStatusDecoration(file.status);
			if (statusInfo != null) {
				decorations.push({
					type: 'text' as const,
					label: statusInfo.letter,
					tooltip: statusInfo.tooltip,
					kind: statusInfo.kind,
					position: 'after' as const,
				});
			}
		}

		// Agent "currently editing" decoration — transient, follows the agent's in-flight
		// file-mutating tool call. Rendered before the status letter so the agent cue isn't lost
		// in the right-edge action gutter.
		const agentPhase = this.agentTouchedFiles?.get(file.path);
		if (agentPhase != null) {
			decorations.push({
				type: 'agent' as const,
				label: 'Editing',
				tooltip: 'Claude Code is editing this file',
				phase: agentPhase,
				position: 'before' as const,
			});
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

		// Check if this file matches the search criteria (always set based on data, regardless of
		// the current context-match-visibility cycle)
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
			let tooltip: string | undefined;
			let altTooltip: string | undefined;
			if (disabled) {
				tooltip = disabledReason;
			} else if (checkVerb && uncheckVerb) {
				if (s === 'checked') {
					tooltip = `${uncheckVerb} ${fileName}`;
				} else if (s === 'mixed') {
					// Plain click stages remaining hunks; alt+click flips to unstage everything —
					// surface alt as a discoverable option (tree-item composes the alt-key hint line).
					tooltip = `${checkVerb} ${fileName}`;
					altTooltip = `${uncheckVerb} ${fileName}`;
				} else {
					tooltip = `${checkVerb} ${fileName}`;
				}
			}

			checkableOverrides = {
				checked: s === 'mixed' ? ('indeterminate' as const) : s === 'checked',
				disableCheck: disabled,
				checkableTooltip: tooltip,
				checkableAltTooltip: altTooltip,
			};
		}

		const conflicted = isConflictStatus(file.status);
		const icon = conflicted
			? { type: 'status' as const, name: file.status }
			: this.showFileIcons
				? { type: 'file-icon' as const, filename: fileName }
				: undefined;
		const tooltip = conflicted
			? getConflictTooltip(file.status as GitFileConflictStatus, file.conflictMarkers)
			: buildFileTooltip(file);

		return {
			branch: false,
			expanded: true,
			path: file.path,
			level: 1,
			checkable: this.checkable,
			checked: false,
			// Conflicted files stage behind a confirm prompt the user can cancel — keep their checkbox
			// model-controlled so a click doesn't optimistically check it before the stage lands.
			controlledCheck: conflicted,
			icon: icon,
			label: fileName,
			// `label` is only the basename, so make the full repo-relative path searchable (exact-substring)
			// — otherwise a query with a folder separator (e.g. `src/webviews/foo.ts`) matches nothing.
			filterText: file.path,
			description: `${flat === true ? filePath : ''}${file.status === 'R' ? ` ← ${file.originalPath}` : ''}`,
			tooltip: tooltip,
			priority: conflicted ? -1 : undefined,
			context: [file],
			actions: actions,
			decorations: decorations.length > 0 ? decorations : undefined,
			contextData: this.fileContext?.(file, options),
			matched: isMatchedFile,
			...options,
			...checkableOverrides,
		};
	}

	private renderTreeFileModel(treeModel: TreeModel[]): TemplateResult<1> {
		// In `matched` context-visibility mode the search context is what's filtering the list, so
		// when nothing passes through, "No matching files" reads more accurately than the generic
		// empty-text.
		const matchedEmpty = this._contextMatchVisibility === 'matched' && this.searchContext != null;
		const emptyText = matchedEmpty ? 'No matching files' : this.emptyText;
		// `mixed` context-match visibility shows all files with matches highlighted (dim non-matches).
		// Route that through `dimUnmatched` rather than forcing `searchBoxFilter` off — otherwise the
		// funnel would hijack the user's search-box filter mode and flip its placeholder.
		const dimUnmatched = this.searchContext != null && this._contextMatchVisibility === 'mixed';
		return html`<gl-tree-view
			.model=${treeModel}
			.guides=${this.indentGuides}
			.filtered=${this.searchContext != null && this._contextMatchVisibility !== 'off'}
			.searchBoxFilter=${this.effectiveSearchBoxFilter}
			.dimUnmatched=${dimUnmatched}
			?filterable=${this.effectiveShowSearchBox}
			?multi-selectable=${this.multiSelectable}
			?draggable-files=${this.draggableFiles}
			filter-placeholder="Filter files..."
			search-placeholder="Search files..."
			empty-text=${emptyText}
			@gl-tree-search-box-filter-changed=${this.onTreeSearchBoxFilterChanged}
			@gl-tree-generated-item-action-clicked=${this.onTreeItemActionClicked}
			@gl-tree-generated-item-checked=${this.onTreeItemChecked}
			@gl-tree-generated-item-selected=${this.onTreeItemSelected}
			@gl-tree-generated-selection-changed=${this.onSelectionChanged}
			@gl-tree-expansion-changed=${this.onTreeExpansionChanged}
		></gl-tree-view>`;
	}

	private onTreeItemActionClicked(e: CustomEvent<TreeItemActionDetail>): void {
		if (!e.detail.action) return;

		const context = e.detail.context;
		// If context contains a file object, dispatch as a file event
		if (context?.[0] && typeof context[0] === 'object' && 'path' in context[0]) {
			const file = context[0] as FileItem;
			const action = e.detail.action;

			// Inline-action fan-out (VS Code SCM): when the clicked row is part of a multi-selection,
			// apply the action across the selection. `batch` actions (e.g. discard) get one event carrying
			// the whole set so the consumer can act once; `fanOut` repeats the action per selected file;
			// `single` opts out entirely (row-specific actions like conflict Open Current/Incoming that
			// would open wrong/empty content for non-applicable rows) and acts only on the clicked row.
			if (
				this.multiSelectable &&
				this._selectedFiles.length > 1 &&
				action.multiBehavior !== 'single' &&
				this._selectedFiles.some(f => f.path === file.path)
			) {
				if (action.multiBehavior === 'batch') {
					this.dispatchFileEvent(action.action, file, e.detail, this._selectedFiles);
				} else {
					// Force non-preview (`dblClick: true`) so a multi-open lands every file in its own tab —
					// a single preview tab would otherwise be replaced by each successive open, leaving only
					// the last file. Non-open fan-out actions ignore showOptions, so this is harmless to them.
					for (const selected of this._selectedFiles) {
						this.dispatchFileEvent(action.action, selected, { dblClick: true, altKey: e.detail.altKey });
					}
				}
				return;
			}

			this.dispatchFileEvent(action.action, file, e.detail);
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
		// Selection-aware checkboxes (VS Code SCM behavior): when the toggled row is part of a
		// multi-selection, apply the SAME ACTION (check → on, uncheck → off) to every selected file
		// by emitting a `file-checked` per selected file — but skip files already in the target state
		// so the consumer doesn't fire redundant ops (e.g. re-`git add`-ing an already-staged file,
		// which would silently capture new working-tree changes). A `mixed` (partially staged) file
		// is NOT in either terminal state, so it always receives the action. A checkbox toggle on a
		// row NOT in the selection (or with <2 selected) acts on that row alone. Consumers read only
		// detail.context[0] (the file) + detail.checked, so a per-file detail with context:[file] is
		// sufficient and keeps the wrappers/panels unchanged.
		const toggledPath = (e.detail.context?.[0] as FileItem | undefined)?.path;
		if (this.multiSelectable && this._selectedFiles.length > 1 && toggledPath != null) {
			const inSelection = this._selectedFiles.some(f => f.path === toggledPath);
			if (inSelection) {
				const checked = e.detail.checked;
				for (const file of this._selectedFiles) {
					const state = this.checkableStates?.get(file.path)?.state ?? this.checkableStateDefault?.state;
					// Skip files already fully in the requested terminal state (`checked` → already
					// 'checked'; unchecked → already off/undefined). `mixed` falls through both ways.
					if (checked ? state === 'checked' : state == null) continue;

					this.dispatchEvent(
						new CustomEvent('file-checked', {
							detail: { node: e.detail.node, context: [file], checked: checked },
							bubbles: true,
							composed: true,
						}),
					);
				}
				return;
			}
		}

		this.dispatchEvent(new CustomEvent('file-checked', { detail: e.detail, bubbles: true, composed: true }));
	}

	private onTreeItemSelected(e: CustomEvent<TreeItemSelectionDetail>): void {
		if (!e.detail.context) return;

		this.dispatchFileEvent(this.selectionAction, e.detail.context[0], e.detail);
	}

	private onSelectionChanged(e: CustomEvent<TreeSelectionChangedDetail>): void {
		const selectedPaths = new Set(e.detail.paths);
		// Dedupe by path: a mixed (staged + unstaged) file can appear as two rows sharing one path, and
		// the selected set must carry each file once — otherwise multi actions double-act (open a file
		// twice, copy/stage its path twice, list it twice in webviewItemsValues).
		const seen = new Set<string>();
		const files = (this.files ?? []).filter(f => {
			if (!selectedPaths.has(f.path) || seen.has(f.path)) return false;

			seen.add(f.path);
			return true;
		});
		this._selectedFiles = files;
		this.dispatchEvent(
			new CustomEvent('file-selection-changed', {
				detail: { files: files, paths: e.detail.paths },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private dispatchFileEvent(
		name: string,
		file: FileItem,
		e?: { dblClick?: boolean; altKey?: boolean },
		files?: readonly FileItem[],
	): void {
		this.dispatchEvent(
			new CustomEvent(name, {
				detail: {
					path: file.path,
					repoPath: file.repoPath,
					status: file.status,
					originalPath: file.originalPath,
					staged: file.staged,
					altKey: e?.altKey,
					files: files,
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
