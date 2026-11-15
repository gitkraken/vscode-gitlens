import * as assert from 'assert';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { RevisionGitSubProvider } from '../revision.js';

const repoPath = '/repo';

function createProvider(): { provider: RevisionGitSubProvider; runs: { cwd: unknown; args: string[] }[] } {
	const runs: { cwd: unknown; args: string[] }[] = [];
	const git = {
		run: (options: { cwd?: string }, ...args: string[]) => {
			runs.push({ cwd: options.cwd, args: args });
			return Promise.resolve({
				stdout: Buffer.from('content'),
				stderr: '',
				exitCode: 0,
				completion: { status: 'exited', code: 0 },
			});
		},
	};

	return {
		provider: new RevisionGitSubProvider(
			{} as unknown as GitServiceContext,
			git as unknown as Git,
			new Cache(),
			{} as unknown as CliGitProviderInternal,
		),
		runs: runs,
	};
}

suite('RevisionGitSubProvider.getRevisionContent — literalPath', () => {
	test('reads a repo-relative path exactly as given, backslashes untouched', async () => {
		const { provider, runs } = createProvider();

		await provider.getRevisionContent(repoPath, 'dir\\name/back\\slash.txt', 'HEAD', { literalPath: true });

		assert.strictEqual(runs.length, 1);
		assert.strictEqual(runs[0].cwd, repoPath);
		assert.ok(runs[0].args.includes('HEAD:./dir\\name/back\\slash.txt'));
	});

	test('reads the index the same way', async () => {
		const { provider, runs } = createProvider();

		await provider.getRevisionContent(repoPath, 'back\\slash.txt', uncommittedStaged, { literalPath: true });

		assert.ok(runs[0].args.includes(':./back\\slash.txt'));
	});

	test('without the option a backslash is still a separator', async () => {
		const { provider, runs } = createProvider();

		await provider.getRevisionContent(repoPath, 'back\\slash.txt', 'HEAD');

		assert.ok(runs[0].args.includes('HEAD:./back/slash.txt'));
	});
});
