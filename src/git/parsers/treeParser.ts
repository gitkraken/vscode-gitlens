import { maybeStopWatch } from '../../system/stopwatch';
import { iterateByDelimiter } from '../../system/string';
import type { GitTreeEntry } from '../models/tree';

export function parseGitTree(data: string | undefined, ref: string, singleEntry: boolean): GitTreeEntry[] {
	using sw = maybeStopWatch(`Git.parseTree`, { log: false, logLevel: 'debug' });

	const trees: GitTreeEntry[] = [];
	if (!data) {
		sw?.stop({ suffix: ` no data` });
		return trees;
	}

	// Format: <mode> <type> <oid> <size>\t<path>

	let metadata: string;
	let oid: string;
	let size: number;
	let type: 'blob' | 'tree';
	let path: string;

	let startIndex = 0;
	let endIndex = 0;

	// Avoid generator if we are only parsing a single entry
	for (let line of singleEntry ? data.split('\n') : iterateByDelimiter(data, '\n')) {
		line = line.trim();
		if (!line) continue;

		[metadata, path] = line.split(/\t/);

		// Skip mode
		startIndex = metadata.indexOf(' ');
		if (startIndex === -1) continue;

		// Parse type
		startIndex++;
		endIndex = metadata.indexOf(' ', startIndex);
		if (endIndex === -1) continue;

		type = metadata.substring(startIndex, endIndex) as 'blob' | 'tree';

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
