import type { ProcessedGraphRow } from '@gitkraken/commit-graph/engine/types.js';

/** Returns the nearest real commit date when a visible-range edge lands on a synthetic workdir row. */
export function nearestNonWorkdirDate(
	rows: readonly ProcessedGraphRow[],
	from: number,
	boundInclusive: number,
): number | undefined {
	const step = boundInclusive >= from ? 1 : -1;
	for (let index = from; step > 0 ? index <= boundInclusive : index >= boundInclusive; index += step) {
		const row = rows[index];
		if (row != null && row.kind !== 'workdir') return row.date;
	}

	return rows[from]?.date;
}
