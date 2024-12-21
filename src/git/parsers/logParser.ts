/* eslint-disable @typescript-eslint/no-deprecated */
import type { Range } from 'vscode';
import type { Container } from '../../container';
import { filterMap } from '../../system/array';
import { normalizePath } from '../../system/path';
import { maybeStopWatch } from '../../system/stopwatch';
import { getLines } from '../../system/string';
import { relative } from '../../system/vscode/path';
import type { GitCommitLine, GitStashCommit } from '../models/commit';
import { GitCommit, GitCommitIdentity } from '../models/commit';
import type { GitFile, GitFileChangeStats } from '../models/file';
import { GitFileChange, GitFileIndexStatus } from '../models/file';
import type { GitLog } from '../models/log';
import { uncommitted } from '../models/revision';
import type { GitUser } from '../models/user';
import { isUserMatch } from '../models/user';

const diffRegex = /diff --git a\/(.*) b\/(.*)/;
const diffRangeRegex = /^@@ -(\d+?),(\d+?) \+(\d+?),(\d+?) @@/;

export const fileStatusRegex = /(\S)\S*\t([^\t\n]+)(?:\t(.+))?/;
const fileStatusAndSummaryRegex = /^(\d+?|-)\s+?(\d+?|-)\s+?(.*)(?:\n\s(delete|rename|copy|create))?/;
const fileStatusAndSummaryRenamedFileRegex = /(.+)\s=>\s(.+)/;
const fileStatusAndSummaryRenamedFilePathRegex = /(.*?){(.+?)?\s=>\s(.*?)?}(.*)/;

const logFileSimpleRegex = /^<r> (.*)\s*(?:(?:diff --git a\/(.*) b\/(.*))|(?:(\S)\S*\t([^\t\n]+)(?:\t(.+))?))/gm;
const logFileSimpleRenamedRegex = /^<r> (\S+)\s*(.*)$/s;
const logFileSimpleRenamedFilesRegex = /^(\S)\S*\t([^\t\n]+)(?:\t(.+)?)?$/gm;

const shortstatRegex =
	/(?<files>\d+) files? changed(?:, (?<additions>\d+) insertions?\(\+\))?(?:, (?<deletions>\d+) deletions?\(-\))?/;

// Using %x00 codes because some shells seem to try to expand things if not
const lb = '%x3c'; // `%x${'<'.charCodeAt(0).toString(16)}`;
const rb = '%x3e'; // `%x${'>'.charCodeAt(0).toString(16)}`;
const sl = '%x2f'; // `%x${'/'.charCodeAt(0).toString(16)}`;
const sp = '%x20'; // `%x${' '.charCodeAt(0).toString(16)}`;

export const enum LogType {
	Log = 0,
	LogFile = 1,
}

interface LogEntry {
	sha?: string;

	author?: string;
	authorDate?: string;
	authorEmail?: string;

	committer?: string;
	committedDate?: string;
	committerEmail?: string;

	parentShas?: string[];

	/** @deprecated */
	path?: string;
	/** @deprecated */
	originalPath?: string;

	file?: GitFile;
	files?: GitFile[];

	status?: GitFileIndexStatus;
	fileStats?: GitFileChangeStats;

	summary?: string;
	tips?: string[];

	line?: GitCommitLine;
}

export type Parser<T> = {
	arguments: string[];
	parse: (data: string | string[]) => Generator<T>;
};

export type ParsedEntryFile = { status: string; path: string; originalPath?: string };
export type ParsedEntryFileWithStats = ParsedEntryFile & { additions: number; deletions: number };
export type ParsedEntryFileWithMaybeStats = ParsedEntryFile & { additions?: number; deletions?: number };

export type ParsedEntryWithFiles<T> = { [K in keyof T]: string } & { files: ParsedEntryFile[] };
export type ParsedEntryWithFilesAndStats<T> = { [K in keyof T]: string } & { files: ParsedEntryFileWithStats[] };
export type ParsedEntryWithFilesAndMaybeStats<T> = { [K in keyof T]: string } & {
	files: ParsedEntryFileWithMaybeStats[];
};

