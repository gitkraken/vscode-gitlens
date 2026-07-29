import * as assert from 'assert';
import type { Container } from '../../../../container.js';
import type { ComposerHunk } from '../compose/protocol.js';
import type { GraphComposeVirtualCommitInput } from '../graphComposeVirtualContentProvider.js';
import { GraphComposeVirtualContentProvider } from '../graphComposeVirtualContentProvider.js';

const utf8 = new TextEncoder();
const decoder = new TextDecoder();

const repoPath = '/mock/repo';
const baseSha = '0000000000000000000000000000000000000000';
const fileName = 'src/sample.ts';
const oldFileName = 'src/old.ts';

function createContainer(baseContentByPath: Map<string, string>): Container {
	return {
		git: {
			getRepositoryService: () => ({
				revision: {
					getRevisionContent: (path: string) => {
						const content = baseContentByPath.get(path);
						return Promise.resolve(content == null ? undefined : utf8.encode(content));
					},
				},
			}),
		},
	} as unknown as Container;
}

function hunk(index: number, hunkHeader: string, lines: string[], overrides?: Partial<ComposerHunk>): ComposerHunk {
	return {
		index: index,
		fileName: fileName,
		additions: lines.filter(l => l.startsWith('+')).length,
		deletions: lines.filter(l => l.startsWith('-')).length,
		source: 'unknown',
		diffHeader: `diff --git a/${fileName} b/${fileName}`,
		hunkHeader: hunkHeader,
		content: lines.join('\n'),
		...overrides,
	};
}

function commit(id: string, hunks: ComposerHunk[]): GraphComposeVirtualCommitInput {
	return { id: id, message: `message for ${id}`, hunks: hunks };
}

/**
 * A 12-line base plus a two-hunk combined diff whose first hunk removes two lines. The second
 * hunk's old-side start therefore sits two lines beyond where it lands in the first hunk's result,
 * which is what makes cross-commit synthesis order-sensitive.
 */
const baseLines = ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10', 'L11', 'L12'];
const baseContent = [...baseLines, ''].join('\n');

const earlyHunkLines = [' L02', '-L03', '-L04'];
const lateHunkLines = ['-L09', '+L09-MOD'];

const earlyHunk = hunk(1, '@@ -2,3 +2,1 @@', earlyHunkLines);
const lateHunk = hunk(2, '@@ -9,1 +7,1 @@', lateHunkLines);

/**
 * Rename-with-edits overrides: git's combined diff reports the file under its final name with the
 * pre-rename name in the header, on every hunk of the file, however those hunks are later split
 * across proposed commits.
 */
const renamed: Partial<ComposerHunk> = {
	diffHeader: `diff --git a/${oldFileName} b/${fileName}`,
	originalFileName: oldFileName,
};

