import type { WorkDirStats } from './contracts/state.js';

export function hasDirtyCounts(stats: Partial<WorkDirStats> | undefined): boolean {
	if (stats == null) return false;

	return (stats.added ?? 0) + (stats.modified ?? 0) + (stats.deleted ?? 0) + (stats.renamed ?? 0) > 0;
}
