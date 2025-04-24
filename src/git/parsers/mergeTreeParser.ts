import { map } from '../../system/iterable';
import { maybeStopWatch } from '../../system/stopwatch';
import { iterateByDelimiter } from '../../system/string';
import type { MergeConflictFile } from '../models/mergeConflict';

export interface GitMergeConflict {
	treeOid: string;
	conflicts: MergeConflictFile[];
}

export function parseMergeTreeConflict(data: string): GitMergeConflict {
	using sw = maybeStopWatch(`Git.parseMergeTreeConflict`, { log: false, logLevel: 'debug' });

	const lines = iterateByDelimiter(data, '\0');
	const treeOid = lines.next();

	const conflicts = treeOid.done ? [] : [...map(lines, l => ({ path: l }))];

	sw?.stop({ suffix: ` parsed ${conflicts.length} conflicts` });

	return { treeOid: treeOid.value, conflicts: conflicts };
}
