import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { AgentSessionPhase } from '@gitlens/agents/types.js';
import type { GitCommitStats } from '@gitlens/git/models/commit.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import { getFileDiffPathspecs, isConflictStatus } from '@gitlens/git/utils/fileStatus.utils.js';
import type { Preferences } from '../../../../commitDetails/protocol.js';
import type { CopyWipPatchEventDetail, OpenMultipleChangesArgs, WipScope } from '../../actions/file.js';
import { renderCommitStatsIcons } from '../commit/commit-stats.js';
import type { TreeItemAction, TreeItemBase } from './base.js';
import type { FileGroup } from './file-tree-utils.js';
import { renderOpenChangesAction, selectFilesByPath, selectRowsByPath } from './file-tree-utils.js';
import type { FileChangeListItemDetail, FileItem } from './gl-file-tree-pane.js';
import './gl-file-tree-pane.js';
import '../chips/action-chip.js';

type Files = Mutable<FileItem[]>;

@customElement('gl-wip-tree-pane')
export class GlWipTreePane extends LitElement {
	static override styles = css`
		/* Establish the named container on this host so the @container query below resolves
	   in the same shadow scope as the rule (cross-shadow container lookup is spotty). */
		:host {
			display: flex;
			flex: 1 1 0%;
			container-name: gl-wip-tree-pane;
			container-type: inline-size;
		}

		/* Group the leading actions (Discard/Stash/Open Changes/Copy) as a cohesive cluster — each
	   gl-action-chip's own padding supplies the internal rhythm; the gl-file-tree-pane header-actions
	   gap separates the cluster from the action-nav toggles. */
		.wip-actions {
			display: flex;
			align-items: center;
		}

		/* Set the general file actions (Open Changes/Copy) apart from the conflict-resolution cluster
		   (Resolve Conflicts + Stage-all) when it precedes them, so the two read as distinct groups.
		   The adjacent-sibling match only fires when a leading-actions chip immediately precedes
		   wip-actions — i.e. exactly the conflict scenarios; with no conflicts wip-actions is the first
		   leading action and the previous element sibling is the subtitle span, so no leading gap. */
		gl-action-chip[slot='leading-actions'] + .wip-actions {
			margin-left: var(--gl-space-8);
		}

		/* Collapse the Stash label to icon-only when the pane runs out of room. display:none
	   cleanly removes the slotted flex item so the button's internal gap collapses too — true
	   icon-only, no half-clipped text. The button's tooltip (Stash All/Staged Changes) keeps it
	   accessible when the label is hidden. The group/action-nav gap is intentionally preserved at
	   narrow widths so the clusters stay visually distinct. */
		@container gl-wip-tree-pane (max-width: 340px) {
			.stash-label {
				display: none !important;
			}
		}

		.subtitle-stats {
			opacity: 1;
		}
	`;

	@property({ type: Array })
	files?: readonly FileItem[];

	@property({ type: Object })
	stats?: GitCommitStats;

	@property({ type: Boolean })
	collapsable = true;

	@property({ type: Boolean, attribute: 'show-file-icons' })
	showFileIcons = false;

	@property({ attribute: false })
	fileActions?: TreeItemAction[] | ((file: FileItem, options?: Partial<TreeItemBase>) => TreeItemAction[]);

	@property({ attribute: false })
	fileContext?: (file: FileItem, options?: Partial<TreeItemBase>) => string | undefined;

	@property({ attribute: false })
	folderContext?: (folder: { name: string; relativePath: string; repoPath?: string }) => string | undefined;

	/** Forwarded to `gl-file-tree-pane`'s `contextRevision`: the inner tree bakes {@link fileContext}'s
	 *  results into a cached model that the callback itself cannot invalidate, so a context reading state
	 *  which lands after the files needs this to change. Without it the rows keep the contexts they had
	 *  when the model was first built — for working changes, the ones from before the repo path resolved. */
	@property({ attribute: false })
	contextRevision?: unknown;

	@property({ attribute: 'empty-text' })
	emptyText = 'No Files';

	@property({ type: Object, attribute: 'search-context' })
	searchContext?: GitCommitSearchContext;

	@property({ type: Object })
	preferences?: Preferences;

	@property({ type: Boolean })
	checkable = false;

	/** Opt-in native row multi-select; forwarded to the inner `gl-file-tree-pane`. Enables
	 *  "Open Selected Changes" and selection-aware checkboxes (toggling one selected row's checkbox
	 *  stages/unstages all selected rows). */
	@property({ type: Boolean, attribute: 'multi-selectable' })
	multiSelectable = false;