export type ParserWithFiles<T> = Parser<ParsedEntryWithFiles<T>>;
export type ParserWithFilesAndStats<T> = Parser<ParsedEntryWithFilesAndStats<T>>;
export type ParserWithFilesAndMaybeStats<T> = Parser<ParsedEntryWithFilesAndMaybeStats<T>>;

export type ParsedStats = { files: number; additions: number; deletions: number };
export type ParsedEntryWithMaybeStats<T> = T & { stats?: ParsedStats };
export type ParserWithMaybeStats<T> = Parser<ParsedEntryWithMaybeStats<T>>;

export type ParsedEntryWithStats<T> = T & { stats: ParsedStats };
export type ParserWithStats<T> = Parser<ParsedEntryWithStats<T>>;

type ContributorsParserMaybeWithStats = ParserWithMaybeStats<{
	sha: string;
	author: string;
	email: string;
	date: string;
}>;

let _contributorsParser: ContributorsParserMaybeWithStats | undefined;
let _contributorsParserWithStats: ContributorsParserMaybeWithStats | undefined;
export function getContributorsParser(stats?: boolean): ContributorsParserMaybeWithStats {
	if (stats) {
		_contributorsParserWithStats ??= createLogParserWithStats({
			sha: '%H',
			author: '%aN',
			email: '%aE',
			date: '%at',
		});
		return _contributorsParserWithStats;
	}

	_contributorsParser ??= createLogParser({
		sha: '%H',
		author: '%aN',
		email: '%aE',
		date: '%at',
	});
	return _contributorsParser;
}

type GraphParserMaybeWithStats = ParserWithMaybeStats<{
	sha: string;
	author: string;
	authorEmail: string;
	authorDate: string;
	committerDate: string;
	parents: string;
	tips: string;
	message: string;
}>;

let _graphParser: GraphParserMaybeWithStats | undefined;
let _graphParserWithStats: GraphParserMaybeWithStats | undefined;

export function getGraphParser(stats?: boolean): GraphParserMaybeWithStats {
	if (stats) {
		_graphParserWithStats ??= createLogParserWithStats({
			sha: '%H',
			author: '%aN',
			authorEmail: '%aE',
			authorDate: '%at',
			committerDate: '%ct',
			parents: '%P',
			tips: '%D',
			message: '%B',
		});
		return _graphParserWithStats;
	}

	_graphParser ??= createLogParser({
		sha: '%H',
		author: '%aN',
		authorEmail: '%aE',
		authorDate: '%at',
		committerDate: '%ct',
		parents: '%P',
		tips: '%D',
		message: '%B',
	});
	return _graphParser;
}

let _graphStatsParser: ParserWithStats<{ sha: string }> | undefined;

export function getGraphStatsParser(): ParserWithStats<{ sha: string }> {
	_graphStatsParser ??= createLogParserWithStats({ sha: '%H' });
	return _graphStatsParser;
}

type RefParser = Parser<string>;

let _refParser: RefParser | undefined;
export function getRefParser(): RefParser {
	_refParser ??= createLogParserSingle('%H');
	return _refParser;
}

type RefAndDateParser = Parser<{ sha: string; authorDate: string; committerDate: string }>;

let _refAndDateParser: RefAndDateParser | undefined;
export function getRefAndDateParser(): RefAndDateParser {
	_refAndDateParser ??= createLogParser({
		sha: '%H',
		authorDate: '%at',
		committerDate: '%ct',
	});
	return _refAndDateParser;
}

export function createLogParser<
	T extends Record<string, unknown>,
	TAdditional extends Record<string, unknown> = Record<string, unknown>,
