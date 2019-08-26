'use strict';
import { fileStatusRegex, GitCommitType, GitFile, GitFileStatus, GitStash, GitStashCommit } from '../git';
import { Arrays, debug, Strings } from '../../system';
// import { Logger } from './logger';

// Using %x00 codes because some shells seem to try to expand things if not
const lb = '%x3c'; // `%x${'<'.charCodeAt(0).toString(16)}`;
const rb = '%x3e'; // `%x${'>'.charCodeAt(0).toString(16)}`;
const sl = '%x2f'; // `%x${'/'.charCodeAt(0).toString(16)}`;
const sp = '%x20'; // `%x${' '.charCodeAt(0).toString(16)}`;

const emptyStr = '';
const emptyEntry: StashEntry = {};

interface StashEntry {
	ref?: string;
	date?: string;
	committedDate?: string;
	fileNames?: string;
	files?: GitFile[];
	summary?: string;
	stashName?: string;
}

export class GitStashParser {
	static defaultFormat = [
		`${lb}${sl}f${rb}`,
		`${lb}r${rb}${sp}%H`, // ref
		`${lb}d${rb}${sp}%at`, // date
		`${lb}c${rb}${sp}%ct`, // committed date
		`${lb}l${rb}${sp}%gd`, // reflog-selector
		`${lb}s${rb}`,
		'%B', // summary
		`${lb}${sl}s${rb}`,
		`${lb}f${rb}`
	].join('%n');

	@debug({ args: false, singleLine: true })
	static parse(data: string, repoPath: string): GitStash | undefined {
		if (!data) return undefined;

		const lines = Strings.lines(`${data}</f>`);
		// Skip the first line since it will always be </f>
		let next = lines.next();
		if (next.done) return undefined;

		if (repoPath !== undefined) {
			repoPath = Strings.normalizePath(repoPath);
		}

		const commits: Map<string, GitStashCommit> = new Map();

		let entry: StashEntry = emptyEntry;
		let line: string | undefined = undefined;
		let token: number;

		let match;
		let renamedFileName;

		while (true) {
			next = lines.next();
			if (next.done) break;

			line = next.value;

			// <<1-char token>> <data>
			// e.g. <r> bd1452a2dc
			token = line.charCodeAt(1);

			switch (token) {
				case 114: // 'r': // ref
					entry = {
						ref: line.substring(4)
					};
					break;

				case 100: // 'd': // author-date
					entry.date = line.substring(4);
					break;

				case 99: // 'c': // committer-date
					entry.committedDate = line.substring(4);
					break;

				case 108: // 'l': // reflog-selector
					entry.stashName = line.substring(4);
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

				case 102: // 'f': // files
					// Skip the blank line git adds before the files
					next = lines.next();
					if (!next.done && next.value !== '</f>') {
						while (true) {
							next = lines.next();
							if (next.done) break;

							line = next.value;
							if (line === '</f>') break;

							if (line.startsWith('warning:')) continue;

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
										originalFileName: match[2]
									});
								} else {
									entry.files.push({
										status: match[1] as GitFileStatus,
										fileName: match[2]
									});
								}
							}
						}

						if (entry.files !== undefined) {
							entry.fileNames = Arrays.filterMap(entry.files, f =>
								f.fileName ? f.fileName : undefined
							).join(', ');
						}
					}

					GitStashParser.parseEntry(entry, repoPath, commits);
			}
		}

		const stash: GitStash = {
			repoPath: repoPath,
			commits: commits
		};
		return stash;
	}

	private static parseEntry(entry: StashEntry, repoPath: string, commits: Map<string, GitStashCommit>) {
		let commit = commits.get(entry.ref!);
		if (commit === undefined) {
			commit = new GitStashCommit(
				GitCommitType.Stash,
				entry.stashName!,
				repoPath,
				entry.ref!,
				new Date((entry.date! as any) * 1000),
				new Date((entry.committedDate! as any) * 1000),
				entry.summary === undefined ? emptyStr : entry.summary,
				entry.fileNames!,
				entry.files || []
			);
		}

		commits.set(entry.ref!, commit);
	}
}