	@property({ attribute: false })
	checkableStates?: Map<string, { state?: 'checked' | 'mixed'; disabled?: boolean; disabledReason?: string }>;

	@property({ attribute: false })
	checkableStateDefault?: { state?: 'checked' | 'mixed'; disabled?: boolean; disabledReason?: string };

	@property({ attribute: false })
	multiDiff?: { repoPath: string; lhs: string; rhs: string; wip?: boolean; title?: string };

	/** Opt-in for the bulk "Stage Current/Incoming for All Conflicts" toolbar buttons.
	 * Off by default — only the graph WIP panel wires the resolve-all events and only enables
	 * this when the paused operation is a rebase (the host bulk resolver bails otherwise),
	 * so leaving it false keeps the buttons hidden in the inspect view and during merge/
	 * cherry-pick/revert pauses where clicks would silently no-op. */
	@property({ type: Boolean, attribute: 'bulk-conflict-actions' })
	bulkConflictActions = false;

	/** Opt-in for the toolbar "Resolve Conflicts" button (fires `resolve-conflicts`). Set true only
	 *  by hosts that route it into AI resolve mode (the graph WIP details when `aiEnabled`); off
	 *  everywhere else so it never renders as a dead button. */
	@property({ type: Boolean, attribute: 'resolve-enabled' })
	resolveEnabled = false;

	/** Repo-relative normalized paths the connected agent(s) are actively editing, mapped to the
	 *  agent's phase. Pass-through to `gl-file-tree-pane`. */
	@property({ attribute: false })
	agentTouchedFiles?: ReadonlyMap<string, AgentSessionPhase>;

	/**
	 * Controlled-when-bound: parent-supplied visibility of the file-tree search box. Forwarded
	 * to `gl-file-tree-pane`. Hosts that leave it undefined get the uncontrolled default.
	 */
	@property({ attribute: 'show-search-box', type: Boolean })
	showSearchBox?: boolean;

	/** Controlled-when-bound: parent-supplied search-box filter mode (`true` = filter, `false` = highlight). */
	@property({ type: Boolean, attribute: 'search-box-filter' })
	searchBoxFilter?: boolean;

	private _effectiveFiles: Files = [];
	private _effectiveStates?: Map<
		string,
		{ state?: 'checked' | 'mixed'; disabled?: boolean; disabledReason?: string }
	>;
	private _grouping?: { getGroup: (file: FileItem) => string; groups: FileGroup[] };
	private _wrappedActions:
		| TreeItemAction[]
		| ((file: FileItem, options?: Partial<TreeItemBase>) => TreeItemAction[])
		| undefined;
	private _wrappedContext: ((file: FileItem, options?: Partial<TreeItemBase>) => string | undefined) | undefined;
	/** Paths with both staged and unstaged hunks. Computed in checkbox mode during dedup; kept on
	 *  the instance so the dispatch overrides for `file-compare-wip` (alt-click) and
	 *  `file-compare-wip-staged` (inline button) can recognize the deduped row as mixed. */
	private _mixedPaths: Set<string> = new Set();

	/** The inner tree's current multi-selection (≥2 = selection-aware toolbar). Mirrored up from
	 *  `gl-file-tree-pane`'s `file-selection-changed` so the Stash/Copy toolbar buttons can act on the
	 *  selection (primary) and fall back to the scope action on Alt — like "Open Selected Changes". */
	@state()
	private _selectedFiles: readonly FileItem[] = [];

