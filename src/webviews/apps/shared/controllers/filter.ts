import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { parseFilterTerms } from '../utils/filter-match.js';

/**
 * `filter` hides non-matching rows (reduces the effective collection); `highlight` keeps every row
 * and dims non-matches. Maps onto the tree's `searchBoxFilter` boolean (true => `filter`).
 */
export type FilterMode = 'filter' | 'highlight';

export interface FilterOptions {
	/** Input debounce in ms (the tree used 150). */
	debounceMs?: number;
	/**
	 * Apply matching for `terms` against the host's data. The host owns the actual matching shape:
	 * a tree runs its recursive parent/child rollup + auto-expand; a flat list flags/reduces rows.
	 * Called with `[]` to clear. Runs synchronously for programmatic sets, post-debounce for input.
	 */
	applyMatch: (terms: string[]) => void;
	/** Re-flatten / re-render hook, run after {@link applyMatch}. */
	onApplied?: () => void;
	/** Raw query text on every change (the tree re-emits this as `gl-tree-filter-changed`). */
	onQueryChanged?: (query: string) => void;
}

/**
 * Owns the interactive search query: text, parsed terms, debounce, and the apply orchestration.
 * Pairs with `filter-match.ts` (the matchers); the host supplies the input UI.
 *
 * Reusable core (L1). The matching itself stays host-shaped via {@link FilterOptions.applyMatch} so a
 * tree keeps its recursion while a flat list filters directly — but query state, term parsing, the
 * debounce, and the synchronous-vs-debounced apply policy live here once. Type-ahead is a SEPARATE
 * navigation concern (keyboard seam), not filtering.
 */
export class FilterController implements ReactiveController {
	private _query = '';
	private _terms: string[] = [];
	private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly host: ReactiveControllerHost,
		private readonly options: FilterOptions,
	) {
		host.addController(this);
	}

	hostConnected(): void {
		/* no-op */
	}

	hostDisconnected(): void {
		clearTimeout(this._debounceTimer);
		this._debounceTimer = undefined;
	}

	get query(): string {
		return this._query;
	}

	get terms(): readonly string[] {
		return this._terms;
	}

	/** Whether a filter is currently active (non-empty query). */
	get isFiltering(): boolean {
		return this._terms.length > 0;
	}

	/**
	 * Set the query. `debounce` (input-driven) defers the apply by `debounceMs`; otherwise (a
	 * programmatic set) it applies synchronously so callers observe results immediately.
	 */
	setQuery(value: string, options?: { debounce?: boolean }): void {
		if (this._query === value && !options?.debounce) {
			// Programmatic set of an unchanged value is a no-op (matches the old setter's dedupe).
			return;
		}

		this._query = value;
		this.options.onQueryChanged?.(value);

		clearTimeout(this._debounceTimer);
		if (options?.debounce) {
			this._debounceTimer = setTimeout(() => this.apply(), this.options.debounceMs ?? 150);
		} else {
			this.apply();
		}
	}

	clear(): void {
		this.setQuery('');
	}

	private apply(): void {
		this._terms = parseFilterTerms(this._query);
		this.options.applyMatch(this._terms);
		this.options.onApplied?.();
		this.host.requestUpdate();
	}
}
