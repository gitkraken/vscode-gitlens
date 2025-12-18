import './rebase.scss';
import type { LitVirtualizer } from '@lit-labs/virtualizer';
import { flow } from '@lit-labs/virtualizer/layouts/flow.js';
import type SlSelect from '@shoelace-style/shoelace/dist/components/select/select.js';
import type { PropertyValues } from 'lit';
import { html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { guard } from 'lit/directives/guard.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { RebaseTodoCommitAction } from '../../../git/models/rebase';
import { filterMap } from '../../../system/iterable';
import { pluralize } from '../../../system/string';
import { createWebviewCommandLink } from '../../../system/webview';
import type { RebaseActiveStatus, RebaseCommitEntry, RebaseEntry, State } from '../../rebase/protocol';
import {
	AbortCommand,
	ChangeEntriesCommand,
	ChangeEntryCommand,
	ContinueCommand,
	isCommandEntry,
	isCommitEntry,
	MoveEntriesCommand,
	MoveEntryCommand,
	RecomposeCommand,
	ReorderCommand,
	RevealRefCommand,
	SearchCommand,
	ShiftEntriesCommand,
	SkipCommand,
	StartCommand,
	SwitchCommand,
	UpdateSelectionCommand,
} from '../../rebase/protocol';
import { GlAppHost } from '../shared/appHost';
import { scrollableBase } from '../shared/components/styles/lit/base.css';
import type { LoggerContext } from '../shared/contexts/logger';
import type { HostIpc } from '../shared/ipc';
import type { GlRebaseEntryElement } from './components/rebase-entry';
import { rebaseStyles } from './rebase.css';
import { RebaseStateProvider } from './stateProvider';
import '@lit-labs/virtualizer';
import './components/conflict-indicator';
import './components/rebase-entry';
import '../shared/components/banner/banner';
import '../shared/components/branch-name';
import '../shared/components/button';
import '../shared/components/checkbox/checkbox';
import '../shared/components/commit-sha';
import '../shared/components/overlays/popover-confirm';
import '../shared/components/overlays/tooltip';

const scrollZonePx = 80;
const scrollSpeedPx = 8;

/** Action shortcut keys (only for commit entries) */
const actionKeyMap: Record<string, RebaseTodoCommitAction> = {
	p: 'pick',
	P: 'pick',
	r: 'reword',
	R: 'reword',
	e: 'edit',
	E: 'edit',
	s: 'squash',
	S: 'squash',
	f: 'fixup',
	F: 'fixup',
	d: 'drop',
	D: 'drop',
};

@customElement('gl-rebase-editor')
export class GlRebaseEditor extends GlAppHost<State, RebaseStateProvider> {
	static override styles = [scrollableBase, rebaseStyles];

	@query('lit-virtualizer')
	private readonly _virtualizer?: LitVirtualizer;
	private readonly virtualizerKeyFn = (entry: RebaseEntry) => entry.id;
	private readonly virtualizerRenderFn = (entry: RebaseEntry, index: number) => this.renderEntry(entry, index);

	@query('#header-conflict-indicator')
	private readonly _conflictIndicator?: any;

	/** Track conflict indicator state for reactive updates */
	@state() private _conflictIndicatorLoading = false;
	@state() private _conflictIndicatorHasConflicts = false;

	/** Drag state - uses direct DOM manipulation to avoid re-renders during drag */
	private draggedId: string | undefined;
	private dragOverId: string | undefined;
	private dragOverBottom = false; // true = insert after target, false = insert before

	/** Entry ID to focus after next render (set before state updates for focus restoration) */
	private pendingFocusId: string | undefined;

	/** Anchor entry ID for multi-select range - set when shift-selecting */
	private anchoredEntryId: string | undefined;
	/** Currently focused entry ID - updated on focus changes */
	private focusedEntryId: string | undefined;

	/** Selection state for multi-select - uses @state for automatic updates */
	@state() private selectedIds: Set<string> = new Set();

	/** Conflict detection stale state - set when commits are dropped */
	@state() private conflictDetectionStale = false;

	/** Cached values computed in willUpdate for performance */
	private _idToSortedIndex = new Map<string, number>();
	private _oldestCommitId: string | undefined;
	private _sortedEntries: RebaseEntry[] = [];
	private _squashingIds = new Set<string>();
	private _squashTargetIds = new Set<string>();
	/**
	 * Number of non-editable entries (base + done) at the start of _sortedEntries.
	 * In ascending mode, non-editable entries are at the start.
	 * In descending mode, they are at the end (reversed), so this is 0 for index calculations.
	 */
	private _editableStartOffset = 0;

	private get ascending(): boolean {
		return this.state?.ascending ?? false;
	}

	private get entries(): RebaseEntry[] {
		return this.state?.entries ?? [];
	}

	private get doneEntries(): RebaseEntry[] {
		return this.state?.doneEntries ?? [];
	}

	private get rebaseStatus(): RebaseActiveStatus | undefined {
		return this.state?.rebaseStatus;
	}

	private get isActiveRebase(): boolean {
		return this.rebaseStatus != null;
	}

	private get isEmptyOrNoop(): boolean {
		const { entries, doneEntries } = this;

		// Not empty if we have done entries (active rebase with completed commits)
		if (doneEntries.length) return false;

		return (
			!entries.length || (entries.length === 1 && entries[0].type === 'command' && entries[0].action === 'noop')
		);
	}

	protected override createStateProvider(
		bootstrap: string,
		ipc: HostIpc,
		logger: LoggerContext,
	): RebaseStateProvider {
		return new RebaseStateProvider(this, bootstrap, ipc, logger);
	}

	override connectedCallback(): void {
		super.connectedCallback?.();
		document.addEventListener('keydown', this.onDocumentKeyDown);
	}

	override disconnectedCallback(): void {
		document.removeEventListener('keydown', this.onDocumentKeyDown);
		super.disconnectedCallback?.();
	}

	private onListKeyDown = (e: KeyboardEvent) => {
		// Ctrl/Cmd+A: select all entries
		if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
			e.preventDefault();
			// Select all entries (excluding base commit if present)
			const baseId = this.state?.onto?.sha;
			const selectableIds = this._sortedEntries.filter(entry => entry.id !== baseId).map(entry => entry.id);
			this.selectedIds = new Set(selectableIds);
			return;
		}

		// Escape: return focus to the entry row from any inner element (select, link, etc.)
		if (e.key === 'Escape') {
			const entryEl = e
				.composedPath()
				.find((el): el is GlRebaseEntryElement => el instanceof Element && el.localName === 'gl-rebase-entry');
			const entryRow = entryEl?.shadowRoot?.querySelector<HTMLElement>('.entry');
			if (entryRow) {
				e.preventDefault();
				entryRow.focus();
			}
			return;
		}

		// If focus is inside a select, let it handle the event
		if (e.composedPath().some(el => el instanceof Element && el.matches('.action-select'))) return;

		const id = this.focusedEntryId;
		if (!id) return;

		const focusedEntry = this.shadowRoot?.querySelector<GlRebaseEntryElement>(`gl-rebase-entry[data-id="${id}"]`);
		if (!focusedEntry) return;

		if (e.key === 'Enter' || e.key === ' ') {
			// Only handle when the entry row itself has focus, not interactive elements within it
			const target = e.composedPath()[0];
			if (!(target instanceof HTMLElement && target.classList.contains('entry'))) return;

			e.preventDefault();

			// If focused entry is not selected, select it (clearing other selections)
			if (!this.selectedIds.has(id)) {
				this.selectedIds = new Set([id]);
				this.anchoredEntryId = id;

				// Notify host of selection change (only for commit entries)
				const sortedIndex = this._idToSortedIndex.get(id) ?? -1;
				if (sortedIndex !== -1) {
					const entry = this._sortedEntries[sortedIndex];
					if (isCommitEntry(entry)) {
						this._ipc.sendCommand(UpdateSelectionCommand, { sha: entry.sha });
					}
				}
				return;
			}

			// If already selected, open the action dropdown
			const actionSelect = focusedEntry.shadowRoot?.querySelector<SlSelect>('.action-select');
			if (actionSelect != null) {
				actionSelect.focus();
				// Use requestAnimationFrame to ensure focus is processed before show
				requestAnimationFrame(() => void actionSelect.show());
			}

			return;
		}

		const sortedIndex = this._idToSortedIndex.get(id) ?? -1;
		if (sortedIndex === -1) return;

		const entry = this._sortedEntries[sortedIndex];

		// Single letter action shortcuts (only for commit entries, no modifiers)
		if (isCommitEntry(entry) && e.key in actionKeyMap && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
			e.preventDefault();
			e.stopPropagation();

			this.onActionChanged(
				new CustomEvent('action-changed', {
					detail: { sha: entry.sha, action: actionKeyMap[e.key] },
				}),
			);
			return;
		}

		// Home/End: jump to first/last entry
		if (e.key === 'Home' || e.key === 'End') {
			e.preventDefault();

			const targetIndex = e.key === 'Home' ? 0 : this._sortedEntries.length - 1;
			if (targetIndex >= 0 && targetIndex < this._sortedEntries.length) {
				this.focusEntry(this._sortedEntries[targetIndex].id);
			}
			return;
		}

		// Only process navigation keys from here on
		if (!this.isNavigationKey(e.key)) return;

		// Alt+Arrow/J/K: move entry (only if not read-only)
		if (e.altKey && !this.state?.isReadOnly) {
			this.handleKeyboardMove(e, sortedIndex, e.key);
			return;
		}

		// Shift+Arrow/J/K: extend selection
		if (e.shiftKey) {
			this.handleKeyboardMultiSelect(e, sortedIndex, e.key);
			return;
		}

		// Arrow keys or j/k: navigate between entries
		this.handleKeyboardNavigate(e, sortedIndex, e.key);
	};

	private onListClick(e: MouseEvent): void {
		// Only handle clicks directly on the virtualizer (empty space), not on entries
		const entry = (e.target as HTMLElement).closest('gl-rebase-entry');
		if (entry) return;

		// Focus the currently focused entry, or first non-base entry if none
		if (this.focusedEntryId) {
			this.focusEntry(this.focusedEntryId);
		} else {
			const baseId = this.state?.onto?.sha;
			const firstFocusable = this._sortedEntries.find(e => e.id !== baseId);
			if (firstFocusable) {
				this.focusEntry(firstFocusable.id);
			}
		}
	}

	private onDragStart(e: DragEvent): void {
		const entry = (e.target as HTMLElement).closest('gl-rebase-entry') as GlRebaseEntryElement;
		// Use data-id attribute instead of .entry property - the .entry property can be stale
		// when lit-virtualizer recycles elements during scroll
		const entryId = entry?.dataset.id;
		if (!entryId) return;

		// Check if this is the base entry (base entries are not draggable)
		const baseId = this.state?.onto?.sha;
		if (baseId && entryId === baseId) return;

		// Don't allow dragging in read-only mode
		if (this.state?.isReadOnly) {
			e.preventDefault();
			return;
		}

		// If the dragged entry is not selected, clear selection and select it
		// This is standard list behavior - dragging an unselected item selects only that item
		if (!this.selectedIds.has(entryId)) {
			this.selectedIds = new Set([entryId]);
			this.anchoredEntryId = entryId;
		}

		this.draggedId = entryId;
		e.dataTransfer!.effectAllowed = 'move';
		e.dataTransfer!.setData('text/plain', entryId);

		// Delay adding class so drag image isn't affected
		requestAnimationFrame(() => {
			entry.classList.add('dragging');
			// Also mark other selected entries as dragging
			if (this.selectedIds.has(entryId) && this.selectedIds.size > 1) {
				for (const id of this.selectedIds) {
					if (id !== entryId) {
						const el = this.getEntryElement(id);
						el?.classList.add('dragging');
					}
				}
			}
		});
	}

	private onDragEnd(): void {
		this.clearDragState();
	}

	private onDragOver(e: DragEvent): void {
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'move';

		this.handleDragAutoScroll(e.clientY);

		const entry = (e.target as HTMLElement).closest('gl-rebase-entry') as GlRebaseEntryElement;
		// Use data-id attribute only - the .entry property can be stale when virtualizer recycles elements
		const entryId = entry?.dataset.id;

		// Don't show indicator on the dragged item itself
		if (entryId === this.draggedId) return;

		// Determine if mouse is in top or bottom half of entry
		// Check for base entry by comparing ID instead of using .isBase property (which can be stale)
		let isBottom = false;
		const baseId = this.state?.onto?.sha;
		if (entry && (!baseId || entryId !== baseId)) {
			const rect = entry.getBoundingClientRect();
			isBottom = e.clientY > rect.top + rect.height / 2;
		}

		this.updateDragOverIndicator(entryId, entry, isBottom);
	}

	private onDragLeave(e: DragEvent): void {
		const entry = (e.target as HTMLElement).closest('gl-rebase-entry') as GlRebaseEntryElement;
		// Use data-id attribute only - the .entry property can be stale when virtualizer recycles elements
		const entryId = entry?.dataset.id;
		if (entryId === this.dragOverId) {
			entry.classList.remove('drag-over', 'drag-over-bottom');
			this.dragOverId = undefined;
			this.dragOverBottom = false;
		}
	}

	private onDrop(e: DragEvent): void {
		e.preventDefault();

		const dropTarget = (e.target as HTMLElement).closest('gl-rebase-entry') as GlRebaseEntryElement;
		if (!this.isValidDropTarget(dropTarget)) {
			this.clearDragState();
			return;
		}

		// Read the dragged ID from dataTransfer - this is the authoritative source set at drag start
		// Fall back to this.draggedId for compatibility
		const draggedId = e.dataTransfer?.getData('text/plain') || this.draggedId;
		if (!draggedId) {
			this.clearDragState();
			return;
		}

		// Use data-id attribute instead of .entry property - the .entry property can be stale
		// when lit-virtualizer recycles elements during scroll
		const targetId = dropTarget.dataset.id;
		if (!targetId) {
			this.clearDragState();
			return;
		}

		// Check if dropping on base entry
		const baseId = this.state?.onto?.sha;
		if (baseId && targetId === baseId) {
			this.handleBaseDrop(draggedId);
			return;
		}

		// Work in display order (what the user sees), then convert to array indices
		const toSortedIndex = this._idToSortedIndex.get(targetId) ?? -1;

		// Calculate insertAfter from the actual drop position, not from cached dragOver state
		// This ensures accuracy even if dragOver events were missed or targeted different elements
		const rect = dropTarget.getBoundingClientRect();
		const insertAfter = e.clientY > rect.top + rect.height / 2;

		// Check if we're dragging a multi-selection
		if (this.selectedIds.has(draggedId) && this.selectedIds.size > 1) {
			this.clearDragState();
			this.executeMoveEntriesBySortedIndex(Array.from(this.selectedIds), toSortedIndex, insertAfter);
		} else {
			const fromSortedIndex = this._idToSortedIndex.get(draggedId) ?? -1;
			this.clearDragState();
			this.executeMoveEntryBySortedIndex(fromSortedIndex, toSortedIndex, insertAfter);
		}
	}

	/** Handles drop on base entry - moves to the position adjacent to base (index 0) */
	private handleBaseDrop(draggedId?: string): void {
		const id = draggedId ?? this.draggedId;
		if (!id) {
			this.clearDragState();
			return;
		}

		this.clearDragState();

		// Check if we're dragging a multi-selection
		if (this.selectedIds.has(id) && this.selectedIds.size > 1) {
			// Get entry IDs in array order (preserves relative order)
			const orderedIds = this.getIdsInArrayOrder(this.selectedIds);

			// Preserve focus
			this.pendingFocusId =
				this.focusedEntryId && this.selectedIds.has(this.focusedEntryId) ? this.focusedEntryId : orderedIds[0];

			// Move all selected entries to the start (index 0)
			this._stateProvider.moveEntries(orderedIds, 0);
			this.refreshIndices();
			this._ipc.sendCommand(MoveEntriesCommand, { ids: orderedIds, to: 0 });
		} else {
			const fromIndex = this.entries.findIndex(e => e.id === id);
			if (fromIndex === -1) return;

			// Move single entry to the start (index 0)
			this.executeMoveEntry(fromIndex, 0);
		}
	}

	// --- Drag Helpers ---

	private handleDragAutoScroll(clientY: number): void {
		if (!this._virtualizer) return;

		const rect = this._virtualizer.getBoundingClientRect();
		if (clientY < rect.top + scrollZonePx) {
			this._virtualizer.scrollBy({ top: -scrollSpeedPx, behavior: 'instant' });
		} else if (clientY > rect.bottom - scrollZonePx) {
			this._virtualizer.scrollBy({ top: scrollSpeedPx, behavior: 'instant' });
		}
	}

	private updateDragOverIndicator(
		id: string | undefined,
		entry: GlRebaseEntryElement | undefined,
		isBottom = false,
	): void {
		const changed = id !== this.dragOverId || isBottom !== this.dragOverBottom;
		if (!changed) return;

		// Remove old indicator
		if (this.dragOverId) {
			const oldEntry = this.getEntryElement(this.dragOverId);
			oldEntry?.classList.remove('drag-over', 'drag-over-bottom');
		}

		// Add new indicator
		this.dragOverId = id;
		this.dragOverBottom = isBottom;
		if (id && entry) {
			entry.classList.add('drag-over');
			if (isBottom) {
				entry.classList.add('drag-over-bottom');
			}
		}
	}

	private isValidDropTarget(target: GlRebaseEntryElement | undefined): boolean {
		// Use data-id attribute instead of .entry property - the .entry property can be stale
		// when lit-virtualizer recycles elements during scroll
		const targetId = target?.dataset.id;
		return Boolean(targetId && this.draggedId && targetId !== this.draggedId);
	}

	private clearDragState(): void {
		this.clearAllDragOverIndicators();
		this.clearDraggingClass();
		this.draggedId = undefined;
		this.dragOverId = undefined;
		this.dragOverBottom = false;
	}

	private clearAllDragOverIndicators(): void {
		if (!this._virtualizer) return;

		// Only clear drag-over indicators, not the dragging state
		for (const el of this._virtualizer.querySelectorAll('.drag-over')) {
			el.classList.remove('drag-over', 'drag-over-bottom');
		}
	}

	private clearDraggingClass(): void {
		if (!this._virtualizer) return;

		for (const el of this._virtualizer.querySelectorAll('.dragging')) {
			el.classList.remove('dragging');
		}
	}

	private getEntryElement(id: string): GlRebaseEntryElement | undefined {
		return this._virtualizer?.querySelector(`gl-rebase-entry[data-id="${id}"]`) ?? undefined;
	}

	/**
	 * Returns entry IDs in array order (suitable for moveEntries) given a set of IDs
	 * Entries are gathered in display order and reversed if descending to get array order
	 */
	private getIdsInArrayOrder(ids: Set<string>): string[] {
		const entries: RebaseEntry[] = [];
		for (const entry of this._sortedEntries) {
			if (ids.has(entry.id)) {
				entries.push(entry);
			}
		}
		// In descending mode, display order is reversed from array order
		if (!this.ascending) {
			entries.reverse();
		}
		return entries.map(e => e.id);
	}

	/**
	 * Executes a move operation using display order indices (for drag operations)
	 * Converts display indices to array indices accounting for ascending/descending order
	 * @param fromSortedIndex - Source index in display/sorted order
	 * @param toSortedIndex - Target entry index in display/sorted order
	 * @param insertAfter - If true, insert after the target; if false, insert before
	 */
	private executeMoveEntryBySortedIndex(fromSortedIndex: number, toSortedIndex: number, insertAfter: boolean): void {
		const sortedCount = this._sortedEntries.length;
		const editableCount = this.entries.length;
		const offset = this._editableStartOffset;

		if (fromSortedIndex === -1 || toSortedIndex === -1) return;
		if (fromSortedIndex >= sortedCount || toSortedIndex >= sortedCount) return;

		// Check for no-op: moving to same position
		// "Insert before" at fromSortedIndex or "insert after" at fromSortedIndex-1 = no change
		if (toSortedIndex === fromSortedIndex) return;
		if (insertAfter && toSortedIndex === fromSortedIndex - 1) return;
		if (!insertAfter && toSortedIndex === fromSortedIndex + 1) return;

		// Convert display indices to entries array indices
		// In ascending mode: sortedIndex includes base+done at start, so subtract offset
		// In descending mode: editable entries are at start (0..editableCount-1), reversed
		let fromIndex: number;
		let toIndex: number;

		if (this.ascending) {
			// Ascending: display order matches array order
			// sortedIndex = offset + entriesIndex, so entriesIndex = sortedIndex - offset
			fromIndex = fromSortedIndex - offset;
			const targetEntriesIndex = toSortedIndex - offset;

			// Insert before target = toIndex at target position
			// Insert after target = toIndex at target position + 1
			toIndex = insertAfter ? targetEntriesIndex + 1 : targetEntriesIndex;
		} else {
			// Descending: editable entries at sortedIndex 0..(editableCount-1), reversed
			// sortedIndex 0 = entries[editableCount-1], sortedIndex (editableCount-1) = entries[0]
			// So: entriesIndex = editableCount - 1 - sortedIndex
			fromIndex = editableCount - 1 - fromSortedIndex;
			const targetEntriesIndex = editableCount - 1 - toSortedIndex;

			// In descending: insert after in display = insert before in array
			// insert before in display = insert after in array
			toIndex = insertAfter ? targetEntriesIndex : targetEntriesIndex + 1;
		}

		// Validate indices are within editable range
		if (fromIndex < 0 || fromIndex >= editableCount) return;
		// toIndex can be 0 to editableCount (inclusive for "append at end")
		if (toIndex < 0 || toIndex > editableCount) return;

		this.executeMoveEntry(fromIndex, toIndex);
	}

	/**
	 * Executes a move operation with optimistic update and host notification
	 * @param fromIndex - Source index in entries array
	 * @param toIndex - Target index in entries array (may equal entries.length for "move to end")
	 */
	private executeMoveEntry(fromIndex: number, toIndex: number): void {
		if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

		const entry = this.entries[fromIndex];
		if (!entry) return;

		// Preserve focus on the moved entry
		this.pendingFocusId = entry.id;

		// For optimistic update: after removing the entry, indices shift
		// If moving to higher index, the target shifts down by 1
		const isMovingToHigherIndex = fromIndex < toIndex;
		const spliceIndex = isMovingToHigherIndex ? toIndex - 1 : toIndex;

		// Apply optimistic update
		this._stateProvider.moveEntry(fromIndex, spliceIndex);
		// Synchronously rebuild indices so subsequent operations use correct state
		this.refreshIndices();

		// Send absolute position to host
		this._ipc.sendCommand(MoveEntryCommand, { id: entry.id, to: toIndex, relative: false });
	}

	/**
	 * Executes a batch move operation for multiple entries
	 * Entries maintain their relative display order and are moved as a group to the target position
	 * @param ids - Entry IDs to move (order doesn't matter, will be sorted by display order)
	 * @param toSortedIndex - Target entry index in display/sorted order
	 * @param insertAfter - If true, insert after the target; if false, insert before
	 */
	private executeMoveEntriesBySortedIndex(ids: string[], toSortedIndex: number, insertAfter: boolean): void {
		if (ids.length === 0) return;

		const sortedCount = this._sortedEntries.length;
		const editableCount = this.entries.length;
		const offset = this._editableStartOffset;
		const idSet = new Set(ids);

		if (toSortedIndex < 0 || toSortedIndex >= sortedCount) return;

		// Get entry IDs in array order (preserves display order, converted to array order)
		const orderedIds = this.getIdsInArrayOrder(idSet);

		// Convert target to effective sorted index (accounting for insert before/after)
		// insertAfter: we want the position after the target entry
		// insertBefore: we want the position at the target entry
		let effectiveSortedIndex = toSortedIndex;
		if (insertAfter) {
			effectiveSortedIndex = toSortedIndex + 1;
		}

		// Count how many selected entries are before the effective target position
		// These will be removed, shifting the target position
		let selectedBeforeTarget = 0;
		for (let i = 0; i < effectiveSortedIndex && i < sortedCount; i++) {
			if (idSet.has(this._sortedEntries[i].id)) {
				selectedBeforeTarget++;
			}
		}

		// Adjust target index in the "remaining" sorted array (after selected entries are removed)
		const adjustedSortedIndex = effectiveSortedIndex - selectedBeforeTarget;

		// Convert adjusted sorted index to entries array index
		// Need to account for non-editable entries at the start (in ascending mode)
		const remainingEditableCount = editableCount - orderedIds.length;
		let toIndex: number;
		if (this.ascending) {
			// In ascending mode, subtract the offset to get entries array index
			// adjustedSortedIndex is in the "remaining" sorted array space
			// The offset still applies since non-editable entries are still at the start
			toIndex = Math.max(0, Math.min(adjustedSortedIndex - offset, remainingEditableCount));
		} else {
			// Descending: editable entries were at the start of sorted array (0..editableCount-1)
			// After removal, remaining editable entries are at (0..remainingEditableCount-1)
			// adjustedSortedIndex in sorted = remainingEditableCount - 1 - entriesIndex
			// So: entriesIndex = remainingEditableCount - adjustedSortedIndex
			toIndex = Math.max(0, Math.min(remainingEditableCount - adjustedSortedIndex, remainingEditableCount));
		}

		// Preserve focus on the focused entry if it's part of selection, otherwise first
		const primaryId = this.focusedEntryId && idSet.has(this.focusedEntryId) ? this.focusedEntryId : orderedIds[0];
		this.pendingFocusId = primaryId;

		// Apply optimistic update
		this._stateProvider.moveEntries(orderedIds, toIndex);
		// Synchronously rebuild indices so subsequent operations use correct state
		this.refreshIndices();

		// Send batch command to host
		this._ipc.sendCommand(MoveEntriesCommand, { ids: orderedIds, to: toIndex });
	}

	private readonly onEntrySelect = (
		e: CustomEvent<{ id: string; sha?: string; ctrlKey: boolean; shiftKey: boolean }>,
	): void => {
		const { id, sha, ctrlKey, shiftKey } = e.detail;

		// Don't allow selecting the base entry
		const baseId = this.state?.onto?.sha;
		if (baseId && id === baseId) return;

		// Update focus tracking
		this.focusedEntryId = id;

		if (shiftKey && this.anchoredEntryId) {
			// Shift+click: select range from last selected to clicked
			const lastIndex = this._idToSortedIndex.get(this.anchoredEntryId) ?? -1;
			const currentIndex = this._idToSortedIndex.get(id) ?? -1;
			if (lastIndex !== -1 && currentIndex !== -1) {
				const start = Math.min(lastIndex, currentIndex);
				const end = Math.max(lastIndex, currentIndex);
				// Filter out the base entry from range selection
				const rangeIds = filterMap(this._sortedEntries.slice(start, end + 1), e =>
					e.id !== baseId ? e.id : undefined,
				);
				this.selectedIds = new Set(rangeIds);
			}
		} else if (ctrlKey) {
			// Ctrl+click: toggle selection
			const newSelection = new Set(this.selectedIds);
			if (newSelection.has(id)) {
				newSelection.delete(id);
			} else {
				newSelection.add(id);
			}
			this.selectedIds = newSelection;
			this.anchoredEntryId = id;
		} else {
			// Regular click: single select
			this.selectedIds = new Set([id]);
			this.anchoredEntryId = id;
		}

		// Notify host of primary selection (only for commit entries)
		if (sha) {
			this._ipc.sendCommand(UpdateSelectionCommand, { sha: sha });
		}
	};

	private readonly onActionChanged = (e: CustomEvent<{ sha: string; action: RebaseTodoCommitAction }>): void => {
		const { sha, action } = e.detail;

		// Collect all entries to change
		let entries: { sha: string; action: RebaseTodoCommitAction }[];

		// If the changed entry is in the selection, change all selected commit entries as a batch
		if (this.selectedIds.has(sha) && this.selectedIds.size > 1) {
			// Only change action for commit entries in the selection
			entries = [];
			for (const selectedId of this.selectedIds) {
				// Only include commit entries (IDs that don't start with 'line:')
				if (!selectedId.startsWith('line:')) {
					// Prevent squash/fixup on the oldest commit
					if (selectedId === this._oldestCommitId && (action === 'squash' || action === 'fixup')) {
						continue;
					}
					entries.push({ sha: selectedId, action: action });
				}
			}
		} else {
			// Prevent squash/fixup on the oldest commit
			if (sha === this._oldestCommitId && (action === 'squash' || action === 'fixup')) {
				return;
			}
			entries = [{ sha: sha, action: action }];
		}

		if (!entries.length) return;

		// If changing to 'drop', check for orphaned squash/fixup entries
		if (action === 'drop') {
			const orphaned = this.findOrphanedSquashEntries(entries.map(e => e.sha));
			for (const orphanSha of orphaned) {
				entries.push({ sha: orphanSha, action: 'pick' });
			}
		}

		if (entries.length === 1) {
			this._stateProvider.changeEntryAction(entries[0].sha, entries[0].action);
			this._ipc.sendCommand(ChangeEntryCommand, { sha: entries[0].sha, action: entries[0].action });
		} else {
			this._stateProvider.changeEntryActions(entries);
			this._ipc.sendCommand(ChangeEntriesCommand, { entries: entries });
		}

		// Only mark conflicts as stale if we're dropping commits (which changes what gets applied)
		if (action === 'drop') {
			this.markConflictDetectionStale();
		}
	};

	/**
	 * Finds squash/fixup entries that would become orphaned if the given SHAs are dropped
	 * An entry is orphaned if it's squash/fixup and there's no valid target before it
	 */
	private findOrphanedSquashEntries(droppingShas: string[]): string[] {
		const dropping = new Set(droppingShas);
		const orphaned: string[] = [];
		const entries = this.entries;

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (!isCommitEntry(entry)) continue;
			if (entry.action !== 'squash' && entry.action !== 'fixup') continue;

			// Look backwards for a valid target
			let hasTarget = false;
			for (let j = i - 1; j >= 0; j--) {
				const target = entries[j];
				if (!isCommitEntry(target)) continue;

				const action = dropping.has(target.sha) ? 'drop' : target.action;
				if (action === 'drop') continue;
				if (action === 'squash' || action === 'fixup') continue;

				// Found a valid target (pick, edit, reword)
				hasTarget = true;
				break;
			}

			if (!hasTarget) {
				orphaned.push(entry.sha);
			}
		}

		return orphaned;
	}

	private handleKeyboardMove(e: Event, sortedIndex: number, key: string): void {
		e.preventDefault();
		e.stopPropagation();

		const entry = this._sortedEntries[sortedIndex];
		if (!entry) return;

		const isDownward = this.isDownwardKey(key);
		// In display order: "down" means higher index. Map to array direction.
		// Ascending: display order = array order, so down = 'down'
		// Descending: display order is reversed, so down = 'up' in array terms
		const direction = isDownward === this.ascending ? 'down' : 'up';

		// Check if this entry is part of multi-selection
		if (this.selectedIds.has(entry.id) && this.selectedIds.size > 1) {
			const ids = Array.from(this.selectedIds);

			// Preserve focus on current entry
			this.pendingFocusId = entry.id;

			// Apply optimistic update
			this._stateProvider.shiftEntries(ids, direction);
			// Synchronously rebuild indices so subsequent operations use correct state
			this.refreshIndices();

			// Send shift command to host
			this._ipc.sendCommand(ShiftEntriesCommand, { ids: ids, direction: direction });
		} else {
			const targetSortedIndex = sortedIndex + (isDownward ? 1 : -1);

			// Boundary checks in display order
			if (targetSortedIndex < 0 || targetSortedIndex >= this._sortedEntries.length) return;

			// When moving down, insert after the target (below it in display)
			// When moving up, insert before the target (above it in display)
			this.executeMoveEntryBySortedIndex(sortedIndex, targetSortedIndex, isDownward);
		}
	}

	private handleKeyboardNavigate(e: Event, sortedIndex: number, key: string): void {
		if (!this.isNavigationKey(key)) return;
		e.preventDefault();

		const isDownward = this.isDownwardKey(key);
		const newSortedIndex = sortedIndex + (isDownward ? 1 : -1);

		// Stop at boundaries
		if (newSortedIndex < 0 || newSortedIndex >= this._sortedEntries.length) return;

		this.focusEntry(this._sortedEntries[newSortedIndex].id);
	}

	private handleKeyboardMultiSelect(e: Event, sortedIndex: number, key: string): void {
		if (!this.isNavigationKey(key)) return;
		e.preventDefault();

		const isDownward = this.isDownwardKey(key);
		const newSortedIndex = sortedIndex + (isDownward ? 1 : -1);

		// Stop at boundaries
		if (newSortedIndex < 0 || newSortedIndex >= this._sortedEntries.length) return;

		const baseId = this.state?.onto?.sha;
		const newId = this._sortedEntries[newSortedIndex].id;

		// Don't allow moving focus to the base entry
		if (newId === baseId) return;

		// Set anchor if not already set (first shift-select sets the anchor)
		this.anchoredEntryId ||= this._sortedEntries[sortedIndex].id;

		// Get anchor index
		const anchorIndex = this._idToSortedIndex.get(this.anchoredEntryId) ?? sortedIndex;

		// Compute selection as range from anchor to new focus position
		const start = Math.min(anchorIndex, newSortedIndex);
		const end = Math.max(anchorIndex, newSortedIndex);
		const rangeIds = filterMap(this._sortedEntries.slice(start, end + 1), e =>
			e.id !== baseId ? e.id : undefined,
		);

		// Set pendingFocusId BEFORE updating selectedIds to prevent willUpdate from
		// capturing the old focus position during re-render
		this.pendingFocusId = newId;
		this.selectedIds = new Set(rangeIds);
	}

	private isNavigationKey(key: string): boolean {
		return key === 'ArrowUp' || key === 'ArrowDown' || key === 'j' || key === 'k' || key === 'J' || key === 'K';
	}

	private isDownwardKey(key: string): boolean {
		// Down arrow/j always means "move to higher display index" (visually down on screen)
		return key === 'ArrowDown' || key === 'j' || key === 'J';
	}

	private focusEntry(id: string): void {
		// Don't allow focusing the base entry
		if (id === this.state?.onto?.sha) return;

		this.focusedEntryId = id;

		const index = this._idToSortedIndex.get(id) ?? -1;
		if (index === -1) return;

		// Scroll to index first to ensure the entry is rendered, then focus
		const virtualizer = this._virtualizer;
		if (virtualizer?.scrollToIndex) {
			virtualizer.scrollToIndex(index, 'nearest');
			requestAnimationFrame(() => {
				const entry = this.getEntryElement(id);
				entry?.shadowRoot?.querySelector<HTMLElement>('.entry')?.focus();
			});
		}
	}

	// ============================================================================
	// Header Actions
	// ============================================================================

	private onOrderToggle() {
		this._ipc.sendCommand(ReorderCommand, { ascending: !this.ascending });
	}

	private onStartClicked() {
		this._ipc.sendCommand(StartCommand, undefined);
	}

	/** Mark conflict detection as stale when the rebase plan is modified */
	private markConflictDetectionStale(): void {
		this.conflictDetectionStale = true;
	}

	private onAbortClicked() {
		this._ipc.sendCommand(AbortCommand, undefined);
	}

	private onContinueClicked() {
		this._ipc.sendCommand(ContinueCommand, undefined);
	}

	private onSkipClicked() {
		this._ipc.sendCommand(SkipCommand, undefined);
	}

	private onSwitchClicked() {
		this._ipc.sendCommand(SwitchCommand, undefined);
	}

	private onSearch() {
		this._ipc.sendCommand(SearchCommand, undefined);
	}

	private onRecomposeCommitsClicked() {
		this._ipc.sendCommand(RecomposeCommand, undefined);
	}

	private onDocumentKeyDown = (e: KeyboardEvent) => {
		// Global shortcuts with Ctrl/Cmd
		if (e.ctrlKey || e.metaKey) {
			if (e.key === 'Enter' && !this.state?.isReadOnly) {
				e.preventDefault();
				// Use Continue when in active rebase, Start otherwise
				if (this.isActiveRebase) {
					if (!this.rebaseStatus?.hasConflicts) {
						this.onContinueClicked();
					}
				} else {
					this.onStartClicked();
				}
			}

			return;
		}

		if (e.key === '/') {
			e.preventDefault();
			this.onSearch();
		}
	};

	/**
	 * Computes which entries are squash targets and which are in the squash path
	 * In raw entries (line order), squash/fixup merges into the commit above it
	 */
	private computeSquashInfo(entries: RebaseEntry[]): { targets: Set<string>; squashing: Set<string> } {
		const targets = new Set<string>();
		const squashing = new Set<string>();

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (!isCommitEntry(entry)) continue;
			if (entry.action !== 'squash' && entry.action !== 'fixup') continue;

			// Look backwards and mark command entries as squashing until we find the target
			for (let j = i - 1; j >= 0; j--) {
				const target = entries[j];
				if (!isCommitEntry(target)) {
					// Command entry - mark it as squashing
					squashing.add(target.id);
					continue;
				}
				if (target.action === 'drop') continue;
				if (target.action === 'squash' || target.action === 'fixup') continue;

				// Found a valid target (pick, edit, reword)
				targets.add(target.sha);
				break;
			}
		}

		return { targets: targets, squashing: squashing };
	}

	/**
	 * Rebuilds `_sortedEntries` and `_idToSortedIndex` synchronously from current state
	 * This must be called immediately after any optimistic state mutation to ensure subsequent operations (like rapid keyboard moves) use correct indices
	 *
	 * Note: This is separate from willUpdate() because willUpdate() runs asynchronously
	 * after requestUpdate(). We need indices to be correct immediately after mutation.
	 */
	private refreshIndices(): void {
		const { entries, doneEntries } = this;
		const onto = this.state?.onto;

		// Count non-editable entries (base + done) that appear before editable entries
		const hasBase = onto != null;
		const nonEditableCount = (hasBase ? 1 : 0) + doneEntries.length;

		// Build list: base (if present) + done entries + pending entries
		const allEntries = doneEntries.length > 0 ? [...doneEntries, ...entries] : entries;

		// Add base entry at the appropriate end, but only if it's not already in the list — See #1201
		if (onto && !allEntries.some(e => e.sha === onto.sha)) {
			const base: RebaseCommitEntry = {
				type: 'commit',
				id: onto.sha,
				action: 'pick',
				sha: onto.sha,
				message: onto.commit?.message ?? 'Base commit',
				line: 0,
				commit: onto.commit,
			};

			this._sortedEntries = this.ascending ? [base, ...allEntries] : [base, ...allEntries].toReversed();
		} else {
			this._sortedEntries = this.ascending ? allEntries : allEntries.toReversed();
		}

		// In ascending mode, non-editable entries are at the start of _sortedEntries
		// In descending mode, they are at the end (due to reversal), so offset for calculations is 0
		this._editableStartOffset = this.ascending ? nonEditableCount : 0;

		// Build ID → display index map for O(1) lookups
		this._idToSortedIndex.clear();
		for (let i = 0; i < this._sortedEntries.length; i++) {
			this._idToSortedIndex.set(this._sortedEntries[i].id, i);
		}
	}

	protected override willUpdate(_changedProperties: PropertyValues): void {
		// Compute cached values for this render cycle
		const entries = this.entries;

		// Find oldest commit (first commit entry in line order)
		this._oldestCommitId = entries.find(isCommitEntry)?.sha;

		// Compute squash info - targets and entries in the squash path
		const squashInfo = this.computeSquashInfo(entries);
		this._squashTargetIds = squashInfo.targets;
		this._squashingIds = squashInfo.squashing;

		// Rebuild sorted entries and index map
		this.refreshIndices();

		// Set initial focus and selection when entries first arrive
		if (this.focusedEntryId == null && this._sortedEntries.length > 0) {
			const baseId = this.state?.onto?.sha;
			let targetId: string | undefined;

			// If in an active rebase, auto-select the last done entry (the paused entry)
			if (this.isActiveRebase && this.doneEntries.length > 0) {
				const lastDoneEntry = this.doneEntries[this.doneEntries.length - 1];
				targetId = lastDoneEntry.id;
			}

			// Otherwise, find first non-base entry (base entry is not focusable)
			if (!targetId) {
				const firstFocusable = this._sortedEntries.find(e => e.id !== baseId);
				targetId = firstFocusable?.id;
			}

			if (targetId) {
				this.focusedEntryId = targetId;
				this.selectedIds = new Set([targetId]);
				this.anchoredEntryId = targetId;
				this.pendingFocusId = targetId;
			}
		}

		// Preserve focus if not already set by a move operation
		if (this.pendingFocusId == null) {
			const focused = this.shadowRoot?.activeElement?.closest<GlRebaseEntryElement>('gl-rebase-entry');
			// Use data-id attribute instead of .entry property to avoid stale references from virtualizer
			this.pendingFocusId = focused?.dataset.id;
		}
	}

	protected override updated(_changedProperties: PropertyValues): void {
		// Sync conflict indicator state for reactive updates to the footer
		if (this._conflictIndicator) {
			this._conflictIndicatorLoading = this._conflictIndicator.isLoading ?? false;
			this._conflictIndicatorHasConflicts = this._conflictIndicator.hasConflicts ?? false;
		}

		if (!this.pendingFocusId) return;

		const idToFocus = this.pendingFocusId;
		this.pendingFocusId = undefined;

		// Defer focus restoration to allow virtualizer to update DOM
		this.focusEntry(idToFocus);
	}

	override render() {
		if (!this.state?.entries) return nothing;

		const isReadOnly = this.state.isReadOnly ?? false;
		const isActive = this.isActiveRebase;
		const isEmptyOrNoop = this.isEmptyOrNoop;

		return html`
			<div class="container ${isReadOnly ? 'read-only' : ''} ${isActive ? 'active-rebase' : ''}">
				${guard(
					[
						this.state.branch,
						this.state.onto,
						this.state.entries.length,
						this.ascending,
						isReadOnly,
						this.rebaseStatus,
					],
					() => this.renderHeader(),
				)}
				${isReadOnly ? this.renderReadOnlyBanner() : nothing}
				${!isEmptyOrNoop
					? html`<lit-virtualizer
							role="list"
							class="entries scrollable ${this.ascending ? 'ascending' : 'descending'}${this.rebaseStatus
								?.hasConflicts
								? ' has-conflicts'
								: ''}"
							autofocus
							@click=${this.onListClick}
							@keydown=${this.onListKeyDown}
							@dragstart=${this.onDragStart}
							@dragend=${this.onDragEnd}
							@dragover=${this.onDragOver}
							@dragleave=${this.onDragLeave}
							@drop=${this.onDrop}
							scroller
							.items=${this._sortedEntries}
							.keyFunction=${this.virtualizerKeyFn}
							.layout=${flow({ direction: 'vertical' })}
							.renderItem=${this.virtualizerRenderFn}
						></lit-virtualizer>`
					: !isReadOnly
						? html`<div class="entries-empty">No commits to rebase</div>`
						: nothing}
				${this.renderFooter()}
			</div>
		`;
	}

	private renderReadOnlyBanner() {
		return html`<gl-banner
			class="read-only-banner"
			display="outline"
			layout="responsive"
			body="This rebase contains merge commits and cannot be edited here. Switch to the text editor to make changes."
			primary-button="Switch to Text Editor"
			@gl-banner-primary-click=${this.onSwitchClicked}
		></gl-banner>`;
	}

	private renderConflictIndicator() {
		// Only show for new rebases (not active ones)
		if (this.isActiveRebase || !this.state?.branch || !this.state?.onto) {
			return nothing;
		}

		return html`<gl-rebase-conflict-indicator
			id="header-conflict-indicator"
			class="conflict-indicator"
			.branch=${this.state.branch}
			.onto=${this.state.onto.sha}
			.stale=${this.conflictDetectionStale}
		></gl-rebase-conflict-indicator>`;
	}

	private renderRebaseBanner() {
		const status = this.rebaseStatus;
		if (!status) return nothing;

		const currentCommitSha = status.currentCommit;
		const pauseReason = status.pauseReason;
		const revealTooltip = this.state?.revealLocation === 'graph' ? 'Open in Commit Graph' : 'Open in Inspect View';

		// Determine icon based on pause reason
		let icon: string;
		if (pauseReason === 'conflict') {
			icon = 'warning';
		} else if (pauseReason === 'edit' || pauseReason === 'break' || pauseReason === 'exec') {
			icon = 'debug-pause';
		} else {
			icon = 'debug-continue';
		}

		// Build status message based on pause reason
		const sha = currentCommitSha
			? html`<gl-tooltip hoist content=${revealTooltip}>
					<gl-commit-sha
						.sha=${currentCommitSha}
						tabindex="0"
						@click=${this.onCurrentCommitClick}
						@keydown=${this.onCurrentCommitKeydown}
						style="cursor: pointer"
					></gl-commit-sha>
				</gl-tooltip>`
			: nothing;

		let statusContent;
		switch (pauseReason) {
			case 'break':
				statusContent = html`Rebase paused at breakpoint`;
				break;

			case 'conflict':
				statusContent = currentCommitSha
					? html`Rebase paused due to conflicts at ${sha}`
					: html`Rebase paused due to conflicts`;
				break;

			case 'exec':
				statusContent = html`Rebase paused due to exec failure`;
				break;

			case 'edit':
				statusContent = currentCommitSha
					? html`Rebase paused for editing at ${sha}`
					: html`Rebase paused for editing`;
				break;

			case 'reword':
				statusContent = currentCommitSha
					? html`Rebase paused for rewording at ${sha}`
					: html`Rebase paused for rewording`;
				break;

			default:
				statusContent = currentCommitSha ? html`Rebase paused at ${sha}` : html`Rebase paused`;
		}

		return html`<div class="rebase-banner ${pauseReason === 'conflict' ? 'has-conflicts' : ''}">
			<code-icon icon="${icon}"></code-icon>
			<span class="rebase-status">${statusContent}</span>
			${pauseReason === 'conflict'
				? html`<gl-tooltip hoist content="Show Conflicts">
						<a class="rebase-action-link" href="${this.showConflictsCommandUrl}">Show conflicts</a>
					</gl-tooltip>`
				: nothing}
			<span class="rebase-progress">(${status.currentStep}/${status.totalSteps})</span>
			<span class="rebase-remaining">${status.totalSteps - status.currentStep} remaining</span>
		</div>`;
	}

	private get showConflictsCommandUrl(): string {
		return createWebviewCommandLink(
			'gitlens.pausedOperation.showConflicts:rebase',
			this._webview.webviewId,
			this._webview.webviewInstanceId,
		);
	}

	private onCurrentCommitClick = () => {
		const sha = this.rebaseStatus?.currentCommit;
		if (!sha) return;
		this._ipc.sendCommand(RevealRefCommand, { type: 'commit', ref: sha });
	};

	private onCurrentCommitKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			this.onCurrentCommitClick();
		}
	};

	private renderEntry(entry: RebaseEntry, index: number) {
		const entryId = entry.id;
		const isFirst = index === 0;
		const isLast = index === this._sortedEntries.length - 1;
		// Check if this entry is done (already applied during active rebase)
		const isDone = entry.done ?? false;
		// Check if this is the current commit being processed
		const currentCommit = this.rebaseStatus?.currentCommit;
		const isCurrent = 'sha' in entry && currentCommit != null && entry.sha?.startsWith(currentCommit);

		if (isCommandEntry(entry)) {
			return html`<gl-rebase-entry
				data-id=${entryId}
				.entry=${entry}
				?isFirst=${isFirst}
				?isLast=${isLast}
				?isDone=${isDone}
				?isCurrent=${isCurrent ?? false}
				?isSelected=${this.selectedIds.has(entryId)}
				?isSquashing=${this._squashingIds.has(entryId)}
				@entry-select=${this.onEntrySelect}
			></gl-rebase-entry>`;
		}

		return html`<gl-rebase-entry
			data-id=${entryId}
			.entry=${entry}
			.authors=${this.state.authors}
			.revealLocation=${this.state.revealLocation}
			?isBase=${entry.sha === this.state?.onto?.sha}
			?isFirst=${isFirst}
			?isLast=${isLast}
			?isDone=${isDone}
			?isCurrent=${isCurrent ?? false}
			?isOldest=${entry.sha === this._oldestCommitId}
			?isSelected=${this.selectedIds.has(entryId)}
			?isSquashTarget=${this._squashTargetIds.has(entryId)}
			@action-changed=${this.onActionChanged}
			@entry-select=${this.onEntrySelect}
			@gl-reveal-commit=${this.onRevealCommit}
		></gl-rebase-entry>`;
	}

	private renderHeader() {
		return html`<header tabindex="-1">
			<div class="header__row">
				<h1 class="header-title">GitLens Interactive Rebase</h1>
				<div class="header-info">${this.renderSubhead()}</div>
				<div class="header-actions">
					${this.renderConflictIndicator()}
					<gl-button
						class="header-toggle"
						appearance="toolbar"
						density="compact"
						tooltip="${this.ascending ? 'Showing Oldest Commits First' : 'Showing Newest Commits First'}"
						@click=${this.onOrderToggle}
					>
						<code-icon slot="prefix" icon="sort-precedence"></code-icon>
						<code-icon icon="${this.ascending ? 'arrow-up' : 'arrow-down'}"></code-icon>
					</gl-button>
				</div>
			</div>
			${this.isActiveRebase ? this.renderRebaseBanner() : nothing}
		</header>`;
	}

	private renderSubhead() {
		if (!this.state) return nothing;

		// Count only commit entries (not command entries like exec/break)
		const doneCommitCount = this.doneEntries.filter(e => e.type === 'commit').length;
		const pendingCommitCount = this.state.entries.filter(e => e.type === 'commit').length;
		const totalCommitCount = doneCommitCount + pendingCommitCount;
		const revealTooltip = this.state.revealLocation === 'graph' ? 'Open in Commit Graph' : 'Open in Inspect View';

		return html`
			<gl-tooltip hoist content=${revealTooltip}>
				<gl-branch-name
					.name=${this.state.branch}
					tabindex="0"
					@click=${this.onBranchClick}
					@keydown=${this.onBranchKeydown}
					style="cursor: pointer"
				></gl-branch-name>
			</gl-tooltip>
			${this.state.onto
				? html`<span class="header-onto"
						>onto
						<gl-tooltip hoist content=${revealTooltip}>
							<gl-commit-sha
								.sha=${this.state.onto.sha}
								tabindex="0"
								@click=${this.onOntoClick}
								@keydown=${this.onOntoKeydown}
								style="cursor: pointer"
							></gl-commit-sha>
						</gl-tooltip>
					</span>`
				: nothing}
			<span class="header-count"
				>${this.isActiveRebase
					? `${doneCommitCount}/${totalCommitCount} commits`
					: pluralize('commit', pendingCommitCount)}</span
			>
		`;
	}

	private onBranchClick = () => {
		if (!this.state?.branch) return;
		this._ipc.sendCommand(RevealRefCommand, { type: 'branch', ref: this.state.branch });
	};

	private onBranchKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			this.onBranchClick();
		}
	};

	private onOntoClick = () => {
		if (!this.state?.onto?.sha) return;
		this._ipc.sendCommand(RevealRefCommand, { type: 'commit', ref: this.state.onto.sha });
	};

	private onOntoKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			this.onOntoClick();
		}
	};

	private onRevealCommit = (e: CustomEvent<{ sha: string }>) => {
		this._ipc.sendCommand(RevealRefCommand, { type: 'commit', ref: e.detail.sha });
	};

	private renderFooter() {
		const isActive = this.isActiveRebase;
		const hasConflicts = this.rebaseStatus?.hasConflicts ?? false;

		return html`<footer>
			<div class="shortcuts">
				<code-icon icon="keyboard"></code-icon>
				<span class="shortcut"><kbd class="word">p</kbd><span>ick</span></span>
				<span class="shortcut"><kbd class="word">r</kbd><span>eword</span></span>
				<span class="shortcut"><kbd class="word">e</kbd><span>dit</span></span>
				<span class="shortcut"><kbd class="word">s</kbd><span>quash</span></span>
				<span class="shortcut"><kbd class="word">f</kbd><span>ixup</span></span>
				<span class="shortcut"><kbd class="word">d</kbd><span>rop</span></span>
				<span class="shortcut"><kbd>alt</kbd> <kbd>↑↓</kbd><span class="label">move</span></span>
				<span class="shortcut"><kbd>/</kbd><span class="label">search</span></span>
			</div>
			<div class="actions">
				${this.renderRecomposeAction(isActive)}
				${isActive ? this.renderActiveRebaseActions(hasConflicts) : this.renderStartRebaseActions()}
			</div>
		</footer>`;
	}

	private renderStartRebaseActions() {
		let variant: 'warning' | 'success' | undefined;
		let icon: 'check' | 'warning' | 'loading' | undefined;
		let tooltip: string | undefined;

		if (this._conflictIndicator) {
			const isLoading = this._conflictIndicatorLoading;
			const hasConflicts = this._conflictIndicatorHasConflicts;
			const isStale = this.conflictDetectionStale;

			if (!isLoading) {
				if (hasConflicts) {
					variant = 'warning';
					icon = 'warning';
					tooltip = 'Start Rebase (Conflicts Detected)';
				} else if (!isStale) {
					variant = 'success';
					icon = 'check';
					tooltip = 'Start Rebase (No Conflicts Detected)';
				}
			} else {
				icon = 'loading';
				tooltip = 'Checking for conflicts...';
			}
		}

		return html`<gl-button
				?disabled=${!this.state?.entries?.length || this.state?.isReadOnly}
				variant=${ifDefined(variant)}
				tooltip=${ifDefined(tooltip)}
				@click=${this.onStartClicked}
			>
				<span
					>Start Rebase
					${icon
						? html`<code-icon
								slot="label"
								icon=${icon}
								modifier=${ifDefined(icon === 'loading' ? 'spin' : undefined)}
							></code-icon>`
						: nothing}</span
				>
				<span slot="suffix" class="button-shortcut">Ctrl+Enter</span>
			</gl-button>
			<gl-button appearance="secondary" @click=${this.onAbortClicked}>Abort</gl-button>`;
	}

	private renderRecomposeAction(isActive: boolean) {
		const isInPlace = this.state?.isInPlace ?? false;
		const message = isInPlace
			? 'Let AI intelligently reorganize these commits with clearer messages and better logical grouping.'
			: 'Let AI intelligently reorganize these commits with clearer messages and better logical grouping. <br><br> After recomposition, simply rebase again to apply these commits onto the target branch.';

		return html`<gl-popover-confirm
			heading="Abort Rebase &amp; Recompose"
			message=${message}
			confirm="Abort &gt; Recompose"
			confirm-variant=${ifDefined(isActive ? 'danger' : undefined)}
			initial-focus=${isActive ? 'cancel' : 'confirm'}
			icon=${isActive ? 'error' : 'warning'}
			@gl-confirm=${this.onRecomposeCommitsClicked}
		>
			<gl-button slot="anchor" appearance="secondary" tooltip="Open Commit Composer &amp; Recompose using AI">
				<code-icon slot=${ifDefined(isActive ? undefined : 'prefix')} icon="sparkle"></code-icon>
				${isActive ? nothing : 'Recompose...'}
			</gl-button>
		</gl-popover-confirm>`;
	}

	private renderActiveRebaseActions(hasConflicts: boolean) {
		return html`
			<gl-button @click=${this.onContinueClicked} ?disabled=${hasConflicts}>
				<span>Continue</span>
				<span slot="suffix" class="button-shortcut">Ctrl+Enter</span>
			</gl-button>
			<gl-button appearance="secondary" @click=${this.onSkipClicked}>Skip</gl-button>
			<gl-button variant="danger" @click=${this.onAbortClicked}>Abort</gl-button>
		`;
	}
}
