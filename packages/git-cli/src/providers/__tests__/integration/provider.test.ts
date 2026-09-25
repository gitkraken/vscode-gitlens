import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CachedGitTypes } from '@gitlens/git/cache.js';
import type { FileSystemProvider, GitServiceContext, GitServiceHooks } from '@gitlens/git/context.js';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import { toFsPath } from '@gitlens/utils/uri.js';
import { CliGitProvider } from '../../../cliGitProvider.js';
import { findGitPath } from '../../../exec/locator.js';
import { createTestRepo } from './helpers.js';

// Cache git location across this file's tests (see helpers.ts — findGitPath does no caching of its own).
let gitLocationPromise: ReturnType<typeof findGitPath>;
function getGitLocation() {
	return (gitLocationPromise ??= findGitPath(null));
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
		readDirectory: async function () {
			return [];
		},
	};
}

/** A `CliGitProvider` with no repository behind it yet — for exercising `init` itself. */
function createBareProvider(hooks?: GitServiceHooks): CliGitProvider {
	const context: GitServiceContext = {
		fs: createNodeFs(),
		hooks: hooks,
		config: { commits: {}, graph: { writeCommitGraph: false } },
	};
	return new CliGitProvider({ context: context, locator: getGitLocation, gitOptions: { gitTimeout: 30000 } });
}

suite('CliGitProvider.init', () => {
	test('creates a repository at a path that does not yet exist, with the given default branch', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'gitlens-test-init-'));
		const target = join(parent, 'nested', 'repo');
		const provider = createBareProvider();
		try {
			await provider.init(target, { defaultBranch: 'trunk' });

			const info = await provider.config.getRepositoryInfo(target);
			assert.ok(info != null && !Array.isArray(info), 'init must produce a discoverable repository');

			const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
				cwd: target,
				encoding: 'utf-8',
			}).trim();
			assert.strictEqual(branch, 'trunk');
		} finally {
			provider.dispose();
			rmSync(parent, { recursive: true, force: true });
		}
	});

	test('bare option creates a bare repository', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'gitlens-test-init-bare-'));
		const target = join(parent, 'bare.git');
		const provider = createBareProvider();
		try {
			await provider.init(target, { bare: true });

			const isBare = execFileSync('git', ['rev-parse', '--is-bare-repository'], {
				cwd: target,
				encoding: 'utf-8',
			}).trim();
			assert.strictEqual(isBare, 'true');
		} finally {
			provider.dispose();
			rmSync(parent, { recursive: true, force: true });
		}
	});
});

suite('PatchGitSubProvider.createEmptyInitialCommit', () => {
	// It hashes the empty tree from an EMPTY stdin — which never closed git's stdin pipe, so the call waited
	// until the command timeout killed it.
	test('commits the empty tree to a repository with no commits', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'gitlens-test-empty-initial-'));
		const target = join(parent, 'repo');
		const provider = createBareProvider();
		try {
			await provider.init(target);
			// `commit-tree` needs an identity, and a CI runner has no global one to fall back on
			execFileSync('git', ['config', 'user.email', 'test@gitlens.test'], { cwd: target, stdio: 'pipe' });
			execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: target, stdio: 'pipe' });

			const sha = await provider.patch.createEmptyInitialCommit(target);

			const head = execFileSync('git', ['symbolic-ref', 'HEAD'], { cwd: target, encoding: 'utf-8' }).trim();
			assert.strictEqual(head, 'refs/heads/main');
			assert.strictEqual(
				execFileSync('git', ['rev-parse', 'refs/heads/main'], { cwd: target, encoding: 'utf-8' }).trim(),
				sha,
			);

			const tree = execFileSync('git', ['rev-parse', `${sha}^{tree}`], { cwd: target, encoding: 'utf-8' }).trim();
			const emptyTree = execFileSync('git', ['hash-object', '-t', 'tree', '/dev/null'], {
				cwd: target,
				encoding: 'utf-8',
			}).trim();
			assert.strictEqual(tree, emptyTree);
		} finally {
			provider.dispose();
			rmSync(parent, { recursive: true, force: true });
		}
	});
});

suite('CliGitProvider.notifyChanged', () => {
	test('fires both hooks and clears a previously cached config read', async () => {
		const onReset: [string, CachedGitTypes[]][] = [];
		const onChanged: [string, RepositoryChange[]][] = [];
		const r = createTestRepo({
			hooks: {
				cache: { onReset: (repoPath, ...types) => onReset.push([repoPath, types]) },
				repository: { onChanged: (repoPath, changes) => onChanged.push([repoPath, changes]) },
			},
		});
		try {
			// Prime the config cache through the typed path.
			const before = await r.provider.config.getConfig(r.path, 'user.name');
			assert.strictEqual(before, 'Test User');

			// Change the value directly via raw git — bypassing the provider entirely, the way a consumer's
			// `provider.git.run` escape hatch would.
			execFileSync('git', ['config', 'user.name', 'Changed Name'], { cwd: r.path, stdio: 'pipe' });

			// Sanity: without notifying, the stale cached value is still served.
			const stillCached = await r.provider.config.getConfig(r.path, 'user.name');
			assert.strictEqual(stillCached, 'Test User', 'sanity: the read must be cache-served before notifyChanged');

			r.provider.notifyChanged(r.path, ['config'], { cache: ['config'] });

			assert.strictEqual(onReset.length, 1, 'onReset must fire exactly once');
			assert.strictEqual(onReset[0][0], r.path);
			assert.deepStrictEqual(onReset[0][1], ['config']);
			assert.strictEqual(onChanged.length, 1, 'onChanged must fire exactly once');
			assert.strictEqual(onChanged[0][0], r.path);
			assert.deepStrictEqual(onChanged[0][1], ['config']);

			const after = await r.provider.config.getConfig(r.path, 'user.name');
			assert.strictEqual(after, 'Changed Name', 'notifyChanged must clear the cache so the new value is read');
		} finally {
			r.cleanup();
		}
	});

	test('an omitted cache option clears every cache type and fires onReset with no types', async () => {
		const onReset: CachedGitTypes[][] = [];
		const r = createTestRepo({
			hooks: { cache: { onReset: (_repoPath, ...types) => onReset.push(types) } },
		});
		try {
			const before = await r.provider.config.getConfig(r.path, 'user.name');
			assert.strictEqual(before, 'Test User');
			execFileSync('git', ['config', 'user.name', 'Changed Name'], { cwd: r.path, stdio: 'pipe' });

			r.provider.notifyChanged(r.path, ['unknown']);

			assert.strictEqual(onReset.length, 1);
			assert.deepStrictEqual(onReset[0], [], 'an omitted cache option must fire onReset with no types (= all)');

			const after = await r.provider.config.getConfig(r.path, 'user.name');
			assert.strictEqual(after, 'Changed Name', 'the config cache must have been cleared too');
		} finally {
			r.cleanup();
		}
	});
});
