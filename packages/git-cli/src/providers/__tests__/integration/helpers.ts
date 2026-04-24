/**
 * Integration test helpers for @gitlens/git library.
 *
 * Creates real git repositories in temp directories and provides
 * a configured CliGitProvider for testing sub-providers.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileSystemProvider, GitServiceContext, GitServiceHooks } from '@gitlens/git/context.js';
import { Logger } from '@gitlens/utils/logger.js';
import { toFsPath } from '@gitlens/utils/uri.js';
import { CliGitProvider } from '../../../cliGitProvider.js';
import { findGitPath } from '../../../exec/locator.js';

export interface TestRepo {
	path: string;
	provider: CliGitProvider;
	cleanup: () => void;
}

// Cache git location across all tests
let gitLocationPromise: ReturnType<typeof findGitPath>;
function getGitLocation() {
	return (gitLocationPromise ??= findGitPath(null));
}

// Configure logger once (no-op unless debugging)
let loggerConfigured = false;
function ensureLogger() {
	if (loggerConfigured) return;
	loggerConfigured = true;

	const noop = () => {};
	const debugLog = process.env.GITLENS_TEST_DEBUG
		? (name: string) => (_msg: string) => {
				console.error(`[${name}] ${_msg}`);
			}
		: () => noop;

	Logger.configure({
		name: 'test',
		createChannel: function (name) {
			const log = debugLog(name);
			return {
				name: name,
				logLevel: 0,
				dispose: noop,
				trace: log,
				debug: log,
				info: log,
				warn: log,
				error: log,
			};
		},
	});
}

function createMinimalContext(hooks?: GitServiceHooks): GitServiceContext {
	return {
		fs: createNodeFs(),
		hooks: hooks,
	};
}

function createNodeFs(): FileSystemProvider {
	return {
		readFile: async function (uri) {
			return readFile(toFsPath(uri));
		},
		stat: async function (uri) {
			try {
				const stats = statSync(toFsPath(uri));
				return {
					type: stats.isDirectory() ? 2 : 1,
					ctime: stats.ctimeMs,
					mtime: stats.mtimeMs,
					size: stats.size,
				};
			} catch {
				return undefined;
			}
		},
		readDirectory: async function (uri) {
			const entries = readdirSync(toFsPath(uri), { withFileTypes: true });
			return entries.map(e => [e.name, e.isDirectory() ? 2 : 1]);
		},
	};
}

/**
 * Creates a test git repository with an initial commit.
 * Returns the provider, git instance, and cleanup function.
 *
 * Call `cleanup()` in your `teardown()` / `suiteTeardown()`.
 */
export function createTestRepo(options?: { hooks?: GitServiceHooks }): TestRepo {
	ensureLogger();

	const dir = mkdtempSync(join(tmpdir(), 'gitlens-test-'));

	// Initialize a git repo with deterministic config
	execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'pipe' });
	execFileSync('git', ['config', 'user.email', 'test@gitlens.test'], { cwd: dir, stdio: 'pipe' });
	execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' });
	// Disable gpg signing in test repos
	execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, stdio: 'pipe' });

	// Create initial commit
	writeFileSync(join(dir, 'README.md'), '# Test Repository\n');
	execFileSync('git', ['add', 'README.md'], {
		cwd: dir,
		stdio: 'pipe',
	});
	execFileSync('git', ['commit', '-m', 'Initial commit'], {
		cwd: dir,
		stdio: 'pipe',
		env: { ...process.env, GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z' },
	});

	const context = createMinimalContext(options?.hooks);
	const provider = new CliGitProvider({
		context: context,
		locator: getGitLocation,
		gitOptions: { gitTimeout: 30000 },
	});

	return {
		path: dir,
		provider: provider,
		cleanup: () => {
			provider.dispose();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

/**
 * Add a file and commit it in the test repo.
 */
export function addCommit(
	repoPath: string,
	filename: string,
	content: string,
	message: string,
	options?: { date?: string },
): void {
	const filePath = join(repoPath, filename);
	// Ensure parent directory exists
	mkdirSync(join(repoPath, ...filename.split('/').slice(0, -1)), { recursive: true });
	writeFileSync(filePath, content);
	const env = { ...process.env };
	if (options?.date) {
		env.GIT_COMMITTER_DATE = options.date;
		env.GIT_AUTHOR_DATE = options.date;
	}
	execFileSync('git', ['add', filename], { cwd: repoPath, stdio: 'pipe', env: env });
	execFileSync('git', ['commit', '-m', message], { cwd: repoPath, stdio: 'pipe', env: env });
}

/**
 * Create a branch in the test repo.
 */
export function createBranch(repoPath: string, name: string, options?: { checkout?: boolean }): void {
	if (options?.checkout) {
		execFileSync('git', ['checkout', '-b', name], { cwd: repoPath, stdio: 'pipe' });
	} else {
		execFileSync('git', ['branch', name], { cwd: repoPath, stdio: 'pipe' });
	}
}

/**
 * Create a tag in the test repo.
 */
export function createTag(repoPath: string, name: string, message?: string): void {
	if (message) {
		execFileSync('git', ['tag', '-a', name, '-m', message], { cwd: repoPath, stdio: 'pipe' });
	} else {
		execFileSync('git', ['tag', name], { cwd: repoPath, stdio: 'pipe' });
	}
}

/**
 * Create a stash in the test repo.
 */
export function createStash(repoPath: string, message?: string): void {
	writeFileSync(join(repoPath, 'stash-file.txt'), `stash content ${Date.now()}\n`);
	execFileSync('git', ['add', 'stash-file.txt'], { cwd: repoPath, stdio: 'pipe' });
	const args = ['stash', 'push'];
	if (message) {
		args.push('-m', message);
	}
	execFileSync('git', args, { cwd: repoPath, stdio: 'pipe' });
}

/**
 * Get the HEAD sha of the test repo.
 */
export function getHeadSha(repoPath: string): string {
	return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf-8' }).trim();
}
