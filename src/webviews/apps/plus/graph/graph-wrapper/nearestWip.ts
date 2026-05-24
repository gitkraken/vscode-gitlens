import type { ColumnNumberBySha, GraphRow, ReadonlyGraphRow } from '@gitkraken/gitkraken-components';
import { uncommitted } from '@gitlens/git/models/revision.js';

type Row = GraphRow | ReadonlyGraphRow;

export interface WipCandidate {
	sha: string;
	anchor: string;
}

/**
 * Restricts WIP candidates to those whose `anchor` is rendered in the same graph column as
 * `fromSha`. Returns the input untouched when `columnsBySha` is undefined or when `fromSha`'s
 * column isn't known yet — callers should treat that as "lane filter unavailable" and fall
 * through to whatever the rest of the pipeline does.
 */
export function filterWipsInLaneOf(
	fromSha: string,
	wips: readonly WipCandidate[],
	columnsBySha: ColumnNumberBySha | undefined,
): readonly WipCandidate[] {
	if (columnsBySha == null) return wips;

	const fromColumn = columnsBySha[fromSha];
	if (fromColumn == null) return wips;

	return wips.filter(w => columnsBySha[w.anchor] === fromColumn);
}

export function findNearestWipSha(
	fromSha: string,
	wips: readonly WipCandidate[],
	rows: readonly Row[] | undefined,
): string | undefined {
	if (wips.length === 0) return undefined;

	const rowsBySha = new Map<string, Row>();
	if (rows != null) {
		for (const row of rows) {
			rowsBySha.set(row.sha, row);
		}
	}

	let best: { sha: string; distance: number } | undefined;
	for (const wip of wips) {
		const distance = bfsAncestorDistance(wip.anchor, fromSha, rowsBySha, rowsBySha.size);
		if (distance === -1) continue;

		if (best == null || distance < best.distance) {
			best = { sha: wip.sha, distance: distance };
		}
	}

	if (best != null) return best.sha;

	return wips.find(w => w.sha === uncommitted)?.sha ?? wips[0].sha;
}

function bfsAncestorDistance(
	start: string,
	target: string,
	rowsBySha: ReadonlyMap<string, Row>,
	maxVisit: number,
): number {
	if (start === target) return 0;

	const visited = new Set<string>([start]);
	let frontier: string[] = [start];
	let distance = 0;
	while (frontier.length > 0 && visited.size <= maxVisit) {
		distance++;
		const next: string[] = [];
		for (const sha of frontier) {
			const row = rowsBySha.get(sha);
			if (row == null) continue;

			for (const parent of row.parents ?? []) {
				if (visited.has(parent)) continue;
				if (parent === target) return distance;

				visited.add(parent);
				next.push(parent);
			}
		}
		frontier = next;
	}
	return -1;
}
