import assert from 'node:assert';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitHubGitProviderInternal } from '../../githubProvider.js';
import { RefsGitSubProvider } from '../refs.js';

suite('RefsGitSubProvider', () => {
	let refs: RefsGitSubProvider;

	setup(() => {
		refs = new RefsGitSubProvider({} as Cache, {} as GitHubGitProviderInternal);
	});

	suite('checkIfCouldBeValidBranchOrTagName', () => {
		test('validates the ref argument, not the repoPath', async () => {
			// If params were reversed, the repo path would be tested against the regex
			const repoPath = '/some/repo/path';
			const result = await refs.checkIfCouldBeValidBranchOrTagName(repoPath, 'main');
			assert.strictEqual(result, true, "'main' should be a valid branch name");
		});

		test('rejects invalid branch names', async () => {
			const result = await refs.checkIfCouldBeValidBranchOrTagName('/repo', 'invalid..name');
			assert.strictEqual(result, false, "'invalid..name' should be rejected (double dots)");
		});

		test('repo path does not affect validation', async () => {
			// A repo path that looks invalid as a branch name should not cause failure
			const result = await refs.checkIfCouldBeValidBranchOrTagName(
				'vscode-vfs://github/owner/repo',
				'feature/foo',
			);
			assert.strictEqual(result, true, "'feature/foo' should be valid regardless of repoPath");
		});
	});
});
