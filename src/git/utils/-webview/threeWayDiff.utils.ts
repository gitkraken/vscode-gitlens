export type DiffOp = 'equal' | 'insert' | 'delete';

export interface DiffEdit {
	op: DiffOp;
	/** Inclusive start index into the base sequence. */
	baseStart: number;
	/** Exclusive end index into the base sequence. */
	baseEnd: number;
	/** Inclusive start index into the side sequence. */
	sideStart: number;
	/** Exclusive end index into the side sequence. */
	sideEnd: number;
}

export interface SideDiff {
	edits: DiffEdit[];
	/** Indices of lines on this side that are not present in base (added). */
	added: ReadonlySet<number>;
	/** Indices of lines on the base side that are not present on this side (removed). */
	removed: ReadonlySet<number>;
	/** True when no edits were produced (side is identical to base). */
	unchanged: boolean;
}

export interface ThreeWayDiff {
	ours: SideDiff;
	theirs: SideDiff;
	/** True when both sides modify overlapping base ranges. */
	hasOverlappingChanges: boolean;
}

const defaultMaxLinesPerSide = 5000;

export function computeThreeWayDiff(
	base: readonly string[],
	ours: readonly string[],
	theirs: readonly string[],
	options?: { maxLinesPerSide?: number },
): ThreeWayDiff {
	const cap = options?.maxLinesPerSide ?? defaultMaxLinesPerSide;
	const oursDiff = ours.length <= cap && base.length <= cap ? diff(base, ours) : approximateDiff(base, ours);
	const theirsDiff = theirs.length <= cap && base.length <= cap ? diff(base, theirs) : approximateDiff(base, theirs);
	return {
		ours: oursDiff,
		theirs: theirsDiff,
		hasOverlappingChanges: rangesOverlap(oursDiff.edits, theirsDiff.edits),
	};
}

function diff(a: readonly string[], b: readonly string[]): SideDiff {
	const n = a.length;
	const m = b.length;
	if (n === 0 && m === 0) {
		return { edits: [], added: new Set(), removed: new Set(), unchanged: true };
	}

	const dp: Uint32Array[] = new Array(n + 1);
	for (let i = 0; i <= n; i++) {
		dp[i] = new Uint32Array(m + 1);
	}
	for (let i = 1; i <= n; i++) {
		const ai = a[i - 1];
		const row = dp[i];
		const prev = dp[i - 1];
		for (let j = 1; j <= m; j++) {
			if (ai === b[j - 1]) {
				row[j] = prev[j - 1] + 1;
			} else {
				const up = prev[j];
				const left = row[j - 1];
				row[j] = up >= left ? up : left;
			}
		}
	}

	const reversed: DiffEdit[] = [];
	let i = n;
	let j = m;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
			reversed.push({ op: 'equal', baseStart: i - 1, baseEnd: i, sideStart: j - 1, sideEnd: j });
			i--;
			j--;
		} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
			reversed.push({ op: 'insert', baseStart: i, baseEnd: i, sideStart: j - 1, sideEnd: j });
			j--;
		} else {
			reversed.push({ op: 'delete', baseStart: i - 1, baseEnd: i, sideStart: j, sideEnd: j });
			i--;
		}
	}

	const edits: DiffEdit[] = [];
	for (let k = reversed.length - 1; k >= 0; k--) {
		const e = reversed[k];
		const last = edits.at(-1);
		if (last?.op === e.op) {
			last.baseEnd = e.baseEnd;
			last.sideEnd = e.sideEnd;
		} else {
			edits.push({ ...e });
		}
	}

	const added = new Set<number>();
	const removed = new Set<number>();
	for (const e of edits) {
		if (e.op === 'insert') {
			for (let k = e.sideStart; k < e.sideEnd; k++) {
				added.add(k);
			}
		} else if (e.op === 'delete') {
			for (let k = e.baseStart; k < e.baseEnd; k++) {
				removed.add(k);
			}
		}
	}
	return { edits: edits, added: added, removed: removed, unchanged: edits.every(e => e.op === 'equal') };
}

/**
 * Fallback when one of the sides is too large to fit the O(n*m) LCS table. Treats every
 * non-trivial side as fully replaced — coarse, but keeps the editor responsive while large-file
 * support is designed properly.
 */
function approximateDiff(a: readonly string[], b: readonly string[]): SideDiff {
	if (a.length === 0 && b.length === 0) {
		return { edits: [], added: new Set(), removed: new Set(), unchanged: true };
	}

	const edits: DiffEdit[] = [];
	if (a.length > 0) {
		edits.push({ op: 'delete', baseStart: 0, baseEnd: a.length, sideStart: 0, sideEnd: 0 });
	}
	if (b.length > 0) {
		edits.push({ op: 'insert', baseStart: a.length, baseEnd: a.length, sideStart: 0, sideEnd: b.length });
	}
	const added = new Set<number>();
	for (let k = 0; k < b.length; k++) {
		added.add(k);
	}
	const removed = new Set<number>();
	for (let k = 0; k < a.length; k++) {
		removed.add(k);
	}
	return { edits: edits, added: added, removed: removed, unchanged: false };
}

function rangesOverlap(a: readonly DiffEdit[], b: readonly DiffEdit[]): boolean {
	for (const ea of a) {
		if (ea.op === 'equal') continue;

		for (const eb of b) {
			if (eb.op === 'equal') continue;
			if (ea.baseStart < eb.baseEnd && eb.baseStart < ea.baseEnd) return true;
		}
	}
	return false;
}
