import type { GitFileIndexStatus } from '@gitlens/git/models/fileStatus.js';
import { diffHunkRegex, diffRegex } from '@gitlens/git/parsers/diffParser.js';
import { joinPaths, normalizePath } from '@gitlens/utils/path.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import { flattenString, iterateByDelimiter } from '@gitlens/utils/string.js';
import type { ExtractAll } from '@gitlens/utils/types.js';

const commitsMapping = {
	sha: '%H',
	author: '%aN',
	authorEmail: '%aE',
	authorDate: '%at',
	committer: '%cN',
	committerEmail: '%cE',
	committerDate: '%ct',
	parents: '%P',
	tips: '%D',
	message: '%B',
};

export type CommitsLogParser = LogParser<typeof commitsMapping>;
let _commitsParser: CommitsLogParser | undefined;
export type CommitsWithFilesLogParser = LogParserWithFilesAndStats<typeof commitsMapping>;
let _commitsWithFilesParser: CommitsWithFilesLogParser | undefined;
export type CommitsInFileRangeLogParser = LogParserWithFiles<typeof commitsMapping>;
let _commitsInFileRangeParser: CommitsInFileRangeLogParser | undefined;

export type ParsedCommit =
	| LogParsedEntry<typeof commitsMapping>
	| LogParsedEntryWithFiles<typeof commitsMapping>
	| LogParsedEntryWithFilesAndStats<typeof commitsMapping>;

export function getCommitsLogParser(
	includeFiles: boolean,
	inFileRange?: boolean,
): CommitsLogParser | CommitsWithFilesLogParser | CommitsInFileRangeLogParser {
	if (inFileRange) {
		_commitsInFileRangeParser ??= createLogParserWithPatch(commitsMapping);
		return _commitsInFileRangeParser;
	}

	if (includeFiles) {
		_commitsWithFilesParser ??= createLogParserWithFilesAndStats(commitsMapping);
		return _commitsWithFilesParser;
	}

	_commitsParser ??= createLogParser(commitsMapping);
	return _commitsParser;
}

const contributorsMapping = { sha: '%H', author: '%aN', email: '%aE', date: '%at', message: '%B' };

type ContributorsLogParser = LogParser<typeof contributorsMapping>;
let _contributorsParser: ContributorsLogParser | undefined;
type ContributorsWithStatsLogParser = LogParserWithStats<typeof contributorsMapping>;
let _contributorsWithStatsParser: ContributorsWithStatsLogParser | undefined;

export function getContributorsLogParser(stats?: boolean): ContributorsLogParser | ContributorsWithStatsLogParser {
	if (stats) {
		_contributorsWithStatsParser ??= createLogParserWithStats(contributorsMapping);
		return _contributorsWithStatsParser;
	}

	_contributorsParser ??= createLogParser(contributorsMapping);
	return _contributorsParser;
}

const graphMapping = {
	sha: '%H',
	author: '%aN',
	authorEmail: '%aE',
	authorDate: '%at',
	committerDate: '%ct',
	parents: '%P',
	tips: '%D',
	message: '%B',
};

export type GraphLogParser = LogParser<typeof graphMapping>;
let _graphParser: GraphLogParser | undefined;
type GraphWithStatsLogParser = LogParserWithStats<typeof graphMapping>;
let _graphWithStatsParser: GraphWithStatsLogParser | undefined;

/**
 * Prints `tips` as full refnames (`HEAD -> refs/heads/main`, `refs/remotes/origin/main`, `tag: refs/tags/v1`), whatever
 * `log.decorate` says, since short names can't tell a local branch from a remote-tracking ref of the same name
 */
export function getGraphParser(stats?: boolean): GraphLogParser | GraphWithStatsLogParser {
	if (stats) {
		if (_graphWithStatsParser == null) {
			_graphWithStatsParser = createLogParserWithStats(graphMapping);
			_graphWithStatsParser.arguments.push('--decorate=full');
		}
		return _graphWithStatsParser;
	}

	if (_graphParser == null) {
		_graphParser = createLogParser(graphMapping);
		_graphParser.arguments.push('--decorate=full');
	}
	return _graphParser;
}

type ShaLogParser = Parser<string>;
let _shaParser: ShaLogParser | undefined;

export function getShaLogParser(): ShaLogParser {
	_shaParser ??= createLogParserSingle('%H');
	return _shaParser;
}

const shaAndDateMapping = { sha: '%H', authorDate: '%at', committerDate: '%ct' };
const shaAndDateAndTipsMapping = { sha: '%H', authorDate: '%at', committerDate: '%ct', tips: '%D' };

type ShaAndDatesLogParser = LogParser<typeof shaAndDateMapping & { tips?: string }>;
let _shaAndDatesParser: ShaAndDatesLogParser | undefined;
type ShaAndDatesAndTipsLogParser = LogParser<typeof shaAndDateAndTipsMapping>;
let _shaAndDatesAndTipsParser: ShaAndDatesAndTipsLogParser | undefined;