	override willUpdate(changedProperties: PropertyValues): void {
		if (
			!changedProperties.has('files') &&
			!changedProperties.has('checkable') &&
			!changedProperties.has('checkableStates') &&
			!changedProperties.has('checkableStateDefault') &&
			!changedProperties.has('fileActions') &&
			!changedProperties.has('fileContext')
		) {
			return;
		}

		const files = (this.files as Files) ?? [];

		let effectiveFiles: Files;
		let effectiveStates: Map<string, { state?: 'checked' | 'mixed'; disabled?: boolean }> | undefined;
		let grouping: { getGroup: (file: FileItem) => string; groups: FileGroup[] } | undefined;
		let mixedPaths: Set<string> = new Set();

		if (this.checkable) {
			// In checkbox mode, deduplicate files and compute mixed states
			const dedup = this.deduplicateFiles(files);
			const deduped = dedup.deduped;
			mixedPaths = dedup.mixedPaths;
			effectiveFiles = deduped;

			// Merge computed mixed states into caller-provided checkableStates
			if (mixedPaths.size > 0 || this.checkableStates) {
				effectiveStates = new Map(this.checkableStates);
				for (const path of mixedPaths) {
					const existing = effectiveStates.get(path);
					effectiveStates.set(path, { ...existing, state: 'mixed' });
				}
			} else {
				effectiveStates = this.checkableStates;
			}

			// Default: staged files are checked
			if (!this.checkableStateDefault) {
				// Build states from staging when no explicit states provided
				for (const f of deduped) {
					if (!effectiveStates?.has(f.path) && !mixedPaths.has(f.path)) {
						effectiveStates ??= new Map();
						if (f.staged) {
							effectiveStates.set(f.path, { state: 'checked' });
						}
					}
				}
			}
		} else {
			// Non-checkbox mode: group conflicts above staged/unstaged so unresolved files
			// surface at the top.
			effectiveFiles = files;
			effectiveStates = this.checkableStates;
			grouping = {
				getGroup: (file: FileItem) =>
					isConflictStatus(file.status) ? 'conflicts' : file.staged ? 'staged' : 'unstaged',
				groups: [
					{ key: 'conflicts', label: 'Conflicts', actions: [] },
					{ key: 'staged', label: 'Staged Changes', actions: this.getStagedActions() },
					{ key: 'unstaged', label: 'Unstaged Changes', actions: this.getUnstagedActions() },
				],
			};
		}

		// When a file appears in BOTH staged and unstaged, downstream action callbacks need to
		// know so they can offer Stage AND Unstage actions instead of one inferred from the
		// canonical (unstaged) FileItem we kept during dedup.
		const callerActions = this.fileActions;
		this._wrappedActions =
			typeof callerActions === 'function'
				? (file, options) => callerActions(file, { ...(options ?? {}), mixed: mixedPaths.has(file.path) })
				: callerActions;

		// Same mixed injection for the context callback, so getFileContext can tag the deduped row
		// `+mixed` from the dedup's single source of truth instead of re-deriving it.
		const callerContext = this.fileContext;
		this._wrappedContext = callerContext
			? (file, options) => callerContext(file, { ...(options ?? {}), mixed: mixedPaths.has(file.path) })
			: undefined;

		this._effectiveFiles = effectiveFiles;
		this._effectiveStates = effectiveStates;
		this._grouping = grouping;
		this._mixedPaths = mixedPaths;
	}

