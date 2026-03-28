import type { GitBlame, GitBlameAuthor } from '@gitlens/git/models/blame.js';
import type { GitCommitLine } from '@gitlens/git/models/commit.js';
import { GitCommit, GitCommitIdentity } from '@gitlens/git/models/commit.js';
import { GitFileChange } from '@gitlens/git/models/fileChange.js';
import { GitFileIndexStatus } from '@gitlens/git/models/fileStatus.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitUser } from '@gitlens/git/models/user.js';
import { isUserMatch } from '@gitlens/git/utils/user.utils.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import { iterateByDelimiter } from '@gitlens/utils/string.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { fileUri, joinUriPath } from '@gitlens/utils/uri.js';

export interface BlameEntry {
	sha: string;
	line: number;
	originalLine: number;
	lineCount: number;

	author?: string;
	authorTime?: number;
	authorTimeZone?: string;
	authorEmail?: string;

	committer?: string;
	committerTime?: number;
	committerTimeZone?: string;
	committerEmail?: string;

	previousSha?: string;
	previousPath?: string;

	path?: string;
	summary?: string;

	authorCurrent?: boolean;
	committerCurrent?: boolean;
}

export function parseGitBlame(
	repoPath: string,
	data: string | undefined,
	currentUser: GitUser | undefined,
	modifiedTime?: number,
): GitBlame | undefined {
	using sw = maybeStopWatch(`Git.parseBlame(${repoPath})`, { log: { onlyExit: true, level: 'debug' } });
	if (!data) {
		sw?.stop({ suffix: ` no data` });
		return undefined;
	}

	// Pre-compute constants once
	const normalizedRepoPath = normalizePath(repoPath);
	const repoUri = fileUri(normalizedRepoPath);

	// Path normalization + URI cache (single-file blame = 1 cache entry)
	let cachedPath: string | undefined;
	let cachedPathUri: Uri | undefined;
	let cachedPreviousPath: string | undefined;
	let cachedPreviousPathUri: Uri | undefined;

	const authors = new Map<string, GitBlameAuthor>();
	const commits = new Map<string, GitCommit>();
	const lines: GitCommitLine[] = [];

	let entry: BlameEntry | undefined;

	for (const line of iterateByDelimiter(data, '\n')) {
		const spaceIdx = line.indexOf(' ');
		if (spaceIdx === -1) continue;

		if (entry == null) {
			// Header line: <sha> <originalLine> <currentLine> <lineCount>
			const sha = line.substring(0, spaceIdx);

			let s = spaceIdx + 1;
			let e = line.indexOf(' ', s);
			const originalLine = parseInt(line.substring(s, e), 10);

			s = e + 1;
			e = line.indexOf(' ', s);
			const lineno = parseInt(line.substring(s, e), 10);

			s = e + 1;
			const lineCount = parseInt(line.substring(s), 10);

			entry = { sha: sha, originalLine: originalLine, line: lineno, lineCount: lineCount };
			continue;
		}

		// Dispatch on first character + key length to avoid creating key substrings
		const keyLen = spaceIdx;
		const valueStart = spaceIdx + 1;

		switch (line.charCodeAt(0)) {
			case 0x61 /* a — author* */:
				if (keyLen === 6 /* "author" */) {
					entry.author = line.substring(valueStart);
				} else if (keyLen === 11 /* "author-mail" | "author-time" */) {
					// Disambiguate at pos 7: 'm' (mail) vs 't' (time)
					if (line.charCodeAt(7) === 0x6d /* m */) {
						entry.authorEmail = parseEmail(line.substring(valueStart));
					} else {
						entry.authorTime = parseInt(line.substring(valueStart), 10) * 1000;
					}
				} else if (keyLen === 9 /* "author-tz" */) {
					entry.authorTimeZone = line.substring(valueStart);
				}
				break;

			case 0x63 /* c — committer* */:
				if (keyLen === 9 /* "committer" */) {
					entry.committer = line.substring(valueStart);
				} else if (keyLen === 14 /* "committer-mail" | "committer-time" */) {
					// Disambiguate at pos 10: 'm' (mail) vs 't' (time)
					if (line.charCodeAt(10) === 0x6d /* m */) {
						entry.committerEmail = parseEmail(line.substring(valueStart));
					} else {
						entry.committerTime = parseInt(line.substring(valueStart), 10) * 1000;
					}
				} else if (keyLen === 12 /* "committer-tz" */) {
					entry.committerTimeZone = line.substring(valueStart);
				}
				break;

			case 0x66 /* f — filename */: {
				// Don't trim — spaces in filenames are valid
				entry.path = line.substring(valueStart);

				// Assemble model immediately — no intermediate storage
				const entryPath = entry.path;
				const isUncommittedEntry = entry.sha === uncommitted;

				let commit = commits.get(entry.sha);
				if (commit == null) {
					if (isUncommittedEntry) {
						entry.author = currentUser?.name ?? '';
						entry.authorCurrent = true;
						entry.authorEmail = currentUser?.email;
						entry.authorTime = modifiedTime ?? entry.authorTime ?? 0;
						entry.committer = entry.author;
						entry.committerEmail = entry.authorEmail;
						entry.committerTime = entry.authorTime;
						entry.committerCurrent = true;
					} else {
						if (isUserMatch(currentUser, entry.author, entry.authorEmail)) {
							entry.authorCurrent = true;
						}
						if (isUserMatch(currentUser, entry.committer, entry.committerEmail)) {
							entry.committerCurrent = true;
						}
					}

					let author = authors.get(entry.author!);
					if (author == null) {
						author = { name: entry.author!, lineCount: 0, current: entry.authorCurrent };
						authors.set(entry.author!, author);
					}

					// Cache path normalization + URI
					if (entryPath !== cachedPath) {
						cachedPath = entryPath;
						cachedPathUri = joinUriPath(repoUri, normalizePath(entryPath));
					}

					let previousPath: string | undefined;
					let previousPathUri: Uri | undefined;
					if (entry.previousPath != null && entry.previousPath !== entryPath) {
						previousPath = entry.previousPath;
						if (previousPath !== cachedPreviousPath) {
							cachedPreviousPath = previousPath;
							cachedPreviousPathUri = joinUriPath(repoUri, normalizePath(previousPath));
						}
						previousPathUri = cachedPreviousPathUri;
					}

					const file = new GitFileChange(
						repoPath,
						entryPath,
						GitFileIndexStatus.Modified,
						cachedPathUri!,
						previousPath,
						previousPathUri,
						entry.previousSha,
					);

					commit = new GitCommit(
						repoPath,
						entry.sha,
						new GitCommitIdentity(
							entry.author!,
							entry.authorEmail,
							new Date(entry.authorTime!),
							undefined,
							entry.authorCurrent,
						),
						new GitCommitIdentity(
							entry.committer!,
							entry.committerEmail,
							new Date(entry.committerTime!),
							undefined,
							entry.committerCurrent,
						),
						entry.summary ?? '',
						[],
						undefined,
						{
							files: undefined,
							filtered: {
								files: [file],
								pathspec: entryPath,
							},
						},
						undefined,
						[],
					);

					commits.set(entry.sha, commit);
				}

				// Accumulate author line counts incrementally
				const authorName = commit.author.name;
				if (authorName) {
					const author = authors.get(authorName);
					if (author != null) {
						author.lineCount += entry.lineCount;
					}
				}

				// Build line mappings
				const previousSha = entry.previousSha ?? commit.file?.previousSha;
				for (let i = 0, count = entry.lineCount; i < count; i++) {
					const l: GitCommitLine = {
						sha: entry.sha,
						previousSha: previousSha,
						originalLine: entry.originalLine + i,
						line: entry.line + i,
					};

					commit.lines.push(l);
					lines[l.line - 1] = l;
				}

				entry = undefined;
				break;
			}

			case 0x73 /* s — summary */:
				entry.summary = line.substring(valueStart);
				break;

			case 0x70 /* p — previous */: {
				const value = line.substring(valueStart);
				const shaEnd = value.indexOf(' ');
				if (shaEnd !== -1) {
					entry.previousSha = value.substring(0, shaEnd);
					entry.previousPath = value.substring(shaEnd + 1);
				}
				break;
			}
		}
	}

	const sortedAuthors = new Map([...authors.entries()].sort((a, b) => b[1].lineCount - a[1].lineCount));

	sw?.stop({ suffix: ` parsed ${lines.length} lines, ${commits.size} commits` });

	return {
		repoPath: repoPath,
		authors: sortedAuthors,
		commits: commits,
		lines: lines,
	};
}

/** Extracts email from a value like `<user@example.com>` */
function parseEmail(raw: string): string {
	const lt = raw.indexOf('<');
	if (lt >= 0) {
		const gt = raw.indexOf('>', lt + 1);
		return gt > lt ? raw.substring(lt + 1, gt) : raw.substring(lt + 1);
	}
	return raw;
}
