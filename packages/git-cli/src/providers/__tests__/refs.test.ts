import * as assert from 'assert';
import * as sinon from 'sinon';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
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

	function createGitResult(stdout: string): GitResult {
		return {
			stdout: stdout,
			stderr: undefined,
			exitCode: 0,
			cancelled: false,
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

		const context = {} as unknown as GitServiceContext;
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
			getRefTips: (
				repoPath: string,
				factory: (
					commonPath: string,
					cacheable: { invalidate: () => void },
					cancellation?: AbortSignal,
				) => Promise<unknown>,
				cancellation?: AbortSignal,
			) => factory(repoPath, { invalidate: () => {} }, cancellation),
		} as unknown as Cache;
		const provider = {} as unknown as CliGitProviderInternal;

		refsProvider = new RefsGitSubProvider(context, gitStub, cache, provider);
	});

	teardown(() => {
		sandbox.restore();
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
});
