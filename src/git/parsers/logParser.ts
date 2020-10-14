'use strict';
import * as paths from 'path';
import { Range } from 'vscode';
import {
	GitAuthor,
	GitCommitType,
	GitFile,
	GitFileStatus,
	GitLog,
	GitLogCommit,
	GitLogCommitLine,
	GitRevision,
} from '../git';
import { Arrays, debug, Strings } from '../../system';

const emptyEntry: LogEntry = {};
const emptyStr = '';
const slash = '/';

const diffRegex = /diff --git a\/(.*) b\/(.*)/;
const diffRangeRegex = /^@@ -(\d+?),(\d+?) \+(\d+?),(\d+?) @@/;

export const fileStatusRegex = /(\S)\S*\t([^\t\n]+)(?:\t(.+))?/;
const fileStatusAndSummaryRegex = /^(\d+?|-)\s+?(\d+?|-)\s+?(.*)(?:\n\s(delete|rename|copy|create))?/;
const fileStatusAndSummaryRenamedFileRegex = /(.+)\s=>\s(.+)/;
const fileStatusAndSummaryRenamedFilePathRegex = /(.*?){(.+?)\s=>\s(.*?)}(.*)/;

const logRefsRegex = /^<r> (.*)/gm;
const logFileSimpleRegex = /^<r> (.*)\s*(?:(?:diff --git a\/(.*) b\/(.*))|(?:(\S)\S*\t([^\t\n]+)(?:\t(.+))?))/gm;
const logFileSimpleRenamedRegex = /^<r> (\S+)\s*(.*)$/s;
const logFileSimpleRenamedFilesRegex = /^(\S)\S*\t([^\t\n]+)(?:\t(.+)?)?$/gm;

// Using %x00 codes because some shells seem to try to expand things if not
const lb = '%x3c'; // `%x${'<'.charCodeAt(0).toString(16)}`;
const rb = '%x3e'; // `%x${'>'.charCodeAt(0).toString(16)}`;
const sl = '%x2f'; // `%x${'/'.charCodeAt(0).toString(16)}`;
const sp = '%x20'; // `%x${' '.charCodeAt(0).toString(16)}`;

interface LogEntry {
	ref?: string;

	author?: string;
	date?: string;
	committedDate?: string;
	email?: string;

	parentShas?: string[];

	fileName?: string;
	originalFileName?: string;
	files?: GitFile[];

	status?: GitFileStatus;
	fileStats?: {
		insertions: number;
		deletions: number;
	};

	summary?: string;

	line?: GitLogCommitLine;
}

export class GitLogParser {
	static defaultFormat = [
		`${lb}${sl}f${rb}`,
		`${lb}r${rb}${sp}%H`, // ref
		`${lb}a${rb}${sp}%aN`, // author
		`${lb}e${rb}${sp}%aE`, // email
		`${lb}d${rb}${sp}%at`, // date
		`${lb}c${rb}${sp}%ct`, // committed date
		`${lb}p${rb}${sp}%P`, // parents
		`${lb}s${rb}`,
		'%B', // summary
		`${lb}${sl}s${rb}`,
		`${lb}f${rb}`,
	].join('%n');

	static simpleRefs = `${lb}r${rb}${sp}%H`;
	static simpleFormat = `${lb}r${rb}${sp}%H`;

	@debug({ args: false })
	static parse(
		data: string,
		type: GitCommitType,
		repoPath: string | undefined,
		fileName: string | undefined,
		sha: string | undefined,
		currentUser: { name?: string; email?: string } | undefined,
		limit: number | undefined,
		reverse: boolean,
		range: Range | undefined,
	): GitLog | undefined {
		if (!data) return undefined;

		let relativeFileName: string;
		let recentCommit: GitLogCommit | undefined = undefined;

		let entry: LogEntry = emptyEntry;
		let line: string | undefined = undefined;
		let token: number;

		let i = 0;
		let first = true;

		const lines = Strings.lines(`${data}</f>`);
		// Skip the first line since it will always be </f>
		let next = lines.next();
		if (next.done) return undefined;

		if (repoPath !== undefined) {
			repoPath = Strings.normalizePath(repoPath);
		}

		const authors = new Map<string, GitAuthor>();
		const commits = new Map<string, GitLogCommit>();
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
						ref: line.substring(4),
					};
					break;

				case 97: // 'a': // author
					if (GitRevision.isUncommitted(entry.ref)) {
						entry.author = 'You';
					} else {
						entry.author = line.substring(4);
					}
					break;

				case 101: // 'e': // author-mail
					entry.email = line.substring(4);
					break;

				case 100: // 'd': // author-date
					entry.date = line.substring(4);
					break;

				case 99: // 'c': // committer-date
					entry.committedDate = line.substring(4);
					break;