>(
	fieldMapping: ExtractAll<T, string>,
	options?: {
		additionalArgs?: string[];
		parseEntry?: (fields: IterableIterator<string>, entry: T & TAdditional) => void;
		prefix?: string;
		fieldPrefix?: string;
		fieldSuffix?: string;
		separator?: string;
		skip?: number;
	},
): Parser<T & TAdditional> {
	let format = options?.prefix ?? '';
	const keys: (keyof ExtractAll<T, string>)[] = [];
	for (const key in fieldMapping) {
		keys.push(key);
		format += `${options?.fieldPrefix ?? ''}${fieldMapping[key]}${
			options?.fieldSuffix ?? (options?.fieldPrefix == null ? '%x00' : '')
		}`;
	}

	const args = ['-z', `--format=${format}`];
	if (options?.additionalArgs != null && options.additionalArgs.length > 0) {
		args.push(...options.additionalArgs);
	}

	function* parse(data: string | string[]): Generator<T & TAdditional> {
		let entry: T & TAdditional = {} as any;
		let fieldCount = 0;
		let field;

		const fields = getLines(data, options?.separator ?? '\0');
		if (options?.skip) {
			for (let i = 0; i < options.skip; i++) {
				field = fields.next();
			}
		}

		while (true) {
			field = fields.next();
			if (field.done) break;

			entry[keys[fieldCount++]] = field.value as (T & TAdditional)[keyof T];

			if (fieldCount === keys.length) {
				fieldCount = 0;
				field = fields.next();

				options?.parseEntry?.(fields, entry);
				yield entry;

				entry = {} as any;
			}
		}
	}

	return { arguments: args, parse: parse };
}

export function createLogParserSingle(field: string): Parser<string> {
	const format = field;
	const args = ['-z', `--format=${format}`];

	function* parse(data: string | string[]): Generator<string> {
		let field;

		const fields = getLines(data, '\0');
		while (true) {
			field = fields.next();
			if (field.done) break;

			yield field.value;
		}
	}

	return { arguments: args, parse: parse };
}

export function createLogParserWithFiles<T extends Record<string, unknown>>(
	fieldMapping?: ExtractAll<T, string>,
): ParserWithFiles<T> {
	let args: string[] = [];
	const keys: (keyof ExtractAll<T, string>)[] = [];
	if (fieldMapping != null) {
		let format = '%x00';
		for (const key in fieldMapping) {
			keys.push(key);
			format += `%x00${fieldMapping[key]}`;
		}
		args = ['-z', `--format=${format}`, '--name-status'];
	} else {
		args = ['-z', '--name-status'];
	}

	function* parse(data: string | string[]): Generator<ParsedEntryWithFiles<T>> {
		const records = getLines(data, '\0\0\0');

		let entry: ParsedEntryWithFiles<T>;
		let files: ParsedEntryFile[];
		let fields: IterableIterator<string>;

		for (const record of records) {
			entry = {} as any;
			files = [];
			fields = getLines(record, '\0');

			if (fieldMapping != null) {
				// Skip the 2 starting NULs
				fields.next();
				fields.next();
			}

			let fieldCount = 0;
			let field;
			while (true) {
				field = fields.next();
				if (field.done) break;

				if (fieldCount < keys.length) {
					entry[keys[fieldCount++]] = field.value as ParsedEntryWithFiles<T>[keyof T];
				} else {
					const file: ParsedEntryFile = { status: field.value.trim(), path: undefined! };
					field = fields.next();
					file.path = field.value;

					if (file.status.startsWith('R') || file.status.startsWith('C')) {
						field = fields.next();
						file.originalPath = field.value;
					}

					files.push(file);
				}
			}

			entry.files = files;
			yield entry;
		}
	}

	return { arguments: args, parse: parse };
}

export function createLogParserWithFilesAndStats<T extends Record<string, unknown>>(
	fieldMapping?: ExtractAll<T, string>,
): ParserWithFilesAndStats<T> {
	let args: string[] = [];
	const keys: (keyof ExtractAll<T, string>)[] = [];
	if (fieldMapping != null) {
		let format = '%x00';
		for (const key in fieldMapping) {
			keys.push(key);
			format += `%x00${fieldMapping[key]}`;
		}
		args = ['-z', `--format=${format}`, '--numstat'];
	} else {
		args = ['-z', '--numstat'];
	}

	function* parse(data: string | string[]): Generator<ParsedEntryWithFilesAndStats<T>> {
		const records = getLines(data, '\0\0\0');

		let entry: ParsedEntryWithFilesAndStats<T>;
		let files: ParsedEntryFileWithStats[];
		let fields: IterableIterator<string>;

		for (const record of records) {
			entry = {} as any;
			files = [];
			fields = getLines(record, '\0');

			if (fieldMapping != null) {
				// Skip the 2 starting NULs
				fields.next();
				fields.next();
			}

			let fieldCount = 0;
			let field;
			while (true) {
				field = fields.next();
				if (field.done) break;

				if (fieldCount < keys.length) {
					entry[keys[fieldCount++]] = field.value as ParsedEntryWithFilesAndStats<T>[keyof T];
				} else {
					const [additions, deletions, path] = field.value.split('\t');
					// Skip binary files which show as - for both additions and deletions
					if (additions === '-' && deletions === '-') continue;

					const file: ParsedEntryFileWithStats = {
						status:
							additions === '0' && deletions === '0'
								? 'M'
								: additions === '0'
								  ? 'D'
								  : deletions === '0'
								    ? 'A'
								    : 'M',
						path: path,
						additions: additions === '-' ? 0 : parseInt(additions, 10),
						deletions: deletions === '-' ? 0 : parseInt(deletions, 10),
					};

					// Handle renamed files which show as path/to/file => new/path/to/file
					if (path.includes(' => ')) {
						const [originalPath, newPath] = path.split(' => ');
						file.originalPath = originalPath;
						file.path = newPath;
						file.status = 'R';
					}

					files.push(file);
				}
			}

			entry.files = files;
			yield entry;
		}
	}

	return { arguments: args, parse: parse };
}

