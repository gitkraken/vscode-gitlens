import { map } from '../../system/iterable';
import { getLines } from '../../system/string';
import type { MergeConflictFile } from '../models/mergeConflict';

export interface GitMergeConflict {
	treeOid: string;
	conflicts: MergeConflictFile[];
}

export function parseMergeTreeConflict(data: string): GitMergeConflict {
	const lines = getLines(data, '\0');
	const treeOid = lines.next();
	if (treeOid.done) return { treeOid: treeOid.value, conflicts: [] };

	const conflicts = [...map(lines, l => ({ path: l }))];
	return { treeOid: treeOid.value, conflicts: conflicts };
}
