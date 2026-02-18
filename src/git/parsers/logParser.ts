import { joinPaths, normalizePath } from '../../system/path.js';
import { maybeStopWatch } from '../../system/stopwatch.js';
import { iterateAsyncByDelimiter, iterateByDelimiter } from '../../system/string.js';
import type { GitFileIndexStatus } from '../models/fileStatus.js';
import { diffHunkRegex, diffRegex } from './diffParser.js';

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

type GraphLogParser = LogParser<typeof graphMapping>;
let _graphParser: GraphLogParser | undefined;
type GraphWithStatsLogParser = LogParserWithStats<typeof graphMapping>;
let _graphWithStatsParser: GraphWithStatsLogParser | undefined;

export function getGraphParser(stats?: boolean): GraphLogParser | GraphWithStatsLogParser {
	if (stats) {
		_graphWithStatsParser ??= createLogParserWithStats(graphMapping);
		return _graphWithStatsParser;
	}

	_graphParser ??= createLogParser(graphMapping);
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
};

type LogParser<T> = AsyncParser<LogParsedEntry<T>>;
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

const recordSep = '\x1E'; // ASCII Record Separator character
const recordFormatSep = '%x1E';
const fieldSep = '\x1D'; // ASCII Group Separator character
const fieldFormatSep = '%x1D';