	override render() {
		const files = (this.files as Files) ?? [];
		const multiDiff = this.multiDiff;

		// Mid-conflict (paused rebase/merge), a bulk Discard or Stash would blow away the in-progress
		// resolution, so hide both — staging/resolve actions and Open/Copy stay.
		const hasConflicts = files.some(f => isConflictStatus(f.status));

		const hasStagedAndUnstaged = this.hasStagedAndUnstaged;
		// Primary action label always set; alt label only when both staged + unstaged changes exist.
		// Both flow into gl-action-chip's `label`/`alt-label`, which composes the tooltip, swaps live
		// when Alt is held, and keeps the aria-label single-action.
		const multiDiffLabel = hasStagedAndUnstaged ? 'Open Staged Changes' : 'Open All Changes';
		const multiDiffAltLabel = hasStagedAndUnstaged ? 'Open Unstaged Changes' : undefined;

		// With ≥2 rows selected the Discard/Stash/Copy toolbar buttons act on the selection (primary),
		// demoting the scope action (staged-aware, the no-selection primary) to Alt — mirrors "Open
		// Selected Changes".
		const hasSelection = this.hasMultiSelection;
		// The scope action shown/run on the demoted Alt slot (and as primary when nothing is selected).
		const stashScopeLabel = hasStagedAndUnstaged ? 'Stash Staged Changes' : 'Stash All Changes';

		return html`<gl-file-tree-pane
			.files=${this._effectiveFiles}
			.collapsable=${this.collapsable}
			?show-file-icons=${this.showFileIcons}
			.searchContext=${this.searchContext}
			.fileActions=${this._wrappedActions}
			.fileContext=${this._wrappedContext}
			.contextRevision=${this.contextRevision}
			.folderContext=${this.folderContext}
			.filesLayout=${this.preferences?.files}
			.showIndentGuides=${this.preferences?.indentGuides}
			.orderBy=${this.preferences?.workingFilesOrderBy}
			?sort-by-stage=${this.preferences?.workingChangesSortBy !== 'flat'}
			.mixedPaths=${this._mixedPaths}
			.grouping=${this._grouping}
			?checkable=${this.checkable}
			?multi-selectable=${this.multiSelectable}
			.checkableStates=${this._effectiveStates}
			.checkableStateDefault=${this.checkableStateDefault}
			.agentTouchedFiles=${this.agentTouchedFiles}
			.showSearchBox=${this.showSearchBox}
			.searchBoxFilter=${this.searchBoxFilter}
			empty-text=${this.emptyText}
			selection-badge-label="Staged"
			selection-action="file-compare-wip"
			check-verb="Stage"
			uncheck-verb="Unstage"
			@gl-check-all=${this.onCheckAll}
			@file-selection-changed=${this.onFileSelectionChanged}
			@file-compare-wip=${this.onFileCompareWip}
			@file-compare-wip-staged=${this.onFileCompareWipStaged}
		>
			<span class="subtitle-stats" slot="subtitle">${this.renderStats()}</span>
			${this.renderResolveConflictsAction(files)}${this.renderConflictBulkActions(files)}
			${
				files.length > 0
					? html`<div class="wip-actions" slot="leading-actions">
							${
								hasConflicts
									? nothing
									: html`${this.renderDiscardUnstagedAction(files)}
											<gl-action-chip
												icon="gl-stash-save"
												label=${hasSelection ? 'Stash Selected Changes' : stashScopeLabel}
												alt-label=${
													hasSelection
														? stashScopeLabel
														: hasStagedAndUnstaged
															? 'Stash All Changes'
															: nothing
												}
												@click=${this.onStashSave}
											>
												<span class="stash-label">Stash</span>
											</gl-action-chip>`
							}
							${
								multiDiff
									? renderOpenChangesAction({
											label: multiDiffLabel,
											altLabel: multiDiffAltLabel,
											// Resolved, not the raw mirror — `onOpenSelectedChanges` opens the resolved
											// set, so counting the mirror could label a count it won't open.
											selectedCount: this.resolveSelectedFiles().length,
											onOpenAll: (altKey: boolean) => this.onOpenMultiDiff(multiDiff, altKey),
											onOpenSelected: () => this.onOpenSelectedChanges(multiDiff),
										})
									: nothing
							}
							${this.renderCopyPatchButton(hasStagedAndUnstaged, hasSelection)}
						</div>`
					: nothing
			}
			<slot name="before-tree" slot="before-tree"></slot>
		</gl-file-tree-pane>`;
	}

	private renderDiscardUnstagedAction(files: Files) {
		// The WIP feed (commit details / graph) emits TWO rows per mixed path — one with
		// staged=true, one with staged=false — so a single `!f.staged && !conflict` scan covers
		// purely-unstaged, untracked, AND the unstaged half of mixed files. If a future caller
		// switches to single-row mixed entries, this predicate will need to take the host's
		// mixed flag into account too.
		//
		// The button morphs: with unstaged content it discards that (preserving staged on mixed
		// files); with ONLY staged content left it switches to discarding the staged changes so it
		// isn't a dead end. Label/tooltip switch with it so the control always announces what it
		// will destroy. Conflicts are excluded from both modes.
		const hasUnstaged = files.some(f => !f.staged && !isConflictStatus(f.status));
		const hasStaged = files.some(f => f.staged && !isConflictStatus(f.status));
		// Unstaged takes precedence; the button only switches to staged-discard when nothing
		// unstaged remains, so it never destroys staged content while unstaged changes are present.
		const stagedOnly = !hasUnstaged && hasStaged;
		const scopeLabel = stagedOnly ? 'Discard Staged Changes' : 'Discard Unstaged Changes';
		// Same `> 1` selection gate as Stash/Copy. Reads the same gate the handlers do so the
		// announced label can't drift from what they run.
		const hasSelection = this.selectionForToolbarAction() != null;
		// Alt demotes to the scope action, mirroring Stash/Copy — the destructive click handlers
		// branch on `e.altKey` only (never Shift, the range-select key) and the host's confirmation
		// dialog is the safety net for that fallthrough. No alt-label without a selection: there's
		// no "Discard All" scope action to fall back to below the scope action itself.
		return html`<gl-action-chip
			icon="discard"
			label=${hasSelection ? 'Discard Selected Changes' : scopeLabel}
			alt-label=${hasSelection ? scopeLabel : nothing}
			?disabled=${!hasUnstaged && !hasStaged}
			@click=${stagedOnly ? this.onDiscardStaged : this.onDiscardUnstaged}
		></gl-action-chip>`;
	}

