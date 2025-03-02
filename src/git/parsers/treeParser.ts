import { maybeStopWatch } from '../../system/stopwatch';
import type { GitLsFilesEntry, GitTreeEntry } from '../models/tree';

const treeRegex = /(?:.+?)\s+(.+?)\s+(.+?)\s+(.+?)\s+(.+)/gm;
const filesRegex = /^(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/gm;

export function parseGitTree(data: string | undefined, ref: string): GitTreeEntry[] {
	using sw = maybeStopWatch(`Git.parseTree`, { log: false, logLevel: 'debug' });

	const trees: GitTreeEntry[] = [];
	if (!data) return trees;

	let type;
	let oid;
	let size;
	let filePath;

	let match;
	do {
		match = treeRegex.exec(data);
		if (match == null) break;

		[, type, oid, size, filePath] = match;

		trees.push({
			ref: ref,
			// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
			oid: oid == null || oid.length === 0 ? '' : ` ${oid}`.substring(1),
			// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
			path: filePath == null || filePath.length === 0 ? '' : ` ${filePath}`.substring(1),
			size: Number(size) || 0,
			// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
			type: (type == null || type.length === 0 ? '' : ` ${type}`.substring(1)) as 'blob' | 'tree',
		});
	} while (true);

	sw?.stop({ suffix: ` parsed ${trees.length} trees` });

	return trees;
}

export function parseGitLsFiles(data: string | undefined): GitLsFilesEntry[] {
	using sw = maybeStopWatch(`Git.parseLsFiles`, { log: false, logLevel: 'debug' });

	const files: GitLsFilesEntry[] = [];
	if (!data) return files;

	let filePath;
	let mode;
	let oid;
	let stage;

	let match;
	do {
		match = filesRegex.exec(data);
		if (match == null) break;

		[, mode, oid, stage, filePath] = match;

		files.push({
			// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
			mode: mode == null || mode.length === 0 ? '' : ` ${mode}`.substring(1),
			// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
			oid: oid == null || oid.length === 0 ? '' : ` ${oid}`.substring(1),
			// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
			path: filePath == null || filePath.length === 0 ? '' : ` ${filePath}`.substring(1),
			stage: parseInt(stage, 10),
		});
	} while (true);

	sw?.stop({ suffix: ` parsed ${files.length} files` });

	return files;
}
