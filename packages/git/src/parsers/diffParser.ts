import { normalizePath } from '@gitlens/utils/path.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import { readCQuotedString, unquoteCString } from '@gitlens/utils/string.js';
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

/**
 * Reads the path a header line names after its fixed lead-in, without the `a/` or `b/` prefix expected of it. A quoted
 * name carries the prefix inside its quotes. Git ends an unquoted `---` or `+++` name that holds a space with a tab,
 * which a name can't hold itself
 */
function readHeaderPath(rest: string, prefix: string): string | undefined {
	if (rest.startsWith('"')) {
		const quoted = readCQuotedString(rest, 0);
		if (quoted == null || !quoted.value.startsWith(prefix)) return undefined;

		return quoted.value.substring(prefix.length);
	}

	if (!rest.startsWith(prefix)) return undefined;

	return rest.endsWith('\t') ? rest.substring(prefix.length, rest.length - 1) : rest.substring(prefix.length);
}

/**
 * The new-side path of a `diff --git` line (without its lead-in) when no other line names it, so both halves are the
 * same path: split where they match, since a path can hold ` b/` itself
 */
function readGitLinePath(rest: string): string | undefined {
	if (rest.startsWith('"')) {
		const quoted = readCQuotedString(rest, 0);
		if (quoted == null || rest[quoted.end] !== ' ') return undefined;

		return readHeaderPath(rest.substring(quoted.end + 1), 'b/');
	}

	// `a/<path> b/<path>`
	const length = rest.length - 5;
	if (length < 0 || length % 2 !== 0 || !rest.startsWith('a/')) return undefined;

	const half = length / 2;
	const path = rest.substring(2, 2 + half);
	return rest.startsWith(' b/', 2 + half) && rest.endsWith(path) ? path : undefined;
}

/**
 * Reads the paths of a file's diff section, which starts at its `diff --git` line, from the lines git writes before the
 * first hunk. The `diff --git` line alone can't be split reliably (a path can hold ` b/`, and git quotes a path with a
 * `"`, `\`, tab or newline), so it is the last resort: the paths come from `+++`, `---` and the `rename`/`copy` lines.
 * A path comes out as `git diff --numstat -z` names it.
 * @returns `originalPath` is `path` for a file that wasn't renamed or copied
 */
export function parseDiffFilePaths(section: string): { path: string; originalPath: string } | undefined {
	let gitLine: string | undefined;
	let newName: string | undefined;
	let oldName: string | undefined;
	let renamedTo: string | undefined;
	let renamedFrom: string | undefined;

	for (let start = 0; start < section.length;) {
		let end = section.indexOf('\n', start);
		if (end === -1) {
			end = section.length;
		}
		const lineStart = start;
		start = end + 1;

		switch (section.charCodeAt(lineStart)) {
			case 0x2b /* + */:
				if (section.startsWith('+++ ', lineStart)) {
					const rest = section.substring(lineStart + 4, end);
					if (rest !== '/dev/null') {
						newName = readHeaderPath(rest, 'b/');
					}
				}
				break;
			case 0x2d /* - */:
				if (section.startsWith('--- ', lineStart)) {
					const rest = section.substring(lineStart + 4, end);
					if (rest !== '/dev/null') {
						oldName = readHeaderPath(rest, 'a/');
					}
				}
				break;
			case 0x72 /* r */:
				if (section.startsWith('rename to ', lineStart)) {
					renamedTo = readHeaderPath(section.substring(lineStart + 10, end), '');
				} else if (section.startsWith('rename from ', lineStart)) {
					renamedFrom = readHeaderPath(section.substring(lineStart + 12, end), '');
				}
				break;
			case 0x63 /* c */:
				if (section.startsWith('copy to ', lineStart)) {
					renamedTo = readHeaderPath(section.substring(lineStart + 8, end), '');
				} else if (section.startsWith('copy from ', lineStart)) {
					renamedFrom = readHeaderPath(section.substring(lineStart + 10, end), '');
				}
				break;
			case 0x64 /* d */:
				if (section.startsWith('diff --git ', lineStart)) {
					gitLine ??= section.substring(lineStart + 11, end);
				}
				break;
			case 0x40 /* @ */:
				if (section.startsWith('@@ ', lineStart)) {
					start = section.length;
				}
				break;
			case 0x47 /* G */:
				if (end - lineStart === 16 && section.startsWith('GIT binary patch', lineStart)) {
					start = section.length;
				}
				break;
		}
	}

	const path = newName ?? renamedTo ?? oldName ?? (gitLine != null ? readGitLinePath(gitLine) : undefined);
	if (path != null) return { path: path, originalPath: renamedFrom ?? oldName ?? path };

	// Nothing but a `diff --git` line to go on, which a rename may have, so split it as it always was
	const match = gitLine != null ? diffRegex.exec(`diff --git ${gitLine}`) : null;
	return match != null ? { path: match[2], originalPath: match[1] } : undefined;
}

