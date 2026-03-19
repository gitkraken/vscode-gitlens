import type { MergeConflictFile } from '@gitlens/git/models/mergeConflicts.js';
import { map } from '@gitlens/utils/iterable.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import { iterateByDelimiter } from '@gitlens/utils/string.js';

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
