import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { TestRepo } from './helpers.js';
import { createTestRepo, revParse } from './helpers.js';

// A backslash is an ordinary file-name character everywhere but Windows, where it can't be in one
const suiteOrSkip = process.platform === 'win32' ? suite.skip : suite;

const rootFile = 'back\\slash.txt';
const nestedFile = 'dir\\name/in\\side.txt';
// What the same names become once a backslash is read as a separator, so the old route finds a different file
const lookalike = 'back/slash.txt';

function git(repo: TestRepo, ...args: string[]): string {
	return execFileSync('git', args, { cwd: repo.path, encoding: 'utf8', stdio: 'pipe' });
}

function write(repo: TestRepo, name: string, content: string): void {
	const path = join(repo.path, name);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

suiteOrSkip('Reading a file whose name holds a backslash by its literal path', () => {
	let repo: TestRepo;
	let baseline: string;
	let committed: string;

	suiteSetup(() => {
		repo = createTestRepo();
		for (const name of [rootFile, nestedFile, 'plain.txt']) {
			write(repo, name, 'one\n');
		}
		write(repo, lookalike, 'x\n');
		git(repo, 'add', '-A');
		git(repo, 'commit', '-m', 'baseline');
		baseline = revParse(repo.path, 'HEAD');

		for (const name of [rootFile, nestedFile, 'plain.txt']) {
			write(repo, name, 'two\n');
		}
		write(repo, lookalike, 'y\n');
		git(repo, 'add', '-A');
		git(repo, 'commit', '-m', 'changes');
		committed = revParse(repo.path, 'HEAD');

		// Working tree: differs from the index and from HEAD
		write(repo, rootFile, 'three\n');
		write(repo, nestedFile, 'three\n');
		write(repo, lookalike, 'z\n');
		git(repo, 'add', '-A');
		write(repo, rootFile, 'four\n');
		write(repo, nestedFile, 'four\n');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	suite('getDiff', () => {
		test('returns the section of a committed change by `paths`', async () => {
			const diff = await repo.provider.diff.getDiff?.(repo.path, committed, baseline, {
				paths: [rootFile],
				errors: 'throw',
			});
			assert.ok(diff?.contents, 'the file’s section should be read');
			assert.ok(diff.contents.includes('back\\\\slash.txt'));
			assert.ok(!diff.contents.includes('plain.txt'));
			assert.ok(!diff.contents.includes('b/back/slash.txt'));
			assert.ok(diff.contents.includes('-one\n+two\n'));
		});

		test('returns the sections of a name inside a folder whose name holds a backslash', async () => {
			const diff = await repo.provider.diff.getDiff?.(repo.path, committed, baseline, {
				paths: [nestedFile, 'plain.txt'],
				errors: 'throw',
			});
			assert.ok(diff?.contents);
			assert.ok(diff.contents.includes('dir\\\\name/in\\\\side.txt'));
			assert.ok(diff.contents.includes('plain.txt'));
			assert.ok(!diff.contents.includes('slash.txt'));
		});

		test('returns the section of a working tree change', async () => {
			const diff = await repo.provider.diff.getDiff?.(repo.path, uncommitted, 'HEAD', {
				paths: [rootFile],
				errors: 'throw',
			});
			assert.ok(diff?.contents);
			assert.ok(diff.contents.includes('back\\\\slash.txt'));
			assert.ok(diff.contents.includes('+four\n'));
			assert.ok(!diff.contents.includes('b/back/slash.txt'));
		});

		test('returns the section of a staged change', async () => {
			const diff = await repo.provider.diff.getDiff?.(repo.path, uncommittedStaged, 'HEAD', {
				paths: [rootFile],
				errors: 'throw',
			});
			assert.ok(diff?.contents);
			assert.ok(diff.contents.includes('-two\n+three\n'));
			assert.ok(!diff.contents.includes('plain.txt'));
			assert.ok(!diff.contents.includes('b/back/slash.txt'));
		});

		test('reads a root commit with `paths`', async () => {
			const diff = await repo.provider.diff.getDiff?.(repo.path, baseline, undefined, {
				paths: [rootFile],
				errors: 'throw',
			});
			assert.ok(diff?.contents);
			assert.ok(diff.contents.includes('back\\\\slash.txt'));
			assert.ok(diff.contents.includes('+one\n'));
			assert.ok(!diff.contents.includes('plain.txt'));
			assert.ok(!diff.contents.includes('b/back/slash.txt'));
		});

		test('`uris` of the same name read the file it becomes when a backslash is a separator', async () => {
			const diff = await repo.provider.diff.getDiff?.(repo.path, committed, baseline, {
				uris: [rootFile],
				errors: 'throw',
			});
			assert.ok(diff?.contents, 'the lookalike file’s section is read');
			assert.ok(!diff.contents.includes('back\\\\slash.txt'), 'never the file that was asked for');
			assert.ok(diff.contents.includes('b/back/slash.txt'));
			assert.ok(diff.contents.includes('-x\n+y\n'));
		});

		test('`uris` of a name with no lookalike read nothing', async () => {
			const diff = await repo.provider.diff.getDiff?.(repo.path, committed, baseline, {
				uris: [nestedFile],
				errors: 'throw',
			});
			assert.ok(!diff?.contents);
		});
	});

	suite('getParsedDiff', () => {
		test('parses the committed file under its literal name', async () => {
			const parsed = await repo.provider.diff.getParsedDiff?.(repo.path, committed, baseline, {
				paths: [rootFile, nestedFile],
				errors: 'throw',
			});
			assert.deepStrictEqual(parsed?.files.map(f => f.path).sort(), [nestedFile, rootFile].sort());
		});

		test('parses the working tree file under its literal name', async () => {
			const parsed = await repo.provider.diff.getParsedDiff?.(repo.path, uncommitted, 'HEAD', {
				paths: [nestedFile],
				errors: 'throw',
			});
			assert.deepStrictEqual(
				parsed?.files.map(f => f.path),
				[nestedFile],
			);
		});

		test('`uris` of the same name do not parse the file', async () => {
			const parsed = await repo.provider.diff.getParsedDiff?.(repo.path, uncommitted, 'HEAD', {
				uris: [nestedFile],
				errors: 'throw',
			});
			assert.ok(!parsed?.files.some(f => f.path === nestedFile));
		});
	});

	suite('getRevisionContent', () => {
		test('reads the bytes at a commit with `literalPath`', async () => {
			for (const [name, expected] of [
				[rootFile, 'two\n'],
				[nestedFile, 'two\n'],
			]) {
				const data = await repo.provider.revision.getRevisionContent(repo.path, name, committed, {
					literalPath: true,
				});
				assert.strictEqual(Buffer.from(data!).toString(), expected, name);
			}
		});

		test('reads the bytes from the index with `literalPath`', async () => {
			const data = await repo.provider.revision.getRevisionContent(repo.path, rootFile, uncommittedStaged, {
				literalPath: true,
			});
			assert.strictEqual(Buffer.from(data!).toString(), 'three\n');
		});

		test('without it the same name is read as the file it becomes when a backslash is a separator', async () => {
			const data = await repo.provider.revision.getRevisionContent(repo.path, rootFile, committed);
			assert.strictEqual(Buffer.from(data!).toString(), 'y\n');
		});

		test('without it a name with no lookalike is not found', async () => {
			await assert.rejects(repo.provider.revision.getRevisionContent(repo.path, nestedFile, committed));
		});
	});
});

suiteOrSkip('Reading a literal path before the first commit', () => {
	let repo: TestRepo;
	let unbornPath: string;

	suiteSetup(() => {
		repo = createTestRepo();
		unbornPath = mkdtempSync(join(tmpdir(), 'gitlens-unborn-literal-'));
		execFileSync('git', ['init', '-b', 'main'], { cwd: unbornPath, stdio: 'pipe' });
		writeFileSync(join(unbornPath, rootFile), 'one\n');
		writeFileSync(join(unbornPath, 'plain.txt'), 'one\n');
		execFileSync('git', ['add', '-A'], { cwd: unbornPath, stdio: 'pipe' });
		writeFileSync(join(unbornPath, rootFile), 'one\ntwo\n');
	});

	suiteTeardown(() => {
		repo.cleanup();
		rmSync(unbornPath, { recursive: true, force: true });
	});

	test('getDiff keeps `paths` when it retries against the empty tree', async () => {
		const diff = await repo.provider.diff.getDiff?.(unbornPath, uncommitted, 'HEAD', {
			paths: [rootFile],
			errors: 'throw',
		});
		assert.ok(diff?.contents);
		assert.ok(diff.contents.includes('back\\\\slash.txt'));
		assert.ok(diff.contents.includes('+two\n'));
		assert.ok(!diff.contents.includes('plain.txt'));
	});
});
