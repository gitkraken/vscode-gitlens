import type { ReactiveController, ReactiveControllerHost } from 'lit';

export interface CollectionIndexOptions<T> {
	/** The current, ordered, effective (post-filter) row list the host renders. */
	getItems: () => readonly T[] | undefined;
	/** Stable identity for a row (e.g. a tree row's `path`, a commit row's `sha`). */
	getItemId: (item: T) => string;
}

/**
 * Maintains `id <-> index` lookups over an ordered, windowed collection so selection, focus, and
 * scrolling can resolve rows by stable id in O(1) — never by DOM index or `nextElementSibling`
 * (fatal under virtualization, where off-window rows have no DOM node).
 *
 * Reusable core (L1): operates on an abstract ordered-id collection and knows nothing about trees,
 * commits, hierarchy, or rendering. Replaces `tree-view`'s `_pathToIndexMap` / `buildPathToIndexMap`
 * / `getItemIndex`. Call {@link rebuild} whenever the effective item list changes.
 */
/** Read-only id<->index surface consumed by Focus/KeyboardNav controllers (decoupled from `T`). */
export interface ReadonlyCollectionIndex {
	readonly size: number;
	indexOf(id: string): number;
	has(id: string): boolean;
	idAt(index: number): string | undefined;
	ids(): string[];
}

export class CollectionIndexController<T> implements ReactiveController, ReadonlyCollectionIndex {
	private _idToIndex = new Map<string, number>();

	constructor(
		host: ReactiveControllerHost,
		private readonly options: CollectionIndexOptions<T>,
	) {
		host.addController(this);
	}

	hostConnected(): void {
		this.rebuild();
	}

	hostDisconnected(): void {
		this._idToIndex.clear();
	}

	/** Rebuild the `id -> index` map from the current items. Call after the item list changes. */
	rebuild(): void {
		this._idToIndex.clear();
		const items = this.options.getItems();
		if (items == null) return;

		for (let i = 0; i < items.length; i++) {
			this._idToIndex.set(this.options.getItemId(items[i]), i);
		}
	}

	get size(): number {
		return this.options.getItems()?.length ?? 0;
	}

	/** Index of `id`, or -1 if not present in the current collection. */
	indexOf(id: string): number {
		return this._idToIndex.get(id) ?? -1;
	}

	has(id: string): boolean {
		return this._idToIndex.has(id);
	}

	itemAt(index: number): T | undefined {
		return this.options.getItems()?.[index];
	}

	idAt(index: number): string | undefined {
		const item = this.itemAt(index);
		return item == null ? undefined : this.options.getItemId(item);
	}

	itemFor(id: string): T | undefined {
		const index = this.indexOf(id);
		return index === -1 ? undefined : this.itemAt(index);
	}

	/** The ordered list of ids (collection order). */
	ids(): string[] {
		const items = this.options.getItems();
		return items == null ? [] : items.map(item => this.options.getItemId(item));
	}
}
