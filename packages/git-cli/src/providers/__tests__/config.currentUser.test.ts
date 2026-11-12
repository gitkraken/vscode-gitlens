import * as assert from 'assert';
import { createRequire, syncBuiltinESMExports } from 'module';
import type * as osModule from 'os';
import { env as process_env } from 'process';
import * as sinon from 'sinon';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitUser } from '@gitlens/git/models/user.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { ConfigGitSubProvider } from '../config.js';

/** A read held open until the test settles it, which signals once it has been started */
function holdRead<T>(): { started: Promise<void>; start: () => Promise<T>; settle: (value: T) => void } {
	let markStarted!: () => void;
	const started = new Promise<void>(resolve => {
		markStarted = resolve;
	});
	let settle!: (value: T) => void;
	const result = new Promise<T>(resolve => {
		settle = resolve;
	});
	return {
		started: started,
		start: () => {
			markStarted();
			return result;
		},
		settle: settle,
	};
}

function exited(stdout: string): GitResult {
	return { stdout: stdout, stderr: undefined, exitCode: 0, completion: { status: 'exited', code: 0 } };
}

function configOf(user: GitUser): Map<string, string> {
	return new Map([
		['user.name', user.name!],
		['user.email', user.email!],
	]);
}

/** The `os` module object the named `os` imports re-sync from (see `syncBuiltinESMExports`) */
const os = createRequire(import.meta.url)('os') as typeof osModule;

const userEnvKeys = ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL', 'EMAIL'];

/**
 * The repository's user changes while `getCurrentUser` is reading it. The read that started before the change answers
 * what it read to its own caller, but must not leave that answer cached for the path.
 */