export function getShaAndDatesLogParser(includeTips?: boolean): ShaAndDatesLogParser | ShaAndDatesAndTipsLogParser {
	if (includeTips) {
		_shaAndDatesAndTipsParser ??= createLogParser(shaAndDateAndTipsMapping);
		return _shaAndDatesAndTipsParser;
	}

	_shaAndDatesParser ??= createLogParser(shaAndDateMapping);
	return _shaAndDatesParser;
}

type ShaAndDatesWithFilesLogParser = LogParserWithFiles<typeof shaAndDateMapping & { tips?: string }>;
let _shaAndDatesWithFilesParser: ShaAndDatesWithFilesLogParser | undefined;

type ShaAndDatesAndTipsWithFilesLogParser = LogParserWithFiles<typeof shaAndDateAndTipsMapping>;
let _shaAndDatesAndTipsWithFilesParser: ShaAndDatesAndTipsWithFilesLogParser | undefined;

export function getShaAndDatesWithFilesLogParser(
	includeTips?: boolean,
): ShaAndDatesWithFilesLogParser | ShaAndDatesAndTipsWithFilesLogParser {
	if (includeTips) {
		_shaAndDatesAndTipsWithFilesParser ??= createLogParserWithFiles(shaAndDateAndTipsMapping);
		return _shaAndDatesAndTipsWithFilesParser;
	}

	_shaAndDatesWithFilesParser ??= createLogParserWithFiles(shaAndDateMapping);
	return _shaAndDatesWithFilesParser;
}

const shaMapping = { sha: '%H' };

type ShaAndFilesAndStatsLogParser = LogParserWithFilesAndStats<typeof shaMapping>;
let _shaAndFilesAndStatsParser: ShaAndFilesAndStatsLogParser | undefined;

export function getShaAndFilesAndStatsLogParser(): ShaAndFilesAndStatsLogParser {
	_shaAndFilesAndStatsParser ??= createLogParserWithFilesAndStats(shaMapping);
	return _shaAndFilesAndStatsParser;
}

type ShaAndFileRangeLogParser = LogParserWithFiles<typeof shaMapping>;
let _shaAndFileRangeParser: ShaAndFileRangeLogParser | undefined;

export function getShaAndFileRangeLogParser(): ShaAndFileRangeLogParser {
	_shaAndFileRangeParser ??= createLogParserWithPatch(shaMapping);
	return _shaAndFileRangeParser;
}

type ShaAndFileSummaryLogParser = LogParserWithFileSummary<typeof shaMapping>;
let _shaAndFileSummaryParser: ShaAndFileSummaryLogParser | undefined;

export function getShaAndFileSummaryLogParser(): ShaAndFileSummaryLogParser {
	_shaAndFileSummaryParser ??= createLogParserWithFileSummary(shaMapping);
	return _shaAndFileSummaryParser;
}

type ShaAndStatsLogParser = LogParserWithStats<typeof shaMapping>;
let _shaAndStatsParser: ShaAndStatsLogParser | undefined;

export function getShaAndStatsLogParser(): ShaAndStatsLogParser {
	_shaAndStatsParser ??= createLogParserWithStats(shaMapping);
	return _shaAndStatsParser;
}

const stashMapping = {
	sha: '%H',
	authorDate: '%at',
	committedDate: '%ct',
	parents: '%P',
	stashName: '%gd',
	summary: '%gs',
	// %s (commit subject) is git's authoritative `On <branch>: …` / `WIP on <branch>: …` record,
	// present even when the reflog message (%gs) was customized (autostash, `git stash store -m`).
	// Used downstream to extract `stashOnRef` reliably.
	commitSubject: '%s',
};

type StashLogParser = LogParser<typeof stashMapping>;
let _stashParser: StashLogParser | undefined;
type StashLogParserWithFiles = LogParserWithFilesAndStats<typeof stashMapping>;
let _stashParserWithFiles: StashLogParserWithFiles | undefined;

export type ParsedStash = LogParsedEntry<typeof stashMapping>;
export type ParsedStashWithFiles = LogParsedEntryWithFilesAndStats<typeof stashMapping>;

export function getStashLogParser(includeFiles?: false): StashLogParser;
export function getStashLogParser(includeFiles: true): StashLogParserWithFiles;
export function getStashLogParser(includeFiles?: boolean): StashLogParser | StashLogParserWithFiles;
export function getStashLogParser(includeFiles?: boolean): StashLogParser | StashLogParserWithFiles {
	if (includeFiles) {
		_stashParserWithFiles ??= createLogParserWithFilesAndStats(stashMapping);
		return _stashParserWithFiles;
	}

	_stashParser ??= createLogParser(stashMapping);
	return _stashParser;
}

type StashFilesOnlyLogParser = LogParserWithFilesAndStats<void>;
let _stashFilesOnlyParser: StashFilesOnlyLogParser | undefined;

