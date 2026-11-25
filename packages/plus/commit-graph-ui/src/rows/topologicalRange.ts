export interface TopologicalRangeRow {
	readonly sha: string;
	readonly parents?: readonly string[];
}

export function walkTopologicalRange(
	rows: readonly TopologicalRangeRow[],
	indexBySha: ReadonlyMap<string, number>,
	fromSha: string,
	toSha: string,
): string[] {
	const fromIdx = indexBySha.get(fromSha);
	const toIdx = indexBySha.get(toSha);
	if (fromIdx == null || toIdx == null) return [];

	const startSha = fromIdx < toIdx ? fromSha : toSha;
	const endSha = fromIdx < toIdx ? toSha : fromSha;

	const out: string[] = [];
	const seen = new Set<string>();
	let cursor: string | undefined = startSha;
	while (cursor != null && !seen.has(cursor)) {
		seen.add(cursor);
		out.push(cursor);
		if (cursor === endSha) return out;

		const idx = indexBySha.get(cursor);
		if (idx == null) break;

		cursor = rows[idx]?.parents?.[0];
	}

	return [startSha, endSha];
}
