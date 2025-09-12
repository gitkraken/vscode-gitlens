import type { Container } from '../../container';
import { joinPaths, normalizePath } from '../../system/path';
import { maybeStopWatch } from '../../system/stopwatch';
import type {
	GitDiffShortStat,
	ParsedGitDiff,
	ParsedGitDiffFileMetadata,
	ParsedGitDiffHunk,
	ParsedGitDiffHunkLine,
	ParsedGitDiffHunks,
} from '../models/diff';
import type { GitFile } from '../models/file';
import { GitFileChange } from '../models/fileChange';
import type { GitFileStatus } from '../models/fileStatus';
import { GitFileIndexStatus } from '../models/fileStatus';

export const diffRegex = /^diff --git a\/(.*) b\/(.*)$/;
export const diffHunkRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const diffStatusRegex =
	/^(?:(new file mode)|(deleted file mode)|(rename (?:from|to))|(copy (?:from|to))|(old mode|new mode)|(@@ -)|(Binary files .+ differ))/m;
const shortStatDiffRegex = /(\d+)\s+files? changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/;

interface ParsedGitDiffFileResult {
	status: GitFileStatus;
	metadata: ParsedGitDiffFileMetadata;
}

function parseFileStatusAndMetadata(
	content: string,
	originalPath: string,
	path: string,
	hasHunks: boolean,
): ParsedGitDiffFileResult {
	// Use a single regex to find all relevant patterns at once
	const matches = content.match(diffStatusRegex);

	// Initialize metadata
	let isBinary = false;
	let modeChanged = false;
	let oldMode: string | undefined;
	let newMode: string | undefined;
	let similarity: number | undefined;
	let status: GitFileStatus;

	if (matches) {
		const [, newFile, deletedFile, rename, copy, modeChange, _hunks, binary] = matches;

		// Extract metadata from matches
		isBinary = Boolean(binary);
		modeChanged = Boolean(modeChange);

		// Determine status based on found patterns (priority order)
		if (newFile) {
			status = GitFileIndexStatus.Added;
		} else if (deletedFile) {
			status = GitFileIndexStatus.Deleted;
		} else if (rename) {
			status = GitFileIndexStatus.Renamed;
		} else if (copy) {
			status = GitFileIndexStatus.Copied;
		} else if (binary) {
			status = path !== originalPath ? GitFileIndexStatus.Renamed : GitFileIndexStatus.Modified;
		} else if (modeChange && !hasHunks) {
			status = GitFileIndexStatus.TypeChanged;
		} else {
			// Default logic based on path comparison
			status = path !== originalPath ? GitFileIndexStatus.Renamed : GitFileIndexStatus.Modified;
		}
	} else {
		// Default logic based on path comparison
		status = path !== originalPath ? GitFileIndexStatus.Renamed : GitFileIndexStatus.Modified;
	}

	// Extract mode information if we detected a mode change
	if (modeChanged) {
		const oldModeMatch = content.match(/old mode (\d+)/);
		const newModeMatch = content.match(/new mode (\d+)/);
		if (oldModeMatch) {
			oldMode = oldModeMatch[1];
		}
		if (newModeMatch) {
			newMode = newModeMatch[1];
		}
	}

	// Extract similarity for renames/copies
	if (status === GitFileIndexStatus.Renamed || status === GitFileIndexStatus.Copied) {
		const similarityMatch = content.match(/similarity index (\d+)%/);
		if (similarityMatch) {
			similarity = parseInt(similarityMatch[1], 10);
		}
	}

	const metadata: ParsedGitDiffFileMetadata = {
		binary: isBinary,
		modeChanged: modeChanged ? { oldMode: oldMode!, newMode: newMode! } : false,
		renamedOrCopied:
			status === GitFileIndexStatus.Renamed || status === GitFileIndexStatus.Copied
				? { similarity: similarity }
				: false,
	};

	return { status: status, metadata: metadata };
}

function parseHunkHeaderPart(headerPart: string) {
	const [startS, countS] = headerPart.split(',');
	const start = Number(startS);
	const count = Number(countS) || 1;
	return { count: count, position: { start: start, end: start + count - 1 } };
}