function createLogParser<T extends Record<string, string>>(mapping: ExtractAll<T, string>): LogParser<T> {
	let format = recordFormatSep;
	const keys: (keyof ExtractAll<T, string>)[] = [];
	for (const key in mapping) {
		keys.push(key);
		format += `${mapping[key]}${fieldFormatSep}`;
	}

	const args = [`--format=${format}`];

	function* parse(data: string | Iterable<string> | undefined): Generator<LogParsedEntry<T>> {
		using sw = maybeStopWatch('Git.LogParser.parse', { log: { onlyExit: true, level: 'debug' } });

		if (!data) {
			sw?.stop({ suffix: ` no data` });
			return;
		}

		const records = iterateByDelimiter(data, recordSep);

		let count = 0;
		let entry: LogParsedEntry<T>;
		let fields: IterableIterator<string>;

		for (const record of records) {
			if (!record.length) continue;

			entry = {} as unknown as LogParsedEntry<T>;
			fields = iterateByDelimiter(record, fieldSep);

			let fieldCount = 0;
			let field;

			while (true) {
				field = fields.next();
				if (field.done) break;
				if (fieldCount >= keys.length) continue; // Handle extra newlines at the end

				count++;
				entry[keys[fieldCount++]] = field.value as T[keyof T];
			}

			yield entry;
		}

		sw?.stop({ suffix: ` parsed ${count} records` });
	}

	async function* parseAsync(stream: AsyncGenerator<string>): AsyncGenerator<LogParsedEntry<T>> {
		using sw = maybeStopWatch('Git.LogParser.parseAsync', { log: { onlyExit: true, level: 'debug' } });

		const records = iterateAsyncByDelimiter(stream, recordSep);

		let count = 0;
		let entry: LogParsedEntry<T>;
		let fields: IterableIterator<string>;

		for await (const record of records) {
			if (!record.length) continue;

			entry = {} as unknown as LogParsedEntry<T>;
			fields = iterateByDelimiter(record, fieldSep);

			let fieldCount = 0;
			let field;

			while (true) {
				field = fields.next();
				if (field.done) break;
				if (fieldCount >= keys.length) continue; // Handle extra newlines at the end

				count++;
				entry[keys[fieldCount++]] = field.value as T[keyof T];
			}

			yield entry;
		}

		sw?.stop({ suffix: ` parsed ${count} records` });
	}

	return {
		arguments: args,
		separators: { record: recordSep, field: fieldSep },
		parse: parse,
		parseAsync: parseAsync,
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

	function* parse(data: string | Iterable<string> | undefined): Generator<LogParsedEntryWithFilesAndStats<T>> {
		using sw = maybeStopWatch('Git.LogParserWithFilesAndStats.parse', { log: { onlyExit: true, level: 'debug' } });

		if (!data) {
			sw?.stop({ suffix: ` no data` });
			return;
		}

		const records = iterateByDelimiter(data, recordSep);

		let count = 0;
		let entry: LogParsedEntryWithFilesAndStats<T>;
		let files: LogParsedFileWithStats[];
		let fields: IterableIterator<string>;

		for (const record of records) {
			if (!record.length) continue;

			count++;
			entry = {} as unknown as LogParsedEntryWithFilesAndStats<T>;
			files = [];
			fields = iterateByDelimiter(record, fieldSep);

			let fieldCount = 0;
			let field;
			while (true) {
				field = fields.next();
				if (field.done) break;

				if (fieldCount < keys.length) {
					entry[keys[fieldCount++]] = field.value as LogParsedEntryWithFilesAndStats<T>[keyof T];
				} else if (fieldCount === keys.length) {
					// Slice off the first newlines between the commits and files/summary, if any
					const summary = field.value.startsWith('\n\n')
						? field.value.substring(2)
						: field.value.startsWith('\n')
							? field.value.substring(1)
							: field.value;
					files.push(...parseFilesAndStats(summary));
				} else {
					debugger;
				}
			}

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

			yield entry;
		}

		sw?.stop({ suffix: ` parsed ${count} records` });
	}

	async function* parseAsync(stream: AsyncGenerator<string>): AsyncGenerator<LogParsedEntryWithFilesAndStats<T>> {
		using sw = maybeStopWatch('Git.LogParserWithFilesAndStats.parseAsync', {
			log: { onlyExit: true, level: 'debug' },
		});

		const records = iterateAsyncByDelimiter(stream, recordSep);

		let count = 0;
		let entry: LogParsedEntryWithFilesAndStats<T>;
		let files: LogParsedFileWithStats[];
		let fields: IterableIterator<string>;

		for await (const record of records) {
			if (!record.length) continue;

			count++;
			entry = {} as unknown as LogParsedEntryWithFilesAndStats<T>;
			files = [];
			fields = iterateByDelimiter(record, fieldSep);

			let fieldCount = 0;
			let field;
			while (true) {
				field = fields.next();
				if (field.done) break;

				if (fieldCount < keys.length) {
					entry[keys[fieldCount++]] = field.value as LogParsedEntryWithFilesAndStats<T>[keyof T];
				} else if (fieldCount === keys.length) {
					// Slice off the first newlines between the commits and files/summary, if any
					const summary = field.value.startsWith('\n\n')
						? field.value.substring(2)
						: field.value.startsWith('\n')
							? field.value.substring(1)
							: field.value;
					files.push(...parseFilesAndStats(summary));
				} else {
					debugger;
				}
			}

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

			yield entry;
		}

		sw?.stop({ suffix: ` parsed ${count} records` });
	}

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

	function* parse(data: string | Iterable<string> | undefined): Generator<LogParsedEntryWithFiles<T>> {
		using sw = maybeStopWatch('Git.LogParserWithFileSummary.parse', { log: { onlyExit: true, level: 'debug' } });

		if (!data) {
			sw?.stop({ suffix: ` no data` });
			return;
		}

		const records = iterateByDelimiter(data, recordSep);

		let count = 0;
		let entry: LogParsedEntryWithFiles<T>;
		let files: LogParsedFile[];
		let fields: IterableIterator<string>;

		for (const record of records) {
			if (!record.length) continue;

			count++;
			entry = {} as unknown as LogParsedEntryWithFiles<T>;
			files = [];
			fields = iterateByDelimiter(record, fieldSep);

			let fieldCount = 0;
			let field;
			while (true) {
				field = fields.next();
				if (field.done) break;

				if (fieldCount < keys.length) {
					entry[keys[fieldCount++]] = field.value as LogParsedEntryWithFiles<T>[keyof T];
				} else if (fieldCount === keys.length) {
					// Slice off the first newlines between the commits and files/summary, if any
					const summary = field.value.startsWith('\n\n')
						? field.value.substring(2)
						: field.value.startsWith('\n')
							? field.value.substring(1)
							: field.value;
					files.push(...parseFileSummary(summary));
				} else {
					debugger;
				}
			}

			entry.files = files;

			yield entry;
		}

		sw?.stop({ suffix: ` parsed ${count} records` });
	}

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

		const rangeMatch = line.value.match(diffHunkRegex);

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
			status: (fileMatch[1] === 'rename' ? 'R' : 'M') as GitFileIndexStatus,
			path: fileMatch[2],
			originalPath: fileMatch[1] === 'rename' ? fileMatch[3] : undefined,
			range: range,
			originalRange: originalRange,
		};
	}

	function* parse(data: string | Iterable<string> | undefined): Generator<LogParsedEntryWithFiles<T>> {
		using sw = maybeStopWatch('Git.LogParserWithPatch.parse', { log: { onlyExit: true, level: 'debug' } });

		if (!data) {
			sw?.stop({ suffix: ` no data` });
			return;
		}

		const records = iterateByDelimiter(data, recordSep);

		let count = 0;
		let entry: LogParsedEntryWithFiles<T>;
		let fields: IterableIterator<string>;

		for (const record of records) {
			if (!record.length) continue;

			count++;
			entry = {} as unknown as LogParsedEntryWithFiles<T>;
			fields = iterateByDelimiter(record, fieldSep);

			let fieldCount = 0;
			let field;
			while (true) {
				field = fields.next();
				if (field.done) break;

				if (fieldCount < keys.length) {
					entry[keys[fieldCount++]] = field.value as LogParsedEntryWithFiles<T>[keyof T];
				} else if (fieldCount === keys.length) {
					// Slice off the first newlines between the commit data and patch, if any
					const patch = field.value.startsWith('\n\n')
						? field.value.substring(2)
						: field.value.startsWith('\n')
							? field.value.substring(1)
							: field.value;
					const file = parsePatch(patch);
					entry.files = file != null ? [file] : [];
				} else {
					debugger;
				}
			}

			yield entry;
		}

		sw?.stop({ suffix: ` parsed ${count} records` });
	}

	async function* parseAsync(stream: AsyncGenerator<string>): AsyncGenerator<LogParsedEntryWithFiles<T>> {
		using sw = maybeStopWatch('Git.LogParserWithPatch.parseAsync', { log: { onlyExit: true, level: 'debug' } });

		const records = iterateAsyncByDelimiter(stream, recordSep);

		let count = 0;
		let entry: LogParsedEntryWithFiles<T>;
		let fields: IterableIterator<string>;

		for await (const record of records) {
			if (!record.length) continue;

			count++;
			entry = {} as unknown as LogParsedEntryWithFiles<T>;
			fields = iterateByDelimiter(record, fieldSep);

			let fieldCount = 0;
			let field;
			while (true) {
				field = fields.next();
				if (field.done) break;

				if (fieldCount < keys.length) {
					entry[keys[fieldCount++]] = field.value as LogParsedEntryWithFiles<T>[keyof T];
				} else if (fieldCount === keys.length) {
					// Slice off the first newlines between the commit data and patch, if any
					const patch = field.value.startsWith('\n\n')
						? field.value.substring(2)
						: field.value.startsWith('\n')
							? field.value.substring(1)
							: field.value;
					const file = parsePatch(patch);
					entry.files = file != null ? [file] : [];
				} else {
					debugger;
				}
			}

			yield entry;
		}

		sw?.stop({ suffix: ` parsed ${count} records` });
	}

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

	function* parse(data: string | Iterable<string> | undefined): Generator<LogParsedEntryWithStats<T>> {
		using sw = maybeStopWatch('Git.LogParserWithStats.parse', { log: { onlyExit: true, level: 'debug' } });

		if (!data) {
			sw?.stop({ suffix: ` no data` });
			return;
		}

		const records = iterateByDelimiter(data, recordSep);

		let count = 0;
		let entry: LogParsedEntryWithStats<T>;
		let fields: IterableIterator<string>;

		for (const record of records) {
			if (!record.length) continue;

			count++;
			entry = {} as unknown as LogParsedEntryWithStats<T>;
			fields = iterateByDelimiter(record, fieldSep);

			let fieldCount = 0;
			let field;
			while (true) {
				field = fields.next();
				if (field.done) break;

				if (fieldCount < keys.length) {
					entry[keys[fieldCount++]] = field.value as LogParsedEntryWithStats<T>[keyof T];
				} else if (fieldCount === keys.length) {
					// Slice off the first newlines between the commit data and files/summary, if any
					const summary = field.value.startsWith('\n\n')
						? field.value.substring(2)
						: field.value.startsWith('\n')
							? field.value.substring(1)
							: field.value;
					entry.stats = parseStats(summary);
				} else {
					debugger;
				}
			}

			yield entry;
		}

		sw?.stop({ suffix: ` parsed ${count} records` });
	}

	async function* parseAsync(stream: AsyncGenerator<string>): AsyncGenerator<LogParsedEntryWithStats<T>> {
		using sw = maybeStopWatch('Git.LogParserWithStats.parseAsync', { log: { onlyExit: true, level: 'debug' } });

		const records = iterateAsyncByDelimiter(stream, recordSep);

		let count = 0;
		let entry: LogParsedEntryWithStats<T>;
		let fields: IterableIterator<string>;

		for await (const record of records) {
			if (!record.length) continue;

			count++;
			entry = {} as unknown as LogParsedEntryWithStats<T>;
			fields = iterateByDelimiter(record, fieldSep);

			let fieldCount = 0;
			let field;
			while (true) {
				field = fields.next();
				if (field.done) break;

				if (fieldCount < keys.length) {
					entry[keys[fieldCount++]] = field.value as LogParsedEntryWithStats<T>[keyof T];
				} else if (fieldCount === keys.length) {
					// Slice off the first newlines between the commit data and files/summary, if any
					const summary = field.value.startsWith('\n\n')
						? field.value.substring(2)
						: field.value.startsWith('\n')
							? field.value.substring(1)
							: field.value;
					entry.stats = parseStats(summary);
				} else {
					debugger;
				}
			}

			yield entry;
		}

		sw?.stop({ suffix: ` parsed ${count} records` });
	}

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

	function* parse(data: string | Iterable<string> | undefined): Generator<LogParsedEntryWithFiles<T>> {
		using sw = maybeStopWatch('Git.createLogParserWithFiles.parse', { log: { onlyExit: true, level: 'debug' } });

		if (!data) {
			sw?.stop({ suffix: ` no data` });
			return;
		}

		const records = iterateByDelimiter(data, recordSep);

		let count = 0;
		let entry: LogParsedEntryWithFiles<T>;
		let fields: IterableIterator<string>;

		for (const record of records) {
			if (!record.length) continue;

			count++;
			entry = {} as unknown as LogParsedEntryWithFiles<T>;
			fields = iterateByDelimiter(record, fieldSep);

			let fieldCount = 0;
			let field;
			while (true) {
				field = fields.next();
				if (field.done) break;

				if (fieldCount < keys.length) {
					entry[keys[fieldCount++]] = field.value as LogParsedEntryWithFiles<T>[keyof T];
				} else if (fieldCount === keys.length) {
					// Slice off the first newlines between the commit data and files, if any
					const files = field.value.startsWith('\n\n')
						? field.value.substring(2)
						: field.value.startsWith('\n')
							? field.value.substring(1)
							: field.value;
					entry.files = parseFileNames(files);
				} else {
					debugger;
				}
			}

			yield entry;
		}

		sw?.stop({ suffix: ` parsed ${count} records` });
	}

	async function* parseAsync(stream: AsyncGenerator<string>): AsyncGenerator<LogParsedEntryWithFiles<T>> {
		using sw = maybeStopWatch('Git.createLogParserWithFiles.parseAsync', {
			log: { onlyExit: true, level: 'debug' },
		});

		const records = iterateAsyncByDelimiter(stream, recordSep);

		let count = 0;
		let entry: LogParsedEntryWithFiles<T>;
		let fields: IterableIterator<string>;

		for await (const record of records) {
			if (!record.length) continue;

			count++;
			entry = {} as unknown as LogParsedEntryWithFiles<T>;
			fields = iterateByDelimiter(record, fieldSep);

			let fieldCount = 0;
			let field;
			while (true) {
				field = fields.next();
				if (field.done) break;

				if (fieldCount < keys.length) {
					entry[keys[fieldCount++]] = field.value as LogParsedEntryWithFiles<T>[keyof T];
				} else if (fieldCount === keys.length) {
					// Slice off the first newlines between the commit data and files, if any
					const files = field.value.startsWith('\n\n')
						? field.value.substring(2)
						: field.value.startsWith('\n')
							? field.value.substring(1)
							: field.value;
					entry.files = parseFileNames(files);
				} else {
					debugger;
				}
			}

			yield entry;
		}

		sw?.stop({ suffix: ` parsed ${count} records` });
	}

	return {
		arguments: args,
		separators: { record: recordSep, field: fieldSep },
		parse: parse,
		parseAsync: parseAsync,
	};
}
