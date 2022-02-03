import { debug } from '../../system/decorators/log';
import { getLines } from '../../system/string';
import { GitDiff, GitDiffHunk, GitDiffHunkLine, GitDiffLine, GitDiffShortStat } from '../models/diff';
import { GitFile, GitFileStatus } from '../models/file';

const nameStatusDiffRegex = /^(.*?)\t(.*?)(?:\t(.*?))?$/gm;
const shortStatDiffRegex =
	/^\s*(\d+)\sfiles? changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/;
const unifiedDiffRegex = /^@@ -([\d]+)(?:,([\d]+))? \+([\d]+)(?:,([\d]+))? @@(?:.*?)\n([\s\S]*?)(?=^@@)/gm;

export class GitDiffParser {
	@debug({ args: false, singleLine: true })
	static parse(data: string, debug: boolean = false): GitDiff | undefined {
		if (!data) return undefined;

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

		if (!hunks.length) return undefined;

		const diff: GitDiff = {
			diff: debug ? data : undefined,
			hunks: hunks,
		};
		return diff;
	}

	@debug({ args: false, singleLine: true })
	static parseHunk(hunk: GitDiffHunk): { lines: GitDiffHunkLine[]; state: 'added' | 'changed' | 'removed' } {
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
		for (const l of getLines(hunk.diff)) {
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

		return {
			lines: hunkLines,
			state: hasAddedOrChanged && hasRemoved ? 'changed' : hasAddedOrChanged ? 'added' : 'removed',
		};
	}

	@debug({ args: false, singleLine: true })
	static parseNameStatus(data: string, repoPath: string): GitFile[] | undefined {
		if (!data) return undefined;

		const files: GitFile[] = [];

		let status: string;
		let fileName: string;
		let originalFileName: string;

		let match: RegExpExecArray | null;
		do {
			match = nameStatusDiffRegex.exec(data);
			if (match == null) break;

			[, status, fileName, originalFileName] = match;

			files.push({
				repoPath: repoPath,
				status: (!status.startsWith('.') ? status[0].trim() : '?') as GitFileStatus,
				conflictStatus: undefined,
				indexStatus: undefined,
				workingTreeStatus: undefined,
				// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
				path: ` ${fileName}`.substr(1),
				// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
				originalPath:
					originalFileName == null || originalFileName.length === 0
						? undefined
						: ` ${originalFileName}`.substr(1),
			});
		} while (true);

		return files;
	}

	@debug({ args: false, singleLine: true })
	static parseShortStat(data: string): GitDiffShortStat | undefined {
		if (!data) return undefined;

		const match = shortStatDiffRegex.exec(data);
		if (match == null) return undefined;

		const [, files, insertions, deletions] = match;

		const diffShortStat: GitDiffShortStat = {
			changedFiles: files == null ? 0 : parseInt(files, 10),
			additions: insertions == null ? 0 : parseInt(insertions, 10),
			deletions: deletions == null ? 0 : parseInt(deletions, 10),
		};

		return diffShortStat;
	}
}
