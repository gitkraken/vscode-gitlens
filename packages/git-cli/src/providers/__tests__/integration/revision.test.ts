import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import type { TestRepo } from './helpers.js';
import { addCommit, createTestRepo, getHeadSha } from './helpers.js';

suite('RevisionSubProvider.resolveShas', () => {
	let repo: TestRepo;
	let headSha: string;
	let parentSha: string;

	suiteSetup(() => {
		repo = createTestRepo();
		addCommit(repo.path, 'file1.txt', 'content', 'Second commit');
		headSha = getHeadSha(repo.path);
		parentSha = execFileSync('git', ['rev-parse', 'HEAD~1'], { cwd: repo.path, encoding: 'utf-8' }).trim();
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('resolves a full commit sha to itself', async () => {
		const resolved = await repo.provider.revision.resolveShas(repo.path, new Set([headSha]));
		assert.deepStrictEqual([...resolved], [headSha]);
	});

	test('resolves a short (unambiguous) prefix to the full commit sha', async () => {
		const resolved = await repo.provider.revision.resolveShas(repo.path, new Set([headSha.slice(0, 8)]));
		assert.deepStrictEqual([...resolved], [headSha]);
	});

	test('resolves multiple full shas to all of them', async () => {
		const resolved = await repo.provider.revision.resolveShas(repo.path, new Set([headSha, parentSha]));
		assert.strictEqual(resolved.size, 2);
		assert.ok(resolved.has(headSha), 'should include HEAD');
		assert.ok(resolved.has(parentSha), 'should include HEAD~1');
	});

	test('filters out non-commit objects (blob)', async () => {
		// A blob oid is hex 4-40, so it's routed through disambiguation then dropped as a non-commit.
		// This is the crux of the ambiguity fix: a prefix matching a commit + blob keeps only the commit.
		const blobOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
			cwd: repo.path,
			input: 'a loose blob\n',
			encoding: 'utf-8',
		}).trim();
		const resolved = await repo.provider.revision.resolveShas(repo.path, new Set([blobOid]));
		assert.strictEqual(resolved.size, 0);
	});

	test('passes through non-hex values (ref name, suffixed sha) unchanged', async () => {
		const resolved = await repo.provider.revision.resolveShas(repo.path, new Set(['main', 'HEAD^']));
		assert.deepStrictEqual([...resolved].sort(), ['HEAD^', 'main']);
	});

	test('returns empty for a hex prefix that matches no object', async () => {
		const resolved = await repo.provider.revision.resolveShas(repo.path, new Set(['abcdef0123']));
		assert.strictEqual(resolved.size, 0);
	});

	test('returns empty for an empty input set', async () => {
		const resolved = await repo.provider.revision.resolveShas(repo.path, new Set());
		assert.strictEqual(resolved.size, 0);
	});
});
