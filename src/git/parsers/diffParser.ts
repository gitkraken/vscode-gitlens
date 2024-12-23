import { joinPaths, normalizePath } from '../../system/path';
import { maybeStopWatch } from '../../system/stopwatch';
import type { GitDiffFile, GitDiffHunk, GitDiffHunkLine, GitDiffShortStat } from '../models/diff';
import type { GitFile, GitFileStatus } from '../models/file';
import { GitFileChange } from '../models/file';

const shortStatDiffRegex = /(\d+)\s+files? changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/;

function parseHunkHeaderPart(headerPart: string) {
	const [startS, countS] = headerPart.split(',');
	const start = Number(startS);
	const count = Number(countS) || 1;
	return { count: count, position: { start: start, end: start + count - 1 } };
}

export function parseGitFileDiff(data: string, includeContents = false): GitDiffFile | undefined {
	using sw = maybeStopWatch('Git.parseFileDiff', { log: false, logLevel: 'debug' });
	if (!data) return undefined;

	const hunks: GitDiffHunk[] = [];

	const lines = data.split('\n');

	// Skip header
	let i = -1;
	while (++i < lines.length) {
		if (lines[i].startsWith('@@')) {
			break;
		}
	}

	// Parse hunks
	let line;
	while (i < lines.length) {
		line = lines[i];
		if (!line.startsWith('@@')) {
			i++;
			continue;
		}

		const header = line.split('@@')[1].trim();
		const [previousHeaderPart, currentHeaderPart] = header.split(' ');

		const current = parseHunkHeaderPart(currentHeaderPart.slice(1));
		const previous = parseHunkHeaderPart(previousHeaderPart.slice(1));

		const hunkLines = new Map<number, GitDiffHunkLine>();
		let fileLineNumber = current.position.start;

		line = lines[++i];
		const contentStartLine = i;

		// Parse hunks lines
		while (i < lines.length && !line.startsWith('@@')) {
			switch (line[0]) {
				// deleted
				case '-': {
					let deletedLineNumber = fileLineNumber;
					while (line?.startsWith('-')) {
						hunkLines.set(deletedLineNumber++, {
							current: undefined,
							previous: line.slice(1),
							state: 'removed',
						});
						line = lines[++i];
					}

					if (line?.startsWith('+')) {
						let addedLineNumber = fileLineNumber;
						while (line?.startsWith('+')) {
							const hunkLine = hunkLines.get(addedLineNumber);
							if (hunkLine != null) {
								hunkLine.current = line.slice(1);
								hunkLine.state = 'changed';
							} else {
								hunkLines.set(addedLineNumber, {
									current: line.slice(1),
									previous: undefined,
									state: 'added',
								});
							}
							addedLineNumber++;
							line = lines[++i];
						}
						fileLineNumber = addedLineNumber;
					} else {
						fileLineNumber = deletedLineNumber;
					}
					break;
				}
				// added
				case '+':
					hunkLines.set(fileLineNumber++, {
						current: line.slice(1),
						previous: undefined,
						state: 'added',
					});

					line = lines[++i];
					break;

				// unchanged (context)
				case ' ':
					hunkLines.set(fileLineNumber++, {
						current: line.slice(1),
						previous: line.slice(1),
						state: 'unchanged',
					});

					line = lines[++i];
					break;

				default:
					line = lines[++i];
					break;
			}
		}

		const hunk: GitDiffHunk = {
			contents: `${lines.slice(contentStartLine, i).join('\n')}\n`,
			current: current,
			previous: previous,
			lines: hunkLines,
		};

		hunks.push(hunk);
	}

	sw?.stop({ suffix: ` parsed ${hunks.length} hunks` });

	return {
		contents: includeContents ? data : undefined,
		hunks: hunks,
	};
}

export function parseGitDiffNameStatusFiles(data: string, repoPath: string): GitFile[] | undefined {
	using sw = maybeStopWatch('Git.parseDiffNameStatusFiles', { log: false, logLevel: 'debug' });
	if (!data) return undefined;

	const files: GitFile[] = [];

	let status;

	const fields = data.split('\0');
	for (let i = 0; i < fields.length - 1; i++) {
		status = fields[i][0];
		if (status === '.') {
			status = '?';
		}

		let originalPath;
		// Renamed files are old followed by the new path
		if (status === 'R' || status === 'C') {
			originalPath = fields[++i];
		}
		const path = fields[++i];

		files.push({ status: status as GitFileStatus, path: path, originalPath: originalPath, repoPath: repoPath });
	}

	sw?.stop({ suffix: ` parsed ${files.length} files` });

	return files;
}

export function parseGitApplyFiles(data: string, repoPath: string): GitFileChange[] {
	using sw = maybeStopWatch('Git.parseApplyFiles', { log: false, logLevel: 'debug' });
	if (!data) return [];

	const files = new Map<string, GitFileChange>();

	const lines = data.split('\0');
	// remove the summary (last) line to parse later
	const summary = lines.pop();

	for (let line of lines) {
		line = line.trim();
		if (!line) continue;

		const [insertions, deletions, path] = line.split('\t');
		files.set(
			normalizePath(path),
			new GitFileChange(repoPath, path, 'M' as GitFileStatus, undefined, undefined, {
				changes: 0,
				additions: parseInt(insertions, 10),
				deletions: parseInt(deletions, 10),
			}),
		);
	}

	for (let line of summary!.split('\n')) {
		line = line.trim();
		if (!line) continue;

		const match = /(rename) (.*?)\{(.+?)\s+=>\s+(.+?)\}(?: \(\d+%\))|(create|delete) mode \d+ (.+)/.exec(line);
		if (match == null) continue;

		let [, rename, renameRoot, renameOriginalPath, renamePath, createOrDelete, createOrDeletePath] = match;

		if (rename != null) {
			renamePath = normalizePath(joinPaths(renameRoot, renamePath));
			renameOriginalPath = normalizePath(joinPaths(renameRoot, renameOriginalPath));

			const file = files.get(renamePath)!;
			files.set(
				renamePath,
				new GitFileChange(
					repoPath,
					renamePath,
					'R' as GitFileStatus,
					renameOriginalPath,
					undefined,
					file.stats,
				),
			);
		} else {
			const file = files.get(normalizePath(createOrDeletePath))!;
			files.set(
				createOrDeletePath,
				new GitFileChange(
					repoPath,
					file.path,
					(createOrDelete === 'create' ? 'A' : 'D') as GitFileStatus,
					undefined,
					undefined,
					file.stats,
				),
			);
		}
	}

	sw?.stop({ suffix: ` parsed ${files.size} files` });

	return [...files.values()];
}

export function parseGitDiffShortStat(data: string): GitDiffShortStat | undefined {
	using sw = maybeStopWatch('Git.parseDiffShortStat', { log: false, logLevel: 'debug' });
	if (!data) return undefined;

	const match = shortStatDiffRegex.exec(data);
	if (match == null) return undefined;

	const [, files, insertions, deletions] = match;

	const diffShortStat: GitDiffShortStat = {
		files: files == null ? 0 : parseInt(files, 10),
		additions: insertions == null ? 0 : parseInt(insertions, 10),
		deletions: deletions == null ? 0 : parseInt(deletions, 10),
	};

	sw?.stop({
		suffix: ` parsed ${diffShortStat.files} files, +${diffShortStat.additions} -${diffShortStat.deletions}`,
	});

	return diffShortStat;
}