export function getStashFilesOnlyLogParser(): StashFilesOnlyLogParser {
	_stashFilesOnlyParser ??= createLogParserWithFilesAndStats();
	return _stashFilesOnlyParser;
}

// Parser types
export type Parser<T> = {
	arguments: string[];
	separators: { record: string; field: string };
	parse: (data: string | Iterable<string> | undefined) => Generator<T> | Iterable<T>;
	parseAsync?: never;
};
export type AsyncParser<T> = {
	arguments: string[];
	separators: { record: string; field: string };
	parse: (data: string | Iterable<string> | undefined) => Generator<T> | Iterable<T>;
	parseAsync: (stream: AsyncGenerator<string>) => AsyncGenerator<T>;
	/**
	 * Like `parseAsync` but yields one ARRAY of entries per stream chunk, scanning each chunk
	 * synchronously with plain `indexOf` (no per-field iterator machinery). Bulk consumers (the
	 * graph walk) avoid two promise hops per record — thousands of awaited yields collapse to one
	 * per chunk. Only the plain parser implements it; per-record `parseAsync` remains the
	 * general-purpose path.
	 */
	parseAsyncBatched?: (stream: AsyncGenerator<string>) => AsyncGenerator<T[]>;
};

export type LogParser<T> = AsyncParser<LogParsedEntry<T>>;
type LogParserWithFiles<T> = AsyncParser<LogParsedEntryWithFiles<T>>;
type LogParserWithFilesAndStats<T> = AsyncParser<LogParsedEntryWithFilesAndStats<T>>;
type LogParserWithFileSummary<T> = Parser<LogParsedEntryWithFiles<T>>;
type LogParserWithStats<T> = AsyncParser<LogParsedEntryWithStats<T>>;

// Parsed entry types
type LogParsedEntry<T> = { [K in keyof T]: string } & { files?: never; stats?: never };
type LogParsedEntryWithFiles<T> = { [K in keyof T]: string } & { files: LogParsedFile[]; stats?: never };
type LogParsedEntryWithFilesAndStats<T> = { [K in keyof T]: string } & {
	files: LogParsedFileWithStats[];
	stats: LogParsedStatsWithFilesStats;
};
type LogParsedEntryWithStats<T> = { [K in keyof T]: string } & { stats: LogParsedStats };

// Parsed types
export interface LogParsedFile {
	status?: string;
	path: string;
	originalPath?: string;
	additions?: never;
	deletions?: never;
	range?: LogParsedRange;
	originalRange?: LogParsedRange;
	/** Git file mode (e.g., 100644=regular, 100755=executable, 120000=symlink, 160000=submodule) */
	mode?: string;
	/** For submodule entries (mode 160000), the commit SHA the submodule points to */
	oid?: string;
	/** For submodule entries (mode 160000), the previous commit SHA */
	previousOid?: string;
}
type LogParsedFileWithStats = Omit<LogParsedFile, 'additions' | 'deletions'> & {
	additions: number;
	deletions: number;
};
interface LogParsedRange {
	startLine: number;
	endLine: number;
}
interface LogParsedStats {
	files: number;
	additions: number;
	deletions: number;
}
interface LogParsedStatsWithFilesStats {
	files: { added: number; changed: number; deleted: number };
	additions: number;
	deletions: number;
}

// KEEP: assumes no `-z` output: a NUL path terminator followed by 0x1E/0x1D would form a sentinel
// SEE: `git commit -F` with a NUL fails "a NUL byte in commit log message not allowed." (git 2.44.0)
const recordSep = '\0\x1E';
const recordFormatSep = '%x00%x1E';
const fieldSep = '\0\x1D';
const fieldFormatSep = '%x00%x1D';

function indexOfSeparator(s: string, separator: string, from: number): number {
	const marker = separator[1];
	let index = s.indexOf(marker, from + 1);
	while (index !== -1 && s.charCodeAt(index - 1) !== 0) {
		index = s.indexOf(marker, index + 1);
	}
	return index === -1 ? -1 : index - 1;
}

const flattenSourceThreshold = 128 * 1024;

function readFields<K extends PropertyKey>(record: string, keys: readonly K[], entry: Record<K, string>): number {
	let start = 0;
	for (const key of keys) {
		const end = indexOfSeparator(record, fieldSep, start);
		if (end === -1) return -1;

		entry[key] = record.substring(start, end);
		start = end + fieldSep.length;
	}
	return start;
}

function getPayload(record: string, start: number): string {
	if (record.charCodeAt(start) === 10) {
		start++;
		if (record.charCodeAt(start) === 10) {
			start++;
		}
	}

	const end = indexOfSeparator(record, fieldSep, start);
	return record.substring(start, end === -1 ? record.length : end);
}

