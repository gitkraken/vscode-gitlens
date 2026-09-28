import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createTestRepo } from './helpers.js';

suite('CliGitProvider.clone', () => {
	let parent: string;

	setup(() => {
		parent = mkdtempSync(join(tmpdir(), 'gitlens-clone-parent-'));
	});

	teardown(() => {
		rmSync(parent, { recursive: true, force: true });
	});

	test('folderName is used exactly, even when the URL-derived default folder already exists', async () => {
		const source = createTestRepo();
		try {
			// Occupy the URL-derived default name — without `folderName` this would force auto-numbering.
			mkdirSync(join(parent, basename(source.path)));

			const result = await source.provider.clone(source.path, parent, { folderName: 'my-repo' });

			assert.strictEqual(result, join(parent, 'my-repo'));
			assert.ok(existsSync(join(parent, 'my-repo', '.git')), 'the clone must exist at the exact folderName');
		} finally {
			source.cleanup();
		}
	});

	test('folderName naming an existing non-empty folder rejects, with no auto-numbered sibling', async () => {
		const source = createTestRepo();
		try {
			const target = join(parent, 'taken');
			mkdirSync(target);
			writeFileSync(join(target, 'file.txt'), 'not empty');

			await assert.rejects(source.provider.clone(source.path, parent, { folderName: 'taken' }));

			assert.ok(!existsSync(join(parent, 'taken-1')), 'folderName must never be auto-numbered');
		} finally {
			source.cleanup();
		}
	});

	test('an unreachable remote rejects rather than returning a folder that was never cloned', async () => {
		const source = createTestRepo();
		try {
			// "Could not read from remote repository" is a `GitWarnings` match the default handler would swallow
			await assert.rejects(
				source.provider.clone(
					'ssh://git.invalid/repo.git',
					parent,
					{ folderName: 'unreachable' },
					{ env: { GIT_SSH_COMMAND: 'exit 1' } },
				),
			);

			assert.ok(!existsSync(join(parent, 'unreachable')));
		} finally {
			source.cleanup();
		}
	});

	test('runOptions.env reaches the clone', async () => {
		const source = createTestRepo();
		try {
			const result = await source.provider.clone(source.path, parent, undefined, {
				env: {
					GIT_CONFIG_COUNT: '1',
					GIT_CONFIG_KEY_0: 'clone.defaultRemoteName',
					GIT_CONFIG_VALUE_0: 'upstream',
				},
			});

			assert.ok(result, 'expected a clone path');
			const remotes = execFileSync('git', ['remote'], { cwd: result, encoding: 'utf-8' }).trim().split('\n');
			assert.deepStrictEqual(remotes, ['upstream']);
		} finally {
			source.cleanup();
		}
	});

	test('without folderName, the existing default-name auto-numbering still happens', async () => {
		const source = createTestRepo();
		try {
			const defaultName = basename(source.path);
			mkdirSync(join(parent, defaultName));

			const result = await source.provider.clone(source.path, parent);

			assert.strictEqual(result, join(parent, `${defaultName}-1`));
		} finally {
			source.cleanup();
		}
	});
});
