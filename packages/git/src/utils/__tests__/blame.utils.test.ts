import * as assert from 'assert';
import type { GitBlame } from '../../models/blame.js';
import { GitCommit, GitCommitIdentity } from '../../models/commit.js';
import type { DiffRange } from '../../providers/types.js';
import { getBlameRange } from '../blame.utils.js';

function createIdentity(name: string): GitCommitIdentity {
	return new GitCommitIdentity(name, `${name}@test.com`, new Date('2024-01-15'));
}

function createCommit(
	sha: string,
	authorName: string,
	lines: { sha: string; originalLine: number; line: number }[],
): GitCommit {
	return new GitCommit(
		'/repo',
		sha,
		createIdentity(authorName),
		createIdentity(authorName),
		`Commit ${sha}`,
		[],
		undefined,
		undefined,
		undefined,
		lines,
	);
}

function createBlame(commits: GitCommit[], lines: { sha: string; originalLine: number; line: number }[]): GitBlame {
	const commitMap = new Map(commits.map(c => [c.sha, c]));
	const authors = new Map<string, { name: string; lineCount: number }>();
	for (const c of commits) {
		const existing = authors.get(c.author.name);
		if (existing != null) {
			existing.lineCount += c.lines.length;
		} else {
			authors.set(c.author.name, { name: c.author.name, lineCount: c.lines.length });
		}
	}
	return {
		repoPath: '/repo',
		authors: authors,
		commits: commitMap,
		lines: lines,
	};
}

/**
 * Builds a standard 5-line blame fixture:
 *   Lines 1-2: commit aaa (Alice)
 *   Lines 3-4: commit bbb (Bob)
 *   Line 5:    commit ccc (Alice)
 */
function createStandardBlame(): GitBlame {
	const lines = [
		{ sha: 'aaa', originalLine: 1, line: 1 },
		{ sha: 'aaa', originalLine: 2, line: 2 },
		{ sha: 'bbb', originalLine: 3, line: 3 },
		{ sha: 'bbb', originalLine: 4, line: 4 },
		{ sha: 'ccc', originalLine: 5, line: 5 },
	];

	const commitA = createCommit('aaa', 'Alice', [lines[0], lines[1]]);
	const commitB = createCommit('bbb', 'Bob', [lines[2], lines[3]]);
	const commitC = createCommit('ccc', 'Alice', [lines[4]]);

	return createBlame([commitA, commitB, commitC], lines);
}

function makeRange(startLine: number, endLine: number): DiffRange {
	return { startLine: startLine, startCharacter: 0, endLine: endLine, endCharacter: 0 };
}

suite('Blame Utils Test Suite', () => {
	suite('getBlameRange', () => {
		test('returns same blame when range covers all lines', () => {
			const blame = createStandardBlame();
			const result = getBlameRange(blame, makeRange(1, 5));
			// startIdx=0 and endIdx=5 >= blame.lines.length(5), so returns blame directly
			assert.strictEqual(result, blame);
		});

		test('returns same blame when range exceeds total lines', () => {
			const blame = createStandardBlame();
			const result = getBlameRange(blame, makeRange(1, 100));
			assert.strictEqual(result, blame);
		});

		test('returns same blame for empty lines array', () => {
			const blame: GitBlame = {
				repoPath: '/repo',
				authors: new Map(),
				commits: new Map(),
				lines: [],
			};
			const result = getBlameRange(blame, makeRange(1, 5));
			assert.strictEqual(result, blame);
		});

		test('filters to a single line', () => {
			const blame = createStandardBlame();
			const result = getBlameRange(blame, makeRange(3, 3));

			assert.ok(result != null);
			assert.strictEqual(result.lines.length, 1);
			assert.strictEqual(result.lines[0].sha, 'bbb');
			assert.strictEqual(result.lines[0].line, 3);

			assert.strictEqual(result.commits.size, 1);
			assert.ok(result.commits.has('bbb'));

			assert.strictEqual(result.authors.size, 1);
			assert.strictEqual(result.authors.get('Bob')?.lineCount, 1);
		});

		test('slices lines correctly with 1-based range to 0-based index', () => {
			const blame = createStandardBlame();
			// Lines 2-4 (1-based) => indices 1-3 (0-based slice(1, 4))
			const result = getBlameRange(blame, makeRange(2, 4));

			assert.ok(result != null);
			assert.strictEqual(result.lines.length, 3);
			assert.strictEqual(result.lines[0].line, 2);
			assert.strictEqual(result.lines[1].line, 3);
			assert.strictEqual(result.lines[2].line, 4);
		});

		test('recalculates author line counts for the subset', () => {
			const blame = createStandardBlame();
			// Lines 1-3: aaa(lines 1,2), bbb(line 3)
			const result = getBlameRange(blame, makeRange(1, 3));

			assert.ok(result != null);
			assert.strictEqual(result.authors.size, 2);
			// Alice has lines 1,2 from commit aaa in the range
			assert.strictEqual(result.authors.get('Alice')?.lineCount, 2);
			// Bob has line 3 from commit bbb in the range
			assert.strictEqual(result.authors.get('Bob')?.lineCount, 1);
		});

		test('sorts authors by line count descending', () => {
			const blame = createStandardBlame();
			// Lines 2-5: aaa(line 2), bbb(lines 3,4), ccc(line 5)
			// Bob=2 lines, Alice=1+1=2 lines from commits aaa and ccc
			const result = getBlameRange(blame, makeRange(2, 5));

			assert.ok(result != null);
			const authorEntries = [...result.authors.entries()];
			// Both have 2 lines but Bob's commit lines (3,4) are checked first in iteration
			// Actually the sort is by lineCount descending; ties maintain insertion order
			for (let i = 0; i < authorEntries.length - 1; i++) {
				assert.ok(
					authorEntries[i][1].lineCount >= authorEntries[i + 1][1].lineCount,
					`Authors should be sorted by lineCount desc: ${authorEntries[i][1].lineCount} < ${authorEntries[i + 1][1].lineCount}`,
				);
			}
		});

		test('only includes commits whose lines are in the range', () => {
			const blame = createStandardBlame();
			// Lines 1-2: only commit aaa
			const result = getBlameRange(blame, makeRange(1, 2));

			assert.ok(result != null);
			assert.strictEqual(result.commits.size, 1);
			assert.ok(result.commits.has('aaa'));
			assert.ok(!result.commits.has('bbb'));
			assert.ok(!result.commits.has('ccc'));
		});

		test('filters commit lines to only those within the range', () => {
			const blame = createStandardBlame();
			// Lines 3-4: commit bbb has lines 3 and 4
			const result = getBlameRange(blame, makeRange(3, 4));

			assert.ok(result != null);
			const commit = result.commits.get('bbb');
			assert.ok(commit != null);
			assert.strictEqual(commit.lines.length, 2);
			assert.strictEqual(commit.lines[0].line, 3);
			assert.strictEqual(commit.lines[1].line, 4);
		});

		test('preserves repoPath in filtered result', () => {
			const blame = createStandardBlame();
			const result = getBlameRange(blame, makeRange(1, 2));

			assert.ok(result != null);
			assert.strictEqual(result.repoPath, '/repo');
		});
	});
});