				case 112: // 'p': // parents
					entry.parentShas = line.substring(4).split(' ');
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
					if (next.done || next.value === '</f>') {
						// If there are no files returned, we end up skipping the commit, so reduce our truncationCount to ensure accurate truncation detection
						if (truncationCount) {
							truncationCount--;
						}

						break;
					}

					while (true) {
						next = lines.next();
						if (next.done) break;

						line = next.value;
						if (line === '</f>') break;

						if (line.startsWith('warning:')) continue;

						if (type === GitCommitType.Log) {
							match = fileStatusRegex.exec(line);
							if (match != null) {
								if (entry.files === undefined) {
									entry.files = [];
								}

								renamedFileName = match[3];
								if (renamedFileName !== undefined) {
									entry.files.push({
										status: match[1] as GitFileStatus,
										fileName: renamedFileName,
										originalFileName: match[2],
									});
								} else {
									entry.files.push({
										status: match[1] as GitFileStatus,
										fileName: match[2],
									});
								}
							}
						} else {
							match = diffRegex.exec(line);
							if (match != null) {
								[, entry.originalFileName, entry.fileName] = match;
								if (entry.fileName === entry.originalFileName) {
									entry.originalFileName = undefined;
									entry.status = 'M';
								} else {
									entry.status = 'R';
								}

								void lines.next();
								void lines.next();
								next = lines.next();

								match = diffRangeRegex.exec(next.value);
								if (match !== null) {
									entry.line = {
										from: {
											line: parseInt(match[1], 10),
											count: parseInt(match[2], 10),
										},
										to: {
											line: parseInt(match[3], 10),
											count: parseInt(match[4], 10),
										},
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
										insertions: Number(match[1]) || 0,
										deletions: Number(match[2]) || 0,
									};

									switch (match[4]) {
										case undefined:
											entry.status = 'M' as GitFileStatus;
											entry.fileName = match[3];
											break;
										case 'copy':
										case 'rename':
											entry.status = (match[4] === 'copy' ? 'C' : 'R') as GitFileStatus;

											renamedFileName = match[3];
											renamedMatch = fileStatusAndSummaryRenamedFilePathRegex.exec(
												renamedFileName,
											);
											if (renamedMatch != null) {
												// If there is no new path, the path part was removed so ensure we don't end up with //
												entry.fileName =
													renamedMatch[3] === ''
														? `${renamedMatch[1]}${renamedMatch[4]}`.replace('//', '/')
														: `${renamedMatch[1]}${renamedMatch[3]}${renamedMatch[4]}`;
												entry.originalFileName = `${renamedMatch[1]}${renamedMatch[2]}${renamedMatch[4]}`;
											} else {
												renamedMatch = fileStatusAndSummaryRenamedFileRegex.exec(
													renamedFileName,
												);
												if (renamedMatch != null) {
													entry.fileName = renamedMatch[2];
													entry.originalFileName = renamedMatch[1];
												} else {
													entry.fileName = renamedFileName;
												}
											}

											break;
										case 'create':
											entry.status = 'A' as GitFileStatus;
											entry.fileName = match[3];
											break;
										case 'delete':
											entry.status = 'D' as GitFileStatus;
											entry.fileName = match[3];
											break;
										default:
											entry.status = 'M' as GitFileStatus;
											entry.fileName = match[3];
											break;
									}
								}

								if (next.done || next.value === '</f>') break;
							}
						}
					}

					if (entry.files !== undefined) {
						entry.fileName = Arrays.filterMap(entry.files, f => (f.fileName ? f.fileName : undefined)).join(
							', ',
						);
					}

					if (first && repoPath === undefined && type === GitCommitType.LogFile && fileName !== undefined) {
						// Try to get the repoPath from the most recent commit
						repoPath = Strings.normalizePath(
							fileName.replace(
								fileName.startsWith(slash) ? `/${entry.fileName}` : entry.fileName!,
								emptyStr,
							),
						);
						relativeFileName = Strings.normalizePath(paths.relative(repoPath, fileName));
					} else {
						relativeFileName = entry.fileName!;
					}
					first = false;

					const commit = commits.get(entry.ref!);
					if (commit === undefined) {
						i++;
						if (limit && i > limit) break loop;
					} else if (truncationCount) {
						// Since this matches an existing commit it will be skipped, so reduce our truncationCount to ensure accurate truncation detection
						truncationCount--;
					}

					recentCommit = GitLogParser.parseEntry(
						entry,
						commit,
						type,
						repoPath,
						relativeFileName,
						commits,
						authors,
						recentCommit,
						currentUser,
					);