export function parseGitDiff(data: string, includeRawContent = false): ParsedGitDiff {
	using sw = maybeStopWatch('Git.parseDiffFiles', { log: false, logLevel: 'debug' });

	const parsed: ParsedGitDiff = { files: [], rawContent: includeRawContent ? data : undefined };

	// Split the diff data into file chunks
	const files = data.split(/^diff --git /m).filter(Boolean);
	if (!files.length) {
		sw?.stop({ suffix: ` parsed no files` });
		return parsed;
	}

	for (const file of files) {
		const [line] = file.split('\n', 1);

		const match = diffRegex.exec(`diff --git ${line}`);
		if (match == null) continue;

		const [, originalPath, path] = match;

		// Check for hunks and parse file status and metadata in a single pass
		const hunkStartIndex = file.indexOf('\n@@ -');
		const hasHunks = hunkStartIndex !== -1;
		const { status, metadata } = parseFileStatusAndMetadata(file, originalPath, path, hasHunks);

		let header: string;
		let rawContent: string | undefined;
		let hunks: ParsedGitDiffHunk[];

		if (!hasHunks) {
			// No hunks - file without content changes (renames, mode changes, etc.)
			header = `diff --git ${file}`;
			rawContent = includeRawContent ? file : undefined;
			hunks = [];
		} else {
			// Has hunks - extract header and content efficiently
			header = `diff --git ${file.substring(0, hunkStartIndex)}`;
			const content = file.substring(hunkStartIndex + 1);
			rawContent = includeRawContent ? content : undefined;
			hunks = parseGitFileDiff(content, includeRawContent)?.hunks || [];
		}

		parsed.files.push({
			path: path,
			originalPath: path === originalPath ? undefined : originalPath,
			status: status,
			header: header,
			rawContent: rawContent,
			hunks: hunks,
			metadata: metadata,
		});
	}

	sw?.stop({ suffix: ` parsed ${parsed.files.length} files` });

	return parsed;
}

export function parseGitFileDiff(data: string, includeRawContent = false): ParsedGitDiffHunks | undefined {
	using sw = maybeStopWatch('Git.parseFileDiff', { log: false, logLevel: 'debug' });
	if (!data) {
		sw?.stop({ suffix: ` no data` });
		return undefined;
	}

	const hunks: ParsedGitDiffHunk[] = [];

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

		const header = line;
		const [previousHeaderPart, currentHeaderPart] = header.split('@@')[1].trim().split(' ');

		const current = parseHunkHeaderPart(currentHeaderPart.slice(1));
		const previous = parseHunkHeaderPart(previousHeaderPart.slice(1));

		const hunkLines = new Map<number, ParsedGitDiffHunkLine>();
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

		const hunk: ParsedGitDiffHunk = {
			header: header,
			content: lines.slice(contentStartLine, i).join('\n'),
			current: current,
			previous: previous,
			lines: hunkLines,
		};

		hunks.push(hunk);
	}

	sw?.stop({ suffix: ` parsed ${hunks.length} hunks` });

	return {
		rawContent: includeRawContent ? data : undefined,
		hunks: hunks,
	};
}

export function parseGitDiffNameStatusFiles(data: string, repoPath: string): GitFile[] | undefined {
	using sw = maybeStopWatch('Git.parseDiffNameStatusFiles', { log: false, logLevel: 'debug' });
	if (!data) {
		sw?.stop({ suffix: ` no data` });
		return undefined;
	}

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

export function parseGitApplyFiles(container: Container, data: string, repoPath: string): GitFileChange[] {
	using sw = maybeStopWatch('Git.parseApplyFiles', { log: false, logLevel: 'debug' });
	if (!data) {
		sw?.stop({ suffix: ` no data` });
		return [];
	}

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
			new GitFileChange(container, repoPath, path, 'M' as GitFileStatus, undefined, undefined, {
				changes: 0,
				additions: parseInt(insertions, 10),
				deletions: parseInt(deletions, 10),
			}),
		);
	}

	for (let line of summary!.split('\n')) {
		line = line.trim();
		if (!line) continue;

		const match = /(rename) (.*?)\{?([^{]+?)\s+=>\s+(.+?)\}?(?: \(\d+%\))|(create|delete) mode \d+ (.+)/.exec(line);
		if (match == null) continue;

		let [, rename, renameRoot, renameOriginalPath, renamePath, createOrDelete, createOrDeletePath] = match;

		if (rename != null) {
			renamePath = normalizePath(joinPaths(renameRoot, renamePath));
			renameOriginalPath = normalizePath(joinPaths(renameRoot, renameOriginalPath));

			const file = files.get(renamePath)!;
			files.set(
				renamePath,
				new GitFileChange(
					container,
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
					container,
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
	if (!data) {
		sw?.stop({ suffix: ` no data` });
		return undefined;
	}

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