	private renderCopyPatchButton(hasStagedAndUnstaged: boolean, hasSelection: boolean) {
		// Need a repoPath to dispatch — fall back to the first file's repoPath if `multiDiff` is
		// undefined (multiDiff is only set when the host wires multi-diff refs, but the Copy
		// button is independent of that flow and should still work).
		const repoPath = this.multiDiff?.repoPath ?? this.files?.find(f => f.repoPath)?.repoPath;
		if (!repoPath) return nothing;

		// The scope action (staged-aware, the no-selection primary) — runs as primary when nothing is
		// selected, and demotes to the Alt slot when a selection is active.
		const scopeLabel = hasStagedAndUnstaged ? 'Copy Staged Changes (Patch)' : 'Copy All Changes (Patch)';

		// With ≥2 rows selected the primary copies the selection and Alt falls back to the scope action
		// (mirrors "Open Selected Changes"). Otherwise the chip's alt-label drives the live staged↔
		// unstaged Alt-swap (primary = staged, Alt = unstaged) — matching the Open Multi-Diff chip — or
		// is a plain "Copy All Changes (Patch)" with no alt action.
		return html`<gl-action-chip
			icon="copy"
			label=${hasSelection ? 'Copy Selected Changes (Patch)' : scopeLabel}
			alt-label=${hasSelection ? scopeLabel : hasStagedAndUnstaged ? 'Copy Unstaged Changes (Patch)' : nothing}
			@click=${(e: MouseEvent) => this.onCopyPatch(e, repoPath)}
		></gl-action-chip>`;
	}

	private renderResolveConflictsAction(files: Files) {
		if (!this.resolveEnabled || !files.some(f => isConflictStatus(f.status))) return nothing;

		return html`<gl-action-chip
			slot="leading-actions"
			icon="gl-merge"
			label="Resolve Conflicts"
			@click=${this.onResolveConflicts}
			><span>Resolve Conflicts</span></gl-action-chip
		>`;
	}

	private onResolveConflicts = () => {
		this.dispatchEvent(new CustomEvent('resolve-conflicts', { bubbles: true, composed: true }));
	};

	private renderConflictBulkActions(files: Files) {
		if (!this.bulkConflictActions || !files.some(f => isConflictStatus(f.status))) return nothing;

		return html`<gl-action-chip
				slot="leading-actions"
				icon="gl-accept-all-left"
				label="Stage Current for All Conflicts"
				@click=${this.onResolveAllCurrent}
			></gl-action-chip>
			<gl-action-chip
				slot="leading-actions"
				icon="gl-accept-all-right"
				label="Stage Incoming for All Conflicts"
				@click=${this.onResolveAllIncoming}
			></gl-action-chip>`;
	}

	private onResolveAllCurrent = () => {
		this.dispatchEvent(new CustomEvent('resolve-all-current', { bubbles: true, composed: true }));
	};

	private onResolveAllIncoming = () => {
		this.dispatchEvent(new CustomEvent('resolve-all-incoming', { bubbles: true, composed: true }));
	};

	private onFileSelectionChanged = (e: CustomEvent<{ files: readonly FileItem[] }>): void => {
		this._selectedFiles = e.detail?.files ?? [];
	};

	/** Re-resolves the selection's paths against the CURRENT `this.files`, rather than trusting the
	 *  `FileItem` objects already sitting in `_selectedFiles` — those are only refreshed when
	 *  `gl-file-tree-pane` re-emits `file-selection-changed`, which it does only when the selected
	 *  id-set itself changes. A model swap (e.g. a different repo/worktree) whose dirty paths happen
	 *  to overlap won't re-emit, so the stale objects can carry the previous model's shapes —
	 *  including a stale `repoPath` a host could resolve the wrong target repo from. Shared by
	 *  `onOpenSelectedChanges` and the discard handlers so "what's currently selected" can't diverge
	 *  between them.
	 *
	 *  Goes through `selectFilesByPath` so each path is carried once — the raw file list holds TWO
	 *  entries for a mixed path, which would otherwise count one selected row as two and hand Stash
	 *  and Copy the same path twice. */
	private resolveSelectedFiles(): readonly FileItem[] {
		return selectFilesByPath(this.files, new Set(this._selectedFiles.map(f => f.path)));
	}

	/** The re-resolved selection when the toolbar chips should act on it (the `hasMultiSelection`
	 *  gate), otherwise `undefined` for "run the scope action". One resolve per click, so the set a
	 *  handler acts on is exactly the one the gate was evaluated against. */
	private selectionForToolbarAction(): readonly FileItem[] | undefined {
		if (!this.multiSelectable) return undefined;

		const files = this.resolveSelectedFiles();
		return files.length > 1 ? files : undefined;
	}