class RecordScanner {
	// KEEP: never push '' to `pieces`: joining one string with '' returns it (maybe a slice), pinning its chunk
	// SEE: https://github.com/v8/v8/blob/main/src/builtins/array-join.tq (BufferJoin single-element fast path)
	private readonly pieces: string[] = [];
	private chunk = '';
	private start = 0;
	private from = 0;

	constructor(private readonly copy = false) {}

	push(chunk: string): void {
		if (this.start < this.chunk.length) {
			this.pieces.push(this.start === 0 ? this.chunk : this.chunk.substring(this.start));
		}

		this.chunk = chunk;
		this.start = 0;
		this.from = 0;
	}

	next(): string | undefined {
		if (this.from === 0 && this.pieces.length !== 0 && this.chunk.charCodeAt(0) === recordSep.charCodeAt(1)) {
			const last = this.pieces.length - 1;
			const piece = this.pieces[last];
			if (piece.charCodeAt(piece.length - 1) === 0) {
				if (piece.length === 1) {
					this.pieces.pop();
				} else {
					this.pieces[last] = piece.substring(0, piece.length - 1);
				}

				this.start = this.from = 1;
				return this.complete('');
			}
		}

		const end = indexOfSeparator(this.chunk, recordSep, this.from);
		if (end === -1) {
			this.from = this.chunk.length;
			return undefined;
		}

		const record = this.complete(this.chunk.substring(this.start, end));
		this.start = this.from = end + recordSep.length;
		return record;
	}

	end(): string {
		const record = this.complete(this.chunk.substring(this.start));
		this.chunk = '';
		this.start = this.from = 0;
		return record;
	}

	private complete(text: string): string {
		if (text.length) {
			this.pieces.push(text);
		}

		let record: string;
		if (this.pieces.length > 1) {
			record = this.pieces.join('');
		} else {
			record = this.pieces[0] ?? '';
			if (this.copy) {
				record = flattenString(record, 1);
			}
		}

		this.pieces.length = 0;
		return record;
	}
}

function createRecordParsers<E>(
	scope: string,
	parseRecord: (record: string) => E | undefined,
): Pick<AsyncParser<E>, 'parse' | 'parseAsync'> {
	const parseScope = `${scope}.parse`;
	const parseAsyncScope = `${scope}.parseAsync`;

	function* parse(data: string | Iterable<string> | undefined): Generator<E> {
		using sw = maybeStopWatch(parseScope, { log: { onlyExit: true, level: 'debug' } });

		if (!data) {
			sw?.stop({ suffix: ` no data` });
			return;
		}

		const scanner = new RecordScanner(typeof data === 'string' && data.length > flattenSourceThreshold);

		let count = 0;
		let dropped = 0;
		let entry: E | undefined;

		for (const chunk of typeof data === 'string' ? [data] : data) {
			scanner.push(chunk);

			for (let record = scanner.next(); record != null; record = scanner.next()) {
				if (!record.length) continue;

				entry = parseRecord(record);
				if (entry == null) {
					dropped++;
					continue;
				}

				count++;
				yield entry;
			}
		}

		const tail = scanner.end();
		if (tail.length) {
			entry = parseRecord(tail);
			if (entry == null) {
				dropped++;
			} else {
				count++;
				yield entry;
			}
		}

		sw?.stop({ suffix: ` parsed ${count} records${dropped > 0 ? `, dropped ${dropped}` : ''}` });
	}

	async function* parseAsync(stream: AsyncGenerator<string>): AsyncGenerator<E> {
		using sw = maybeStopWatch(parseAsyncScope, { log: { onlyExit: true, level: 'debug' } });

		const scanner = new RecordScanner(true);

		let count = 0;
		let dropped = 0;
		let entry: E | undefined;

		// KEEP: no `for await` and never close or await the caller's stream: git's stream cleanup waits for git to exit
		for (let result = await stream.next(); !result.done; result = await stream.next()) {
			scanner.push(result.value);

			for (let record = scanner.next(); record != null; record = scanner.next()) {
				if (!record.length) continue;

				entry = parseRecord(record);
				if (entry == null) {
					dropped++;
					continue;
				}

				count++;
				yield entry;
			}
		}

		const tail = scanner.end();
		if (tail.length) {
			entry = parseRecord(tail);
			if (entry == null) {
				dropped++;
			} else {
				count++;
				yield entry;
			}
		}

		sw?.stop({ suffix: ` parsed ${count} records${dropped > 0 ? `, dropped ${dropped}` : ''}` });
	}

	return { parse: parse, parseAsync: parseAsync };
}

