import * as assert from 'node:assert';
// Imported for its side effect, FIRST and deliberately — see agentStatusService.test.ts: letting
// container initialize first breaks the decorator-registry import cycle.
import '../../../../container.js';
import { Uri } from 'vscode';
import { GitError } from '@gitlens/git-cli/exec/git.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import { GlCliGitProvider } from '../cliGitProvider.js';

type ScmSearch = (folderUri: Uri, silent?: boolean) => Promise<unknown[]>;

// Exercised against a minimal fake `this`, since constructing the provider needs a real Container. That couples these
// tests to private member names, which a rename breaks noisily.
suite('GlCliGitProvider discovery', () => {
	test('a repository whose git dir gets no answer is skipped, without failing the rest of the search', async () => {
		const folder = Uri.file('/workspace');
		const stalled = Uri.file('/workspace/stalled');
		const healthy = Uri.file('/workspace/healthy');
		const gitDir = { uri: Uri.file('/workspace/healthy/.git') };
		const added: Uri[] = [];

		const prototype = GlCliGitProvider.prototype as unknown as {
			addDiscoveredRepository: unknown;
			scmRepositorySearch: ScmSearch;
		};
		const fakeThis = {
			addDiscoveredRepository: prototype.addDiscoveredRepository,
			addRepository: (_folder: unknown, uri: Uri) => {
				added.push(uri);
				return [{ id: uri.toString(), uri: uri }];
			},
			cache: { trackedPaths: { clear: () => {} } },
			container: { git: { getRepository: () => undefined } },
			ensureGit: () => Promise.resolve(),
			getScmGitApi: () =>
				Promise.resolve({
					state: 'initialized',
					repositories: [{ rootUri: stalled }, { rootUri: healthy }],
				}),
			provider: {
				config: {
					getGitDir: (path: string) =>
						path === stalled.fsPath
							? Promise.reject(new CancellationError(undefined, 'timeout'))
							: Promise.resolve(gitDir),
				},
			},
			whenScmRepositoriesInitialized: () => Promise.resolve(),
		};

		const repositories = await prototype.scmRepositorySearch.call(fakeThis, folder);

		assert.strictEqual(repositories.length, 1);
		assert.deepStrictEqual(
			added.map(u => u.fsPath),
			[healthy.fsPath],
		);
	});

	test('a folder whose repository lookup gets no answer is skipped, without failing the rest of the search', async () => {
		const folder = Uri.file('/workspace');
		const stalled = Uri.file('/workspace/stalled');
		const healthy = Uri.file('/workspace/healthy');
		const added: string[] = [];

		const prototype = GlCliGitProvider.prototype as unknown as {
			findDiscoverableRepositoryUri: unknown;
			repositorySearch: (folderOrUri: Uri, depth?: number) => Promise<unknown[]>;
		};
		const fakeThis = {
			addDiscoveredRepository: (uri: Uri) => {
				added.push(uri.fsPath);
				return [{ id: uri.toString() }];
			},
			findDiscoverableRepositoryUri: prototype.findDiscoverableRepositoryUri,
			findRepositoryUri: (uri: Uri) => {
				if (uri.fsPath === healthy.fsPath) return Promise.resolve(healthy);

				return Promise.reject(new CancellationError(undefined, 'timeout'));
			},
			repositorySearchCore: () => Promise.resolve([`${stalled.fsPath}/.git`, `${healthy.fsPath}/.git`]),
			toCanonicalMap: new Map(),
		};

		const repositories = await prototype.repositorySearch.call(fakeThis, folder, 1);

		assert.strictEqual(repositories.length, 1);
		assert.deepStrictEqual(added, [healthy.fsPath]);
	});

	suite('findRepositoryUri', () => {
		const findRepositoryUri = GlCliGitProvider.prototype.findRepositoryUri;

		function fakeThisReading(getRepositoryInfo: () => Promise<unknown>): unknown {
			return { provider: { config: { getRepositoryInfo: getRepositoryInfo } }, unsafePaths: new Set<string>() };
		}

		test('rejects, rather than answering no repository, when git gives no answer', async () => {
			const uri = Uri.file('/gitlens-test-does-not-exist');
			for (const noAnswer of [
				new CancellationError(undefined, 'timeout'),
				new GitError(new Error('terminated')),
			]) {
				await assert.rejects(
					findRepositoryUri.call(
						fakeThisReading(() => Promise.reject(noAnswer)),
						uri,
						true,
					),
					(ex: unknown) => ex === noAnswer,
				);
			}
		});

		test('answers no repository for any other failure', async () => {
			const fakeThis = fakeThisReading(() => Promise.reject(new Error('unrelated')));
			assert.strictEqual(
				await findRepositoryUri.call(fakeThis, Uri.file('/gitlens-test-does-not-exist'), true),
				undefined,
			);
		});
	});
});
