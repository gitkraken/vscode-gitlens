import * as assert from 'assert';
import * as sinon from 'sinon';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { ReferenceUpdateErrorReason } from '@gitlens/git/errors.js';
import { ReferenceUpdateError } from '@gitlens/git/errors.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { GitError } from '../../exec/git.js';
import { RefsGitSubProvider } from '../refs.js';

const recordSep = '\x1E';
const fieldSep = '\x1D';

// Unified RefRecord fields, in mapping declaration order:
// current, name, objectname, peeledObjectname, upstream, upstreamTracking,
// committerDate, creatorDate, authorDate, subject
function buildRefRecord(opts: { name: string; sha: string; peeled?: string }): string {
	const fields = [
		'', // current
		opts.name, // name (refname)
		opts.sha, // objectname
		opts.peeled ?? '', // peeledObjectname
		'', // upstream
		'', // upstreamTracking
		'', // committerDate
		'', // creatorDate
		'', // authorDate
		'', // subject
	];
	return fields.join(fieldSep) + fieldSep;
}

function buildRefRecords(records: { name: string; sha: string; peeled?: string }[]): string {
	return records.map(r => recordSep + buildRefRecord(r)).join('');
}

suite('RefsGitSubProvider Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let refsProvider: RefsGitSubProvider;
	let gitStub: sinon.SinonStubbedInstance<Git>;
	let onReset: sinon.SinonSpy;
	let onChanged: sinon.SinonSpy;
	let cachedRefTips: sinon.SinonSpy;

	function createGitResult(stdout: string): GitResult {
		return {
			stdout: stdout,
			stderr: undefined,
			exitCode: 0,
			completion: { status: 'exited', code: 0 },
		};
	}

	setup(() => {
		sandbox = sinon.createSandbox();

		class MockGit {
			supported(_feature: string) {
				return Promise.resolve([]);
			}
			supports(_feature: string) {
				return Promise.resolve(true);
			}
			run(..._args: any[]) {
				return Promise.resolve(createGitResult(''));
			}
			async *stream(..._args: any[]): AsyncGenerator<string> {
				// Default: empty stream. Tests override with `.callsFake(...)`.
			}
		}

		gitStub = sandbox.createStubInstance(MockGit) as unknown as sinon.SinonStubbedInstance<Git>;
		(gitStub.supported as sinon.SinonStub).resolves([]);

		onReset = sinon.spy();
		onChanged = sinon.spy();
		const context = {
			hooks: { cache: { onReset: onReset }, repository: { onChanged: onChanged } },
		} as unknown as GitServiceContext;

		cachedRefTips = sinon.spy(
			(
				repoPath: string,
				factory: (
					commonPath: string,
					cacheable: { invalidate: () => void },
					cancellation?: AbortSignal,
				) => Promise<unknown>,
				cancellation?: AbortSignal,
			) => factory(repoPath, { invalidate: () => {} }, cancellation),
		);

		// Pass-through cache: invoke the factory directly with no caching.
		const cache = {
			getRefs: (
				repoPath: string,
				factory: (
					commonPath: string,
					cacheable: { invalidate: () => void },
					cancellation?: AbortSignal,
				) => Promise<unknown>,
				cancellation?: AbortSignal,
			) => factory(repoPath, { invalidate: () => {} }, cancellation),
			getRefTips: cachedRefTips,
			getCommonPath: (repoPath: string) => repoPath,
		} as unknown as Cache;
		// A local-branch delete drops GitLens's per-branch state
		const provider = {
			branches: { forgetDeletedBranch: () => Promise.resolve() },
		} as unknown as CliGitProviderInternal;

		refsProvider = new RefsGitSubProvider(context, gitStub, cache, provider);
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('getReflogEntries', () => {
		test('formats only the fields it reads, and maps them to sha and message', async () => {
			gitStub.run.resolves(
				createGitResult(
					`${recordSep}${['aaa1', 'branch: Created from main'].join(fieldSep)}${fieldSep}` +
						`${recordSep}${['bbb2', 'commit: second'].join(fieldSep)}${fieldSep}`,
				),
			);

			const entries = await refsProvider.getReflogEntries('/repo', 'refs/heads/topic');

			const format =
				(gitStub.run.getCall(0).args.slice(1) as string[]).find(a => a.startsWith('--format=')) ?? '';
			assert.ok(format.includes('%H') && format.includes('%gs'), 'sanity: the sha and subject are formatted');
			assert.ok(!format.includes('%gD'), 'the reflog selector is never read, so it is never formatted');
			assert.deepStrictEqual(entries, [
				{ sha: 'aaa1', message: 'branch: Created from main' },
				{ sha: 'bbb2', message: 'commit: second' },
			]);
		});
	});

	suite('getRefTips', () => {
		const repoPath = '/repo';

		function stubForEachRef(records: { name: string; sha: string; peeled?: string }[]) {
			gitStub.run
				.withArgs(sinon.match.has('cwd', repoPath), 'for-each-ref')
				.resolves(createGitResult(buildRefRecords(records)));
		}

		test('parses heads, remotes, and tags', async () => {
			stubForEachRef([
				{ name: 'refs/heads/main', sha: 'aaa1111111111111111111111111111111111111' },
				{ name: 'refs/heads/feature/foo', sha: 'bbb2222222222222222222222222222222222222' },
				{ name: 'refs/remotes/origin/main', sha: 'ccc3333333333333333333333333333333333333' },
				{ name: 'refs/tags/lightweight', sha: 'ddd4444444444444444444444444444444444444' },
			]);

			const refs = await refsProvider.getRefTips(repoPath);

			assert.deepStrictEqual(refs, [
				{
					type: 'branch',
					name: 'main',
					fullName: 'refs/heads/main',
					sha: 'aaa1111111111111111111111111111111111111',
				},
				{
					type: 'branch',
					name: 'feature/foo',
					fullName: 'refs/heads/feature/foo',
					sha: 'bbb2222222222222222222222222222222222222',
				},
				{
					type: 'remote',
					name: 'origin/main',
					fullName: 'refs/remotes/origin/main',
					sha: 'ccc3333333333333333333333333333333333333',
				},
				{
					type: 'tag',
					name: 'lightweight',
					fullName: 'refs/tags/lightweight',
					sha: 'ddd4444444444444444444444444444444444444',
				},
			]);
		});

		test('annotated tags peel to the commit SHA', async () => {
			stubForEachRef([
				{
					name: 'refs/tags/v1.0.0',
					sha: 'eee5555555555555555555555555555555555555', // tag-object SHA
					peeled: 'fff6666666666666666666666666666666666666', // commit SHA
				},
			]);

			const [tag] = await refsProvider.getRefTips(repoPath);

			assert.strictEqual(tag.type, 'tag');
			assert.strictEqual(tag.name, 'v1.0.0');
			assert.strictEqual(tag.sha, 'fff6666666666666666666666666666666666666');
		});

		test('skips refs/remotes/<remote>/HEAD', async () => {
			stubForEachRef([
				{ name: 'refs/remotes/origin/HEAD', sha: 'aaa1111111111111111111111111111111111111' },
				{ name: 'refs/remotes/origin/main', sha: 'bbb2222222222222222222222222222222222222' },
			]);

			const refs = await refsProvider.getRefTips(repoPath);

			assert.strictEqual(refs.length, 1);
			assert.strictEqual(refs[0].name, 'origin/main');
		});

		test('returns [] for empty output', async () => {
			gitStub.run.withArgs(sinon.match.has('cwd', repoPath), 'for-each-ref').resolves(createGitResult(''));
			const refs = await refsProvider.getRefTips(repoPath);
			assert.deepStrictEqual(refs, []);
		});

		test('options.include filters the cached full result', async () => {
			stubForEachRef([
				{ name: 'refs/heads/main', sha: 'aaa1111111111111111111111111111111111111' },
				{ name: 'refs/remotes/origin/main', sha: 'bbb2222222222222222222222222222222222222' },
				{ name: 'refs/tags/v1', sha: 'ccc3333333333333333333333333333333333333' },
			]);

			const onlyHeads = await refsProvider.getRefTips(repoPath, { include: ['heads'] });
			assert.strictEqual(onlyHeads.length, 1);
			assert.strictEqual(onlyHeads[0].type, 'branch');

			const tagsAndRemotes = await refsProvider.getRefTips(repoPath, { include: ['tags', 'remotes'] });
			assert.deepStrictEqual(tagsAndRemotes.map(r => r.type).sort(), ['remote', 'tag']);
		});
	});

	suite('getRefsContainingShas', () => {
		const repoPath = '/repo';

		// 40-char SHAs (real-looking) for the fixture DAG. Reuse across tests.
		const A = 'a000000000000000000000000000000000000000'; // main tip
		const F = 'f000000000000000000000000000000000000000'; // feature tip
		const B = 'b000000000000000000000000000000000000000';
		const C = 'c000000000000000000000000000000000000000';
		const D = 'd000000000000000000000000000000000000000';

		function stubForEachRef(records: { name: string; sha: string; peeled?: string }[]) {
			gitStub.run
				.withArgs(sinon.match.has('cwd', repoPath), 'for-each-ref')
				.resolves(createGitResult(buildRefRecords(records)));
		}

		function stubRevList(lines: string[]) {
			// Single chunk containing the full output — exercises the same line splitter as multi-chunk.
			(gitStub.stream as sinon.SinonStub)
				.withArgs(sinon.match.has('cwd', repoPath), 'rev-list')
				.callsFake(async function* () {
					yield lines.join('\n');
				});
		}

		test('propagates refs from multiple tips down to ancestors', async () => {
			stubForEachRef([
				{ name: 'refs/heads/main', sha: A },
				{ name: 'refs/heads/feature', sha: F },
			]);
			stubRevList([
				// `<sha> <parents...>` in topo order (children before parents)
				`${A} ${B}`,
				`${F} ${B}`,
				`${B} ${C}`,
				`${C} ${D}`,
				D, // no parents output — excluded by ^D^@
			]);

			const result = await refsProvider.getRefsContainingShas(repoPath, [C, D], D);

			const cRefs = result.get(C);
			assert.ok(cRefs, 'C should have refs');
			assert.deepStrictEqual(cRefs.map(r => r.name).sort(), ['feature', 'main']);

			const dRefs = result.get(D);
			assert.ok(dRefs, 'D should have refs');
			assert.deepStrictEqual(dRefs.map(r => r.name).sort(), ['feature', 'main']);
		});

		test('tag on an internal commit attributes that commit and its ancestors only', async () => {
			// `T` is a tag pointing at B. `feature` is on its own branch from B.
			stubForEachRef([
				{ name: 'refs/heads/main', sha: A },
				{ name: 'refs/tags/v1', sha: B },
				{ name: 'refs/heads/feature', sha: F },
			]);
			stubRevList([
				`${A} ${B}`,
				`${F} ${C}`, // feature descends through a different parent — does NOT contain B
				`${B} ${D}`,
				`${C} ${D}`,
				D,
			]);

			const result = await refsProvider.getRefsContainingShas(repoPath, [B, C, D], D);

			// B contains: main (via A→B), v1 (tag on B itself). NOT feature (feature descends through C, not B).
			const bRefs = result.get(B);
			assert.ok(bRefs);
			assert.deepStrictEqual(bRefs.map(r => r.name).sort(), ['main', 'v1']);

			// C contains: feature only (main goes A→B→D, skipping C).
			const cRefs = result.get(C);
			assert.deepStrictEqual(cRefs?.map(r => r.name).sort(), ['feature']);

			// D contains everything (root of bounded subgraph).
			const dRefs = result.get(D);
			assert.deepStrictEqual(dRefs?.map(r => r.name).sort(), ['feature', 'main', 'v1']);
		});

		test('sorts refs: branch < remote < tag, tags by version desc', async () => {
			stubForEachRef([
				{ name: 'refs/tags/v1.0.0', sha: A },
				{ name: 'refs/tags/v2.0.0', sha: A },
				{ name: 'refs/remotes/origin/main', sha: A },
				{ name: 'refs/heads/main', sha: A },
			]);
			stubRevList([A]); // A is its own oldest — single-commit subgraph

			const result = await refsProvider.getRefsContainingShas(repoPath, [A], A);

			const refs = result.get(A);
			assert.ok(refs);
			// Local branch first, then remote, then tags by version desc.
			assert.deepStrictEqual(
				refs.map(r => `${r.type}:${r.name}`),
				['branch:main', 'remote:origin/main', 'tag:v2.0.0', 'tag:v1.0.0'],
			);
		});

		test('orphaned target (unreachable from any ref) is omitted from result', async () => {
			stubForEachRef([{ name: 'refs/heads/main', sha: A }]);
			// `A` does NOT reach `D` in this scenario.
			stubRevList([`${A} ${B}`, B]);

			const result = await refsProvider.getRefsContainingShas(repoPath, [D], D);

			assert.strictEqual(result.size, 0);
		});

		test('empty shas → empty map without spawning', async () => {
			const result = await refsProvider.getRefsContainingShas(repoPath, [], D);
			assert.strictEqual(result.size, 0);
			sinon.assert.notCalled(gitStub.run);
			sinon.assert.notCalled(gitStub.stream as sinon.SinonStub);
		});

		test('multiple refs sharing a tip all attach', async () => {
			// Local branch and its remote-tracking counterpart at the same tip.
			stubForEachRef([
				{ name: 'refs/heads/main', sha: A },
				{ name: 'refs/remotes/origin/main', sha: A },
			]);
			stubRevList([A]);

			const result = await refsProvider.getRefsContainingShas(repoPath, [A], A);

			const refs = result.get(A);
			assert.ok(refs);
			assert.strictEqual(refs.length, 2);
			assert.deepStrictEqual(refs.map(r => r.fullName).sort(), ['refs/heads/main', 'refs/remotes/origin/main']);
		});
	});

	suite('ref mutations', () => {
		const repoPath = '/repo';
		const sha = 'aaa1111111111111111111111111111111111111';
		const other = 'bbb2222222222222222222222222222222222222';

		setup(() => {
			// A local-branch delete first asks git which branches its worktrees have checked out — none, here
			gitStub.run.withArgs(sinon.match.any, 'worktree', 'list', '--porcelain').resolves(createGitResult(''));
		});

		/** The argv of the single `git` invocation a mutation makes, minus the run options. */
		function argv(): unknown[] {
			return gitStub.run.getCall(0).args.slice(1);
		}

		/** A rejection shaped like a real failed run, carrying `text` as the error git reported. */
		function failWith(text: string): void {
			gitStub.run.rejects(new GitError(new Error(text)));
		}

		suite('argv', () => {
			test('a plain update passes no old value', async () => {
				await refsProvider.updateReference(repoPath, 'refs/kepler/mark', sha);

				assert.deepStrictEqual(argv(), ['update-ref', 'refs/kepler/mark', sha]);
			});

			test('an expected sha becomes git own compare-and-swap old value', async () => {
				await refsProvider.updateReference(repoPath, 'refs/kepler/mark', sha, { expected: other });

				assert.deepStrictEqual(argv(), ['update-ref', 'refs/kepler/mark', sha, other]);
			});

			test("'absent' becomes a literal empty old value", async () => {
				await refsProvider.updateReference(repoPath, 'refs/kepler/mark', sha, { expected: 'absent' });

				// The empty string IS the create-only contract — git reads it as "the ref must not exist".
				// Were it dropped on its way to argv the call would silently become an unconditional
				// overwrite, which no assertion on the resulting ref value could distinguish.
				assert.deepStrictEqual(argv(), ['update-ref', 'refs/kepler/mark', sha, '']);
			});

			test('a plain delete passes no old value', async () => {
				await refsProvider.deleteReference(repoPath, 'refs/kepler/mark');

				assert.deepStrictEqual(argv(), ['update-ref', '-d', '--no-deref', 'refs/kepler/mark']);
			});

			test('an expected sha is appended to a delete', async () => {
				await refsProvider.deleteReference(repoPath, 'refs/kepler/mark', { expected: other });

				assert.deepStrictEqual(argv(), ['update-ref', '-d', '--no-deref', 'refs/kepler/mark', other]);
			});
		});

		suite('delete guards', () => {
			test('HEAD is refused without running git', async () => {
				// Dereferenced, it is the checked-out branch; not dereferenced, it is the repository's HEAD file
				await assert.rejects(refsProvider.deleteReference(repoPath, 'HEAD'), (ex: unknown) =>
					ReferenceUpdateError.is(ex, 'checkedOut'),
				);
				sinon.assert.notCalled(gitStub.run);
			});

			test('a branch git lists as checked out in a worktree is refused', async () => {
				gitStub.run
					.withArgs(sinon.match.any, 'worktree', 'list', '--porcelain')
					.resolves(
						createGitResult(
							`worktree /repo\nHEAD ${sha}\nbranch refs/heads/main\n\nworktree /wt\nHEAD ${sha}\nbranch refs/heads/in-use\n`,
						),
					);

				await assert.rejects(refsProvider.deleteReference(repoPath, 'refs/heads/in-use'), (ex: unknown) =>
					ReferenceUpdateError.is(ex, 'checkedOut'),
				);
				sinon.assert.neverCalledWith(gitStub.run, sinon.match.any, 'update-ref');
			});
		});

		suite('failure reasons', () => {
			const updateCases: [reason: ReferenceUpdateErrorReason, stderr: string][] = [
				['conflict', `cannot lock ref 'refs/kepler/mark': is at ${sha} but expected ${other}`],
				['conflict', `cannot lock ref 'refs/kepler/mark': reference already exists`],
				['conflict', `cannot lock ref 'refs/heads/df/sub': 'refs/heads/df' exists; cannot create it`],
				['invalidRef', `refusing to update ref with bad name 'refs/heads/bad..name'`],
				['invalidObject', `trying to write ref 'refs/kepler/mark' with nonexistent object ${sha}`],
				['invalidObject', `fatal: nosuchthing: not a valid SHA1`],
			];

			function testUpdateReason(reason: ReferenceUpdateErrorReason, stderr: string): void {
				test(`update maps "${stderr.slice(0, 48)}…" to ${reason}`, async () => {
					failWith(stderr);

					await assert.rejects(
						refsProvider.updateReference(repoPath, 'refs/kepler/mark', sha),
						(ex: unknown) => ReferenceUpdateError.is(ex, reason),
					);
				});
			}

			for (const [reason, stderr] of updateCases) {
				testUpdateReason(reason, stderr);
			}

			test('an unresolvable ref is a lost race on update but an already-done delete', async () => {
				// The one stderr shape the two operations read differently, which is why they map through
				// separate tables — collapsing them would cost a deleter the ability to tell an idempotent
				// no-op from a real conflict without re-reading.
				const stderr = `cannot lock ref 'refs/kepler/mark': unable to resolve reference 'refs/kepler/mark'`;
				failWith(stderr);

				await assert.rejects(
					refsProvider.updateReference(repoPath, 'refs/kepler/mark', sha, { expected: other }),
					(ex: unknown) => ReferenceUpdateError.is(ex, 'conflict'),
				);
				await assert.rejects(
					refsProvider.deleteReference(repoPath, 'refs/kepler/mark', { expected: other }),
					(ex: unknown) => ReferenceUpdateError.is(ex, 'notFound'),
				);
			});

			test('the failure carries the action and the ref it targeted', async () => {
				failWith(`cannot lock ref 'refs/kepler/mark': reference already exists`);

				await assert.rejects(
					refsProvider.updateReference(repoPath, 'refs/kepler/mark', sha, { expected: 'absent' }),
					(ex: unknown) =>
						ReferenceUpdateError.is(ex) &&
						ex.details.action === 'update' &&
						ex.details.ref === 'refs/kepler/mark',
				);
			});
		});

		suite('change hooks', () => {
			test('a branch update resets the branches cache and announces heads', async () => {
				await refsProvider.updateReference(repoPath, 'refs/heads/main', sha);

				sinon.assert.calledWith(onReset, repoPath, 'branches');
				sinon.assert.calledWith(onChanged, repoPath, ['heads']);
			});

			test('a tag update resets the tags cache and announces tags', async () => {
				await refsProvider.updateReference(repoPath, 'refs/tags/v1.0.0', sha);

				sinon.assert.calledWith(onReset, repoPath, 'tags');
				sinon.assert.calledWith(onChanged, repoPath, ['tags']);
			});

			test('a remote-tracking update resets the branches cache and announces remotes', async () => {
				await refsProvider.updateReference(repoPath, 'refs/remotes/origin/main', sha);

				// Remote-tracking branches are read through the branch and ref-tip caches — resetting only
				// `'remotes'` (the configured remotes) would leave both serving the old tip.
				sinon.assert.calledWith(onReset, repoPath, 'branches');
				sinon.assert.neverCalledWith(onReset, repoPath, 'remotes');
				sinon.assert.calledWith(onChanged, repoPath, ['remotes']);
			});

			test('a HEAD update resets branches and status and announces head and heads', async () => {
				await refsProvider.updateReference(repoPath, 'HEAD', sha);

				sinon.assert.calledWith(onReset, repoPath, 'branches', 'status');
				sinon.assert.calledWith(onChanged, repoPath, ['head', 'heads']);
			});

			test('an unmodelled namespace announces nothing', async () => {
				await refsProvider.updateReference(repoPath, 'refs/kepler/mark', sha);

				sinon.assert.notCalled(onChanged);
				sinon.assert.notCalled(onReset);
			});

			test('a delete announces the same change as an update to the ref', async () => {
				await refsProvider.deleteReference(repoPath, 'refs/heads/main', { expected: sha });

				sinon.assert.calledWith(onReset, repoPath, 'branches', 'config');
				sinon.assert.calledOnce(onReset);
				sinon.assert.calledWith(onChanged, repoPath, ['heads']);
			});

			test('a refused mutation announces nothing', async () => {
				failWith(`cannot lock ref 'refs/heads/main': is at ${sha} but expected ${other}`);

				await assert.rejects(
					refsProvider.updateReference(repoPath, 'refs/heads/main', sha, { expected: other }),
				);

				sinon.assert.notCalled(onReset);
				sinon.assert.notCalled(onChanged);
			});
		});
	});
});