export function createLogParserWithStats<T extends Record<string, unknown>>(
	fieldMapping: ExtractAll<T, string>,
): ParserWithStats<T> {
	function parseStats(fields: IterableIterator<string>, entry: ParsedEntryWithMaybeStats<T>) {
		const stats = fields.next().value;
		const match = shortstatRegex.exec(stats);
		if (match?.groups != null) {
			entry.stats = {
				files: Number(match.groups.files || 0),
				additions: Number(match.groups.additions || 0),
				deletions: Number(match.groups.deletions || 0),
			};
		}
		fields.next();
		return entry;
	}

	return createLogParser<T, ParsedEntryWithStats<T>>(fieldMapping, {
		additionalArgs: ['--shortstat'],
		parseEntry: parseStats,
		prefix: '%x00%x00',
		separator: '\0',
		fieldSuffix: '%x00',
		skip: 2,
	});
}

export const parseGitLogAllFormat = [
	`${lb}${sl}f${rb}`,
	`${lb}r${rb}${sp}%H`, // ref
	`${lb}a${rb}${sp}%aN`, // author
	`${lb}e${rb}${sp}%aE`, // author email
	`${lb}d${rb}${sp}%at`, // author date
	`${lb}n${rb}${sp}%cN`, // committer
	`${lb}m${rb}${sp}%cE`, // committer email
	`${lb}c${rb}${sp}%ct`, // committer date
	`${lb}p${rb}${sp}%P`, // parents
	`${lb}t${rb}${sp}%D`, // tips
	`${lb}s${rb}`,
	'%B', // summary
	`${lb}${sl}s${rb}`,
	`${lb}f${rb}`,
].join('%n');
export const parseGitLogDefaultFormat = [
	`${lb}${sl}f${rb}`,
	`${lb}r${rb}${sp}%H`, // ref
	`${lb}a${rb}${sp}%aN`, // author
	`${lb}e${rb}${sp}%aE`, // author email
	`${lb}d${rb}${sp}%at`, // author date
	`${lb}n${rb}${sp}%cN`, // committer
	`${lb}m${rb}${sp}%cE`, // committer email
	`${lb}c${rb}${sp}%ct`, // committer date
	`${lb}p${rb}${sp}%P`, // parents
	`${lb}s${rb}`,
	'%B', // summary
	`${lb}${sl}s${rb}`,
	`${lb}f${rb}`,
].join('%n');
export const parseGitLogSimpleFormat = `${lb}r${rb}${sp}%H`;