	private onStashSave(e: MouseEvent) {
		// With a multi-selection, the primary stashes just the selected files; Alt falls back to the
		// scope action below (mirrors "Open Selected Changes"). Ships the re-resolved set, not the
		// `_selectedFiles` mirror — the host reads the repo off `files[0].repoPath`, so a stale entry
		// would stash in the repo the pane was showing before the model swapped.
		const selected = this.selectionForToolbarAction();
		const hasSelection = selected != null;
		if (selected != null && e.altKey !== true) {
			this.dispatchEvent(
				new CustomEvent('stash-save', {
					detail: { files: selected },
					bubbles: true,
					composed: true,
				}),
			);
			return;
		}

		// No selection: mixed staged + unstaged → primary stashes only staged, Alt stashes all; else stash
		// all. Selection + Alt collapses to the no-selection primary (staged when mixed, else all).
		const onlyStaged = this.hasStagedAndUnstaged && (hasSelection || e.altKey !== true);
		this.dispatchEvent(
			new CustomEvent('stash-save', { detail: { onlyStaged: onlyStaged }, bubbles: true, composed: true }),
		);
	}

	private onDiscardUnstaged(e: MouseEvent) {
		// With a multi-selection, the primary discards just the selected files; Alt falls back to the
		// scope action below (mirrors Stash/Copy). Branches on `e.altKey` only — Shift is the
		// range-select key and must never widen a destructive action, so an accidental Shift held
		// into the click stays scoped to the selection. The host's confirmation dialog is the safety
		// net for the Alt fallthrough. The host resolves staged vs unstaged per file, so this branch
		// is identical to `onDiscardStaged`'s.
		//
		// Resolved once here and gated on the same rule the chip's label reads, so the selection can't
		// be re-resolved to a different set between the two.
		const selected = this.selectionForToolbarAction();
		if (selected != null && e.altKey !== true) {
			this.dispatchEvent(
				new CustomEvent('discard-unstaged', { detail: { files: selected }, bubbles: true, composed: true }),
			);
			return;
		}

		this.dispatchEvent(new CustomEvent('discard-unstaged', { bubbles: true, composed: true }));
	}

	private onDiscardStaged(e: MouseEvent) {
		// Same selection branch as `onDiscardUnstaged`, including its Alt-demotes/Shift-ignored and
		// resolve-once rules — only the scope fallback differs.
		const selected = this.selectionForToolbarAction();
		if (selected != null && e.altKey !== true) {
			this.dispatchEvent(
				new CustomEvent('discard-staged', { detail: { files: selected }, bubbles: true, composed: true }),
			);
			return;
		}

		this.dispatchEvent(new CustomEvent('discard-staged', { bubbles: true, composed: true }));
	}