/**
 * Reads a `--numstat` or `--summary` rename or copy in which git quoted a name. Git then drops the compact
 * `prefix/{old => new}/suffix` form for `old => new`, each side quoted on its own only when it needs it; a name git
 * didn't quote holds no `"`. A lone quoted name, as in a numstat line that isn't a rename, comes back as `path` alone.
 * Names come back as git names them, so a `\` in one stays (git quotes every name holding one)
 */
export function parseQuotedRenameOrCopyPaths(
	text: string,
	stripPercentage: boolean,
): { path: string; originalPath?: string } | undefined {
	let from: string;
	let toStart: number;
	if (text.startsWith('"')) {
		const quoted = readCQuotedString(text, 0);
		if (quoted == null) return undefined;

		// Just one quoted name, as in a numstat line that isn't a rename
		if (quoted.end === text.length) return { path: quoted.value };
		if (!text.startsWith(' => ', quoted.end)) return undefined;

		from = quoted.value;
		toStart = quoted.end + 4;
	} else {
		const index = text.indexOf(' => "');
		if (index === -1) return undefined;

		from = text.substring(0, index).trim();
		toStart = index + 4;
	}

	let to: string;
	if (text[toStart] === '"') {
		const quoted = readCQuotedString(text, toStart);
		if (quoted == null) return undefined;

		to = quoted.value;
	} else {
		to = text.substring(toStart);
		if (stripPercentage && to.endsWith('%)')) {
			const percentPos = to.lastIndexOf(' (');
			if (percentPos > -1) {
				to = to.substring(0, percentPos);
			}
		}
		to = to.trim();
	}

	return { path: to, originalPath: from };
}

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
		// Check for hunks and parse file status and metadata in a single pass
		const hunkStartIndex = file.indexOf('\n@@ -');
		const hasHunks = hunkStartIndex !== -1;

		const header = `diff --git ${hasHunks ? file.substring(0, hunkStartIndex) : file}`;

		const paths = parseDiffFilePaths(header);
		if (paths == null) continue;

		const { path, originalPath } = paths;
		const { status, metadata } = parseFileStatusAndMetadata(file, originalPath, path, hasHunks);

		let rawContent: string | undefined;
		let hunks: ParsedGitDiffHunk[];

		if (!hasHunks) {
			// No hunks - file without content changes (renames, mode changes, etc.)
			rawContent = includeRawContent ? file : undefined;
			hunks = [];
		} else {
			// Has hunks - extract content efficiently
			const content = file.substring(hunkStartIndex + 1);
			rawContent = includeRawContent ? content : undefined;
			hunks = parseGitFileDiff(content, includeRawContent)?.hunks ?? [];
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
	const filesWithChunks = chunks.map(chunk => ({ path: parseDiffFilePaths(chunk)?.path ?? '', chunk: chunk }));

	const allPaths = filesWithChunks.map(f => f.path);
	const includedPaths = await getIncludedPaths(allPaths);

	if (includedPaths.length === allPaths.length) return diff;

	return filesWithChunks
		.filter(f => includedPaths.includes(f.path))
		.map(f => f.chunk)
		.join('');
}

/**
 * Counts the added and removed lines of a parsed diff file, matching what `git diff --numstat`
 * reports for it. Binary files and files without content changes (pure renames, mode changes)
 * count as 0/0.
 */