suite('ConfigGitSubProvider.getCurrentUser across a drop', () => {
	const repoPath = '/repos/a';
	const oldUser: GitUser = { name: 'Old User', email: 'old@example.com' };
	const newUser: GitUser = { name: 'New User', email: 'new@example.com' };

	let cache: Cache;
	let provider: ConfigGitSubProvider;
	let run: sinon.SinonStub<[options: unknown, ...args: string[]], Promise<GitResult>>;
	let getConfigRegex: sinon.SinonStub<
		[repoPath: string | undefined, pattern: string, options?: { global?: boolean; runGitLocally?: boolean }],
		Promise<Map<string, string>>
	>;

	setup(() => {
		cache = new Cache();
		run = sinon.stub<[options: unknown, ...args: string[]], Promise<GitResult>>();
		run.callsFake((_options, ...args) => Promise.resolve(exited(args.at(-1) ?? '')));
		provider = new ConfigGitSubProvider(
			{ hooks: {} } as unknown as GitServiceContext,
			{ run: run } as unknown as Git,
			cache,
			{} as unknown as CliGitProviderInternal,
		);
		getConfigRegex = sinon.stub(provider, 'getConfigRegex');
		getConfigRegex.resolves(configOf(newUser));
	});

	teardown(() => {
		sinon.restore();
		cache.dispose();
	});

	const drops = [
		['a config clear', (cache: Cache) => cache.clearCaches(repoPath, 'config')],
		['a full clear', (cache: Cache) => cache.clearCaches(undefined)],
		['unregistering the path', (cache: Cache) => cache.unregisterRepoPath(repoPath)],
		['a reset', (cache: Cache) => cache.reset()],
	] as const;

	async function readConfigAcross(drop: (cache: Cache) => void): Promise<void> {
		const read = holdRead<Map<string, string>>();
		getConfigRegex.onFirstCall().callsFake(read.start);

		const inFlight = provider.getCurrentUser(repoPath);
		await read.started;
		drop(cache);
		read.settle(configOf(oldUser));

		assert.deepStrictEqual(await inFlight, oldUser, 'the read answers its own caller');
		assert.strictEqual(cache.currentUser.get(repoPath), undefined);

		assert.deepStrictEqual(await provider.getCurrentUser(repoPath), newUser);
		assert.strictEqual(getConfigRegex.callCount, 2);
	}

	async function checkMailmapAcross(drop: (cache: Cache) => void): Promise<void> {
		getConfigRegex.onFirstCall().resolves(configOf(oldUser));
		const check = holdRead<GitResult>();
		run.onFirstCall().callsFake(check.start);

		const inFlight = provider.getCurrentUser(repoPath);
		await check.started;
		drop(cache);
		check.settle(exited(`${oldUser.name} <${oldUser.email}>`));

		assert.deepStrictEqual(await inFlight, oldUser, 'the read answers its own caller');
		assert.strictEqual(cache.currentUser.get(repoPath), undefined);

		assert.deepStrictEqual(await provider.getCurrentUser(repoPath), newUser);
	}

	suite('while the config is read', () => {
		for (const [name, drop] of drops) {
			test(`${name} mid-read leaves no user cached, and the next read answers the new user`, () =>
				readConfigAcross(drop));
		}

		test('a config clear of another path mid-read still caches the user', async () => {
			const read = holdRead<Map<string, string>>();
			getConfigRegex.onFirstCall().callsFake(read.start);

			const inFlight = provider.getCurrentUser(repoPath);
			await read.started;
			cache.clearCaches('/repos/b', 'config');
			read.settle(configOf(oldUser));
			await inFlight;

			assert.deepStrictEqual(cache.currentUser.get(repoPath), oldUser);
		});

		test('a config clear mid-read leaves no failed read cached', async () => {
			const read = holdRead<Map<string, string>>();
			getConfigRegex.onFirstCall().callsFake(async () => {
				await read.start();
				throw new Error('config read failed');
			});

			const inFlight = provider.getCurrentUser(repoPath);
			await read.started;
			cache.clearCaches(repoPath, 'config');
			read.settle(new Map());

			assert.strictEqual(await inFlight, undefined, 'the read answers its own caller');
			assert.strictEqual(cache.currentUser.get(repoPath), undefined);

			assert.deepStrictEqual(await provider.getCurrentUser(repoPath), newUser);
		});

		suite('with no user configured anywhere', () => {
			let savedEnv: Record<string, string | undefined>;

			setup(() => {
				savedEnv = Object.fromEntries(userEnvKeys.map(k => [k, process_env[k]]));
				for (const key of userEnvKeys) {
					Reflect.deleteProperty(process_env, key);
				}
				sinon.stub(os, 'userInfo').returns({ username: '' } as osModule.UserInfo<string>);
				syncBuiltinESMExports();
			});

			teardown(() => {
				sinon.restore();
				syncBuiltinESMExports();
				for (const [key, value] of Object.entries(savedEnv)) {
					if (value == null) {
						Reflect.deleteProperty(process_env, key);
					} else {
						process_env[key] = value;
					}
				}
			});

			test('a config clear mid-read leaves no "no user" cached, and the next read answers the new user', async () => {
				const read = holdRead<Map<string, string>>();
				getConfigRegex.onFirstCall().callsFake(read.start);

				const inFlight = provider.getCurrentUser(repoPath);
				await read.started;
				cache.clearCaches(repoPath, 'config');
				read.settle(new Map());

				assert.strictEqual(await inFlight, undefined, 'the read answers its own caller');
				assert.strictEqual(cache.currentUser.get(repoPath), undefined);

				assert.deepStrictEqual(await provider.getCurrentUser(repoPath), newUser);
			});

			test('a read with no drop caches "no user"', async () => {
				getConfigRegex.resolves(new Map());

				assert.strictEqual(await provider.getCurrentUser(repoPath), undefined);
				assert.strictEqual(cache.currentUser.get(repoPath), null);
			});
		});
	});

	suite('while the mailmap is checked', () => {
		for (const [name, drop] of drops) {
			test(`${name} mid-check leaves no user cached, and the next read answers the new user`, () =>
				checkMailmapAcross(drop));
		}
	});

	test('a call after a config clear mid-read answers the new user rather than joining the read', async () => {
		const read = holdRead<Map<string, string>>();
		getConfigRegex.onFirstCall().callsFake(read.start);

		const beforeClear = provider.getCurrentUser(repoPath);
		await read.started;
		cache.clearCaches(repoPath, 'config');
		const afterClear = provider.getCurrentUser(repoPath);
		read.settle(configOf(oldUser));

		assert.deepStrictEqual(await beforeClear, oldUser, 'the read answers its own caller');
		assert.deepStrictEqual(await afterClear, newUser);
		assert.deepStrictEqual(cache.currentUser.get(repoPath), newUser);
		assert.strictEqual(getConfigRegex.callCount, 2);
	});

	test('calls with no drop between them share one read', async () => {
		const read = holdRead<Map<string, string>>();
		getConfigRegex.onFirstCall().callsFake(read.start);

		const first = provider.getCurrentUser(repoPath);
		await read.started;
		const second = provider.getCurrentUser(repoPath);
		read.settle(configOf(oldUser));

		assert.deepStrictEqual(await first, oldUser);
		assert.deepStrictEqual(await second, oldUser);
		assert.strictEqual(getConfigRegex.callCount, 1);
	});

	test("calls split by a drop of another path's user share one read", async () => {
		const read = holdRead<Map<string, string>>();
		getConfigRegex.onFirstCall().callsFake(read.start);

		const first = provider.getCurrentUser(repoPath);
		await read.started;
		cache.clearCaches('/repos/b', 'config');
		const second = provider.getCurrentUser(repoPath);
		read.settle(configOf(oldUser));

		assert.deepStrictEqual(await first, oldUser);
		assert.deepStrictEqual(await second, oldUser);
		assert.strictEqual(getConfigRegex.callCount, 1);
	});

	test('a cached user is read only after the read validator applied what changed', async () => {
		cache.currentUser.set(repoPath, oldUser);
		cache.setReadValidator(() =>
			Promise.resolve().then(() => {
				cache.clearCaches(repoPath, 'config');
			}),
		);

		assert.deepStrictEqual(await provider.getCurrentUser(repoPath), newUser);
		assert.strictEqual(getConfigRegex.callCount, 1);
	});

	test('a read with no drop caches the user', async () => {
		assert.deepStrictEqual(await provider.getCurrentUser(repoPath), newUser);
		assert.deepStrictEqual(cache.currentUser.get(repoPath), newUser);

		assert.deepStrictEqual(await provider.getCurrentUser(repoPath), newUser);
		assert.strictEqual(getConfigRegex.callCount, 1);
	});
});
