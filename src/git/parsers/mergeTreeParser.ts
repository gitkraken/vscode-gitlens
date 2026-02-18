import { map } from '../../system/iterable.js';
import { maybeStopWatch } from '../../system/stopwatch.js';
import { iterateByDelimiter } from '../../system/string.js';
import type { MergeConflictFile } from '../models/mergeConflicts.js';

export interface GitMergeConflict {
	treeOid: string;
	conflicts: MergeConflictFile[];
}

export function parseMergeTreeConflict(data: string): GitMergeConflict {
	using sw = maybeStopWatch(`Git.parseMergeTreeConflict`, { log: { onlyExit: true, level: 'debug' } });

	const lines = iterateByDelimiter(data, '\0');
	const treeOid = lines.next();

	const conflicts = treeOid.done ? [] : [...map(lines, l => ({ path: l }))];

	sw?.stop({ suffix: ` parsed ${conflicts.length} conflicts` });

	return { treeOid: treeOid.value, conflicts: conflicts };
}
