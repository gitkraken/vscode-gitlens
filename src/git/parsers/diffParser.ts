import { maybeStopWatch } from '../../system/stopwatch';
import { getLines, pluralize } from '../../system/string';
import type { GitDiffFile, GitDiffHunkLine, GitDiffLine, GitDiffShortStat } from '../models/diff';
import { GitDiffHunk } from '../models/diff';
import type { GitFile, GitFileStatus } from '../models/file';

const shortStatDiffRegex = /(\d+)\s+files? changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/;
const unifiedDiffRegex = /^@@ -([\d]+)(?:,([\d]+))? \+([\d]+)(?:,([\d]+))? @@(?:.*?)\n([\s\S]*?)(?=^@@)/gm;

export function parseFileDiff(data: string, includeContents: boolean = false): GitDiffFile | undefined {
	if (!data) return undefined;

	const sw = maybeStopWatch('parseFileDiff', { log: false, logLevel: 'debug' });

	const hunks: GitDiffHunk[] = [];

	let previousStart;
	let previousCount;
	let currentStart;
	let currentCount;
	let hunk;

	let match;
	do {
		match = unifiedDiffRegex.exec(`${data}\n@@`);
		if (match == null) break;

		[, previousStart, previousCount, currentStart, currentCount, hunk] = match;

		previousCount = Number(previousCount) || 0;
		previousStart = Number(previousStart) || 0;
		currentCount = Number(currentCount) || 0;
		currentStart = Number(currentStart) || 0;

		hunks.push(
			new GitDiffHunk(
				// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
				` ${hunk}`.substr(1),
				{
					count: currentCount === 0 ? 1 : currentCount,
					position: {
						start: currentStart,
						end: currentStart + (currentCount > 0 ? currentCount - 1 : 0),
					},
				},
				{
					count: previousCount === 0 ? 1 : previousCount,
					position: {
						start: previousStart,
						end: previousStart + (previousCount > 0 ? previousCount - 1 : 0),
					},
				},
			),
		);
	} while (true);

	sw?.stop({ suffix: ` parsed ${pluralize('hunk', hunks.length)}` });

	if (!hunks.length) return undefined;

	const diff: GitDiffFile = {
		contents: includeContents ? data : undefined,
		hunks: hunks,
	};
	return diff;
}

export function parseDiffHunk(hunk: GitDiffHunk): { lines: GitDiffHunkLine[]; state: 'added' | 'changed' | 'removed' } {
	const sw = maybeStopWatch('parseDiffHunk', { log: false, logLevel: 'debug' });

	const currentStart = hunk.current.position.start;
	const previousStart = hunk.previous.position.start;

	const currentLines: (GitDiffLine | undefined)[] =
		currentStart > previousStart
			? new Array(currentStart - previousStart).fill(undefined, 0, currentStart - previousStart)
			: [];
	const previousLines: (GitDiffLine | undefined)[] =
		previousStart > currentStart
			? new Array(previousStart - currentStart).fill(undefined, 0, previousStart - currentStart)
			: [];

	let hasAddedOrChanged;
	let hasRemoved;

	let removed = 0;
	for (const l of getLines(hunk.contents)) {
		switch (l[0]) {
			case '+':
				hasAddedOrChanged = true;
				currentLines.push({
					line: ` ${l.substring(1)}`,
					state: 'added',
				});

				if (removed > 0) {
					removed--;
				} else {
					previousLines.push(undefined);
				}

				break;

			case '-':
				hasRemoved = true;
				removed++;

				previousLines.push({
					line: ` ${l.substring(1)}`,
					state: 'removed',
				});

				break;

			default:
				while (removed > 0) {
					removed--;
					currentLines.push(undefined);
				}

				currentLines.push({ line: l, state: 'unchanged' });
				previousLines.push({ line: l, state: 'unchanged' });

				break;
		}
	}

	while (removed > 0) {
		removed--;
		currentLines.push(undefined);
	}

	const hunkLines: GitDiffHunkLine[] = [];

	for (let i = 0; i < Math.max(currentLines.length, previousLines.length); i++) {
		hunkLines.push({
			hunk: hunk,
			current: currentLines[i],
			previous: previousLines[i],
		});
	}

	sw?.stop({ suffix: ` parsed ${pluralize('line', hunkLines.length)}` });

	return {
		lines: hunkLines,
		state: hasAddedOrChanged && hasRemoved ? 'changed' : hasAddedOrChanged ? 'added' : 'removed',
	};
}

export function parseDiffNameStatusFiles(data: string, repoPath: string): GitFile[] | undefined {
	if (!data) return undefined;

	const sw = maybeStopWatch('parseDiffNameStatusFiles', { log: false, logLevel: 'debug' });

	const files: GitFile[] = [];

	let status;

	const fields = data.split('\0');
	for (let i = 0; i < fields.length - 1; i++) {
		status = fields[i][0];
		if (status === '.') {
			status = '?';
		}

		files.push({
			status: status as GitFileStatus,
			path: fields[++i],
			originalPath: status.startsWith('R') || status.startsWith('C') ? fields[++i] : undefined,
			repoPath: repoPath,
		});
	}

	sw?.stop({ suffix: ` parsed ${pluralize('file', files.length)}` });

	return files;
}

export function parseDiffShortStat(data: string): GitDiffShortStat | undefined {
	if (!data) return undefined;

	const sw = maybeStopWatch('parseDiffShortStat', { log: false, logLevel: 'debug' });

	const match = shortStatDiffRegex.exec(data);
	if (match == null) return undefined;

	const [, files, insertions, deletions] = match;

	const diffShortStat: GitDiffShortStat = {
		changedFiles: files == null ? 0 : parseInt(files, 10),
		additions: insertions == null ? 0 : parseInt(insertions, 10),
		deletions: deletions == null ? 0 : parseInt(deletions, 10),
	};

	sw?.stop({
		suffix: ` parsed ${pluralize('file', diffShortStat.changedFiles)}, +${diffShortStat.additions} -${
			diffShortStat.deletions
		}`,
	});

	return diffShortStat;
}