const afterEarlyOnly = ['L01', 'L02', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10', 'L11', 'L12', ''].join('\n');
const afterBoth = ['L01', 'L02', 'L05', 'L06', 'L07', 'L08', 'L09-MOD', 'L10', 'L11', 'L12', ''].join('\n');

function createProvider(baseContentByPath?: Map<string, string>): GraphComposeVirtualContentProvider {
	return new GraphComposeVirtualContentProvider(
		createContainer(baseContentByPath ?? new Map([[fileName, baseContent]])),
	);
}

async function readAll(
	provider: GraphComposeVirtualContentProvider,
	commits: GraphComposeVirtualCommitInput[],
	path = fileName,
): Promise<string[]> {
	const sessionId = provider.startSession({ repoPath: repoPath, baseSha: baseSha, commits: commits });
	const contents: string[] = [];
	for (const c of commits) {
		contents.push(decoder.decode(await provider.readFile(sessionId, c.id, path)));
	}
	return contents;
}

suite('GraphComposeVirtualContentProvider Test Suite', () => {
	test('synthesizes each commit against the base rather than its predecessor', async () => {
		const provider = createProvider();
		const [first, second] = await readAll(provider, [commit('c1', [earlyHunk]), commit('c2', [lateHunk])]);

		assert.strictEqual(first, afterEarlyOnly);
		assert.strictEqual(second, afterBoth);
	});

	test('synthesizes correctly when the later hunk lands in the earlier commit', async () => {
		const provider = createProvider();
		const [first, second] = await readAll(provider, [commit('c1', [lateHunk]), commit('c2', [earlyHunk])]);

		assert.strictEqual(first, ['L01', ...baseLines.slice(1, 8), 'L09-MOD', 'L10', 'L11', 'L12', ''].join('\n'));
		assert.strictEqual(second, afterBoth);
	});

	test('sorts hunks into base order regardless of their order within a commit', async () => {
		const provider = createProvider();
		const [only] = await readAll(provider, [commit('c1', [lateHunk, earlyHunk])]);

		assert.strictEqual(only, afterBoth);
	});

	test('spreads a file’s hunks across three commits', async () => {
		const provider = createProvider();
		const tailHunk = hunk(3, '@@ -12,1 +10,1 @@', ['-L12', '+L12-MOD']);
		const [first, second, third] = await readAll(provider, [
			commit('c1', [earlyHunk]),
			commit('c2', [tailHunk]),
			commit('c3', [lateHunk]),
		]);

		assert.strictEqual(first, afterEarlyOnly);
		assert.strictEqual(
			second,
			['L01', 'L02', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10', 'L11', 'L12-MOD', ''].join('\n'),
		);
		assert.strictEqual(
			third,
			['L01', 'L02', 'L05', 'L06', 'L07', 'L08', 'L09-MOD', 'L10', 'L11', 'L12-MOD', ''].join('\n'),
		);
	});

	test('ignores hunks belonging to other files', async () => {
		const provider = createProvider();
		const otherFileHunk = hunk(2, '@@ -1,1 +1,1 @@', ['-x', '+X'], { fileName: 'src/other.ts' });
		const [only] = await readAll(provider, [commit('c1', [earlyHunk, otherFileHunk])]);

		assert.strictEqual(only, afterEarlyOnly);
	});

	test('treats a file absent from the base as a new file', async () => {
		const provider = createProvider(new Map());
		const addHunk = hunk(1, '@@ -0,0 +1,2 @@', ['+new1', '+new2']);
		const [only] = await readAll(provider, [commit('c1', [addHunk])]);

		assert.strictEqual(only, 'new1\nnew2\n');
	});

	test('returns the base unchanged for a commit that only renames the file', async () => {
		const provider = createProvider(new Map([['src/old.ts', baseContent]]));
		const renameHunk = hunk(1, 'rename', ['Rename from src/old.ts'], {
			isRename: true,
			originalFileName: 'src/old.ts',
		});
		const [only] = await readAll(provider, [commit('c1', [renameHunk])]);

		assert.strictEqual(only, baseContent);
	});

	test('keeps an earlier commit’s hunks when the file is renamed with edits across commits', async () => {
		const provider = createProvider(new Map([[oldFileName, baseContent]]));
		const [first, second] = await readAll(provider, [
			commit('c1', [hunk(1, earlyHunk.hunkHeader, earlyHunkLines, renamed)]),
			commit('c2', [hunk(2, lateHunk.hunkHeader, lateHunkLines, renamed)]),
		]);

		assert.strictEqual(first, afterEarlyOnly);
		assert.strictEqual(second, afterBoth);
	});

	test('spreads a renamed file’s hunks across three commits', async () => {
		const provider = createProvider(new Map([[oldFileName, baseContent]]));
		const tailHunkLines = ['-L12', '+L12-MOD'];
		const [first, second, third] = await readAll(provider, [
			commit('c1', [hunk(1, earlyHunk.hunkHeader, earlyHunkLines, renamed)]),
			commit('c2', [hunk(3, '@@ -12,1 +10,1 @@', tailHunkLines, renamed)]),
			commit('c3', [hunk(2, lateHunk.hunkHeader, lateHunkLines, renamed)]),
		]);

		assert.strictEqual(first, afterEarlyOnly);
		assert.strictEqual(
			second,
			['L01', 'L02', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10', 'L11', 'L12-MOD', ''].join('\n'),
		);
		assert.strictEqual(
			third,
			['L01', 'L02', 'L05', 'L06', 'L07', 'L08', 'L09-MOD', 'L10', 'L11', 'L12-MOD', ''].join('\n'),
		);
	});

	/**
	 * The two sides the diff editor requests for a rename row: `buildDiffArgs` takes the left from
	 * `originalPath` against the row's parent, and a rename row only renders for the earliest commit
	 * holding the file — so the pre-rename name is only ever read at a commit with none of its hunks.
	 */
	test('reads the pre-rename name as untouched base at the commit before the rename', async () => {
		const provider = createProvider(
			new Map([
				[oldFileName, baseContent],
				['src/other.ts', 'x\n'],
			]),
		);
		const commits = [
			commit('c1', [hunk(1, '@@ -1,1 +1,1 @@', ['-x', '+X'], { fileName: 'src/other.ts' })]),
			commit('c2', [hunk(2, earlyHunk.hunkHeader, earlyHunkLines, renamed)]),
		];
		const sessionId = provider.startSession({ repoPath: repoPath, baseSha: baseSha, commits: commits });

		assert.strictEqual(decoder.decode(await provider.readFile(sessionId, 'c1', oldFileName)), baseContent);
		assert.strictEqual(decoder.decode(await provider.readFile(sessionId, 'c2', fileName)), afterEarlyOnly);
	});

	test('reports the base as the first commit’s parent and the predecessor thereafter', async () => {
		const provider = createProvider();
		const commits = [commit('c1', [earlyHunk]), commit('c2', [lateHunk])];
		const sessionId = provider.startSession({ repoPath: repoPath, baseSha: baseSha, commits: commits });

		assert.deepStrictEqual(await provider.getParent(sessionId, 'c1'), {
			kind: 'ref',
			repoPath: repoPath,
			sha: baseSha,
		});
		assert.deepStrictEqual(await provider.getParent(sessionId, 'c2'), { kind: 'virtual', commitId: 'c1' });
	});

	test('throws once a session has ended', async () => {
		const provider = createProvider();
		const commits = [commit('c1', [earlyHunk])];
		const sessionId = provider.startSession({ repoPath: repoPath, baseSha: baseSha, commits: commits });
		provider.endSession(sessionId);

		await assert.rejects(() => provider.readFile(sessionId, 'c1', fileName), /virtual session not found/);
	});
});
