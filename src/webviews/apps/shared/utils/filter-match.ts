import { html } from 'lit';

/**
 * Shared text-matching primitives for filtering/searching virtualized collections.
 *
 * Lifted verbatim (behavior-identical) from the private helpers that used to live inside
 * `tree-view.ts` so they can be reused by `FilterController` and any other list/tree consumer.
 * These operate on a SINGLE flat row's searchable text — hierarchy (parent/child match rollup,
 * auto-expand of matching branches) stays in the tree layer, which wraps `matchesTerms` per node.
 */

/** Characters that participate in type-to-filter (matches VS Code's filterable set). */
export const filterableCharRegex = /^[a-zA-Z0-9\s\-_.]$/;

/** Split a raw query into independent lowercased terms (whitespace-separated, AND semantics). */
export function parseFilterTerms(query: string): string[] {
	return query
		.toLowerCase()
		.trim()
		.split(/\s+/)
		.filter(t => t.length > 0);
}

/**
 * Fuzzy (subsequence) match: returns the matched character indices in `text` for `filter`, or
 * `undefined` if `filter` is not a subsequence of `text`. Both are expected lowercased by callers.
 */
export function fuzzyMatch(text: string, filter: string): number[] | undefined {
	let fromIndex = 0;
	const matchedIndices: number[] = [];

	for (const char of filter) {
		const index = text.indexOf(char, fromIndex);
		if (index === -1) return undefined;

		matchedIndices.push(index);
		fromIndex = index + 1;
	}

	return matchedIndices;
}

/**
 * Per-row match used by both the tree's recursive rollup and flat-list filtering. All terms must
 * match (AND). Exact substring is used for `filterText` (e.g. the full path in tree mode) to avoid
 * false positives from fuzzy-matching across long paths; fuzzy matching is reserved for the
 * displayed `label`.
 */
export function matchesTerms(
	fields: { label?: string; filterText?: string; description?: string },
	terms: string[],
): boolean {
	if (terms.length === 0) return true;

	const labelLower = (fields.label ?? '').toLowerCase();
	const filterTextLower = fields.filterText?.toLowerCase();
	const descLower = fields.description?.toLowerCase();

	return terms.every(
		term =>
			filterTextLower?.includes(term) ||
			labelLower.includes(term) ||
			fuzzyMatch(labelLower, term) != null ||
			descLower?.includes(term),
	);
}

/**
 * Collect the sorted, de-duplicated character indices in `text` that match any of `terms`
 * (exact-substring first, then fuzzy). Used to render `<mark>` highlights.
 */
export function collectHighlightIndices(text: string, terms: string[]): number[] {
	if (terms.length === 0) return [];

	const lowerText = text.toLowerCase();
	const allIndices = new Set<number>();
	for (const term of terms) {
		const idx = lowerText.indexOf(term);
		if (idx !== -1) {
			for (let i = idx; i < idx + term.length; i++) {
				allIndices.add(i);
			}
			continue;
		}

		const matched = fuzzyMatch(lowerText, term);
		if (matched != null) {
			for (const i of matched) {
				allIndices.add(i);
			}
		}
	}

	if (allIndices.size === 0) return [];

	return [...allIndices].sort((a, b) => a - b);
}

/** Wrap the matched character `indices` of `text` in `<mark>` for highlighted rendering. */
export function renderFuzzyHighlight(text: string, indices: number[]): unknown {
	if (indices.length === 0) return text;

	const result: unknown[] = [];
	let lastIndex = 0;

	for (const index of indices) {
		if (index >= text.length) break;

		if (index > lastIndex) {
			result.push(text.slice(lastIndex, index));
		}
		result.push(html`<mark>${text.slice(index, index + 1)}</mark>`);
		lastIndex = index + 1;
	}

	if (lastIndex < text.length) {
		result.push(text.slice(lastIndex));
	}

	return result;
}
