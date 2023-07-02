import { debug } from '../../system/decorators/log';
import { getLines } from '../../system/string';
import type { GitDiff, GitDiffHunkLine, GitDiffLine, GitDiffShortStat } from '../models/diff';
import { GitDiffHunk } from '../models/diff';
import type { GitFile, GitFileStatus } from '../models/file';

const shortStatDiffRegex = /(\d+)\s+files? changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/;
const unifiedDiffRegex = /^@@ -([\d]+)(?:,([\d]+))? \+([\d]+)(?:,([\d]+))? @@(?:.*?)\n([\s\S]*?)(?=^@@)/gm;

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class GitDiffParser {
	@debug({ args: false, singleLine: true })
	static parse(data: string, includeRawDiff: boolean = false): GitDiff | undefined {
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
			diff: includeRawDiff ? data : undefined,
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
				originalPath: status[0] === 'R' || status[0] === 'C' ? fields[++i] : undefined,
				repoPath: repoPath,
			});
		}

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