export function createLogParser<T extends Record<string, string>>(mapping: ExtractAll<T, string>): LogParser<T> {
	let format = recordFormatSep;
	const keys: (keyof ExtractAll<T, string>)[] = [];
	for (const key in mapping) {
		keys.push(key);
		format += `${mapping[key]}${fieldFormatSep}`;
	}

	const args = [`--format=${format}`];

	function parseRecord(record: string): LogParsedEntry<T> | undefined {
		const entry = {} as unknown as LogParsedEntry<T>;
		return readFields(record, keys, entry) === -1 ? undefined : entry;
	}

	async function* parseAsyncBatched(stream: AsyncGenerator<string>): AsyncGenerator<LogParsedEntry<T>[]> {
		using sw = maybeStopWatch('Git.LogParser.parseAsyncBatched', { log: { onlyExit: true, level: 'debug' } });

		const scanner = new RecordScanner(true);

		let count = 0;
		let dropped = 0;
		let entry: LogParsedEntry<T> | undefined;

		for await (const chunk of stream) {
			scanner.push(chunk);

			let batch: LogParsedEntry<T>[] | undefined;
			for (let record = scanner.next(); record != null; record = scanner.next()) {
				if (!record.length) continue;

				entry = parseRecord(record);
				if (entry == null) {
					dropped++;
					continue;
				}

				(batch ??= []).push(entry);
				count++;
			}

			if (batch != null) {
				yield batch;
			}
		}

		const tail = scanner.end();
		if (tail.length) {
			entry = parseRecord(tail);
			if (entry == null) {
				dropped++;
			} else {
				count++;
				yield [entry];
			}
		}

		sw?.stop({ suffix: ` parsed ${count} records${dropped > 0 ? `, dropped ${dropped}` : ''}` });
	}

	const { parse, parseAsync } = createRecordParsers('Git.LogParser', parseRecord);

	return {
		arguments: args,
		separators: { record: recordSep, field: fieldSep },
		parse: parse,
		parseAsync: parseAsync,
		parseAsyncBatched: parseAsyncBatched,
	};
}

