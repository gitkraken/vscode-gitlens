/**
 * Framework-agnostic row-adornment provider contract — the engine's sole extension seam. Refs,
 * agent-session badges, stack-position chips, and (later) PR/CI/issue overlays all plug in by
 * implementing `RowAdornmentProvider`. Content type is generic (`TContent`) — the renderer
 * supplies its own template type (Lit `TemplateResult`, a future canvas draw-command, etc.).
 * `describeForA11y` lets each provider contribute a natural-language fragment to the commit
 * row's `aria-label`.
 */

import type { ProcessedGraphRow, Sha } from './types.js';

/**
 * When an adornment should be rendered:
 *   - `true` — always visible
 *   - array — visible when any of the listed row-states are active
 */
export type AdornmentVisibility = true | readonly ('hover' | 'focus' | 'selected')[];

/**
 * Invalidation scope for `RowAdornmentInvalidateEvent`:
 *   - `all` — re-run `provideAdornments` then `resolveAdornment` (use when visibility/context may have changed)
 *   - `content` — re-run `resolveAdornment` only (use when only the rendered content changed)
 */
export type InvalidationType = 'all' | 'content';

/**
 * Event providers dispatch on their `invalidate` EventTarget to tell the engine to
 * recompute (all/content) for the given shas (or all shas if omitted).
 */
export class RowAdornmentInvalidateEvent extends CustomEvent<{
	shas?: Set<Sha>;
	type: InvalidationType;
}> {
	static readonly type = 'invalidate';

	constructor(type: InvalidationType, shas?: Iterable<Sha>) {
		super(RowAdornmentInvalidateEvent.type, {
			detail: { shas: shas ? new Set(shas) : undefined, type: type },
		});
	}
}

/**
 * Per-row adornment configuration returned from `provideRowAdornment`. The renderer caches
 * the resolved content per sha and calls `resolveAdornment(row, context)` lazily when the
 * row actually renders.
 */
export interface RowAdornment<TContext = unknown> {
	/** When the adornment should be shown. Defaults to `true` (always). */
	visibility?: AdornmentVisibility;
	/** Optional per-row data passed back to `resolveAdornment`. */
	context?: TContext;
	/** If true, `resolveAdornment` runs on every render instead of being cached. */
	dynamic?: boolean;
}

/**
 * Consumer-implemented extension point. The engine calls `provideAdornments` for the
 * visible rows and later `resolveAdornment` (for rendering) + `describeForA11y` (for the
 * aria-label) when a specific row becomes active.
 */
/**
 * Where the renderer should slot the rendered adornment in the multi-zone row layout.
 * Defaults to `message` (inline before the commit message). The ref adornment uses
 * `ref` so chips can collapse into their own resizable column; the lane-collapse adornment
 * uses `fold` so its chevrons render in the dedicated fold strip at the lanes' left edge.
 */
export type AdornmentZone = 'fold' | 'ref' | 'message';

export interface RowAdornmentProvider<TContent = unknown, TContext = unknown> {
	/**
	 * Optional render-zone hint (default: `message`).
	 */
	zone?: AdornmentZone;
	/**
	 * PULL-based per-row evaluation: return the adornment config for this row, or undefined
	 * when the row has none. Called only for rows that actually render (the visible window),
	 * so it must be cheap — O(1) lookups against provider-held state, no per-call scans. The
	 * renderer caches the resolved result per sha; providers signal changes via `invalidate`.
	 */
	provideRowAdornment(row: ProcessedGraphRow): RowAdornment<TContext> | undefined;

	/**
	 * Render the adornment for a specific row. Called when the row becomes active. Return
	 * `null` for "nothing to show."
	 */
	resolveAdornment(row: ProcessedGraphRow, context?: TContext): TContent | null | Promise<TContent | null>;

	/**
	 * Contribute a natural-language fragment to the row's aria-label. Called synchronously
	 * during render; must be cheap. Example: `"on branch main"`, `"2 of 4 in stack 'foo'"`.
	 * Return `null` to contribute nothing.
	 */
	describeForA11y?(row: ProcessedGraphRow, context?: TContext): string | null;

	/**
	 * Optional EventTarget. Dispatch `RowAdornmentInvalidateEvent` here to trigger a
	 * recompute. The engine subscribes to `'invalidate'` events on attach.
	 */
	invalidate?: EventTarget;
}

/**
 * Lightweight registry that composes multiple providers. The engine uses this to fan a
 * single row through all registered providers and merge results.
 */
export class AdornmentRegistry<TContent = unknown> {
	private readonly providers: RowAdornmentProvider<TContent>[] = [];

	register(provider: RowAdornmentProvider<TContent>): () => void {
		this.providers.push(provider);
		return () => {
			const i = this.providers.indexOf(provider);
			if (i >= 0) {
				this.providers.splice(i, 1);
			}
		};
	}

	list(): readonly RowAdornmentProvider<TContent>[] {
		return this.providers;
	}
}
