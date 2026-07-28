import * as assert from 'assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Container } from '../../../../container.js';
import type { GitRepositoryService } from '../../../../git/gitRepositoryService.js';
import { ConflictToolsIntegration } from '../integration.js';
import type { Resolution, ResolvedChunk } from '../types.js';

/** The working-tree shape of a one-marker conflict in a file git otherwise merged cleanly. */
const conflicted = [
	'keep-above',
	'<<<<<<< HEAD',
	'timeout = 30',
	'=======',
	'timeout = 60',
	'>>>>>>> incoming',
	'keep-below',
	'',
].join('\n');
/** What the library computes for "take theirs" on that marker — the merged regions survive. */
const merged = ['keep-above', 'timeout = 60', 'keep-below', ''].join('\n');

function resolution(overrides: Partial<Resolution> & Pick<Resolution, 'filePath' | 'strategy'>): Resolution {
	return { content: '', confidence: 0.95, description: 'why', ...overrides };
}

const oneChunk: ResolvedChunk[] = [{ markerIndex: 0, strategy: 'theirs' }];

/**
 * A repo rooted at a temp dir with a recording git runner — enough for `applyBatch` to drive the
 * real `@gitkraken/conflict-tools` apply loop through our port, so the assertions cover what
 * actually lands on disk (and which git commands were reached for).
 */
function makeFakes(repoPath: string) {
	const execs: string[][] = [];
	const svc = {
		path: repoPath,
		createUnsafeGit: () => ({
			run: (args: string[]) => {
				execs.push(args);
				return Promise.resolve({ stdout: '' });
			},
		}),
	} as unknown as GitRepositoryService;

	return { integration: new ConflictToolsIntegration({} as Container), svc: svc, execs: execs };
}

suite('coretools/conflict/ConflictToolsIntegration applyBatch', () => {
	let dir: string;

	setup(async () => {
		dir = await mkdtemp(join(tmpdir(), 'gitlens-conflict-apply-'));
	});

	teardown(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	test('writes a chunked take-theirs resolution instead of checking out the whole stage blob', async () => {
		// The library classifies a single-marker "take theirs" as a FILE-level take and applies it with
		// `checkoutFile` — which would replace the file with the incoming blob and revert everything git
		// merged cleanly outside the marker. What's applied must equal the `content` we record as the
		// summary's "AI-resolved" side.
		const { integration, svc, execs } = makeFakes(dir);
		await writeFile(join(dir, 'server.conf'), conflicted);

		await integration.applyBatch({
			svc: svc,
			resolutions: [
				resolution({ filePath: 'server.conf', content: merged, strategy: 'take-theirs', chunks: oneChunk }),
			],
		});

		assert.strictEqual(await readFile(join(dir, 'server.conf'), 'utf8'), merged);
		assert.strictEqual(
			execs.some(a => a[0] === 'checkout'),
			false,
		);
		// Still staged, so the step can be continued
		assert.deepStrictEqual(
			execs.filter(a => a[0] === 'add'),
			[['add', '--', 'server.conf']],
		);
	});

	test('preserves the file’s CRLF line endings when substituting content', async () => {
		const { integration, svc } = makeFakes(dir);
		await writeFile(join(dir, 'server.conf'), conflicted.replace(/\n/g, '\r\n'));

		await integration.applyBatch({
			svc: svc,
			resolutions: [
				resolution({ filePath: 'server.conf', content: merged, strategy: 'take-theirs', chunks: oneChunk }),
			],
		});

		assert.strictEqual(await readFile(join(dir, 'server.conf'), 'utf8'), merged.replace(/\n/g, '\r\n'));
	});

	test('keeps the real checkout for a marker-less take (binary / delete-modify)', async () => {
		// No chunks means the library produced `content: ''` — substituting it would truncate the file,
		// so the stage-blob checkout is the only correct apply.
		const { integration, svc, execs } = makeFakes(dir);
		await writeFile(join(dir, 'icon.bin'), 'original');

		await integration.applyBatch({
			svc: svc,
			resolutions: [
				resolution({ filePath: 'icon.bin', strategy: 'take-ours', confidence: 1, chunks: [] }),
				resolution({ filePath: 'notes.md', strategy: 'take-theirs', confidence: 1 }),
			],
		});

		assert.strictEqual(await readFile(join(dir, 'icon.bin'), 'utf8'), 'original');
		assert.deepStrictEqual(
			execs.filter(a => a[0] === 'checkout'),
			[
				['checkout', '--ours', '--', 'icon.bin'],
				['checkout', '--theirs', '--', 'notes.md'],
			],
		);
	});

	test('never substitutes a deleted resolution — the file is removed, not emptied', async () => {
		const { integration, svc, execs } = makeFakes(dir);
		await writeFile(join(dir, 'gone.txt'), 'original');

		await integration.applyBatch({
			svc: svc,
			resolutions: [resolution({ filePath: 'gone.txt', strategy: 'deleted', confidence: 1, chunks: oneChunk })],
		});

		await assert.rejects(() => readFile(join(dir, 'gone.txt'), 'utf8'));
		assert.deepStrictEqual(execs, []);
	});

	test('never substitutes a skipped resolution — nothing is written or staged', async () => {
		const { integration, svc, execs } = makeFakes(dir);
		await writeFile(join(dir, 'a.txt'), conflicted);

		await integration.applyBatch({
			svc: svc,
			resolutions: [resolution({ filePath: 'a.txt', content: merged, strategy: 'skipped', chunks: [] })],
		});

		assert.strictEqual(await readFile(join(dir, 'a.txt'), 'utf8'), conflicted);
		assert.deepStrictEqual(execs, []);
	});

	test('substitution is scoped to the batch it was built from', async () => {
		// The map lives on the per-call port, so a later batch that takes the same path without chunks
		// must fall back to the real checkout rather than reusing the earlier content.
		const { integration, svc, execs } = makeFakes(dir);
		await writeFile(join(dir, 'server.conf'), conflicted);

		await integration.applyBatch({
			svc: svc,
			resolutions: [
				resolution({ filePath: 'server.conf', content: merged, strategy: 'take-theirs', chunks: oneChunk }),
			],
		});
		await integration.applyBatch({
			svc: svc,
			resolutions: [resolution({ filePath: 'server.conf', strategy: 'take-theirs', confidence: 1 })],
		});

		assert.deepStrictEqual(
			execs.filter(a => a[0] === 'checkout'),
			[['checkout', '--theirs', '--', 'server.conf']],
		);
	});
});
