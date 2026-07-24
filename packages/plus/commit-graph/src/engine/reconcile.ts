/**
 * Suffix identity reconciliation for prefix changes (fetch / new commits / rebase).
 *
 * A prefix change forces a full engine run (the layout is a forward state machine), which mints
 * all-new row objects — even though everything below the changed region is byte-identical to the
 * prior run (reserved columns are stable and the edge machine converges right after the change).
 * This pass walks both row arrays from the BOTTOM, compares rows byte-wise (topology + column +
 * edges), and swaps the prior row objects back into the new array while they match.
 *
 * Restoring object identity for the unchanged suffix is what lets every identity-keyed consumer
 * (the collapse filter, segment indexes, render caches) splice instead of rebuilding: identical
 * CONTENT is provable only row-by-row, but identical IDENTITY is provable with one `===`.
 */

import type { ProcessedGraphRow, RowEdge, RowEdges } from './types.js';

function edgeEquals(a: RowEdge['starting'], b: RowEdge['starting']): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;
	return a.parentSha === b.parentSha && a.kind === b.kind && a.spansHidden === b.spansHidden;
}

function rowEdgesEqual(a: RowEdges, b: RowEdges): boolean {
	const aKeys = Object.keys(a);
	if (aKeys.length !== Object.keys(b).length) return false;

	for (const key of aKeys) {
		const column = Number(key);
		const ae = a[column];
		const be = b[column];
		if (be == null) return false;
		if (!edgeEquals(ae.starting, be.starting)) return false;
		if (!edgeEquals(ae.ending, be.ending)) return false;
		if (!edgeEquals(ae.passThrough, be.passThrough)) return false;
	}
	return true;
}

function rowEquals(a: ProcessedGraphRow, b: ProcessedGraphRow): boolean {
	if (!rowLayoutEquals(a, b)) return false;
	if (a.edgeColumnMax !== b.edgeColumnMax) return false;
	return rowEdgesEqual(a.edges, b.edges);
}

// Layout-only equality (everything but edges) — used to align a suffix BEFORE the edge pass runs,
// so the edge pass can stop at carry convergence and splice the prior rows (edges included).
function rowLayoutEquals(a: ProcessedGraphRow, b: ProcessedGraphRow): boolean {
	if (a.sha !== b.sha || a.kind !== b.kind || a.date !== b.date) return false;
	if (a.column !== b.column) return false;
	if (a.parents.length !== b.parents.length) return false;

	for (let i = 0; i < a.parents.length; i++) {
		if (a.parents[i] !== b.parents[i]) return false;
	}
	return true;
}

/**
 * Aligns the trailing run of `next` (fresh LAYOUT output — edges not yet computed) against `prior`
 * by layout content only. The edge pass uses the result to stop at carry convergence and splice
 * the prior row objects in wholesale ({@link computeEdges}'s `splice` option). Same alignment
 * semantics as {@link reconcileRowsSuffix} (anchor via locator for cut/grown bottoms), but WITHOUT
 * swapping — the swap happens only for rows the edge pass proves reusable.
 */
export function alignRowsSuffixByLayout(
	prior: readonly ProcessedGraphRow[],
	next: readonly ProcessedGraphRow[],
	priorIndexOfSha?: (sha: string) => number | undefined,
): ReconciledSuffix | undefined {
	if (prior.length === 0 || next.length === 0) return undefined;

	let pi = prior.length - 1;
	let ni = next.length - 1;
	if (prior[pi].sha !== next[ni].sha) {
		const anchor = priorIndexOfSha?.(next[ni].sha);
		if (anchor != null) {
			pi = anchor;
		} else {
			const priorBottomSha = prior[pi].sha;
			const scanFloor = Math.max(0, ni - 10_000);
			let found = -1;
			for (let i = ni; i >= scanFloor; i--) {
				if (next[i].sha === priorBottomSha) {
					found = i;
					break;
				}
			}
			if (found < 0) return undefined;

			ni = found;
		}
	}

	let reused = 0;
	while (pi >= 0 && ni >= 0 && rowLayoutEquals(prior[pi], next[ni])) {
		reused++;
		pi--;
		ni--;
	}
	if (reused === 0) return undefined;

	return { reused: reused, priorStart: pi + 1, nextStart: ni + 1 };
}

/** The aligned spans a suffix reconciliation reused (see {@link reconcileRowsSuffix}). */
export interface ReconciledSuffix {
	/** Number of trailing rows swapped to prior identity. */
	reused: number;
	/** Index (into `prior`) of the first reused row. */
	priorStart: number;
	/** Index (into `next`) of the first reused row. */
	nextStart: number;
}

/**
 * Swaps `prior` row objects into `next` (IN PLACE) for the byte-identical trailing run, walking
 * upward from an alignment anchor and stopping at the first mismatch — the reusable run is
 * contiguous because the forward state machine's output can only diverge from the change upward.
 *
 * The anchor is the bottom row of `next`: hosts commonly reload a FIXED row count, so a prepended
 * commit shifts the shared region down and pushes prior bottom rows out — `priorIndexOfSha` (when
 * provided) locates the anchor inside `prior` so that misalignment doesn't zero the reuse. Rows are
 * compared byte-wise, and a row's output never depends on rows BELOW it, so reuse across a bottom
 * cut is exact. Returns undefined when nothing is reusable.
 */
export function reconcileRowsSuffix(
	prior: readonly ProcessedGraphRow[],
	next: ProcessedGraphRow[],
	priorIndexOfSha?: (sha: string) => number | undefined,
): ReconciledSuffix | undefined {
	if (prior.length === 0 || next.length === 0) return undefined;

	let pi = prior.length - 1;
	let ni = next.length - 1;
	if (prior[pi].sha !== next[ni].sha) {
		// Misaligned bottoms. Cut case (host reloaded a fixed count; prior bottom rows fell off):
		// locate NEXT's bottom inside PRIOR. Grown case (host loaded further than before): locate
		// PRIOR's bottom inside NEXT by scanning upward — the overhang is bounded by a page or two,
		// so cap the scan rather than build a full index.
		const anchor = priorIndexOfSha?.(next[ni].sha);
		if (anchor != null) {
			pi = anchor;
		} else {
			const priorBottomSha = prior[pi].sha;
			const scanFloor = Math.max(0, ni - 10_000);
			let found = -1;
			for (let i = ni; i >= scanFloor; i--) {
				if (next[i].sha === priorBottomSha) {
					found = i;
					break;
				}
			}
			if (found < 0) return undefined;

			ni = found;
		}
	}

	let reused = 0;
	while (pi >= 0 && ni >= 0) {
		const p = prior[pi];
		if (p !== next[ni] && !rowEquals(p, next[ni])) break;

		next[ni] = p;
		reused++;
		pi--;
		ni--;
	}
	if (reused === 0) return undefined;

	return { reused: reused, priorStart: pi + 1, nextStart: ni + 1 };
}
