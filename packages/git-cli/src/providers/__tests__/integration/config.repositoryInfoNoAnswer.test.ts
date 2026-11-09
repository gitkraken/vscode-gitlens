import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { fileUri } from '@gitlens/utils/uri.js';
import { CliGitProvider } from '../../../cliGitProvider.js';
import type { GitOptions } from '../../../exec/git.js';
import { Git, GitError } from '../../../exec/git.js';
import { findGitPath } from '../../../exec/locator.js';

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd: cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function initRepo(path: string): string {
	mkdirSync(path, { recursive: true });
	git(path, 'init', '-q', '-b', 'main');
	git(
		path,
		'-c',
		'user.name=Test',
		'-c',
		'user.email=t@t',
		'-c',
		'commit.gpgsign=false',
		'commit',
		'-q',
		'--allow-empty',
		'-m',
		'init',
	);
	return path;
}

function isTimeout(ex: unknown): boolean {
	return isCancellationError(ex) && ex.reason === 'timeout';
}

// The arguments of each `rev-parse` `getRepositoryInfo` can run, matched within ` <args> $`, where `$` ends them
const primaryRead = '--show-toplevel --git-dir --git-common-dir';
const isBareRead = '--is-bare-repository';
const gitDirRead = 'rev-parse --git-dir --git-common-dir';
const workTreeRead = '--show-toplevel --git-dir $';

// Also bounds the reads a test expects to succeed, so it leaves them room on a loaded machine
const noAnswerTimeout = 3000;

/**
 * Runs real git through a script that can stall or kill the `rev-parse` a test names, so these exercise the provider's
 * own time limit against a real process, where a run with a 1ms limit may finish first.
 */