export function parseGitLog(
	container: Container,
	data: string,
	type: LogType,
	repoPath: string | undefined,
	fileName: string | undefined,
	sha: string | undefined,
	currentUser: GitUser | undefined,
	limit: number | undefined,
	reverse: boolean,
	range: Range | undefined,
	stashes?: Map<string, GitStashCommit>,
	includeOnlyStashes?: boolean,
	hasMoreOverride?: boolean,
): GitLog | undefined {
	using sw = maybeStopWatch(`Git.parseLog(${repoPath}, fileName=${fileName}, sha=${sha})`, {
		log: false,
		logLevel: 'debug',
	});
	if (!data) return undefined;

	let relativeFileName: string | undefined;

	let entry: LogEntry = {};
	let line: string | undefined = undefined;
	let token: number;

	let i = 0;
	let first = true;

	const lines = getLines(`${data}</f>`);
	// Skip the first line since it will always be </f>
	let next = lines.next();
	if (next.done) return undefined;

	if (repoPath !== undefined) {
		repoPath = normalizePath(repoPath);
	}

	const commits = new Map<string, GitCommit>();
	let truncationCount = limit;

	let match;
	let renamedFileName;
	let renamedMatch;

	loop: while (true) {
		next = lines.next();
		if (next.done) break;

		line = next.value;

		// Since log --reverse doesn't properly honor a max count -- enforce it here
		if (reverse && limit && i >= limit) break;

		// <1-char token> data
		// e.g. <r> bd1452a2dc
		token = line.charCodeAt(1);

		switch (token) {
			case 114: // 'r': // ref
				entry = {
					sha: line.substring(4),
				};
				break;

			case 97: // 'a': // author
				if (uncommitted === entry.sha) {
					entry.author = 'You';
				} else {
					entry.author = line.substring(4);
				}
				break;

			case 101: // 'e': // author-mail
				entry.authorEmail = line.substring(4);
				break;

			case 100: // 'd': // author-date
				entry.authorDate = line.substring(4);
				break;

			case 110: // 'n': // committer
				entry.committer = line.substring(4);
				break;

			case 109: // 'm': // committer-mail
				entry.committedDate = line.substring(4);
				break;

			case 99: // 'c': // committer-date
				entry.committedDate = line.substring(4);
				break;

			case 112: // 'p': // parents
				line = line.substring(4);
				entry.parentShas = line.length !== 0 ? line.split(' ') : undefined;
				break;

			case 116: // 't': // tips
				line = line.substring(4);
				entry.tips = line.length !== 0 ? line.split(', ') : undefined;
				break;

			case 115: // 's': // summary
				while (true) {
					next = lines.next();
					if (next.done) break;

					line = next.value;
					if (line === '</s>') break;

					if (entry.summary === undefined) {
						entry.summary = line;
					} else {
						entry.summary += `\n${line}`;
					}
				}

				// Remove the trailing newline
				if (entry.summary != null && entry.summary.charCodeAt(entry.summary.length - 1) === 10) {
					entry.summary = entry.summary.slice(0, -1);
				}
				break;

			case 102: {
				// 'f': // files
				// Skip the blank line git adds before the files
				next = lines.next();

				let hasFiles = true;
				if (next.done || next.value === '</f>') {
					hasFiles = false;
				}

				// eslint-disable-next-line no-unmodified-loop-condition
				while (hasFiles) {
					next = lines.next();
					if (next.done) break;

					line = next.value;
					if (line === '</f>') break;

					if (line.startsWith('warning:')) continue;

					if (type === LogType.Log) {
						match = fileStatusRegex.exec(line);
						if (match != null) {
							if (entry.files === undefined) {
								entry.files = [];
							}

							renamedFileName = match[3];
							if (renamedFileName !== undefined) {
								entry.files.push({
									status: match[1] as GitFileIndexStatus,
									path: renamedFileName,
									originalPath: match[2],
								});
							} else {
								entry.files.push({
									status: match[1] as GitFileIndexStatus,
									path: match[2],
								});
							}
						}
					} else {
						match = diffRegex.exec(line);
						if (match != null) {
							[, entry.originalPath, entry.path] = match;
							if (entry.path === entry.originalPath) {
								entry.originalPath = undefined;
								entry.status = GitFileIndexStatus.Modified;
							} else {
								entry.status = GitFileIndexStatus.Renamed;
							}

							void lines.next();
							void lines.next();
							next = lines.next();

							match = diffRangeRegex.exec(next.value);
							if (match !== null) {
								entry.line = {
									sha: entry.sha!,
									originalLine: parseInt(match[1], 10),
									// count: parseInt(match[2], 10),
									line: parseInt(match[3], 10),
									// count: parseInt(match[4], 10),
								};
							}

							while (true) {
								next = lines.next();
								if (next.done || next.value === '</f>') break;
							}
							break;
						} else {
							next = lines.next();
							match = fileStatusAndSummaryRegex.exec(`${line}\n${next.value}`);
							if (match != null) {
								entry.fileStats = {
									additions: Number(match[1]) || 0,
									deletions: Number(match[2]) || 0,
									changes: 0,
								};

								switch (match[4]) {
									case undefined:
										entry.status = 'M' as GitFileIndexStatus;
										entry.path = match[3];
										break;
									case 'copy':
									case 'rename':
										entry.status = (match[4] === 'copy' ? 'C' : 'R') as GitFileIndexStatus;

										renamedFileName = match[3];
										renamedMatch = fileStatusAndSummaryRenamedFilePathRegex.exec(renamedFileName);
										if (renamedMatch != null) {
											const [, start, from, to, end] = renamedMatch;
											// If there is no new path, the path part was removed so ensure we don't end up with //
											if (!to) {
												entry.path = `${
													start.endsWith('/') && end.startsWith('/')
														? start.slice(0, -1)
														: start
												}${end}`;
											} else {
												entry.path = `${start}${to}${end}`;
											}

											if (!from) {
												entry.originalPath = `${
													start.endsWith('/') && end.startsWith('/')
														? start.slice(0, -1)
														: start
												}${end}`;
											} else {
												entry.originalPath = `${start}${from}${end}`;
											}
										} else {
											renamedMatch = fileStatusAndSummaryRenamedFileRegex.exec(renamedFileName);
											if (renamedMatch != null) {
												entry.path = renamedMatch[2];
												entry.originalPath = renamedMatch[1];
											} else {
												entry.path = renamedFileName;
											}
										}

										break;
									case 'create':
										entry.status = 'A' as GitFileIndexStatus;
										entry.path = match[3];
										break;
									case 'delete':
										entry.status = 'D' as GitFileIndexStatus;
										entry.path = match[3];
										break;
									default:
										entry.status = 'M' as GitFileIndexStatus;
										entry.path = match[3];
										break;
								}
							}

							if (next.done || next.value === '</f>') break;
						}
					}
				}

				if (entry.files !== undefined) {
					entry.path = filterMap(entry.files, f => (f.path ? f.path : undefined)).join(', ');
				}

				if (first && repoPath === undefined && type === LogType.LogFile && fileName !== undefined) {
					// Try to get the repoPath from the most recent commit
					repoPath = normalizePath(
						fileName.replace(fileName.startsWith('/') ? `/${entry.path}` : entry.path!, ''),
					);
					relativeFileName = normalizePath(relative(repoPath, fileName));
				} else {
					relativeFileName =
						entry.path ??
						(repoPath != null && fileName != null
							? normalizePath(relative(repoPath, fileName))
							: undefined);
				}
				first = false;

				if (includeOnlyStashes && !stashes?.has(entry.sha!)) continue;

				const commit = commits.get(entry.sha!);
				if (commit === undefined) {
					i++;
					if (limit && i > limit) break loop;
				} else if (truncationCount) {
					// Since this matches an existing commit it will be skipped, so reduce our truncationCount to ensure accurate truncation detection
					truncationCount--;
				}

				parseLogEntry(
					container,
					entry,
					commit,
					type,
					repoPath,
					relativeFileName,
					commits,
					currentUser,
					stashes,
				);

				break;
			}
		}
	}

	sw?.stop({ suffix: ` parsed ${commits.size} commits` });

	const log: GitLog = {
		repoPath: repoPath!,
		commits: commits,
		sha: sha,
		count: i,
		limit: limit,
		range: range,
		hasMore: hasMoreOverride ?? Boolean(truncationCount && i > truncationCount && truncationCount !== 1),
	};
	return log;
}