	private onOpenMultiDiff(
		refs: { repoPath: string; lhs: string; rhs: string; wip?: boolean; title?: string },
		altKey: boolean,
	): void {
		const files = this.files;
		if (!files?.length) return;

		const scope = this.resolveScope(altKey);
		const filtered = this.filterFilesByScope(files, scope);
		if (!filtered.length) return;

		const title = this.buildScopedTitle(refs.title ?? 'Working Changes', scope);

		this.dispatchEvent(
			new CustomEvent('open-multiple-changes', {
				detail: {
					files: filtered,
					repoPath: refs.repoPath,
					lhs: refs.lhs,
					rhs: refs.rhs,
					wip: refs.wip,
					title: title,
				} satisfies OpenMultipleChangesArgs,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onOpenSelectedChanges(refs: {
		repoPath: string;
		lhs: string;
		rhs: string;
		wip?: boolean;
		title?: string;
	}): void {
		// Rows, not files: a mixed path occupies two rows and each is its own diff (`staged: true` →
		// HEAD↔index, `staged: false` → index↔working, per `openWipMultipleChanges`), so de-duping
		// here would open only the staged half. Everything that acts on the selection as a set of
		// files uses `resolveSelectedFiles` instead.
		const files = selectRowsByPath(this.files, new Set(this._selectedFiles.map(f => f.path)));
		if (!files.length) return;

		this.dispatchEvent(
			new CustomEvent('open-multiple-changes', {
				detail: {
					files: files,
					repoPath: refs.repoPath,
					lhs: refs.lhs,
					rhs: refs.rhs,
					wip: refs.wip,
					title: refs.title,
				} satisfies OpenMultipleChangesArgs,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onCopyPatch(e: MouseEvent, repoPath: string): void {
		// With a multi-selection, the primary copies a combined HEAD↔working patch of just the selected
		// files (scope `all` + the selected paths as pathspec); Alt falls back to the scope action below
		// (mirrors "Open Selected Changes").
		// Re-resolved rather than the `_selectedFiles` mirror, for the same reason as Stash — and
		// resolved once so the gate and the pathspecs can't come from different sets.
		const selected = this.selectionForToolbarAction();
		const hasSelection = selected != null;
		if (selected != null && e.altKey !== true) {
			this.dispatchEvent(
				new CustomEvent('copy-wip-patch', {
					detail: {
						repoPath: repoPath,
						scope: 'all',
						uris: selected.flatMap(f => getFileDiffPathspecs(f)),
					} satisfies CopyWipPatchEventDetail,
					bubbles: true,
					composed: true,
				}),
			);
			return;
		}

		// Selection + Alt collapses to the no-selection primary scope (staged when mixed, else all).
		const scope = this.resolveScope(hasSelection ? false : e.altKey === true);
		// For staged/unstaged scopes, pass the scope-filtered file paths through so the
		// host-side `getDiff` uses pathspec to constrain output to exactly those files —
		// matches the file set the Open Multi-Diff button opens for the same scope, and
		// keeps merge-conflict files out of the 'unstaged' patch (raw `git diff` would
		// otherwise emit the conflict's combined-diff regardless of intent).
		let uris: readonly string[] | undefined;
		if (scope !== 'all') {
			const files = this.files;
			if (files?.length) {
				uris = this.filterFilesByScope(files, scope).flatMap(f => getFileDiffPathspecs(f));
			}
		}
		this.dispatchEvent(
			new CustomEvent('copy-wip-patch', {
				detail: { repoPath: repoPath, scope: scope, uris: uris } satisfies CopyWipPatchEventDetail,
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** True when ≥2 rows are selected in multi-selectable mode — the single gate for whether the
	 *  Discard/Stash/Copy toolbar chips act on the selection instead of the scope action, both in
	 *  their rendered label and in their click handler. `> 1` matches `gl-file-tree-pane`'s
	 *  `showOpenSelected` gate. One getter, used everywhere the gate is read, so a chip's announced
	 *  label can never drift from what its handler actually does.
	 *
	 *  Derived from `resolveSelectedFiles()` — the SAME re-resolved-against-`this.files` set the
	 *  discard handlers act on — rather than the raw `_selectedFiles` mirror, which can be stale
	 *  against a swapped model (see `resolveSelectedFiles`'s doc comment). Reading the raw mirror
	 *  here let the chip announce "Discard Selected Changes" for a selection that had already
	 *  resolved to nothing, so the click did silently nothing. WIP file lists are small, so the
	 *  extra filter per read is cheap; no caching. Shares `selectionForToolbarAction` with the click
	 *  handlers so the label and the action apply literally the same gate. */
	private get hasMultiSelection(): boolean {
		return this.selectionForToolbarAction() != null;
	}

	/** True when BOTH staged and unstaged changes are present — the Copy/Open buttons then surface a
	 *  staged(primary)/unstaged(Alt) choice. Otherwise they fall back to the single `all` action.
	 *
	 *  Derived from raw `this.files` (pre-dedup) on every read using two short-circuit `.some()`
	 *  scans. Reading from raw files (NOT `_effectiveFiles`) matters because checkbox-mode dedup
	 *  collapses mixed files to a single `staged: false` row, which would undercount staged
	 *  presence. Conflicts count as `staged`-needing-attention per the smart-button rules. */
	private get hasStagedAndUnstaged(): boolean {
		const files = this.files;
		if (!files?.length) return false;

		const hasStaged = files.some(f => isConflictStatus(f.status) || f.staged === true);
		if (!hasStaged) return false;
		return files.some(f => !isConflictStatus(f.status) && f.staged !== true);
	}

	private resolveScope(altKey: boolean): WipScope {
		if (!this.hasStagedAndUnstaged) return 'all';
		return altKey ? 'unstaged' : 'staged';
	}

	private filterFilesByScope(files: readonly FileItem[], scope: WipScope): readonly FileItem[] {
		if (scope === 'all') return files;
		if (scope === 'staged') {
			return files.filter(f => isConflictStatus(f.status) || f.staged === true);
		}
		return files.filter(f => !isConflictStatus(f.status) && f.staged !== true);
	}

	private buildScopedTitle(baseTitle: string, scope: WipScope): string {
		switch (scope) {
			case 'staged':
				return `${baseTitle} (Staged)`;
			case 'unstaged':
				return `${baseTitle} (Unstaged)`;
			default:
				return baseTitle;
		}
	}

	private renderStats() {
		return renderCommitStatsIcons(this.stats) ?? nothing;
	}

	private deduplicateFiles(files: Files): { deduped: Files; mixedPaths: Set<string> } {
		const deduped: Files = [];
		const mixedPaths = new Set<string>();
		const seen = new Map<string, number>();

		for (const f of files) {
			const idx = seen.get(f.path);
			if (idx != null) {
				mixedPaths.add(f.path);
				// Keep the unstaged version as canonical so single-row mixed files expose
				// `staged: false` — matching the `unstaged > staged > committed` precedence
				// applied by the AI-compose path (see `anchorRank` in graphWebview.ts).
				// Inline tree actions still see `options.mixed === true` (wrapped above) and
				// offer both Stage and Unstage; this only fixes the right-click menu, which
				// keys off `webviewItem` derived from `file.staged`.
				if (!f.staged && deduped[idx].staged) {
					deduped[idx] = f;
				}
			} else {
				seen.set(f.path, deduped.length);
				deduped.push(f);
			}
		}

		return { deduped: deduped, mixedPaths: mixedPaths };
	}

	private getStagedActions(): TreeItemAction[] {
		return [
			{
				icon: 'gl-cloud-patch-share',
				label: 'Share Staged Changes',
				action: 'staged-create-patch',
			},
		];
	}

	private getUnstagedActions(): TreeItemAction[] {
		return [
			{
				icon: 'gl-cloud-patch-share',
				label: 'Share Unstaged Changes',
				action: 'unstaged-create-patch',
			},
		];
	}

	private onCheckAll(e: CustomEvent<{ checked: boolean }>): void {
		e.stopPropagation();

		this.dispatchEvent(
			new CustomEvent(e.detail.checked ? 'stage-all' : 'unstage-all', {
				bubbles: true,
				composed: true,
			}),
		);
	}

	/**
	 * Forks the default WIP row click so:
	 *  - Conflicted rows fall back to `file-open` (the conflict markers are easier to deal with in
	 *    the file itself than in a diff).
	 *  - Mixed rows with Alt held flip the dispatched event to the staged-portion diff
	 *    (HEAD ↔ index) — independent of the natural staged flag carried by the deduped canonical
	 *    row, which always points at the unstaged portion. The `viewColumn` is cleared so Alt
	 *    means "open staged" and *not* the global "open in side editor" — the user is choosing one
	 *    semantic over the other for this surface.
	 *  - All other rows fall through untouched so the host's `file-compare-wip` handler resolves
	 *    them via the file's natural `staged` flag.
	 */
	private onFileCompareWip = (e: CustomEvent<FileChangeListItemDetail>): void => {
		const detail = e.detail;
		if (isConflictStatus(detail.status)) {
			e.stopPropagation();
			this.dispatchEvent(new CustomEvent('file-open', { detail: detail, bubbles: true, composed: true }));
			return;
		}

		if (detail.altKey && this._mixedPaths.has(detail.path)) {
			e.stopPropagation();
			this.dispatchFileCompareWipStaged(detail, { clearViewColumn: true });
		}
	};

	/** Bridge the inline "Open Staged Changes" button (`file-compare-wip-staged`) into the host's
	 *  `file-compare-wip` listener with `staged: true` overridden so the diff resolves to staged ↔
	 *  HEAD regardless of the row's canonical staged flag (unstaged for deduped mixed rows).
	 *  `viewColumn` is preserved so Alt+click on the button keeps its standard "open in side
	 *  editor" meaning — the button already encodes the "open staged" intent. */
	private onFileCompareWipStaged = (e: CustomEvent<FileChangeListItemDetail>): void => {
		e.stopPropagation();
		this.dispatchFileCompareWipStaged(e.detail);
	};

	private dispatchFileCompareWipStaged(
		detail: FileChangeListItemDetail,
		options?: { clearViewColumn?: boolean },
	): void {
		const showOptions =
			detail.showOptions != null && options?.clearViewColumn
				? { ...detail.showOptions, viewColumn: undefined }
				: detail.showOptions;
		this.dispatchEvent(
			new CustomEvent('file-compare-wip', {
				detail: { ...detail, staged: true, showOptions: showOptions } satisfies FileChangeListItemDetail,
				bubbles: true,
				composed: true,
			}),
		);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-wip-tree-pane': GlWipTreePane;
	}
}
