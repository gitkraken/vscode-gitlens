/** Aligns unchanged layout spans so the edge pass can prove and restore suffix identity. */

import type { ProcessedGraphRow } from './types.js';

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
 * the prior row objects in wholesale. A locator aligns cut bottoms; a bounded scan aligns grown
 * bottoms. The swap happens only for rows the edge pass proves reusable.
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

/** Aligned spans identified by layout matching or proven reusable by the edge pass. */
export interface ReconciledSuffix {
	/** Number of matching rows in the aligned span. */
	reused: number;
	/** Index (into `prior`) of the first matching row. */
	priorStart: number;
	/** Index (into `next`) of the first matching row. */
	nextStart: number;
}