function parseLogEntry(
	container: Container,
	entry: LogEntry,
	commit: GitCommit | undefined,
	type: LogType,
	repoPath: string | undefined,
	relativeFileName: string | undefined,
	commits: Map<string, GitCommit>,
	currentUser: GitUser | undefined,
	stashes: Map<string, GitStashCommit> | undefined,
): void {
	if (commit == null) {
		if (entry.author != null) {
			if (isUserMatch(currentUser, entry.author, entry.authorEmail)) {
				entry.author = 'You';
			}
		}

		if (entry.committer != null) {
			if (isUserMatch(currentUser, entry.committer, entry.committerEmail)) {
				entry.committer = 'You';
			}
		}

		const originalFileName = entry.originalPath ?? (relativeFileName !== entry.path ? entry.path : undefined);

		const files: { file?: GitFileChange; files?: GitFileChange[] } = {
			files: entry.files?.map(f => new GitFileChange(repoPath!, f.path, f.status, f.originalPath)),
		};
		if (type === LogType.LogFile && relativeFileName != null) {
			files.file = new GitFileChange(
				repoPath!,
				relativeFileName,
				entry.status!,
				originalFileName,
				undefined,
				entry.fileStats,
			);
		}

		const stash = stashes?.get(entry.sha!);
		if (stash != null) {
			commit = new GitCommit(
				container,
				repoPath!,
				stash.sha,
				stash.author,
				stash.committer,
				stash.summary,
				stash.parents,
				stash.message,
				files,
				undefined,
				entry.line != null ? [entry.line] : [],
				entry.tips,
				stash.stashName,
				stash.stashOnRef,
			);
			commits.set(stash.sha, commit);
		} else {
			commit = new GitCommit(
				container,
				repoPath!,
				entry.sha!,

				new GitCommitIdentity(entry.author!, entry.authorEmail, new Date((entry.authorDate! as any) * 1000)),

				new GitCommitIdentity(
					entry.committer!,
					entry.committerEmail,
					new Date((entry.committedDate! as any) * 1000),
				),
				entry.summary?.split('\n', 1)[0] ?? '',
				entry.parentShas ?? [],
				entry.summary ?? '',
				files,
				undefined,
				entry.line != null ? [entry.line] : [],
				entry.tips,
			);
			commits.set(entry.sha!, commit);
		}
	}
}