export function countDiffInsertionsAndDeletions(file: ParsedGitDiffFile): { insertions: number; deletions: number } {
	let insertions = 0;
	let deletions = 0;
	for (const hunk of file.hunks) {
		// Counted off the hunk's raw content rather than its header counts (which include unchanged
		// context) or `hunk.lines` (which merges a removed/added pair into one `changed` entry and
		// lets a following context line overwrite the tail of an asymmetric block). Scanned in place
		// rather than split into lines: splitting a multi-megabyte diff allocates a string per line
		// for a single pass that only ever looks at each line's first character.
		const { content } = hunk;
		for (let start = 0; start < content.length;) {
			const marker = content[start];
			if (marker === '+') {
				insertions++;
			} else if (marker === '-') {
				deletions++;
			}

			const end = content.indexOf('\n', start);
			if (end === -1) break;

			start = end + 1;
		}
	}
	return { insertions: insertions, deletions: deletions };
}

/** Counts the approximate number of changed lines in a diff file — the size of both sides of its
 *  hunks, unchanged context included. Suitable for relative sizing, not for reporting a line count
 *  to the user; use {@link countDiffInsertionsAndDeletions} for that. */
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
			status: originalPath ? 'R' : 'M',
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

			// A quoted name can hold the `{`, `}` or ` => ` the regex splits the compact form at
			if (line.startsWith('copy ') && line.includes('"')) {
				const copied = parseQuotedRenameOrCopyPaths(line.substring(5), true);
				if (copied != null) {
					const file = files.get(normalizePath(copied.path));
					if (file != null) {
						file.status = 'C';
					}
					continue;
				}
			}

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
				const file = files.get(normalizePath(unquoteCString(createOrDeletePath)));
				if (file != null) {
					file.status = createOrDelete === 'create' ? 'A' : 'D';
				}
			} else if (renameOrCopy === 'copy') {
				// Numstat defaulted to R; promote to C. Reconstruct the full new-side path by
				// concatenating prefix + new-leaf + suffix, covering all compact and non-compact forms.
				const file = files.get(normalizePath(renameRoot + renameNewLeaf + renameSuffix));
				if (file != null) {
					file.status = 'C';
				}
			} else if (modeChangePath != null) {
				// File-type boundary: 100xxx = regular file, 120000 = symlink, 160000 = gitlink.
				// Promote to T only when the high two octal digits differ (ignore permission-only changes).
				if (oldMode.substring(0, 2) !== newMode.substring(0, 2)) {
					const file = files.get(normalizePath(unquoteCString(modeChangePath)));
					if (file != null) {
						file.status = 'T';
					}
				}
			}
			// Renames are already handled by the numstat section with -z
		}
	}

	sw?.stop({ suffix: ` parsed ${files.size} files` });

	return files.size > 0 ? [...files.values()] : undefined;
}

/**
 * Parses the output of `git apply --numstat --summary -z`. Unlike `git diff`, `git apply` writes the names of its
 * summary lines as they are, never C-quoted, so they are read as written
 */
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

		// The name is everything after the second tab: with `-z` it is as it is on disk, so it can hold tabs itself
		const tab1 = line.indexOf('\t');
		const tab2 = tab1 === -1 ? -1 : line.indexOf('\t', tab1 + 1);
		if (tab2 === -1) continue;

		const insertions = line.substring(0, tab1);
		const deletions = line.substring(tab1 + 1, tab2);
		const path = line.substring(tab2 + 1);
		files.set(
			normalizePath(path),
			new GitFileChange(repoPath, path, 'M', getUri(path), undefined, undefined, undefined, {
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
			const newPath = renameRoot + renameNewLeaf + renameSuffix;
			const originalPath = renameRoot + renameOriginalLeaf + renameSuffix;
			const key = normalizePath(newPath);

			const file = files.get(key);
			if (file == null) continue;

			files.set(
				key,
				new GitFileChange(
					repoPath,
					file.path,
					renameOrCopy === 'copy' ? 'C' : 'R',
					getUri(file.path),
					originalPath,
					getUri(originalPath),
					undefined,
					file.stats,
				),
			);
		} else if (createOrDelete != null) {
			const key = normalizePath(createOrDeletePath);
			const file = files.get(key);
			if (file == null) continue;

			files.set(
				key,
				new GitFileChange(
					repoPath,
					file.path,
					createOrDelete === 'create' ? 'A' : 'D',
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
