import type { GitBlame, GitBlameAuthor } from '../models/blame.js';
import type { GitCommit } from '../models/commit.js';
import type { DiffRange } from '../providers/types.js';

/**
 * Filters a {@link GitBlame} object to only include lines within the given range.
 * This is a pure data transform — no I/O or provider access needed.
 *
 * @param blame - The full blame to filter
 * @param range - 1-based line range (inclusive)
 */
export function getBlameRange(blame: GitBlame, range: DiffRange): GitBlame | undefined {
	if (blame.lines.length === 0) return blame;

	// DiffRange is 1-based; lines array is 0-indexed
	const startIdx = range.startLine - 1;
	const endIdx = range.endLine; // endLine is inclusive, slice is exclusive

	if (startIdx === 0 && endIdx >= blame.lines.length) return blame;

	const lines = blame.lines.slice(startIdx, endIdx);
	const shas = new Set(lines.map(l => l.sha));

	const authors = new Map<string, GitBlameAuthor>();
	const commits = new Map<string, GitCommit>();
	for (const c of blame.commits.values()) {
		if (!shas.has(c.sha)) continue;

		const commit = c.with({
			lines: c.lines.filter(l => l.line >= range.startLine && l.line <= range.endLine),
		});
		commits.set(c.sha, commit);

		let author = authors.get(commit.author.name);
		if (author == null) {
			author = {
				name: commit.author.name,
				lineCount: 0,
				current: commit.author.current,
			};
			authors.set(author.name, author);
		}

		author.lineCount += commit.lines.length;
	}

	const sortedAuthors = new Map([...authors.entries()].sort((a, b) => b[1].lineCount - a[1].lineCount));

	return {
		repoPath: blame.repoPath,
		authors: sortedAuthors,
		commits: commits,
		lines: lines,
	};
}
