import { MRU } from '@gitlens/utils/mru.js';

/** Derived back/forward state shared by the inspect + graph details navigation UI. */
export interface NavigationState {
	count: number;
	position: number;
	canBack: boolean;
	canForward: boolean;
}

/**
 * Browser-style back/forward history over visited commits, shared by both the Inspect panel and
 * the Graph details panel so there is a single navigation implementation. Wraps {@link MRU} using
 * `add` semantics (revisits dedupe, a new visit truncates forward history) and centralizes the
 * button-enablement derivation that used to be duplicated across the inspect backend + frontend.
 */
export class NavigationStack<T extends { sha: string }> {
	private _mru: MRU<T>;
	private _lastEmitted?: NavigationState;

	constructor(
		private readonly maxSize: number = 10,
		private readonly comparator: (a: T, b: T) => boolean = (a, b) => a.sha === b.sha,
		private readonly onChange?: (state: NavigationState) => void,
	) {
		this._mru = new MRU<T>(maxSize, comparator);
	}

	/** Records a newly-visited commit at the front of the stack (deduped, forward history dropped). */
	record(item: T): void {
		this._mru.add(item);
		this.emit();
	}

	back(): T | undefined {
		const item = this._mru.navigate('back');
		if (item != null) {
			this.emit();
		}
		return item;
	}

	forward(): T | undefined {
		const item = this._mru.navigate('forward');
		if (item != null) {
			this.emit();
		}
		return item;
	}

	current(): T | undefined {
		return this._mru.get();
	}

	/** Clears all history (e.g. on repo switch) and emits the empty state. */
	reset(): void {
		this._mru = new MRU<T>(this.maxSize, this.comparator);
		this.emit();
	}

	/** Emits only when the derived state actually changed. The graph fires several selection echoes
	 *  per row switch (focus-row churn / RAF retries); without this, each would push an identical new
	 *  state object and re-render the nav buttons, causing visible jitter. */
	private emit(): void {
		const next = this.state;
		const prev = this._lastEmitted;
		if (
			prev?.count === next.count &&
			prev.position === next.position &&
			prev.canBack === next.canBack &&
			prev.canForward === next.canForward
		) {
			return;
		}

		this._lastEmitted = next;
		this.onChange?.(next);
	}

	get state(): NavigationState {
		const count = this._mru.count;
		const position = this._mru.position;
		// Newest entry is at index 0; `position` is the current entry. A lower index is newer
		// (forward), a higher index is older (back).
		return {
			count: count,
			position: position,
			canForward: position > 0,
			canBack: position < count - 1,
		};
	}
}
