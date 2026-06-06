import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { CollectionIndexController } from './collection-index.js';
import type { FocusStrategy } from './focus.js';
import { FocusController } from './focus.js';
import { KeyboardNavController } from './keyboard-nav.js';
import type { SelectionMode } from './selection.js';
import { SelectionController } from './selection.js';
import { VirtualScrollController } from './virtual-scroll.js';

type Virtualizer = HTMLElement & {
	scrollToIndex?: (index: number, position?: string) => unknown;
	layoutComplete?: Promise<void>;
};

export interface VirtualCollectionOptions<T> {
	getItems: () => readonly T[] | undefined;
	getItemId: (item: T) => string;
	/** Whether a row may be a multi-selection member (folders/sentinels excluded). Default: true. */
	isSelectable?: (item: T) => boolean;
	mode?: () => SelectionMode;
	focusStrategy?: FocusStrategy;
	getVirtualizer: () => Virtualizer | undefined;
	getContainer?: () => HTMLElement | undefined;
	pageSize?: () => number;
	selectionFollowsFocus?: () => boolean;
	onSelectionChange?: () => void;
	onActivate?: (id: string) => void;
	onUnhandledKey?: (e: KeyboardEvent) => boolean;
}

/**
 * Facade that instantiates and wires the L1 sub-controllers (index, scroll, focus, selection,
 * keyboard) and owns the one genuinely bug-prone thing: the cross-concern ORDERING on a data
 * change — rebuild the index, reconcile focus to a surviving row, then prune the selection.
 *
 * Hosts that want the whole machine attach this; hosts that need only a piece (e.g. `rebase.ts`
 * wanting just selection) can attach a sub-controller directly. The sub-controllers remain public
 * so a host can drive them for its own keys (a tree's ArrowLeft/Right, type-ahead) via the seam.
 */
export class VirtualCollectionController<T> implements ReactiveController {
	readonly index: CollectionIndexController<T>;
	readonly scroll: VirtualScrollController;
	readonly focus: FocusController;
	readonly selection: SelectionController;
	readonly keyboard: KeyboardNavController;

	constructor(
		private readonly host: ReactiveControllerHost,
		private readonly options: VirtualCollectionOptions<T>,
	) {
		host.addController(this);

		this.index = new CollectionIndexController<T>(host, {
			getItems: options.getItems,
			getItemId: options.getItemId,
		});

		this.scroll = new VirtualScrollController(host, {
			getVirtualizer: options.getVirtualizer,
			getContainer: options.getContainer,
			getCount: () => this.index.size,
		});

		this.selection = new SelectionController(host, {
			mode: options.mode,
			orderedIds: () => this.index.ids(),
			isSelectable: options.isSelectable != null ? (id: string) => this.isSelectable(id) : undefined,
			onChange: options.onSelectionChange,
		});

		this.focus = new FocusController(host, {
			index: this.index,
			scroll: this.scroll,
			strategy: options.focusStrategy,
			getContainer: options.getContainer,
		});

		this.keyboard = new KeyboardNavController(host, {
			index: this.index,
			focus: this.focus,
			selection: this.selection,
			mode: options.mode ?? (() => 'single'),
			pageSize: options.pageSize,
			selectionFollowsFocus: options.selectionFollowsFocus,
			onActivate: options.onActivate,
			onUnhandledKey: options.onUnhandledKey,
		});
	}

	hostConnected(): void {
		/* sub-controllers self-register */
	}

	hostDisconnected(): void {
		/* sub-controllers self-unregister */
	}

	hostUpdated(): void {
		this.seedAnchor();
	}

	/**
	 * Seed the range pivot from the focused row once, in multi-select, when no anchor exists yet —
	 * otherwise the *first* Shift+click / Shift+Arrow (with no prior plain/Ctrl interaction) has no
	 * anchor and {@link SelectionController.selectRange} collapses to the single clicked/focused row.
	 *
	 * Lives in the facade (not a host) so every collection — this tree and the future virtualized
	 * list — inherits it for free. Runs in `hostUpdated` (after the host commits focus, and after the
	 * synchronous click/keydown handlers), so it can't re-poison the anchor mid-interaction: both the
	 * click path and the keyboard path move focus to the target *before* `selectRange`, so seeding
	 * reactively on focus changes would defeat the range — seeding only on the settled post-update
	 * state, and only when there's no anchor, avoids that. Idempotent (skips once an anchor exists)
	 * and re-seeds from the cursor after a {@link SelectionController.clear}.
	 */
	private seedAnchor(): void {
		if (this.selection.mode !== 'multi' || this.selection.anchorId != null) return;

		const focused = this.focus.focusedId;
		if (focused != null) {
			this.selection.setAnchor(focused);
		}
	}

	private isSelectable(id: string): boolean {
		const predicate = this.options.isSelectable;
		if (predicate == null) return true;

		const item = this.index.itemFor(id);
		return item == null ? false : predicate(item);
	}

	/**
	 * Reconcile all controllers after the effective item list changes (filter, expand/collapse,
	 * model swap). ORDER MATTERS: index first (everything else reads it), then focus reconcile
	 * (keep the cursor on a surviving row), then prune the selection to present ids.
	 */
	onItemsChanged(): void {
		this.index.rebuild();
		this.focus.reconcile();
		this.selection.pruneTo((id: string) => this.index.has(id));
	}

	handleKeydown(e: KeyboardEvent): boolean {
		return this.keyboard.handleKeydown(e);
	}
}
