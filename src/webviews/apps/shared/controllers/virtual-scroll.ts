import type { ReactiveController, ReactiveControllerHost } from 'lit';

type Virtualizer = HTMLElement & {
	scrollToIndex?: (index: number, position?: string) => unknown;
	layoutComplete?: Promise<void>;
};

export interface VirtualScrollOptions {
	/** The `<lit-virtualizer>` element (the actual scroller). */
	getVirtualizer: () => Virtualizer | undefined;
	/** The focusable container, for restoring focus after a programmatic scroll. */
	getContainer?: () => HTMLElement | undefined;
	/** Current row count (to detect the End row). */
	getCount: () => number;
	/** Whether the virtualizer is its own scroller (the default). When it scrolls with an ancestor instead
	 *  (document flow), setting its `scrollTop` does nothing, so Home/End go through `scrollToIndex` too. */
	isScroller?: () => boolean;
	/** In document flow: the ancestor that scrolls, and the height of one row. The row is then brought into
	 *  view by arithmetic — the virtualizer's own scroll-into-view aims at its first clipping ancestor and
	 *  can't be trusted when several virtualizers share one scroller. */
	getScrollParent?: () => HTMLElement | undefined;
	getRowHeight?: () => number;
}

/**
 * Scrolling over a `<lit-virtualizer>` with the workarounds the tree relied on:
 *  - Home/End (index 0 / last) set `scrollTop` manually because `scrollToIndex` mis-handles large
 *    jumps and can leave a blank viewport.
 *  - Middle rows use `scrollToIndex(index, 'nearest')`.
 *  - Focus is restored to the container after the scroll settles (a programmatic scroll otherwise
 *    steals focus from the keyboard user).
 *
 * Reusable core (L1). Replaces `tree-view`'s `scrollToItem` + the `_scrolling` guard +
 * `kickVirtualizerAfterFirstLayout`.
 */
export class VirtualScrollController implements ReactiveController {
	private _scrolling = false;

	constructor(
		private readonly host: ReactiveControllerHost,
		private readonly options: VirtualScrollOptions,
	) {
		host.addController(this);
	}

	hostConnected(): void {
		/* no-op */
	}

	hostDisconnected(): void {
		this._scrolling = false;
	}

	/** Scroll the row at `index` into view (no-op while a previous scroll is in flight). */
	scrollToIndex(index: number, options?: { restoreFocus?: boolean }): void {
		if (this._scrolling) return;

		this._scrolling = true;
		const restoreFocus = options?.restoreFocus ?? true;

		void this.host.updateComplete.then(
			() => {
				const virtualizer = this.options.getVirtualizer();
				const container = this.options.getContainer?.();
				if (virtualizer == null) {
					this._scrolling = false;
					return;
				}

				const restore = () => {
					if (restoreFocus && container != null && document.activeElement !== container) {
						container.focus();
					}
					this._scrolling = false;
				};

				const scrollParent =
					this.options.isScroller?.() === false ? this.options.getScrollParent?.() : undefined;
				if (scrollParent != null) {
					// Rows are uniform, so the row's place is its index times the row height from the
					// virtualizer's top within the scroller; scroll only as far as needed ('nearest').
					// Scrolling makes virtualizers above render or drop rows and settle their heights, which
					// shifts what's below — so measure again a frame later and correct once more
					const bringIntoView = () => {
						const rowHeight = this.options.getRowHeight?.() ?? 22;
						const top =
							virtualizer.getBoundingClientRect().top -
							scrollParent.getBoundingClientRect().top +
							scrollParent.scrollTop +
							index * rowHeight;
						const bottom = top + rowHeight;
						// A row's height of breathing room on either side, so the row never sits on the edge
						if (top - rowHeight < scrollParent.scrollTop) {
							scrollParent.scrollTop = Math.max(0, top - rowHeight);
						} else if (bottom + rowHeight > scrollParent.scrollTop + scrollParent.clientHeight) {
							scrollParent.scrollTop = bottom + rowHeight - scrollParent.clientHeight;
						}
					};
					bringIntoView();
					requestAnimationFrame(() => {
						bringIntoView();
						requestAnimationFrame(() => {
							bringIntoView();
							restore();
						});
					});
					return;
				}

				const isHome = index === 0;
				const isEnd = index === this.options.getCount() - 1;

				if ((isHome || isEnd) && (this.options.isScroller?.() ?? true)) {
					// scrollToIndex has known issues with large jumps (blank viewport); set scrollTop
					// on the virtualizer (the actual scroller via `scroller`) directly instead.
					requestAnimationFrame(() => {
						if (isHome) {
							virtualizer.scrollTop = 0;
						} else {
							virtualizer.scrollTop = virtualizer.scrollHeight;
						}
						requestAnimationFrame(restore);
					});
				} else {
					requestAnimationFrame(() => {
						const result: unknown = virtualizer.scrollToIndex?.(index, 'nearest');
						if (result != null && typeof (result as { then?: unknown }).then === 'function') {
							void (result as Promise<unknown>).then(restore);
						} else {
							requestAnimationFrame(restore);
						}
					});
				}
			},
			// Never leave the reentrancy guard stuck on a rejected render cycle, or all future
			// scrolls would silently no-op for the component's lifetime.
			() => {
				this._scrolling = false;
			},
		);
	}

	/**
	 * Force a second layout pass after the virtualizer's first (dynamically-imported) layout — its
	 * initial `rangechange` can fire before the layout listener wires up, leaving a blank render
	 * until something else nudges it. Caller supplies the re-slice (reassigning the items array with
	 * a path-keyed diff preserves focus/selection/scroll). Upstream: lit/lit#3472.
	 */
	async kickAfterFirstLayout(reslice: () => void): Promise<void> {
		const virtualizer = this.options.getVirtualizer();
		if (virtualizer == null) return;

		await virtualizer.layoutComplete;
		reslice();
	}
}
