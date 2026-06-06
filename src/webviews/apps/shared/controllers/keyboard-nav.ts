import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { ReadonlyCollectionIndex } from './collection-index.js';
import type { FocusController } from './focus.js';
import type { SelectionController, SelectionMode } from './selection.js';

export interface KeyboardNavOptions {
	index: ReadonlyCollectionIndex;
	focus: FocusController;
	selection: SelectionController;
	mode: () => SelectionMode;
	/** Rows per page for PageUp/PageDown. Defaults to 10. */
	pageSize?: () => number;
	/** Whether a plain arrow move also updates the (single) selection. Default: true. */
	selectionFollowsFocus?: () => boolean;
	/** Activation (Enter, or Space in single mode) on the focused id. */
	onActivate?: (id: string) => void;
	/**
	 * The keyboard seam: keys the controller does not consume (ArrowLeft/Right for expand-collapse,
	 * printable chars for type-ahead, Escape, …) are forwarded here so the host can handle its own
	 * concerns. Return `true` if the host handled the key (the controller then reports handled).
	 */
	onUnhandledKey?: (e: KeyboardEvent) => boolean;
}

/**
 * Translates the COMMON keyboard vocabulary (Up/Down/Home/End/PageUp/PageDown/Enter/Space, plus the
 * multi-select extensions Shift+Arrow / Ctrl+Arrow / Ctrl-Cmd+A / Space-toggle) into Focus +
 * Selection operations, and forwards everything else to the host via {@link KeyboardNavOptions.onUnhandledKey}.
 *
 * Reusable core (L1). A tree adds ArrowLeft/Right expand-collapse and type-ahead through the seam; a
 * flat listbox forwards nothing. Keeps the common nav logic in one place across lists and trees.
 */
export class KeyboardNavController implements ReactiveController {
	constructor(
		private readonly host: ReactiveControllerHost,
		private readonly options: KeyboardNavOptions,
	) {
		host.addController(this);
	}

	hostConnected(): void {
		/* no-op */
	}

	hostDisconnected(): void {
		/* no-op */
	}

	private get multi(): boolean {
		return this.options.mode() === 'multi';
	}

	private get followsFocus(): boolean {
		return this.options.selectionFollowsFocus?.() ?? true;
	}

	/** Handle a keydown. Returns `true` if consumed (caller should `preventDefault`/`stopPropagation`). */
	handleKeydown(e: KeyboardEvent): boolean {
		const { focus, selection } = this.options;

		switch (e.key) {
			case 'ArrowDown':
			case 'ArrowUp': {
				const delta = e.key === 'ArrowDown' ? 1 : -1;
				if (this.multi && (e.ctrlKey || e.metaKey)) {
					// Move the cursor without changing the selection.
					focus.move(delta);
					return true;
				}

				focus.move(delta);
				this.applyNavSelection(e);
				return true;
			}
			case 'Home':
			case 'End': {
				if (e.key === 'Home') {
					focus.first();
				} else {
					focus.last();
				}
				this.applyNavSelection(e);
				return true;
			}
			case 'PageUp':
			case 'PageDown': {
				focus.pageBy(e.key === 'PageDown' ? 1 : -1, this.options.pageSize?.() ?? 10);
				this.applyNavSelection(e);
				return true;
			}
			case 'Enter': {
				const id = focus.focusedId;
				if (id != null) {
					this.options.onActivate?.(id);
				}
				return true;
			}
			case ' ': {
				const id = focus.focusedId;
				if (id == null) return true;

				if (this.multi) {
					selection.toggle(id);
				} else {
					this.options.onActivate?.(id);
				}
				return true;
			}
			case 'a':
			case 'A': {
				if (this.multi && (e.ctrlKey || e.metaKey)) {
					selection.selectAll();
					return true;
				}
				return this.options.onUnhandledKey?.(e) ?? false;
			}
			default:
				return this.options.onUnhandledKey?.(e) ?? false;
		}
	}

	/** After a focus move, update the selection per mode: range-extend (Shift+multi) or collapse-to-one. */
	private applyNavSelection(e: KeyboardEvent): void {
		const id = this.options.focus.focusedId;
		if (id == null) return;

		if (this.multi && e.shiftKey) {
			this.options.selection.selectRange(id);
			return;
		}

		if (this.followsFocus) {
			// In multi mode, don't collapse the selection onto a non-member (e.g. a folder cursor) —
			// mirrors the host's branch guard. Single mode still highlights folders via setSingle.
			if (this.multi && !this.options.selection.canSelect(id)) return;

			// Single mode (and multi plain-arrow, VS Code-style) collapses selection to the cursor.
			this.options.selection.setSingle(id);
		}
	}
}
