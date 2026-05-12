import * as assert from 'assert';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitResult } from '@gitlens/git/exec.types.js';
import * as sinon from 'sinon';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { TagsGitSubProvider } from '../tags.js';

suite('TagsGitSubProvider Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let tagsProvider: TagsGitSubProvider;
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
			supports(_feature: string) {
				return Promise.resolve(true);
			}
			run(..._args: any[]) {
				return Promise.resolve(createGitResult(''));
			}
			async *stream(..._args: any[]): AsyncGenerator<string> {
				// Default: empty stream.
			}
		}

		gitStub = sandbox.createStubInstance(MockGit) as unknown as sinon.SinonStubbedInstance<Git>;

		const context = {
			hooks: {},
		} as unknown as GitServiceContext;
		const cache = {} as unknown as Cache;
		const provider = {} as unknown as CliGitProviderInternal;

		tagsProvider = new TagsGitSubProvider(context, gitStub, cache, provider);
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('createTag', () => {
		const repoPath = '/repo';
		const name = 'v1.2.3';
		const sha = 'abc1234';

		test('without options builds args [tag, name, sha]', async () => {
			await tagsProvider.createTag(repoPath, name, sha);

			const args = gitStub.run.firstCall.args.slice(1);
			assert.deepStrictEqual(args, ['tag', name, sha]);
		});

		test('with a message inserts -m and message before name', async () => {
			await tagsProvider.createTag(repoPath, name, sha, 'release notes');

			const args = gitStub.run.firstCall.args.slice(1);
			assert.deepStrictEqual(args, ['tag', '-m', 'release notes', name, sha]);
		});

		test('with { force: true } prepends --force', async () => {
			await tagsProvider.createTag(repoPath, name, sha, undefined, { force: true });

			const args = gitStub.run.firstCall.args.slice(1);
			assert.deepStrictEqual(args, ['tag', '--force', name, sha]);
		});

		test('with a message AND { force: true } emits both flags before name', async () => {
			await tagsProvider.createTag(repoPath, name, sha, 'release notes', { force: true });

			const args = gitStub.run.firstCall.args.slice(1);
			assert.deepStrictEqual(args, ['tag', '--force', '-m', 'release notes', name, sha]);
		});

		test('with { force: false } omits --force', async () => {
			await tagsProvider.createTag(repoPath, name, sha, undefined, { force: false });

			const args = gitStub.run.firstCall.args.slice(1);
			assert.deepStrictEqual(args, ['tag', name, sha]);
		});
	});
});
