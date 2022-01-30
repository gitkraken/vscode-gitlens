import { debug } from '../../system/decorators/log';
import { normalizePath, relative } from '../../system/path';
import { getLines } from '../../system/string';
import {
	GitAuthor,
	GitBlame,
	GitCommit2,
	GitCommitIdentity,
	GitCommitLine,
	GitFileChange,
	GitFileIndexStatus,
	GitRevision,
	GitUser,
} from '../models';

interface BlameEntry {
	sha: string;

	line: number;
	originalLine: number;
	lineCount: number;

	author: string;
	authorDate?: string;
	authorTimeZone?: string;
	authorEmail?: string;

	committer: string;
	committerDate?: string;
	committerTimeZone?: string;
	committerEmail?: string;

	previousSha?: string;
	previousFileName?: string;

	fileName?: string;

	summary?: string;
}

export class GitBlameParser {
	@debug({ args: false, singleLine: true })
	static parse(
		data: string,
		repoPath: string | undefined,
		fileName: string,
		currentUser: GitUser | undefined,
	): GitBlame | undefined {
		if (!data) return undefined;

		const authors = new Map<string, GitAuthor>();
		const commits = new Map<string, GitCommit2>();
		const lines: GitCommitLine[] = [];

		let relativeFileName;

		let entry: BlameEntry | undefined = undefined;
		let line: string;
		let lineParts: string[];

		let first = true;

		for (line of getLines(data)) {
			lineParts = line.split(' ');
			if (lineParts.length < 2) continue;

			if (entry === undefined) {
				entry = {
					author: undefined!,
					committer: undefined!,
					sha: lineParts[0],
					originalLine: parseInt(lineParts[1], 10),
					line: parseInt(lineParts[2], 10),
					lineCount: parseInt(lineParts[3], 10),
				};

				continue;
			}

			switch (lineParts[0]) {
				case 'author':
					if (GitRevision.isUncommitted(entry.sha)) {
						entry.author = 'You';
					} else {
						entry.author = lineParts.slice(1).join(' ').trim();
					}
					break;

				case 'author-mail': {
					if (GitRevision.isUncommitted(entry.sha)) {
						entry.authorEmail = currentUser !== undefined ? currentUser.email : undefined;
						continue;
					}

					entry.authorEmail = lineParts.slice(1).join(' ').trim();
					const start = entry.authorEmail.indexOf('<');
					if (start >= 0) {
						const end = entry.authorEmail.indexOf('>', start);
						if (end > start) {
							entry.authorEmail = entry.authorEmail.substring(start + 1, end);
						} else {
							entry.authorEmail = entry.authorEmail.substring(start + 1);
						}
					}

					break;
				}
				case 'author-time':
					entry.authorDate = lineParts[1];
					break;

				case 'author-tz':
					entry.authorTimeZone = lineParts[1];
					break;

				case 'committer':
					if (GitRevision.isUncommitted(entry.sha)) {
						entry.committer = 'You';
					} else {
						entry.committer = lineParts.slice(1).join(' ').trim();
					}
					break;

				case 'committer-mail': {
					if (GitRevision.isUncommitted(entry.sha)) {
						entry.committerEmail = currentUser !== undefined ? currentUser.email : undefined;
						continue;
					}

					entry.committerEmail = lineParts.slice(1).join(' ').trim();
					const start = entry.committerEmail.indexOf('<');
					if (start >= 0) {
						const end = entry.committerEmail.indexOf('>', start);
						if (end > start) {
							entry.committerEmail = entry.committerEmail.substring(start + 1, end);
						} else {
							entry.committerEmail = entry.committerEmail.substring(start + 1);
						}
					}

					break;
				}
				case 'committer-time':
					entry.committerDate = lineParts[1];
					break;

				case 'committer-tz':
					entry.committerTimeZone = lineParts[1];
					break;

				case 'summary':
					entry.summary = lineParts.slice(1).join(' ').trim();
					break;

				case 'previous':
					entry.previousSha = lineParts[1];
					entry.previousFileName = lineParts.slice(2).join(' ');
					break;

				case 'filename':
					entry.fileName = lineParts.slice(1).join(' ');

					if (first && repoPath === undefined) {
						// Try to get the repoPath from the most recent commit
						repoPath = normalizePath(
							fileName.replace(fileName.startsWith('/') ? `/${entry.fileName}` : entry.fileName, ''),
						);
						relativeFileName = normalizePath(relative(repoPath, fileName));
					} else {
						relativeFileName = entry.fileName;
					}
					first = false;

					GitBlameParser.parseEntry(entry, repoPath, relativeFileName, commits, authors, lines, currentUser);

					entry = undefined;
					break;

				default:
					break;
			}
		}

		for (const [, c] of commits) {
			if (!c.author.name) continue;

			const author = authors.get(c.author.name);
			if (author == undefined) return undefined;

			author.lineCount += c.lines.length;
		}

		const sortedAuthors = new Map([...authors.entries()].sort((a, b) => b[1].lineCount - a[1].lineCount));

		const blame: GitBlame = {
			repoPath: repoPath!,
			authors: sortedAuthors,
			commits: commits,
			lines: lines,
		};
		return blame;
	}

	private static parseEntry(
		entry: BlameEntry,
		repoPath: string | undefined,
		relativeFileName: string,
		commits: Map<string, GitCommit2>,
		authors: Map<string, GitAuthor>,
		lines: GitCommitLine[],
		currentUser: { name?: string; email?: string } | undefined,
	) {
		let commit = commits.get(entry.sha);
		if (commit == null) {
			if (entry.author != null) {
				if (
					currentUser != null &&
					// Name or e-mail is configured
					(currentUser.name != null || currentUser.email != null) &&
					// Match on name if configured
					(currentUser.name == null || currentUser.name === entry.author) &&
					// Match on email if configured
					(currentUser.email == null || currentUser.email === entry.authorEmail)
				) {
					entry.author = 'You';
				}

				let author = authors.get(entry.author);
				if (author == null) {
					author = {
						name: entry.author,
						lineCount: 0,
					};
					authors.set(entry.author, author);
				}
			}

			commit = new GitCommit2(
				repoPath!,
				entry.sha,
				new GitCommitIdentity(entry.author, entry.authorEmail, new Date((entry.authorDate as any) * 1000)),
				new GitCommitIdentity(
					entry.committer,
					entry.committerEmail,
					new Date((entry.committerDate as any) * 1000),
				),
				entry.summary!,
				[],
				undefined,
				new GitFileChange(
					repoPath!,
					relativeFileName,
					GitFileIndexStatus.Modified,
					entry.previousFileName && entry.previousFileName !== entry.fileName
						? entry.previousFileName
						: undefined,
					entry.previousSha,
				),
				[],
			);

			commits.set(entry.sha, commit);
		}

		for (let i = 0, len = entry.lineCount; i < len; i++) {
			const line: GitCommitLine = {
				sha: entry.sha,
				line: entry.line + i,
				originalLine: entry.originalLine + i,
				previousSha: commit.file?.previousSha,
			};

			commit.lines?.push(line);
			lines[line.line - 1] = line;
		}
	}
}
