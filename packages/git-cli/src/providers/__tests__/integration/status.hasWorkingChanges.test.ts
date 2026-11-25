import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LogChannel } from '@gitlens/utils/logger.js';
import type { TestRepo } from './helpers.js';
import { addCommit, createTestRepo } from './helpers.js';

function git(cwd: string, ...args: string[]): void {
	execFileSync('git', args, { cwd: cwd, stdio: 'pipe' });
}

function write(repoPath: string, file: string, content = 'x\n'): void {
	mkdirSync(join(repoPath, ...file.split('/').slice(0, -1)), { recursive: true });
	writeFileSync(join(repoPath, file), content);
}

// Pins the answer of the untracked probe: the same for every tree shape, whichever way git is asked
suite('StatusSubProvider — hasWorkingChanges untracked probe', () => {
	let repo: TestRepo;
	const completed: string[] = [];

	setup(() => {
		completed.length = 0;
		const logger: LogChannel = {
			name: 'status-spy',
			logLevel: 0,
			dispose: () => {},
			trace: () => {},
			debug: () => {},
			info: (msg: string) => {
				if (msg.includes('• completed')) {
					completed.push(msg);
				}
			},
			warn: () => {},
			error: () => {},
		};
		repo = createTestRepo({ gitOptions: { logger: logger } });
	});

	teardown(() => {
		repo.cleanup();
	});

	function probe(): Promise<boolean> {
		return repo.provider.status.hasWorkingChanges(repo.path, { staged: false, unstaged: false, untracked: true });
	}

	test('clean tree has none', async () => {
		assert.strictEqual(await probe(), false);
	});

	test('only empty directories has none', async () => {
		mkdirSync(join(repo.path, 'e', 'sub'), { recursive: true });
		assert.strictEqual(await probe(), false);
	});

	test('directory ignored by the committed root .gitignore has none', async () => {
		addCommit(repo.path, '.gitignore', 'ignored/\n', 'Add ignore');
		write(repo.path, 'ignored/file.txt');
		assert.strictEqual(await probe(), false);
	});

	test('directory ignored via info/exclude, plus empty directories, has none', async () => {
		mkdirSync(join(repo.path, '.git', 'info'), { recursive: true });
		appendFileSync(join(repo.path, '.git', 'info', 'exclude'), 'hidden/\n');
		write(repo.path, 'hidden/file.txt');
		mkdirSync(join(repo.path, 'e', 'sub'), { recursive: true });
		assert.strictEqual(await probe(), false);
	});

	test('directory whose own .gitignore is * has none', async () => {
		write(repo.path, 'self/.gitignore', '*\n');
		write(repo.path, 'self/other.txt');
		assert.strictEqual(await probe(), false);
	});

	test('untracked .gitignore ignoring its only sibling still counts', async () => {
		write(repo.path, 'dir/.gitignore', 'only.txt\n');
		write(repo.path, 'dir/only.txt');
		assert.strictEqual(await probe(), true);
	});

	test('file nested in untracked directories counts', async () => {
		write(repo.path, 'deep/a/b/real');
		assert.strictEqual(await probe(), true);
	});

	test('file at the root counts', async () => {
		write(repo.path, 'root.txt');
		assert.strictEqual(await probe(), true);
	});

	test('file inside a tracked directory counts', async () => {
		addCommit(repo.path, 'tracked/a.txt', 'a\n', 'Add tracked');
		write(repo.path, 'tracked/new.txt');
		assert.strictEqual(await probe(), true);
	});

	test('nested git repository with no commits counts', async () => {
		mkdirSync(join(repo.path, 'nested'), { recursive: true });
		git(join(repo.path, 'nested'), 'init', '-b', 'main');
		assert.strictEqual(await probe(), true);
	});

	test('nested git repository with a commit counts', async () => {
		const nested = join(repo.path, 'nested');
		mkdirSync(nested, { recursive: true });
		git(nested, 'init', '-b', 'main');
		git(nested, 'config', 'user.email', 'test@gitlens.test');
		git(nested, 'config', 'user.name', 'Test User');
		git(nested, 'config', 'commit.gpgsign', 'false');
		addCommit(nested, 'n.txt', 'n\n', 'Nested');
		assert.strictEqual(await probe(), true);
	});

	test('asks git to report untracked directories whole and skip empty ones', async () => {
		write(repo.path, 'deep/a/real');
		await probe();

		const line = completed.find(l => l.includes(' ls-files '));
		assert.ok(line != null, `no ls-files run captured in: ${completed.join('\n')}`);
		assert.ok(line.includes('--directory'), line);
		assert.ok(line.includes('--no-empty-directory'), line);
	});

	test('lists every untracked file on a git before the reworked directory walk', async () => {
		const supports = repo.provider.git.supports.bind(repo.provider.git);
		repo.provider.git.supports = feature => (feature === 'git:ls-files:directory' ? false : supports(feature));

		write(repo.path, 'deep/a/real');
		assert.strictEqual(await probe(), true);

		const line = completed.find(l => l.includes(' ls-files '));
		assert.ok(line != null, `no ls-files run captured in: ${completed.join('\n')}`);
		assert.ok(!line.includes('--directory'), line);
	});
});
