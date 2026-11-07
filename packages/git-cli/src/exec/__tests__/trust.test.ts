import * as assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, realpathSync, rmdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { execPath } from 'process';
import { WorkspaceUntrustedError } from '@gitlens/git/errors.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { CliGitProvider } from '../../cliGitProvider.js';
import type { ProcessSpawner } from '../exec.js';
import type { GitRunOptions } from '../exec.types.js';
import { Git } from '../git.js';
import type { GitOptions } from '../git.js';

// Absolute on this platform (a drive is added on Windows), as real repository paths are
const trustedRepo = resolve('/test/trusted');
const untrustedRepo = resolve('/test/untrusted');

/** A spawner that records where git was started and runs a harmless node process in its place */
function recordingSpawner(): { spawner: ProcessSpawner; cwds: (string | undefined)[] } {
	const cwds: (string | undefined)[] = [];
	const spawner: ProcessSpawner = (_command, _args, options) => {
		cwds.push(options.cwd);
		return spawn(execPath, ['-e', ''], { ...options, cwd: undefined });
	};
	return { spawner: spawner, cwds: cwds };
}

const locator = async () => ({ path: 'git', version: '2.40.0' });

suite('Git per-path trust', () => {
	function newGit(isTrusted: GitOptions['isTrusted']): { git: Git; cwds: (string | undefined)[] } {
		const { spawner, cwds } = recordingSpawner();
		return { git: new Git(locator, { spawn: spawner, isTrusted: isTrusted }), cwds: cwds };
	}

	const refuseUntrusted = (repoPath: string) => normalizePath(repoPath) !== normalizePath(untrustedRepo);

	test('run rejects an untrusted path before spawning while another path runs', async () => {
		const { git, cwds } = newGit(refuseUntrusted);

		await assert.rejects(git.run({ cwd: untrustedRepo }, 'status'), WorkspaceUntrustedError);
		assert.deepStrictEqual(cwds, [], 'nothing was spawned for the refused path');

		await git.run({ cwd: trustedRepo }, 'status');
		assert.deepStrictEqual(cwds, [trustedRepo]);
	});

	test('stream rejects an untrusted path before spawning while another path runs', async () => {
		const { git, cwds } = newGit(refuseUntrusted);

		await assert.rejects(async () => {
			for await (const _chunk of git.stream({ cwd: untrustedRepo }, 'log')) {
				// drain
			}
		}, WorkspaceUntrustedError);
		assert.deepStrictEqual(cwds, []);

		for await (const _chunk of git.stream({ cwd: trustedRepo }, 'log')) {
			// drain
		}
		assert.deepStrictEqual(cwds, [trustedRepo]);
	});

	test('the predicate is asked about the run cwd', async () => {
		const asked: string[] = [];
		const { git } = newGit(repoPath => {
			asked.push(repoPath);
			return true;
		});

		await git.run({ cwd: trustedRepo }, 'status');
		assert.deepStrictEqual(asked, [normalizePath(trustedRepo)]);
	});

	test('a run with no cwd is asked about the process working directory', async () => {
		const asked: string[] = [];
		const { git, cwds } = newGit(repoPath => {
			asked.push(repoPath);
			return false;
		});

		await assert.rejects(git.run({ cwd: undefined }, 'status'), WorkspaceUntrustedError);
		assert.deepStrictEqual(asked, [normalizePath(process.cwd())]);
		assert.deepStrictEqual(cwds, []);
	});

	test('an empty cwd is asked about the process working directory', async () => {
		const asked: string[] = [];
		const { git } = newGit(repoPath => {
			asked.push(repoPath);
			return true;
		});

		// Global config reads run with an empty cwd
		await git.run({ cwd: '' }, 'config', '--global', '--get', 'user.name');
		assert.deepStrictEqual(asked, [normalizePath(process.cwd())]);
	});

	test('a cwd with a .. segment is asked about the path it resolves to', async () => {
		const asked: string[] = [];
		const { git, cwds } = newGit(repoPath => {
			asked.push(repoPath);
			return refuseUntrusted(repoPath);
		});

		// Concatenated rather than joined, so the `..` reaches the run as a caller could pass it
		await assert.rejects(git.run({ cwd: `${trustedRepo}/../untrusted` }, 'status'), WorkspaceUntrustedError);
		assert.deepStrictEqual(asked, [normalizePath(untrustedRepo)]);
		assert.deepStrictEqual(cwds, []);
	});

	test('a bare repository in a refused folder answers bare without running git there', async () => {
		const { git, cwds } = newGit(refuseUntrusted);

		assert.strictEqual(await git.rev_parse__work_tree_of_git_dir(resolve(untrustedRepo, 'bare.git')), undefined);
		assert.deepStrictEqual(cwds, []);
	});

	test('a -C into an untrusted path is refused even when the cwd is trusted', async () => {
		const { git, cwds } = newGit(refuseUntrusted);

		await assert.rejects(
			git.run({ cwd: trustedRepo, configs: ['-C', untrustedRepo] }, 'status'),
			WorkspaceUntrustedError,
		);
		await assert.rejects(git.run({ cwd: trustedRepo }, '-C', untrustedRepo, 'status'), WorkspaceUntrustedError);
		assert.deepStrictEqual(cwds, []);

		await git.run({ cwd: trustedRepo, configs: ['-C', trustedRepo] }, 'status');
		assert.deepStrictEqual(cwds, [trustedRepo]);
	});

	// A host that trusts a folder trusts what is inside it, so a git dir under the untrusted repo is refused too
	const refuseUnderUntrusted = (repoPath: string) => {
		const path = normalizePath(repoPath);
		const untrusted = normalizePath(untrustedRepo);
		return path !== untrusted && !path.startsWith(`${untrusted}/`);
	};

	test('a --git-dir=<path> into an untrusted repo is refused even when the cwd is trusted', async () => {
		const asked: string[] = [];
		const { git, cwds } = newGit(repoPath => {
			asked.push(repoPath);
			return refuseUnderUntrusted(repoPath);
		});
		const gitDir = resolve(untrustedRepo, '.git');

		await assert.rejects(git.run({ cwd: trustedRepo }, `--git-dir=${gitDir}`, 'status'), WorkspaceUntrustedError);
		await assert.rejects(
			git.run({ cwd: trustedRepo, configs: [`--git-dir=${gitDir}`] }, 'status'),
			WorkspaceUntrustedError,
		);
		assert.deepStrictEqual(cwds, []);
		assert.ok(asked.includes(normalizePath(gitDir)), 'the git dir path itself is asked about');
	});

	test('a two-argument --git-dir <path> into an untrusted repo is refused', async () => {
		const { git, cwds } = newGit(refuseUnderUntrusted);
		const gitDir = resolve(untrustedRepo, '.git');

		await assert.rejects(git.run({ cwd: trustedRepo }, '--git-dir', gitDir, 'status'), WorkspaceUntrustedError);
		await assert.rejects(
			git.run({ cwd: trustedRepo, configs: ['--git-dir', gitDir] }, 'status'),
			WorkspaceUntrustedError,
		);
		await assert.rejects(
			(async () => {
				for await (const _chunk of git.stream({ cwd: trustedRepo }, '--git-dir', gitDir, 'log')) {
					// drain
				}
			})(),
			WorkspaceUntrustedError,
		);
		assert.deepStrictEqual(cwds, []);
	});

	test('a relative --git-dir is resolved against the cwd before it is asked about', async () => {
		const { git, cwds } = newGit(refuseUnderUntrusted);

		await assert.rejects(
			git.run({ cwd: trustedRepo }, '--git-dir=../untrusted/.git', 'status'),
			WorkspaceUntrustedError,
		);
		assert.deepStrictEqual(cwds, []);
	});

	test('a --work-tree into an untrusted path is refused, in both forms', async () => {
		const { git, cwds } = newGit(refuseUntrusted);

		await assert.rejects(
			git.run({ cwd: trustedRepo }, `--work-tree=${untrustedRepo}`, 'status'),
			WorkspaceUntrustedError,
		);
		await assert.rejects(
			git.run({ cwd: trustedRepo }, '--work-tree', untrustedRepo, 'status'),
			WorkspaceUntrustedError,
		);
		assert.deepStrictEqual(cwds, []);
	});

	test('GIT_DIR and GIT_WORK_TREE in the run env are refused', async () => {
		const { git, cwds } = newGit(refuseUnderUntrusted);

		await assert.rejects(
			git.run({ cwd: trustedRepo, env: { GIT_DIR: resolve(untrustedRepo, '.git') } }, 'status'),
			WorkspaceUntrustedError,
		);
		await assert.rejects(
			git.run({ cwd: trustedRepo, env: { GIT_WORK_TREE: untrustedRepo } }, 'status'),
			WorkspaceUntrustedError,
		);
		await assert.rejects(
			(async () => {
				for await (const _chunk of git.stream(
					{ cwd: trustedRepo, env: { GIT_DIR: resolve(untrustedRepo, '.git') } },
					'log',
				)) {
					// drain
				}
			})(),
			WorkspaceUntrustedError,
		);
		assert.deepStrictEqual(cwds, []);
	});

	test('a trusted --git-dir, --work-tree and env path run', async () => {
		const { git, cwds } = newGit(refuseUnderUntrusted);
		const gitDir = resolve(trustedRepo, '.git');

		await git.run({ cwd: trustedRepo }, `--git-dir=${gitDir}`, 'status');
		await git.run({ cwd: trustedRepo }, '--git-dir', gitDir, '--work-tree', trustedRepo, 'status');
		await git.run({ cwd: trustedRepo, env: { GIT_DIR: gitDir, GIT_WORK_TREE: trustedRepo } }, 'status');
		assert.strictEqual(cwds.length, 3);
	});

	test('a run with none of the markers is asked about the cwd only', async () => {
		const asked: string[] = [];
		const { git } = newGit(repoPath => {
			asked.push(repoPath);
			return true;
		});

		await git.run(
			{ cwd: trustedRepo, env: { GIT_INDEX_FILE: resolve(untrustedRepo, 'index') } },
			'log',
			'--',
			'--git-dir',
		);
		assert.deepStrictEqual(asked, [normalizePath(trustedRepo)]);
	});

	test('an option-shaped token after the verb or `--` is never asked about', async () => {
		const asked: string[] = [];
		const { git } = newGit(repoPath => {
			asked.push(repoPath);
			return true;
		});

		await git.run({ cwd: trustedRepo }, 'grep', '-C', untrustedRepo, 'needle');
		await git.run({ cwd: trustedRepo }, 'log', `--git-dir=${untrustedRepo}`, '--work-tree', untrustedRepo);
		await git.run({ cwd: trustedRepo }, 'add', '--', '-C', untrustedRepo, `--git-dir=${untrustedRepo}`);
		const trusted = normalizePath(trustedRepo);
		assert.deepStrictEqual(asked, [trusted, trusted, trusted]);
	});

	test('an undefined token among the leading options is skipped', async () => {
		const { git, cwds } = newGit(refuseUntrusted);

		await assert.rejects(
			git.run({ cwd: trustedRepo }, '-C', undefined, untrustedRepo, undefined, 'status'),
			WorkspaceUntrustedError,
		);
		await assert.rejects(
			git.run({ cwd: trustedRepo, configs: ['-C'] }, undefined, untrustedRepo, 'status'),
			WorkspaceUntrustedError,
		);
		assert.deepStrictEqual(cwds, []);
	});

	test('a -C in configs and one in args join relative to each other', async () => {
		const asked: string[] = [];
		const { git } = newGit(repoPath => {
			asked.push(repoPath);
			return true;
		});

		await git.run({ cwd: trustedRepo, configs: ['-C', 'a'] }, '-C', 'b', 'status');
		assert.deepStrictEqual(asked, [normalizePath(trustedRepo), normalizePath(resolve(trustedRepo, 'a', 'b'))]);
	});

	test('GIT_DIR matches case-insensitively and every matching key is asked about', async () => {
		const { git, cwds } = newGit(refuseUnderUntrusted);

		await assert.rejects(
			git.run({ cwd: trustedRepo, env: { git_dir: resolve(untrustedRepo, '.git') } }, 'status'),
			WorkspaceUntrustedError,
		);
		await assert.rejects(
			git.run({ cwd: trustedRepo, env: { Git_Work_Tree: untrustedRepo } }, 'status'),
			WorkspaceUntrustedError,
		);
		// Git outside Windows reads only the exact `GIT_DIR`, so a trusted spelling ahead of it can't vouch for it
		await assert.rejects(
			git.run(
				{
					cwd: trustedRepo,
					env: { git_dir: resolve(trustedRepo, '.git'), GIT_DIR: resolve(untrustedRepo, '.git') },
				},
				'status',
			),
			WorkspaceUntrustedError,
		);
		// Node on Windows keeps the spelling that sorts first, whatever order the keys were added in
		await assert.rejects(
			git.run(
				{
					cwd: trustedRepo,
					env: { GIT_DIR: resolve(trustedRepo, '.git'), git_dir: resolve(untrustedRepo, '.git') },
				},
				'status',
			),
			WorkspaceUntrustedError,
		);
		assert.deepStrictEqual(cwds, []);

		await git.run(
			{
				cwd: trustedRepo,
				env: { GIT_DIR: resolve(trustedRepo, '.git'), git_dir: resolve(trustedRepo, '.git') },
			},
			'status',
		);
		assert.strictEqual(cwds.length, 1);
	});

	test('GIT_COMMON_DIR in the run env is refused, since config and hooks are read from it', async () => {
		const { git, cwds } = newGit(refuseUnderUntrusted);

		await assert.rejects(
			git.run({ cwd: trustedRepo, env: { GIT_COMMON_DIR: resolve(untrustedRepo, '.git') } }, 'status'),
			WorkspaceUntrustedError,
		);
		assert.deepStrictEqual(cwds, []);

		await git.run({ cwd: trustedRepo, env: { GIT_COMMON_DIR: resolve(trustedRepo, '.git') } }, 'status');
		assert.strictEqual(cwds.length, 1);
	});

	test('a -C after a global option that takes a separate value is still refused', async () => {
		const { git, cwds } = newGit(refuseUntrusted);

		await assert.rejects(
			git.run({ cwd: trustedRepo }, '--attr-source', 'HEAD', '-C', untrustedRepo, 'status'),
			WorkspaceUntrustedError,
		);
		await assert.rejects(
			git.run({ cwd: trustedRepo }, '--shallow-file', 'shallow', '-C', untrustedRepo, 'status'),
			WorkspaceUntrustedError,
		);
		assert.deepStrictEqual(cwds, []);
	});

	test('an absolute -C is asked about alone, whatever the starting directory', async () => {
		const asked: string[] = [];
		const { git, cwds } = newGit(repoPath => {
			asked.push(repoPath);
			return normalizePath(repoPath) === normalizePath(trustedRepo);
		});

		// The starting directory is not trusted, but git never looks at it
		await git.run({ cwd: '' }, '-C', trustedRepo, 'status');
		await git.run({ cwd: untrustedRepo, configs: ['-C', trustedRepo] }, 'status');
		await git.run({ cwd: untrustedRepo }, '-C', 'a', '-C', trustedRepo, 'status');
		assert.deepStrictEqual(asked, Array(3).fill(normalizePath(trustedRepo)));
		assert.strictEqual(cwds.length, 3);

		// A relative one resolves against the starting directory, which is then asked about too
		asked.length = 0;
		await assert.rejects(git.run({ cwd: untrustedRepo }, '-C', 'a', 'status'), WorkspaceUntrustedError);
		assert.deepStrictEqual(asked, [normalizePath(untrustedRepo)]);

		// A refused absolute target is still refused
		await assert.rejects(git.run({ cwd: trustedRepo }, '-C', untrustedRepo, 'status'), WorkspaceUntrustedError);
	});

	test('an absolute -C leaves the other paths to resolve against it', async () => {
		const { git, cwds } = newGit(refuseUnderUntrusted);

		await assert.rejects(
			git.run({ cwd: '' }, '-C', untrustedRepo, '--git-dir=.git', 'status'),
			WorkspaceUntrustedError,
		);
		await assert.rejects(
			git.run({ cwd: '' }, '-C', trustedRepo, '--git-dir', '../untrusted/.git', 'status'),
			WorkspaceUntrustedError,
		);
		assert.deepStrictEqual(cwds, []);
	});

	test('a refusal carries the exact path the host refused', async () => {
		const { git } = newGit(refuseUnderUntrusted);
		const gitDir = resolve(untrustedRepo, '.git');

		const refusal = async (promise: Promise<unknown>) => {
			try {
				await promise;
			} catch (ex) {
				assert.ok(ex instanceof WorkspaceUntrustedError);
				return ex.path;
			}
			return assert.fail('expected a refusal');
		};

		assert.strictEqual(await refusal(git.run({ cwd: untrustedRepo }, 'status')), normalizePath(untrustedRepo));
		assert.strictEqual(
			await refusal(git.run({ cwd: trustedRepo }, `--git-dir=${gitDir}`, 'status')),
			normalizePath(gitDir),
			'the git dir, not the cwd',
		);
		assert.strictEqual(
			await refusal(git.run({ cwd: trustedRepo }, '-C', untrustedRepo, 'status')),
			normalizePath(untrustedRepo),
		);
		assert.strictEqual(
			await refusal(git.run({ cwd: trustedRepo }, '--work-tree', untrustedRepo, 'status')),
			normalizePath(untrustedRepo),
		);
		assert.strictEqual(
			await refusal(git.run({ cwd: trustedRepo, env: { GIT_DIR: gitDir } }, 'status')),
			normalizePath(gitDir),
		);
	});

	test('a notify run asks the host once and notifies nothing for a refused path', async () => {
		const asked: string[] = [];
		const { git } = newGit(repoPath => {
			asked.push(repoPath);
			return refuseUntrusted(repoPath);
		});
		const notified: (readonly string[])[] = [];
		git.bindChangeNotifier(repoPaths => notified.push(repoPaths));

		await git.run({ cwd: trustedRepo, notify: 'infer' }, 'commit', '-m', 'x');
		assert.deepStrictEqual(asked, [normalizePath(trustedRepo)], 'asked once');
		assert.strictEqual(notified.length, 1);

		await assert.rejects(
			git.run({ cwd: untrustedRepo, notify: 'infer' }, 'commit', '-m', 'x'),
			WorkspaceUntrustedError,
		);
		assert.strictEqual(notified.length, 1);
	});

	test('a working directory that was deleted refuses with the typed error', async function () {
		// Windows won't remove a folder a process is in
		if (process.platform === 'win32') return this.skip();

		const { git, cwds } = newGit(() => true);
		const original = process.cwd();
		const dir = mkdtempSync(join(tmpdir(), 'gitlens-trust-'));
		try {
			process.chdir(realpathSync(dir));
			rmdirSync(dir);

			for (const options of [
				{ cwd: '' },
				{ cwd: undefined },
				{ cwd: 'relative' },
				{ cwd: '', errors: 'ignore' },
			]) {
				await assert.rejects(
					git.run(options as GitRunOptions, 'status'),
					(ex: unknown) => ex instanceof WorkspaceUntrustedError && ex.path == null,
				);
			}
			await assert.rejects(git.run({ cwd: '' }, '-C', 'relative', 'status'), WorkspaceUntrustedError);
			assert.deepStrictEqual(cwds, []);

			// An absolute -C never needs the starting directory
			await git.run({ cwd: '' }, '-C', trustedRepo, 'status');
			assert.strictEqual(cwds.length, 1);
		} finally {
			process.chdir(original);
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('a predicate that answers anything but true refuses', async () => {
		const { git, cwds } = newGit((() => undefined) as unknown as GitOptions['isTrusted']);

		assert.strictEqual(git.isPathTrusted(trustedRepo), false);
		await assert.rejects(git.run({ cwd: trustedRepo }, 'status'), WorkspaceUntrustedError);
		assert.deepStrictEqual(cwds, []);
	});

	test('isPathTrusted answers true without a predicate', () => {
		assert.strictEqual(newGit(undefined).git.isPathTrusted(untrustedRepo), true);
		assert.strictEqual(newGit(refuseUntrusted).git.isPathTrusted(untrustedRepo), false);
		assert.strictEqual(newGit(refuseUntrusted).git.isPathTrusted(trustedRepo), true);
	});
});

suite('CliGitProvider trust wiring', () => {
	const providers: CliGitProvider[] = [];

	teardown(() => {
		for (const p of providers.splice(0)) {
			p.dispose();
		}
	});

	function newProvider(options: { workspaceIsTrusted?: boolean; isTrusted?: GitOptions['isTrusted'] }): {
		provider: CliGitProvider;
		cwds: (string | undefined)[];
	} {
		const { spawner, cwds } = recordingSpawner();
		const provider = new CliGitProvider({
			context: {
				fs: {
					readFile: () => Promise.reject(new Error('unexpected')),
					stat: () => Promise.resolve(undefined),
					readDirectory: () => Promise.resolve([]),
				},
				workspace:
					options.workspaceIsTrusted != null
						? { isTrusted: options.workspaceIsTrusted, getFolder: () => undefined }
						: undefined,
			},
			locator: locator,
			gitOptions: { spawn: spawner, isTrusted: options.isTrusted },
		});
		providers.push(provider);
		return { provider: provider, cwds: cwds };
	}

	test('honors gitOptions.isTrusted per path when the context has no workspace flag', async () => {
		const { provider, cwds } = newProvider({
			isTrusted: repoPath => normalizePath(repoPath) !== normalizePath(untrustedRepo),
		});

		await assert.rejects(provider.git.run({ cwd: untrustedRepo }, 'status'), WorkspaceUntrustedError);
		assert.deepStrictEqual(cwds, []);

		await provider.git.run({ cwd: trustedRepo }, 'status');
		assert.deepStrictEqual(cwds, [trustedRepo]);
	});

	test('the config provider falls back without git for an untrusted path only', async () => {
		const { provider, cwds } = newProvider({
			isTrusted: repoPath => normalizePath(repoPath) !== normalizePath(untrustedRepo),
		});

		assert.deepStrictEqual(await provider.config.getRepositoryInfo(untrustedRepo), []);
		assert.deepStrictEqual(cwds, [], 'no git process was started in the untrusted repository');

		await provider.config.getRepositoryInfo(trustedRepo);
		assert.deepStrictEqual(cwds, [trustedRepo], 'the trusted repository still asks git');
	});

	test('keeps no git dir or current user read while a path was refused', async () => {
		let trusted = false;
		const { provider } = newProvider({ isTrusted: () => trusted });

		await provider.config.getGitDir(untrustedRepo);
		assert.strictEqual(provider.cache.gitDir.get(untrustedRepo), undefined);
		assert.strictEqual(await provider.config.getCurrentUser(untrustedRepo), undefined);
		assert.strictEqual(provider.cache.currentUser.get(untrustedRepo), undefined);

		trusted = true;
		await provider.config.getGitDir(untrustedRepo);
		assert.notStrictEqual(provider.cache.gitDir.get(untrustedRepo), undefined, 'a trusted read is kept');
	});

	test('the workspace flag wins over gitOptions.isTrusted when untrusted', async () => {
		const { provider, cwds } = newProvider({ workspaceIsTrusted: false, isTrusted: () => true });

		await assert.rejects(provider.git.run({ cwd: trustedRepo }, 'status'), WorkspaceUntrustedError);
		assert.deepStrictEqual(cwds, []);
	});

	test('the workspace flag wins over gitOptions.isTrusted when trusted', async () => {
		const { provider, cwds } = newProvider({ workspaceIsTrusted: true, isTrusted: () => false });

		await provider.git.run({ cwd: untrustedRepo }, 'status');
		assert.deepStrictEqual(cwds, [untrustedRepo]);
	});

	test('everything runs when neither is set', async () => {
		const { provider, cwds } = newProvider({});

		await provider.git.run({ cwd: untrustedRepo }, 'status');
		assert.deepStrictEqual(cwds, [untrustedRepo]);
	});
});
