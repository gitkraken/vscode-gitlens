import { normalizePath } from '@gitlens/utils/path.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import { fileUri, joinUriPath } from '@gitlens/utils/uri.js';
import type {
	GitDiffShortStat,
	ParsedGitDiff,
	ParsedGitDiffFile,
	ParsedGitDiffFileMetadata,
	ParsedGitDiffHunk,
	ParsedGitDiffHunkLine,
	ParsedGitDiffHunks,
} from '../models/diff.js';
import type { GitFile } from '../models/file.js';
import { GitFileChange } from '../models/fileChange.js';
import type { GitFileStatus } from '../models/fileStatus.js';
import { GitFileIndexStatus } from '../models/fileStatus.js';

export const diffRegex = /^diff --git a\/(.*) b\/(.*)$/;
export const diffHunkRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const diffStatusRegex =
	/^(?:(new file mode)|(deleted file mode)|(rename (?:from|to))|(copy (?:from|to))|(old mode|new mode)|(@@ -)|(Binary files .+ differ))/m;
const shortStatDiffRegex = /(\d+)\s+files? changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/;
const oldModeRegex = /old mode (\d+)/;
const newModeRegex = /new mode (\d+)/;
const similarityRegex = /similarity index (\d+)%/;
const diffGitSplitRegex = /^diff --git /m;
const diffGitLookaheadRegex = /^(?=diff --git )/m;
// Matches summary lines from `git diff --summary` and `git apply --summary`:
//   ` rename [prefix/]{old => new}[/suffix] (XX%)` or ` rename old => new (XX%)`
//   ` copy   [prefix/]{old => new}[/suffix] (XX%)` or ` copy   old => new (XX%)`
//   ` create|delete mode XXXXXX path`
//   ` mode change XXXXXX => YYYYYY path`
// The rename/copy alternative captures four parts so compact mid-form paths like
// `a/b/{c => d}/e.txt` reconstruct correctly: prefix + oldLeaf + suffix and prefix + newLeaf + suffix.
// `[^}]+` on the new-leaf forces greedy-with-backtracking so the leaf anchors at `}` in compact forms
// and at ` (XX%)` otherwise — lazy `(.+?)` would push content into the suffix group.
const diffSummaryRegex =
	/(rename|copy) (.*?)\{?([^{]+?)\s+=>\s+([^}]+)\}?(.*?)(?: \(\d+%\))|(create|delete) mode \d+ (.+)|mode change (\d+) => (\d+) (.+)/;

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
		const oldModeMatch = content.match(oldModeRegex);
		const newModeMatch = content.match(newModeRegex);
		if (oldModeMatch) {
			oldMode = oldModeMatch[1];
		}
		if (newModeMatch) {
			newMode = newModeMatch[1];
		}
	}

	// Extract similarity for renames/copies
	if (status === GitFileIndexStatus.Renamed || status === GitFileIndexStatus.Copied) {
		const similarityMatch = content.match(similarityRegex);
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
	using sw = maybeStopWatch('Git.parseDiffFiles', { log: { onlyExit: true, level: 'debug' } });

	const parsed: ParsedGitDiff = { files: [], rawContent: includeRawContent ? data : undefined };

	// Split the diff data into file chunks
	const files = data.split(diffGitSplitRegex).filter(Boolean);
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

/**
 * Filters a diff string, keeping only files whose paths are returned by the predicate.
 * @param diff The raw diff string
 * @param getIncludedPaths Predicate that receives all file paths and returns the paths to include
 * @returns Filtered diff with only included files, or the original diff if no files were excluded
 */
export async function filterDiffFiles(
	diff: string,
	getIncludedPaths: (paths: string[]) => string[] | Promise<string[]>,
): Promise<string> {
	if (!diff) return diff;

	// Split into file chunks at "diff --git" boundaries (lookahead keeps the delimiter)
	const chunks = diff.split(diffGitLookaheadRegex).filter(Boolean);
	if (!chunks.length) return diff;

	// Extract path from each chunk's header line
	const filesWithChunks = chunks.map(chunk => {
		const match = diffRegex.exec(chunk.split('\n', 1)[0]);
		return { path: match?.[2] ?? '', chunk: chunk };
	});

	const allPaths = filesWithChunks.map(f => f.path);
	const includedPaths = await getIncludedPaths(allPaths);

	if (includedPaths.length === allPaths.length) return diff;

	return filesWithChunks
		.filter(f => includedPaths.includes(f.path))
		.map(f => f.chunk)
		.join('');
}

/** Counts insertions and deletions from a parsed diff file */
export function countDiffInsertionsAndDeletions(file: ParsedGitDiffFile): { insertions: number; deletions: number } {
	let insertions = 0;
	let deletions = 0;
	for (const hunk of file.hunks) {
		insertions += hunk.current.count;
		deletions += hunk.previous.count;
	}
	return { insertions: insertions, deletions: deletions };
}

/** Counts approximate number of changed lines in a diff file */
export function countDiffLines(file: ParsedGitDiffFile): number {
	let count = 0;
	for (const hunk of file.hunks) {
		count += hunk.current.count + hunk.previous.count;
	}
	return count;
}

export function parseGitFileDiff(data: string, includeRawContent = false): ParsedGitDiffHunks | undefined {
	using sw = maybeStopWatch('Git.parseFileDiff', { log: { onlyExit: true, level: 'debug' } });
	if (!data) {
		sw?.stop({ suffix: ` no data` });
		return undefined;
	}

	const hunks: ParsedGitDiffHunk[] = [];

	const lines = data.split('\n');

	// Skip header — match standard hunk headers only (`@@ ... @@`), NOT combined-diff headers (`@@@ ... @@@`)
	let i = -1;
	while (++i < lines.length) {
		if (lines[i].startsWith('@@ ')) {
			break;
		}
	}

	// Parse hunks
	let line;
	while (i < lines.length) {
		line = lines[i];
		if (!line.startsWith('@@ ')) {
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
		while (i < lines.length && !line.startsWith('@@ ')) {
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
	using sw = maybeStopWatch('Git.parseDiffNameStatusFiles', { log: { onlyExit: true, level: 'debug' } });
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
			if (i + 1 >= fields.length - 1) break;

			originalPath = fields[++i];
		}
		if (i + 1 >= fields.length) break;

		const path = fields[++i];

		files.push({ status: status as GitFileStatus, path: path, originalPath: originalPath, repoPath: repoPath });
	}

	sw?.stop({ suffix: ` parsed ${files.length} files` });

	return files;
}

/**
 * Parses the output of `git diff --numstat --summary -z`.
 *
 * Numstat records are null-separated:
 *   `additions\tdeletions\tpath\0`
 * Renames and copies have an empty path followed by two additional null-separated fields:
 *   `additions\tdeletions\t\0oldPath\0newPath\0`
 * The summary section (if any) follows the final null byte as newline-separated lines:
 *   ` create mode 100644 path`
 *   ` delete mode 100644 path`
 *   ` rename old => new (100%)`
 *   ` copy old => new (85%)`
 *   ` mode change 100644 => 120000 path`
 *
 * Numstat alone cannot distinguish: rename vs. copy, or modified vs. type-changed.
 * The summary pass refines those statuses: copies are promoted to `C`, and mode changes
 * that cross the file-type boundary (regular file ↔ symlink ↔ gitlink, i.e. the high two
 * octal digits differ) are promoted to `T`.
 */
export function parseGitDiffNumStatFiles(data: string, repoPath: string): GitFile[] | undefined {
	using sw = maybeStopWatch('Git.parseDiffNumStatFiles', { log: { onlyExit: true, level: 'debug' } });
	if (!data) {
		sw?.stop({ suffix: ` no data` });
		return undefined;
	}

	const files = new Map<string, GitFile>();

	// Numstat records are \0-terminated; the summary (if any) lives after the final \0 as \n-separated lines.
	// Slice explicitly rather than popping the last split element, so numstat and summary never get conflated.
	const lastNullIndex = data.lastIndexOf('\0');
	const numstatData = lastNullIndex === -1 ? data : data.substring(0, lastNullIndex);
	const summary = lastNullIndex === -1 ? '' : data.substring(lastNullIndex + 1);

	const fields = numstatData.split('\0');

	let i = 0;
	while (i < fields.length) {
		const field = fields[i];
		if (!field) {
			i++;
			continue;
		}

		const tabIndex1 = field.indexOf('\t');
		if (tabIndex1 === -1) {
			i++;
			continue;
		}
		const tabIndex2 = field.indexOf('\t', tabIndex1 + 1);
		if (tabIndex2 === -1) {
			i++;
			continue;
		}

		const insertionsStr = field.substring(0, tabIndex1);
		const deletionsStr = field.substring(tabIndex1 + 1, tabIndex2);
		let path = field.substring(tabIndex2 + 1);

		let originalPath: string | undefined;
		if (path === '') {
			// Rename or copy: next two fields are oldPath and newPath (summary pass distinguishes R vs C)
			if (i + 2 >= fields.length) break;
			originalPath = fields[++i];
			path = fields[++i];
		}

		// Binary files report `-` instead of a line count; preserve the explicit check for clarity
		const additions = insertionsStr === '-' ? 0 : parseInt(insertionsStr, 10) || 0;
		const deletions = deletionsStr === '-' ? 0 : parseInt(deletionsStr, 10) || 0;

		const normalizedPath = normalizePath(path);
		files.set(normalizedPath, {
			repoPath: repoPath,
			path: path,
			originalPath: originalPath,
			status: (originalPath ? 'R' : 'M') as GitFileStatus,
			stats: { additions: additions, deletions: deletions, changes: additions + deletions },
		});

		i++;
	}

	// Refine statuses from the summary section:
	//   create → A, delete → D, copy → C (renames already default to R from numstat),
	//   mode change across file-type boundaries → T
	if (summary) {
		for (let line of summary.split('\n')) {
			line = line.trim();
			if (!line) continue;

			const match = diffSummaryRegex.exec(line);
			if (match == null) continue;

			// Positional destructure matches diffSummaryRegex's 9 capture groups.
			// Group 3 (original-leaf) is unused here — numstat already provides authoritative rename paths.
			const [
				,
				renameOrCopy,
				renameRoot,
				,
				renameNewLeaf,
				renameSuffix,
				createOrDelete,
				createOrDeletePath,
				oldMode,
				newMode,
				modeChangePath,
			] = match;

			if (createOrDelete != null) {
				const file = files.get(normalizePath(createOrDeletePath));
				if (file != null) {
					file.status = (createOrDelete === 'create' ? 'A' : 'D') as GitFileStatus;
				}
			} else if (renameOrCopy === 'copy') {
				// Numstat defaulted to R; promote to C. Reconstruct the full new-side path by
				// concatenating prefix + new-leaf + suffix, covering all compact and non-compact forms.
				const file = files.get(normalizePath(renameRoot + renameNewLeaf + renameSuffix));
				if (file != null) {
					file.status = 'C' as GitFileStatus;
				}
			} else if (modeChangePath != null) {
				// File-type boundary: 100xxx = regular file, 120000 = symlink, 160000 = gitlink.
				// Promote to T only when the high two octal digits differ (ignore permission-only changes).
				if (oldMode.substring(0, 2) !== newMode.substring(0, 2)) {
					const file = files.get(normalizePath(modeChangePath));
					if (file != null) {
						file.status = 'T' as GitFileStatus;
					}
				}
			}
			// Renames are already handled by the numstat section with -z
		}
	}

	sw?.stop({ suffix: ` parsed ${files.size} files` });

	return files.size > 0 ? [...files.values()] : undefined;
}

export function parseGitApplyFiles(data: string, repoPath: string): GitFileChange[] {
	using sw = maybeStopWatch('Git.parseApplyFiles', { log: { onlyExit: true, level: 'debug' } });
	if (!data) {
		sw?.stop({ suffix: ` no data` });
		return [];
	}

	const repoUri = fileUri(normalizePath(repoPath));
	const getUri = (p: string) => joinUriPath(repoUri, normalizePath(p));
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
			new GitFileChange(repoPath, path, 'M' as GitFileStatus, getUri(path), undefined, undefined, undefined, {
				changes: 0,
				additions: parseInt(insertions, 10),
				deletions: parseInt(deletions, 10),
			}),
		);
	}

	for (let line of summary!.split('\n')) {
		line = line.trim();
		if (!line) continue;

		const match = diffSummaryRegex.exec(line);
		if (match == null) continue;

		// Positional destructure matches diffSummaryRegex's 9 capture groups.
		// mode-change groups (8–10) are unused here — git apply's summary does not emit them in practice.
		const [
			,
			renameOrCopy,
			renameRoot,
			renameOriginalLeaf,
			renameNewLeaf,
			renameSuffix,
			createOrDelete,
			createOrDeletePath,
		] = match;

		if (renameOrCopy != null) {
			// Reconstruct both sides: prefix + leaf + suffix, handling all compact and non-compact forms.
			const newPath = normalizePath(renameRoot + renameNewLeaf + renameSuffix);
			const originalPath = normalizePath(renameRoot + renameOriginalLeaf + renameSuffix);

			const file = files.get(newPath)!;
			files.set(
				newPath,
				new GitFileChange(
					repoPath,
					newPath,
					(renameOrCopy === 'copy' ? 'C' : 'R') as GitFileStatus,
					getUri(newPath),
					originalPath,
					getUri(originalPath),
					undefined,
					file.stats,
				),
			);
		} else if (createOrDelete != null) {
			const file = files.get(normalizePath(createOrDeletePath))!;
			files.set(
				createOrDeletePath,
				new GitFileChange(
					repoPath,
					file.path,
					(createOrDelete === 'create' ? 'A' : 'D') as GitFileStatus,
					getUri(file.path),
					undefined,
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
	using sw = maybeStopWatch('Git.parseDiffShortStat', { log: { onlyExit: true, level: 'debug' } });
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