export function parseGitLogSimple(
	data: string,
	skip: number,
	skipRef?: string,
): [string | undefined, string | undefined, GitFileIndexStatus | undefined] {
	using _sw = maybeStopWatch('Git.parseLogSimple', { log: false, logLevel: 'debug' });

	let ref;
	let diffFile;
	let diffRenamed;
	let status;
	let file;
	let renamed;

	let match;
	do {
		match = logFileSimpleRegex.exec(data);
		if (match == null) break;

		if (match[1] === skipRef) continue;
		if (skip-- > 0) continue;

		[, ref, diffFile, diffRenamed, status, file, renamed] = match;

		// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
		file = ` ${diffRenamed || diffFile || renamed || file}`.substring(1);
		// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
		status = status == null || status.length === 0 ? undefined : ` ${status}`.substring(1);
	} while (skip >= 0);

	// Ensure the regex state is reset
	logFileSimpleRegex.lastIndex = 0;

	// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
	return [
		ref == null || ref.length === 0 ? undefined : ` ${ref}`.substring(1),
		file,
		status as GitFileIndexStatus | undefined,
	];
}

export function parseGitLogSimpleRenamed(
	data: string,
	originalFileName: string,
): [string | undefined, string | undefined, GitFileIndexStatus | undefined] {
	using _sw = maybeStopWatch('Git.parseLogSimpleRenamed', { log: false, logLevel: 'debug' });

	let match = logFileSimpleRenamedRegex.exec(data);
	if (match == null) return [undefined, undefined, undefined];

	const [, ref, files] = match;

	let status;
	let file;
	let renamed;

	do {
		match = logFileSimpleRenamedFilesRegex.exec(files);
		if (match == null) break;

		[, status, file, renamed] = match;

		if (originalFileName !== file) {
			status = undefined;
			file = undefined;
			renamed = undefined;
			continue;
		}

		// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
		file = ` ${renamed || file}`.substring(1);
		// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
		status = status == null || status.length === 0 ? undefined : ` ${status}`.substring(1);

		break;
	} while (true);

	// Ensure the regex state is reset
	logFileSimpleRenamedFilesRegex.lastIndex = 0;

	return [
		// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
		ref == null || ref.length === 0 || file == null ? undefined : ` ${ref}`.substring(1),
		file,
		status as GitFileIndexStatus | undefined,
	];
}
