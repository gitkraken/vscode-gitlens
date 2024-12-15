import type { Container } from '../../container';
import { maybeStopWatch } from '../../system/stopwatch';
import { getLines } from '../../system/string';
import type { GitBlame, GitBlameAuthor } from '../models/blame';
import type { GitCommitLine } from '../models/commit';
import { GitCommit, GitCommitIdentity } from '../models/commit';
import { GitFileChange, GitFileIndexStatus } from '../models/file';
import { uncommitted } from '../models/revision';
import { isUncommitted } from '../models/revision.utils';
import type { GitUser } from '../models/user';

interface BlameEntry {
	sha: string;

	line: number;
	originalLine: number;
	lineCount: number;

	author: string;
	authorTime: number;
	authorTimeZone?: string;
	authorEmail?: string;

	committer: string;
	committerTime: number;
	committerTimeZone?: string;
	committerEmail?: string;

	previousSha?: string;
	previousPath?: string;

	path: string;

	summary?: string;
}

export function parseGitBlame(
	container: Container,
	repoPath: string,
	data: string | undefined,
	currentUser: GitUser | undefined,
	modifiedTime?: number,
): GitBlame | undefined {
	using sw = maybeStopWatch(`Git.parseBlame(${repoPath})`, { log: false, logLevel: 'debug' });
	if (!data) return undefined;

	const authors = new Map<string, GitBlameAuthor>();
	const commits = new Map<string, GitCommit>();
	const lines: GitCommitLine[] = [];

	let entry: BlameEntry | undefined = undefined;
	let key: string;
	let line: string;
	let lineParts: string[];

	for (line of getLines(data)) {
		lineParts = line.split(' ');
		if (lineParts.length < 2) continue;

		[key] = lineParts;
		if (entry == null) {
			entry = {
				sha: key,
				originalLine: parseInt(lineParts[1], 10),
				line: parseInt(lineParts[2], 10),
				lineCount: parseInt(lineParts[3], 10),
			} as unknown as BlameEntry;

			continue;
		}

		switch (key) {
			case 'author':
				if (entry.sha === uncommitted) {
					entry.author = 'You';
				} else {
					entry.author = line.slice(key.length + 1).trim();
				}
				break;

			case 'author-mail': {
				if (entry.sha === uncommitted) {
					entry.authorEmail = currentUser?.email;
					continue;
				}

				entry.authorEmail = line.slice(key.length + 1).trim();
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
				if (entry.sha === uncommitted && modifiedTime != null) {
					entry.authorTime = modifiedTime;
				} else {
					entry.authorTime = parseInt(lineParts[1], 10) * 1000;
				}
				break;

			case 'author-tz':
				entry.authorTimeZone = lineParts[1];
				break;

			case 'committer':
				if (isUncommitted(entry.sha)) {
					entry.committer = 'You';
				} else {
					entry.committer = line.slice(key.length + 1).trim();
				}
				break;

			case 'committer-mail': {
				if (isUncommitted(entry.sha)) {
					entry.committerEmail = currentUser?.email;
					continue;
				}

				entry.committerEmail = line.slice(key.length + 1).trim();
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
				if (entry.sha === uncommitted && modifiedTime != null) {
					entry.committerTime = modifiedTime;
				} else {
					entry.committerTime = parseInt(lineParts[1], 10) * 1000;
				}
				break;

			case 'committer-tz':
				entry.committerTimeZone = lineParts[1];
				break;

			case 'summary':
				entry.summary = line.slice(key.length + 1).trim();
				break;

			case 'previous':
				entry.previousSha = lineParts[1];
				entry.previousPath = lineParts.slice(2).join(' ');
				break;

			case 'filename':
				// Don't trim to allow spaces in the filename
				entry.path = line.slice(key.length + 1);

				// Since the filename marks the end of a commit, parse the entry and clear it for the next
				parseBlameEntry(container, entry, repoPath, commits, authors, lines, currentUser);

				entry = undefined;
				break;

			default:
				break;
		}
	}

	for (const [, c] of commits) {
		if (!c.author.name) continue;

		const author = authors.get(c.author.name);
		if (author == null) return undefined;

		author.lineCount += c.lines.length;
	}

	const sortedAuthors = new Map([...authors.entries()].sort((a, b) => b[1].lineCount - a[1].lineCount));

	sw?.stop({ suffix: ` parsed ${lines.length} lines, ${commits.size} commits` });

	const blame: GitBlame = {
		repoPath: repoPath,
		authors: sortedAuthors,
		commits: commits,
		lines: lines,
	};
	return blame;
}

function parseBlameEntry(
	container: Container,
	entry: BlameEntry,
	repoPath: string,
	commits: Map<string, GitCommit>,
	authors: Map<string, GitBlameAuthor>,
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

		commit = new GitCommit(
			container,
			repoPath,
			entry.sha,
			new GitCommitIdentity(entry.author, entry.authorEmail, new Date(entry.authorTime)),
			new GitCommitIdentity(entry.committer, entry.committerEmail, new Date(entry.committerTime)),
			entry.summary!,
			[],
			undefined,
			new GitFileChange(
				repoPath,
				entry.path,
				GitFileIndexStatus.Modified,
				entry.previousPath && entry.previousPath !== entry.path ? entry.previousPath : undefined,
				entry.previousSha,
			),
			undefined,
			[],
		);

		commits.set(entry.sha, commit);
	}

	for (let i = 0, len = entry.lineCount; i < len; i++) {
		const line: GitCommitLine = {
			sha: entry.sha,
			previousSha: commit.file!.previousSha,
			originalLine: entry.originalLine + i,
			line: entry.line + i,
		};

		commit.lines.push(line);
		lines[line.line - 1] = line;
	}
}