function createLogParserWithFilesAndStats(): LogParserWithFilesAndStats<void>;
function createLogParserWithFilesAndStats<T extends Record<string, string>>(
	mapping: ExtractAll<T, string>,
): LogParserWithFilesAndStats<T>;
function createLogParserWithFilesAndStats<T extends Record<string, string> | void>(
	mapping?: ExtractAll<T, string>,
): LogParserWithFilesAndStats<T> {
	let format = recordFormatSep;
	const keys: (keyof ExtractAll<T, string>)[] = [];
	if (mapping != null) {
		for (const key in mapping) {
			keys.push(key);
			format += `${mapping[key]}${fieldFormatSep}`;
		}
	}
	// Use --raw instead of --summary to get accurate mode info for ALL files (not just creates/deletes)
	// This allows us to reliably detect submodules (mode 160000) even for modifications
	const args = [`--format=${format}`, '--numstat', '--raw'];

	function parseFilesAndStats(content: string): LogParsedFileWithStats[] {
		const files: LogParsedFileWithStats[] = [];
		if (!content?.length) return files;

		// Map to store info from --raw lines: path -> { mode, status, originalPath, oid?, previousOid? }
		// Raw format: :<old_mode> <new_mode> <old_sha> <new_sha> <status>[score]\t<path>[\t<new_path>]
		const infoMap = new Map<
			string,
			{ mode: string; status: string; originalPath?: string; oid?: string; previousOid?: string }
		>();

		let startIndex: number;
		let endIndex: number;

		// Single pass: --raw lines come first, then --numstat lines
		for (const line of iterateByDelimiter(content, '\n')) {
			if (!line) continue;

			if (line.charCodeAt(0) === 58 /* ':' */) {
				// --raw format: :<old_mode> <new_mode> <old_sha> <new_sha> <status>[score]\t<path>[\t<new_path>]
				const tabIndex = line.indexOf('\t');
				if (tabIndex === -1) continue;

				// Parse metadata using indexOf instead of split() to avoid array allocation
				// Format after ':': <old_mode> <new_mode> <old_sha> <new_sha> <status>[score]

				// Skip old_mode, find new_mode
				startIndex = line.indexOf(' ') + 1;
				if (startIndex === 0) continue;

				endIndex = line.indexOf(' ', startIndex);
				if (endIndex === -1) continue;

				const newMode = line.substring(startIndex, endIndex);

				// Parse old_sha and new_sha positions
				const oldShaStart = endIndex + 1;
				const oldShaEnd = line.indexOf(' ', oldShaStart);
				if (oldShaEnd === -1) continue;

				const newShaStart = oldShaEnd + 1;
				const newShaEnd = line.indexOf(' ', newShaStart);
				if (newShaEnd === -1) continue;

				// For submodules (mode 160000), capture the commit SHAs
				let oid: string | undefined;
				let previousOid: string | undefined;
				if (newMode === '160000') {
					previousOid = line.substring(oldShaStart, oldShaEnd);
					oid = line.substring(newShaStart, newShaEnd);
				}

				// Status is first char after the last space
				startIndex = newShaEnd;
				const status = line.charAt(startIndex + 1);

				// Parse path(s) using indexOf instead of split
				const pathPart = line.substring(tabIndex + 1);
				let path: string;
				let originalPath: string | undefined;

				const pathTabIndex = pathPart.indexOf('\t');
				if ((status === 'R' || status === 'C') && pathTabIndex !== -1) {
					// For renames/copies: old_path\tnew_path
					originalPath = pathPart.substring(0, pathTabIndex);
					path = pathPart.substring(pathTabIndex + 1);
				} else {
					path = pathPart;
				}

				// Trim to match parseCopyOrRename which trims renamed paths
				infoMap.set(path.trim(), {
					mode: newMode,
					status: status,
					originalPath: originalPath?.trim(),
					oid: oid,
					previousOid: previousOid,
				});
			} else {
				// --numstat format: <additions>\t<deletions>\t<path>
				// With renames: <additions>\t<deletions>\t{prefix/old => new/suffix}
				endIndex = line.indexOf('\t');
				if (endIndex === -1) {
					debugger;
					continue;
				}

				const additions = line.substring(0, endIndex);

				startIndex = endIndex + 1;
				endIndex = line.indexOf('\t', startIndex);
				if (endIndex === -1) {
					debugger;
					continue;
				}

				const deletions = line.substring(startIndex, endIndex);

				let path = line.substring(endIndex + 1);
				let originalPath: string | undefined;

				// Parse rename format from numstat (e.g., "{old => new}/path")
				({ path, originalPath } = parseCopyOrRename(path, false));

				// Look up --raw info for this path (keyed by trimmed new/destination path)
				const info = infoMap.get(path.trim());

				// Use status from --raw if available; provides accurate status (A/D/M/R/C/T)
				const status = info?.status ?? (originalPath ? 'R' : 'M');

				// Use originalPath from --raw if available (cleaner than numstat format)
				if (info?.originalPath) {
					originalPath = info.originalPath;
				}

				const file: LogParsedFileWithStats = {
					status: status,
					path: path.trim(),
					originalPath: originalPath?.trim(),
					additions: additions === '-' ? 0 : parseInt(additions, 10) || 0,
					deletions: deletions === '-' ? 0 : parseInt(deletions, 10) || 0,
					// Store mode for consumers to derive file type (160000=submodule, 100755=executable, etc.)
					mode: info?.mode,
					oid: info?.oid,
					previousOid: info?.previousOid,
				};

				files.push(file);
			}
		}

		return files;
	}

	function parseRecord(record: string): LogParsedEntryWithFilesAndStats<T> | undefined {
		const entry = {} as unknown as LogParsedEntryWithFilesAndStats<T>;
		const payloadStart = readFields(record, keys, entry);
		if (payloadStart === -1) return undefined;

		const files = parseFilesAndStats(getPayload(record, payloadStart));
		entry.files = files;
		if (files.length) {
			entry.stats = { additions: 0, deletions: 0, files: { added: 0, deleted: 0, changed: 0 } };

			for (const f of files) {
				if (f.additions || f.deletions) {
					entry.stats.additions += f.additions ?? 0;
					entry.stats.deletions += f.deletions ?? 0;
					if (f.status === 'A' || f.status === '?') {
						entry.stats.files.added++;
					} else if (f.status === 'D') {
						entry.stats.files.deleted++;
					} else {
						entry.stats.files.changed++;
					}
				}
			}
		}

		return entry;
	}

	const { parse, parseAsync } = createRecordParsers('Git.LogParserWithFilesAndStats', parseRecord);

	return {
		arguments: args,
		separators: { record: recordSep, field: fieldSep },
		parse: parse,
		parseAsync: parseAsync,
	};
}

function createLogParserWithFileSummary(): LogParserWithFileSummary<void>;
function createLogParserWithFileSummary<T extends Record<string, string>>(
	mapping: ExtractAll<T, string>,
): LogParserWithFileSummary<T>;
function createLogParserWithFileSummary<T extends Record<string, string> | void>(
	mapping?: ExtractAll<T, string>,
): LogParserWithFileSummary<T> {
	let format = recordFormatSep;
	const keys: (keyof ExtractAll<T, string>)[] = [];
	if (mapping != null) {
		for (const key in mapping) {
			keys.push(key);
			format += `${mapping[key]}${fieldFormatSep}`;
		}
	}
	const args = [`--format=${format}`, '--summary'];

	function parseFileSummary(content: string): LogParsedFile[] {
		const files: LogParsedFile[] = [];
		if (!content?.length) return files;

		let startIndex;

		let path;
		let originalPath;
		let status;

		for (const line of iterateByDelimiter(content, '\n')) {
			if (!line) continue;

			if (line.startsWith(' rename ')) {
				({ path, originalPath } = parseCopyOrRename(line.substring(8 /* move past ' rename ' */), true));
				files.push({ path: path, originalPath: originalPath, status: 'R' });
			} else if (line.startsWith(' copy ')) {
				({ path, originalPath } = parseCopyOrRename(line.substring(6 /* move past ' copy ' */), true));
				files.push({ path: path, originalPath: originalPath, status: 'C' });
			} else {
				if (line.startsWith(' create mode ')) {
					status = 'A';
				} else if (line.startsWith(' delete mode ')) {
					status = 'D';
				} else {
					// Ignore " mode change " lines
					if (!line.startsWith(' mode change ')) {
						debugger;
					}
					continue;
				}

				startIndex = line.indexOf(' ', 13 /* move past 'create mode <num>' or 'delete mode <num>' */);
				if (startIndex > -1) {
					path = line.substring(startIndex + 1);
					files.push({ path: path, status: status });
				} else {
					debugger;
				}
			}
		}

		return files;
	}

	function parseRecord(record: string): LogParsedEntryWithFiles<T> | undefined {
		const entry = {} as unknown as LogParsedEntryWithFiles<T>;
		const payloadStart = readFields(record, keys, entry);
		if (payloadStart === -1) return undefined;

		entry.files = parseFileSummary(getPayload(record, payloadStart));
		return entry;
	}

	const { parse } = createRecordParsers('Git.LogParserWithFileSummary', parseRecord);

	return {
		arguments: args,
		separators: { record: recordSep, field: fieldSep },
		parse: parse,
	};
}

