import * as assert from 'node:assert';
// Imported for its side effect, FIRST and deliberately — see agentStatusService.test.ts: letting
// container initialize first breaks the decorator-registry import cycle.
import '../../container.js';
import { Uri } from 'vscode';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import { VisitedPathsTrie } from '@gitlens/utils/trie.js';
import { GitProviderService } from '../gitProviderService.js';
import { GitRepositoryService } from '../gitRepositoryService.js';

const noAnswer = new CancellationError(undefined, 'timeout');

// Exercised against a minimal fake `this`, since constructing either service needs a real Container. That couples these
// tests to private member names, which a rename breaks noisily.
suite('GitProviderService.getOrAddRepository when git gives no answer', () => {
	const uri = Uri.file('/gitlens-test-does-not-exist/bare.git');
	const gitDir = { uri: uri };
	const repository = { id: uri.toString(), opened: false };
	const getOrAdd = GitProviderService.prototype.getOrAddRepository as (
		this: unknown,
		uri: Uri,
		options: { opened: boolean; detectNested: boolean },
	) => Promise<unknown>;

	/** Runs a call with no answer from `read`, then one with an answer */
	async function assertAddsNothingAndFindsItNextTime(read: 'findRepositoryUri' | 'getGitDir'): Promise<void> {
		let answers = false;
		const unlessAnswers = <T>(which: typeof read, value: T) =>
			read === which && !answers ? Promise.reject(noAnswer) : Promise.resolve(value);

		const added: unknown[] = [];
		const pending = new Map<string, unknown>();
		const searched = new VisitedPathsTrie();
		const fakeThis = {
			_discoveringRepositories: undefined,
			_gitService: {
				forRepo: () => ({ config: { getGitDir: () => unlessAnswers('getGitDir', gitDir) } }),
			},
			_pendingRepositories: pending,
			_repositories: {
				count: 0,
				add: (r: unknown) => added.push(r),
				get: () => undefined,
			},
			_searchedRepositoryPaths: searched,
			allHaveKnownCommonRepo: () => false,
			getProvider: () => ({
				provider: {
					addRepository: (_folder: unknown, _uri: Uri, g: unknown) => {
						assert.strictEqual(g, gitDir);
						return [repository];
					},
					findRepositoryUri: () => unlessAnswers('findRepositoryUri', uri),
				},
			}),
			getRepository: () => undefined,
			updateContext: () => {},
		};

		assert.strictEqual(await getOrAdd.call(fakeThis, uri, { opened: false, detectNested: true }), undefined);
		assert.strictEqual(added.length, 0);
		assert.strictEqual(pending.size, 0);
		assert.strictEqual(searched.has(uri.fsPath), false);

		answers = true;
		assert.strictEqual(await getOrAdd.call(fakeThis, uri, { opened: false, detectNested: true }), repository);
		assert.deepStrictEqual(added, [repository]);
	}

	test('adds nothing, keeps nothing and finds the repository next time when looking for it gets no answer', () =>
		assertAddsNothingAndFindsItNextTime('findRepositoryUri'));

	test('adds nothing, keeps nothing and finds the repository next time when its git dir gets no answer', () =>
		assertAddsNothingAndFindsItNextTime('getGitDir'));
});

suite('GitRepositoryService.watch when git gives no answer', () => {
	test('resolves with no watch, as it does with no git dir, rather than rejecting', async () => {
		const fakeThis = { config: { getGitDir: () => Promise.reject(noAnswer) } };
		const watch = GitRepositoryService.prototype.watch as (this: unknown) => Promise<unknown>;

		assert.strictEqual(await watch.call(fakeThis), undefined);
	});
});