					break;
				}
			}
		}

		const log: GitLog = {
			repoPath: repoPath!,
			authors: authors,
			commits: commits,
			sha: sha,
			count: i,
			limit: limit,
			range: range,
			hasMore: Boolean(truncationCount && i > truncationCount && truncationCount !== 1),
		};
		return log;
	}

	private static parseEntry(
		entry: LogEntry,
		commit: GitLogCommit | undefined,
		type: GitCommitType,
		repoPath: string | undefined,
		relativeFileName: string,
		commits: Map<string, GitLogCommit>,
		authors: Map<string, GitAuthor>,
		recentCommit: GitLogCommit | undefined,
		currentUser: { name?: string; email?: string } | undefined,
	): GitLogCommit | undefined {
		if (commit === undefined) {
			if (entry.author !== undefined) {
				if (
					currentUser !== undefined &&
					// Name or e-mail is configured
					(currentUser.name !== undefined || currentUser.email !== undefined) &&
					// Match on name if configured
					(currentUser.name === undefined || currentUser.name === entry.author) &&
					// Match on email if configured
					(currentUser.email === undefined || currentUser.email === entry.email)
				) {
					entry.author = 'You';
				}

				let author = authors.get(entry.author);
				if (author === undefined) {
					author = {
						name: entry.author,
						lineCount: 0,
					};
					authors.set(entry.author, author);
				}
			}

			const originalFileName =
				entry.originalFileName ?? (relativeFileName !== entry.fileName ? entry.fileName : undefined);

			if (type === GitCommitType.LogFile) {
				entry.files = [
					{
						status: entry.status!,
						fileName: relativeFileName,
						originalFileName: originalFileName,
					},
				];
			}

			commit = new GitLogCommit(
				type,
				repoPath!,
				entry.ref!,
				entry.author!,
				entry.email,
				new Date((entry.date! as any) * 1000),
				new Date((entry.committedDate! as any) * 1000),
				entry.summary === undefined ? emptyStr : entry.summary,
				relativeFileName,
				entry.files ?? [],
				entry.status,
				originalFileName,
				type === GitCommitType.Log ? entry.parentShas![0] : undefined,
				undefined,
				entry.fileStats,
				entry.parentShas,
				entry.line,
			);

			commits.set(entry.ref!, commit);
		}
		// else {
		//     Logger.log(`merge commit? ${entry.sha}`);
		// }

		if (recentCommit !== undefined) {
			// If the commit sha's match (merge commit), just forward it along
			commit.nextSha = commit.sha !== recentCommit.sha ? recentCommit.sha : recentCommit.nextSha;

			// Only add a filename if this is a file log
			if (type === GitCommitType.LogFile) {
				recentCommit.previousFileName = commit.originalFileName ?? commit.fileName;
				commit.nextFileName = recentCommit.originalFileName ?? recentCommit.fileName;
			}
		}
		return commit;
	}

	@debug({ args: false })
	static parseLastRefOnly(data: string): string | undefined {
		let ref;
		let match;
		do {
			match = logRefsRegex.exec(data);
			if (match == null) break;

			[, ref] = match;
		} while (true);

		// Ensure the regex state is reset
		logRefsRegex.lastIndex = 0;

		return ref;
	}

	@debug({ args: false })
	static parseRefsOnly(data: string): string[] {
		const refs = [];

		let ref;
		let match;
		do {
			match = logRefsRegex.exec(data);
			if (match == null) break;

			[, ref] = match;

			if (ref == null || ref.length === 0) continue;

			// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
			refs.push(` ${ref}`.substr(1));
		} while (true);

		// Ensure the regex state is reset
		logRefsRegex.lastIndex = 0;

		return refs;
	}

	@debug({ args: false })
	static parseSimple(
		data: string,
		skip: number,
		skipRef?: string,
	): [string | undefined, string | undefined, GitFileStatus | undefined] {
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
			file = ` ${diffRenamed || diffFile || renamed || file}`.substr(1);
			// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
			status = status == null || status.length === 0 ? undefined : ` ${status}`.substr(1);
		} while (skip >= 0);

		// Ensure the regex state is reset
		logFileSimpleRegex.lastIndex = 0;

		// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
		return [
			ref == null || ref.length === 0 ? undefined : ` ${ref}`.substr(1),
			file,
			status as GitFileStatus | undefined,
		];
	}

	@debug({ args: false })
	static parseSimpleRenamed(
		data: string,
		originalFileName: string,
	): [string | undefined, string | undefined, GitFileStatus | undefined] {
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
			file = ` ${renamed || file}`.substr(1);
			// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
			status = status == null || status.length === 0 ? undefined : ` ${status}`.substr(1);

			break;
		} while (true);

		// Ensure the regex state is reset
		logFileSimpleRenamedFilesRegex.lastIndex = 0;

		return [
			// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
			ref == null || ref.length === 0 || file == null ? undefined : ` ${ref}`.substr(1),
			file,
			status as GitFileStatus | undefined,
		];
	}
}