function parseCopyOrRename(path: string, stripPercentage: boolean): { path: string; originalPath?: string } {
	const renameIndex = path.indexOf(' => ');
	if (renameIndex === -1) return { path: path };

	let hasBraces = true;

	let openIndex = path.indexOf('{');
	if (openIndex === -1) {
		hasBraces = false;
		openIndex = 0;
	}

	let closeIndex = path.indexOf('}', openIndex);
	if (closeIndex === -1) {
		hasBraces = false;
		closeIndex = path.length;
	}

	const prefix = path.substring(0, openIndex);
	const fromPart = path.substring(hasBraces ? openIndex + 1 : 0, renameIndex);
	let toPart = path.substring(renameIndex + 4, closeIndex);
	let suffix = path.substring(closeIndex + 1);

	// Check for percentage marker which always appears at the end as (xx%)
	if (stripPercentage) {
		if (hasBraces) {
			if (suffix.endsWith('%)')) {
				// Find the last open paren that starts the percentage
				const percentPos = suffix.lastIndexOf(' (');
				if (percentPos > -1) {
					suffix = suffix.substring(0, percentPos);
				}
			}
		} else if (toPart.endsWith('%)')) {
			// Find the last open paren that starts the percentage
			const percentPos = toPart.lastIndexOf(' (');
			if (percentPos > -1) {
				toPart = toPart.substring(0, percentPos);
			}
		}
	}

	return {
		path: normalizePath(joinPaths(prefix, toPart, suffix).trim()),
		originalPath: normalizePath(joinPaths(prefix, fromPart, suffix).trim()),
	};
}

function createLogParserSingle(field: string): Parser<string> {
	const args = ['-z', `--format=${field}`];

	function parse(data: string | Iterable<string> | undefined): Iterable<string> {
		using _sw = maybeStopWatch('Git.LogParserSingle.parse', { log: { onlyExit: true, level: 'debug' } });

		return data ? iterateByDelimiter(data, '\0') : [];
	}

	return { arguments: args, separators: { record: '\0', field: '\0' }, parse: parse };
}

// TODO: a NUL+0x1E inside diff content still splits a patch record; needs scanner lookahead across chunks
function createLogParserWithPatch<T extends Record<string, string>>(
	mapping: ExtractAll<T, string>,
): LogParserWithFiles<T> {
	let format = recordFormatSep;
	const keys: (keyof ExtractAll<T, string>)[] = [];
	for (const key in mapping) {
		keys.push(key);
		format += `${mapping[key]}${fieldFormatSep}`;
	}

	const args = [`--format=${format}`];

	function parsePatch(content: string): LogParsedFile | undefined {
		const lines = iterateByDelimiter(content, '\n');
		let line = lines.next();
		if (line.done) return undefined;

		const fileMatch = diffRegex.exec(line.value);
		if (fileMatch == null) return undefined;

		while (!line.done && !line.value.startsWith('@@ ')) {
			line = lines.next();
		}

		const rangeMatch = line.done ? undefined : line.value.match(diffHunkRegex);

		let range: LogParsedRange | undefined;
		let originalRange: LogParsedRange | undefined;
		if (rangeMatch != null) {
			let start = parseInt(rangeMatch[1], 10);
			let count = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : 1;

			originalRange = start && count ? { startLine: start, endLine: start + count - 1 } : undefined;

			start = parseInt(rangeMatch[3], 10);
			count = rangeMatch[4] ? parseInt(rangeMatch[4], 10) : 1;

			range = start && count ? { startLine: start, endLine: start + count - 1 } : undefined;
		}

		return {
			status: (fileMatch[1] === 'rename' ? 'R' : 'M') satisfies GitFileIndexStatus,
			path: fileMatch[2],
			originalPath: fileMatch[1] === 'rename' ? fileMatch[3] : undefined,
			range: range,
			originalRange: originalRange,
		};
	}

	function parseRecord(record: string): LogParsedEntryWithFiles<T> | undefined {
		const entry = { files: [] } as unknown as LogParsedEntryWithFiles<T>;
		const payloadStart = readFields(record, keys, entry);
		if (payloadStart === -1) return undefined;

		const file = parsePatch(getPayload(record, payloadStart));
		if (file != null) {
			entry.files = [file];
		}
		return entry;
	}

	const { parse, parseAsync } = createRecordParsers('Git.LogParserWithPatch', parseRecord);

	return {
		arguments: args,
		separators: { record: recordSep, field: fieldSep },
		parse: parse,
		parseAsync: parseAsync,
	};
}

