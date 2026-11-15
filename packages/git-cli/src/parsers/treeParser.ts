import type { GitTreeEntry, GitTreeType } from '@gitlens/git/models/tree.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import { iterateByDelimiter } from '@gitlens/utils/string.js';

export function parseGitTree(data: string | undefined, ref: string, singleEntry: boolean): GitTreeEntry[] {
	using sw = maybeStopWatch(`Git.parseTree`, { log: { onlyExit: true, level: 'debug' } });

	const trees: GitTreeEntry[] = [];
	if (!data) {
		sw?.stop({ suffix: ` no data` });
		return trees;
	}

	// Format (`-z`, so a path is as it is on disk rather than C-quoted): <mode> <type> <oid> <size>\t<path>\0

	let metadata: string;
	let oid: string;
	let size: number;
	let type: GitTreeType;
	let path: string;

	let startIndex: number;
	let endIndex: number;

	// Avoid generator if we are only parsing a single entry
	for (const line of singleEntry ? data.split('\0') : iterateByDelimiter(data, '\0')) {
		if (!line) continue;

		// The first tab ends the metadata; a path can hold tabs itself
		startIndex = line.indexOf('\t');
		if (startIndex === -1) continue;

		metadata = line.substring(0, startIndex);
		path = line.substring(startIndex + 1);

		// Skip mode
		startIndex = metadata.indexOf(' ');
		if (startIndex === -1) continue;

		// Parse type
		startIndex++;
		endIndex = metadata.indexOf(' ', startIndex);
		if (endIndex === -1) continue;

		type = metadata.substring(startIndex, endIndex) as GitTreeType;

		// Parse oid
		startIndex = endIndex + 1;
		endIndex = metadata.indexOf(' ', startIndex);
		if (endIndex === -1) continue;

		oid = metadata.substring(startIndex, endIndex);

		// Parse size
		startIndex = endIndex + 1;

		size = parseInt(metadata.substring(startIndex), 10);

		trees.push({ ref: ref, oid: oid, path: path || '', size: isNaN(size) ? 0 : size, type: type || 'blob' });
	}

	sw?.stop({ suffix: ` parsed ${trees.length} trees` });

	return trees;
}