suite('getRepositoryInfo when git gives no answer (real git)', () => {
	let root: string;
	let main: string;
	let script: string;
	let failure: string;
	const providers: CliGitProvider[] = [];

	function stall(args: string): void {
		writeFileSync(failure, `stall\n${args}\n`);
	}

	function kill(args: string): void {
		writeFileSync(failure, `kill\n${args}\n`);
	}

	/** A wrapper around git reporting that git was killed, which Windows does for any killed process */
	function exitWith(code: number, args: string): void {
		writeFileSync(failure, `${code}\n${args}\n`);
	}

	function recover(): void {
		rmSync(failure, { force: true });
	}

	function newProvider(options?: {
		gitPath?: string;
		gitOptions?: GitOptions;
		isTrusted?: boolean;
		onGitDirResolveFailed?: () => void;
	}): CliGitProvider {
		const provider = new CliGitProvider({
			context: {
				fs: { readFile: () => assert.fail(), stat: () => assert.fail(), readDirectory: () => assert.fail() },
				hooks: { operations: { onGitDirResolveFailed: options?.onGitDirResolveFailed } },
				workspace:
					options?.isTrusted != null
						? { isTrusted: options.isTrusted, getFolder: () => undefined }
						: undefined,
				config: { commits: {}, graph: { writeCommitGraph: false } },
			},
			locator: async () => {
				const location = await findGitPath(null);
				return { ...location, path: options?.gitPath ?? script };
			},
			gitOptions: { gitTimeout: noAnswerTimeout, ...options?.gitOptions },
		});
		providers.push(provider);
		return provider;
	}

	setup(function () {
		// The fake git is a shell script, which Windows can't spawn directly
		if (process.platform === 'win32') {
			this.skip();
		}

		// Real path: the fixtures compare paths git prints, which are resolved through symlinks
		root = realpathSync(mkdtempSync(join(tmpdir(), 'gitlens-repository-info-')));
		main = initRepo(join(root, 'main'));
		failure = join(root, 'failure');
		script = join(root, 'fake-git');
		writeFileSync(
			script,
			`#!/bin/sh
if [ -e "${failure}" ]; then
	{ read -r action; read -r args; } < "${failure}"
	case " $* $" in
		*"$args"*)
			if [ "$action" = stall ]; then exec sleep 60; fi
			if [ "$action" = kill ]; then kill -KILL $$; fi
			exit "$action"
			;;
	esac
fi
exec git "$@"
`,
			{ mode: 0o755 },
		);
	});

	teardown(() => {
		for (const provider of providers.splice(0)) {
			provider.dispose();
		}
		if (root != null) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	suite('getGitDir', () => {
		/** A worktree inside its own main checkout's working tree: a layout `getGitDir` asks git about */
		function addNestedWorktree(): string {
			const worktree = join(main, 'nested');
			git(main, 'worktree', 'add', '-q', '--detach', worktree);
			assert.ok(lstatSync(join(worktree, '.git')).isFile());
			return worktree;
		}

		test('rejects when git runs past its time limit, keeping nothing, and reads again next time', async () => {
			const worktree = addNestedWorktree();
			let reported = 0;
			const provider = newProvider({ onGitDirResolveFailed: () => reported++ });

			stall(primaryRead);
			await assert.rejects(provider.config.getGitDir(worktree), isTimeout);
			assert.strictEqual(provider.cache.gitDir.get(worktree), undefined);
			assert.strictEqual(reported, 0);

			recover();
			const gitDir = await provider.config.getGitDir(worktree);
			assert.strictEqual(gitDir.uri.fsPath, join(main, '.git', 'worktrees', 'nested'));
			assert.strictEqual(gitDir.commonUri?.fsPath, join(main, '.git'));
			assert.strictEqual(provider.cache.gitDir.get(worktree), gitDir);
		});

		test('rejects when git is killed, keeping nothing, and reads again next time', async () => {
			const worktree = addNestedWorktree();
			const provider = newProvider();

			kill(primaryRead);
			await assert.rejects(provider.config.getGitDir(worktree), GitError);
			assert.strictEqual(provider.cache.gitDir.get(worktree), undefined);

			recover();
			assert.strictEqual(
				(await provider.config.getGitDir(worktree)).uri.fsPath,
				join(main, '.git', 'worktrees', 'nested'),
			);
		});

		test('still answers <path>/.git for a folder git says is not a repository, and keeps it', async () => {
			const outside = join(root, 'outside');
			mkdirSync(outside);
			let reported = 0;
			const provider = newProvider({ onGitDirResolveFailed: () => reported++ });

			const gitDir = await provider.config.getGitDir(outside);
			assert.strictEqual(gitDir.uri.fsPath, join(outside, '.git'));
			assert.strictEqual(provider.cache.gitDir.get(outside), gitDir);
			assert.strictEqual(reported, 1);
		});

		/** A nested worktree stopped on a merge conflict */
		function addStoppedMerge(): string {
			const worktree = addNestedWorktree();
			const identity = ['-c', 'user.name=Test', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false'];
			git(worktree, 'checkout', '-q', '-b', 'topic');
			writeFileSync(join(worktree, 'conflict'), 'topic\n');
			git(worktree, 'add', 'conflict');
			git(worktree, ...identity, 'commit', '-q', '-m', 'topic');
			writeFileSync(join(main, 'conflict'), 'main\n');
			git(main, 'add', 'conflict');
			git(main, ...identity, 'commit', '-q', '-m', 'main');
			// `--no-ff` and no rerere, so a user's own git config can't turn this into anything but a stopped merge
			assert.throws(() => git(worktree, ...identity, '-c', 'rerere.enabled=false', 'merge', '--no-ff', 'main'));
			return worktree;
		}

		test('a paused operation read during a stall answers none without keeping it, and is found once git answers', async () => {
			const worktree = addStoppedMerge();
			const provider = newProvider();

			stall(primaryRead);
			assert.strictEqual(await provider.pausedOps.getPausedOperationStatus(worktree), undefined);

			recover();
			assert.strictEqual((await provider.pausedOps.getPausedOperationStatus(worktree))?.type, 'merge');
		});

		test('a paused operation read of an unreadable git dir answers none without keeping it', async () => {
			const worktree = addStoppedMerge();
			const provider = newProvider();
			const gitDir = await provider.config.getGitDir(worktree);

			provider.cache.gitDir.set(worktree, { uri: fileUri(join(root, 'gone')) });
			assert.strictEqual(await provider.pausedOps.getPausedOperationStatus(worktree), undefined);

			provider.cache.gitDir.set(worktree, gitDir);
			assert.strictEqual((await provider.pausedOps.getPausedOperationStatus(worktree))?.type, 'merge');
		});

		test('the default worktree path answers none during a stall, and is found once git answers', async () => {
			const worktree = addNestedWorktree();
			const provider = newProvider();

			stall(primaryRead);
			assert.strictEqual(await provider.config.getDefaultWorktreePath(worktree), undefined);

			recover();
			assert.strictEqual(await provider.config.getDefaultWorktreePath(worktree), main);
		});

		test('gk config reads report the failure without keeping it, and read the file once git answers', async () => {
			const worktree = addNestedWorktree();
			mkdirSync(join(main, '.git', 'gk'));
			git(main, 'config', '-f', join(main, '.git', 'gk', 'config'), 'branch.main.gk-merge-base', 'develop');
			const provider = newProvider();

			stall(primaryRead);
			assert.strictEqual(await provider.config.getGkConfig(worktree, 'branch.main.gk-merge-base'), undefined);
			await provider.config.setGkConfig(worktree, 'branch.main.gk-merge-base', 'other');

			recover();
			assert.strictEqual(await provider.config.getGkConfig(worktree, 'branch.main.gk-merge-base'), 'develop');
		});
	});

	suite('getRepositoryInfo', () => {
		test('rejects when git runs past its time limit, and answers once it stops', async () => {
			const provider = newProvider();

			stall(primaryRead);
			await assert.rejects(provider.config.getRepositoryInfo(main), isTimeout);

			recover();
			const info = await provider.config.getRepositoryInfo(main);
			assert.ok(!Array.isArray(info));
			assert.strictEqual(info.repoPath, main);
		});

		test('rejects when git is killed', async () => {
			kill(primaryRead);
			await assert.rejects(newProvider().config.getRepositoryInfo(main), GitError);
		});

		test('rejects when a wrapper around git reports it was killed', async () => {
			const worktree = join(main, 'nested');
			git(main, 'worktree', 'add', '-q', '--detach', worktree);
			const provider = newProvider();

			for (const code of [137, 1]) {
				exitWith(code, primaryRead);
				await assert.rejects(provider.config.getGitDir(worktree), GitError);
				assert.strictEqual(provider.cache.gitDir.get(worktree), undefined);
			}

			recover();
			assert.strictEqual(
				(await provider.config.getGitDir(worktree)).uri.fsPath,
				join(main, '.git', 'worktrees', 'nested'),
			);
		});

		test('rejects both of two reads in a row when git cannot be located, rather than hanging the second', async () => {
			const notFound = new Error('git not found');
			const provider = new CliGitProvider({
				context: {
					fs: {
						readFile: () => assert.fail(),
						stat: () => assert.fail(),
						readDirectory: () => assert.fail(),
					},
					config: { commits: {}, graph: { writeCommitGraph: false } },
				},
				locator: () => Promise.reject(notFound),
			});
			providers.push(provider);

			for (let i = 0; i < 2; i++) {
				const outcome = await Promise.race([
					provider.config.getRepositoryInfo(main).then(
						() => 'resolved',
						(ex: unknown) => ex,
					),
					new Promise(resolve => setTimeout(resolve, 2000, 'hung')),
				]);
				assert.strictEqual(outcome, notFound);
			}
		});

		test('still answers [] for a file, even with git not starting', async () => {
			const file = join(root, 'a-file');
			writeFileSync(file, '');
			assert.deepStrictEqual(await newProvider().config.getRepositoryInfo(file), []);

			const notExecutable = join(root, 'not-executable');
			writeFileSync(notExecutable, '', { mode: 0o644 });
			assert.deepStrictEqual(await newProvider({ gitPath: notExecutable }).config.getRepositoryInfo(file), []);
		});

		test('rejects when git cannot start in a folder that exists', async () => {
			const notExecutable = join(root, 'not-executable');
			writeFileSync(notExecutable, '', { mode: 0o644 });

			await assert.rejects(newProvider({ gitPath: notExecutable }).config.getRepositoryInfo(main), GitError);
		});

		test('still answers [] for a folder that does not exist, even with git not starting', async () => {
			const missing = join(root, 'missing');
			assert.deepStrictEqual(await newProvider().config.getRepositoryInfo(missing), []);

			const notExecutable = join(root, 'not-executable');
			writeFileSync(notExecutable, '', { mode: 0o644 });
			assert.deepStrictEqual(await newProvider({ gitPath: notExecutable }).config.getRepositoryInfo(missing), []);
		});

		test('still answers [] for what git itself refuses', async () => {
			const provider = newProvider();

			const outside = join(root, 'outside');
			mkdirSync(outside);
			assert.deepStrictEqual(await provider.config.getRepositoryInfo(outside), [], 'not a repository');

			const invalidGitFile = join(root, 'invalid-git-file');
			mkdirSync(invalidGitFile);
			writeFileSync(join(invalidGitFile, '.git'), 'junk\n');
			assert.deepStrictEqual(await provider.config.getRepositoryInfo(invalidGitFile), [], 'invalid .git file');

			const worktree = join(root, 'worktree');
			git(main, 'worktree', 'add', '-q', '--detach', worktree);
			rmSync(join(main, '.git', 'worktrees', 'worktree'), { recursive: true });
			assert.deepStrictEqual(await provider.config.getRepositoryInfo(worktree), [], 'its git dir is gone');

			const badConfig = initRepo(join(root, 'bad-config'));
			writeFileSync(join(badConfig, '.git', 'config'), '[bad\n', { flag: 'a' });
			assert.deepStrictEqual(await provider.config.getRepositoryInfo(badConfig), [], 'an unreadable config');
		});

		test('rejects, rather than answering for the repository around it, when a bare check gets no answer', async () => {
			const bare = join(main, 'embedded.git');
			git(root, 'clone', '-q', '--bare', main, bare);
			const provider = newProvider();

			for (const read of [isBareRead, gitDirRead]) {
				stall(read);
				await assert.rejects(provider.config.getRepositoryInfo(bare), isTimeout, read);
			}

			recover();
			assert.deepStrictEqual(await provider.config.getRepositoryInfo(bare), [true, bare]);
		});

		test('keeps the exit code when a wrapper reports a bare check was killed', async () => {
			const bare = join(main, 'embedded.git');
			git(root, 'clone', '-q', '--bare', main, bare);

			exitWith(137, isBareRead);
			await assert.rejects(
				newProvider().config.getRepositoryInfo(bare),
				(ex: unknown) => ex instanceof GitError && ex.exitCode === 137,
			);
		});

		test('rejects, rather than calling a .git folder a bare repository, when its working tree gets no answer', async () => {
			git(main, 'config', '--unset', 'core.bare');
			const dotGit = join(main, '.git');
			const provider = newProvider();

			stall(workTreeRead);
			await assert.rejects(provider.config.getRepositoryInfo(dotGit), isTimeout);

			recover();
			const info = await provider.config.getRepositoryInfo(dotGit);
			assert.ok(!Array.isArray(info));
			assert.strictEqual(info.repoPath, main);
		});

		suite('rev_parse__show_toplevel', () => {
			test('rejects, rather than answering for the repository around it, when a bare check gets no answer', async () => {
				const bare = join(main, 'embedded.git');
				git(root, 'clone', '-q', '--bare', main, bare);
				const provider = newProvider();

				for (const read of [isBareRead, gitDirRead]) {
					stall(read);
					await assert.rejects(provider.git.rev_parse__show_toplevel(bare), isTimeout, read);
				}

				recover();
				assert.deepStrictEqual(await provider.git.rev_parse__show_toplevel(bare), [true, bare]);
			});

			test('rejects when git is killed or cannot start in a folder that exists', async () => {
				kill('--show-toplevel');
				await assert.rejects(newProvider().git.rev_parse__show_toplevel(main), GitError);
				recover();

				const notExecutable = join(root, 'not-executable');
				writeFileSync(notExecutable, '', { mode: 0o644 });
				await assert.rejects(
					newProvider({ gitPath: notExecutable }).git.rev_parse__show_toplevel(main),
					GitError,
				);
			});

			test('still answers [] for what git itself refuses and for a file', async () => {
				const outside = join(root, 'outside');
				mkdirSync(outside);
				const provider = newProvider();
				assert.deepStrictEqual(await provider.git.rev_parse__show_toplevel(outside), []);

				const file = join(outside, 'a-file');
				writeFileSync(file, '');
				assert.deepStrictEqual(await provider.git.rev_parse__show_toplevel(file), []);
			});

			test('still walks up from a folder that does not exist', async () => {
				const missing = join(main, 'missing');
				assert.deepStrictEqual(await newProvider().git.rev_parse__show_toplevel(missing), [true, main]);
			});
		});

		suite('in an untrusted workspace', () => {
			test('answers [] without asking git', async () => {
				stall('rev-parse');

				assert.deepStrictEqual(await newProvider({ isTrusted: false }).config.getRepositoryInfo(main), []);
			});

			/** A host's own `Git` runs without the workspace's trust check, so the bare clone check itself decides */
			function newUntrustedProvider(gitPath: string): CliGitProvider {
				const provider = new CliGitProvider({
					context: {
						fs: {
							readFile: () => assert.fail(),
							stat: () => assert.fail(),
							readDirectory: () => assert.fail(),
						},
						workspace: { isTrusted: false, getFolder: () => undefined },
						config: { commits: {}, graph: { writeCommitGraph: false } },
					},
					locator: () => assert.fail(),
					git: new Git(async () => ({ ...(await findGitPath(null)), path: gitPath }), {
						gitTimeout: noAnswerTimeout,
					}),
				});
				providers.push(provider);
				return provider;
			}

			function addBareClone(): string {
				const bare = join(root, 'bare.git');
				git(root, 'clone', '-q', '--bare', main, bare);
				return bare;
			}

			test('rejects, rather than skipping the bare clone check, when git runs past its time limit', async () => {
				const bare = addBareClone();
				const provider = newUntrustedProvider(script);

				stall('--show-cdup');
				await assert.rejects(provider.config.getRepositoryInfo(bare), isTimeout);

				recover();
				assert.deepStrictEqual(await provider.config.getRepositoryInfo(bare), []);
			});

			test('rejects, rather than skipping the bare clone check, when git is killed', async () => {
				const bare = addBareClone();
				const provider = newUntrustedProvider(script);

				kill('--show-cdup');
				await assert.rejects(provider.config.getRepositoryInfo(bare), GitError);

				recover();
				assert.deepStrictEqual(await provider.config.getRepositoryInfo(bare), []);
			});

			test('rejects, rather than skipping the bare clone check, when git cannot start', async () => {
				const bare = addBareClone();
				const notExecutable = join(root, 'not-executable');
				writeFileSync(notExecutable, '', { mode: 0o644 });

				await assert.rejects(newUntrustedProvider(notExecutable).config.getRepositoryInfo(bare), GitError);
			});

			test('goes on when the folder has no HEAD, as a bare clone would', async () => {
				const provider = newUntrustedProvider(script);

				const info = await provider.config.getRepositoryInfo(main);
				assert.ok(!Array.isArray(info));
				assert.strictEqual(info.repoPath, main);
			});
		});
	});
});