function createLogParserWithStats<T extends Record<string, string>>(
	mapping: ExtractAll<T, string>,
): LogParserWithStats<T> {
	let format = recordFormatSep;
	const keys: (keyof ExtractAll<T, string>)[] = [];
	for (const key in mapping) {
		keys.push(key);
		format += `${mapping[key]}${fieldFormatSep}`;
	}

	const args = [`--format=${format}`, '--shortstat'];

	function parseStats(content: string): LogParsedStats {
		const stats: LogParsedStats = { files: 0, additions: 0, deletions: 0 };
		content = content?.trim();
		if (!content?.length) return { files: 0, additions: 0, deletions: 0 };

		let filesEnd;
		let filesIndex = content.indexOf(' files changed');
		if (filesIndex === -1) {
			filesIndex = content.indexOf(' file changed');
			if (filesIndex === -1) return stats;

			filesEnd = filesIndex + ' file changed'.length;
		} else {
			filesEnd = filesIndex + ' files changed'.length;
		}

		// Extract number before " files changed"
		const filesPart = content.substring(0, filesIndex).trim();
		stats.files = parseInt(filesPart, 10) || 0;

		// Extract additions if present
		const additionsIndex = content.indexOf(' insertion', filesEnd);
		if (additionsIndex !== -1) {
			// Look for the number before "insertion(+)" or "insertions(+)"
			const spaceIndex = content.lastIndexOf(' ', additionsIndex - 1);
			if (spaceIndex !== -1) {
				const additionsPart = content.substring(spaceIndex, additionsIndex).trim();
				stats.additions = parseInt(additionsPart, 10) || 0;
			}
		}

		// Extract deletions if present
		const deletionsIndex = content.indexOf(' deletion', filesEnd);
		if (deletionsIndex !== -1) {
			// Look for the number before ""deletion(-)" or "deletions(-)"
			const spaceIndex = content.lastIndexOf(' ', deletionsIndex - 1);
			if (spaceIndex !== -1) {
				const deletionsPart = content.substring(spaceIndex, deletionsIndex).trim();
				stats.deletions = parseInt(deletionsPart, 10) || 0;
			}
		}

		return stats;
	}

	function parseRecord(record: string): LogParsedEntryWithStats<T> | undefined {
		const entry = { stats: { files: 0, additions: 0, deletions: 0 } } as unknown as LogParsedEntryWithStats<T>;
		const payloadStart = readFields(record, keys, entry);
		if (payloadStart === -1) return undefined;

		const payload = getPayload(record, payloadStart);
		if (payload.length) {
			entry.stats = parseStats(payload);
		}
		return entry;
	}

	const { parse, parseAsync } = createRecordParsers('Git.LogParserWithStats', parseRecord);

	return {
		arguments: args,
		separators: { record: recordSep, field: fieldSep },
		parse: parse,
		parseAsync: parseAsync,
	};
}

function createLogParserWithFiles<T extends Record<string, string>>(
	mapping: ExtractAll<T, string>,
): LogParserWithFiles<T> {
	let format = recordFormatSep;
	const keys: (keyof ExtractAll<T, string>)[] = [];
	for (const key in mapping) {
		keys.push(key);
		format += `${mapping[key]}${fieldFormatSep}`;
	}

	const args = [`--format=${format}`, '--name-only'];

	function parseFileNames(content: string): LogParsedFile[] {
		const files: LogParsedFile[] = [];
		if (!content?.length) return files;

		for (const line of iterateByDelimiter(content, '\n')) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			files.push({ path: trimmed });
		}

		return files;
	}

	function parseRecord(record: string): LogParsedEntryWithFiles<T> | undefined {
		const entry = { files: [] } as unknown as LogParsedEntryWithFiles<T>;
		const payloadStart = readFields(record, keys, entry);
		if (payloadStart === -1) return undefined;

		entry.files = parseFileNames(getPayload(record, payloadStart));
		return entry;
	}

	const { parse, parseAsync } = createRecordParsers('Git.createLogParserWithFiles', parseRecord);

	return {
		arguments: args,
		separators: { record: recordSep, field: fieldSep },
		parse: parse,
		parseAsync: parseAsync,
	};
}
