import * as assert from 'assert';
import { isSelfMergeTarget } from '../branch.utils.js';

suite('git/-webview/branch.utils', () => {
	suite('isSelfMergeTarget', () => {
		test('the default branch, whose target resolves remote-qualified (desktop)', () => {
			// `getDefaultBranchName` runs `git symbolic-ref --short refs/remotes/origin/HEAD`, so the
			// fallback chain answers `origin/main` for a focal branch named `main` — the same branch.
			assert.strictEqual(isSelfMergeTarget('origin/main', 'main'), true);
		});

		test('the default branch, whose target resolves bare (GitHub provider)', () => {
			// The GitHub provider used by vscode.dev returns the GraphQL `defaultBranchRef.name` verbatim.
			assert.strictEqual(isSelfMergeTarget('main', 'main'), true);
		});

		test('the remote branch itself, focused directly', () => {
			assert.strictEqual(isSelfMergeTarget('origin/main', 'origin/main'), true);
		});

		test('a real target the focal branch is merely level with', () => {
			// The regression this exists for: `feature/github-stacked-prs` sat on the same commit as
			// `origin/main`, and a tip-SHA test condemned it as targetless — leaving the graph's scope
			// bare, which dims every row off the focal tip's first-parent line instead of re-rooting.
			assert.strictEqual(isSelfMergeTarget('origin/main', 'feature/github-stacked-prs'), false);
		});

		test('the remote strip is never applied to the focal branch name', () => {
			// `getBranchNameWithoutRemote` cuts at the first `/`, so stripping the focal side too would
			// reduce `feature/github-stacked-prs` to `github-stacked-prs` and match unrelated branches.
			assert.strictEqual(isSelfMergeTarget('origin/feature', 'feature/github-stacked-prs'), false);
			assert.strictEqual(isSelfMergeTarget('origin/github-stacked-prs', 'feature/github-stacked-prs'), false);
		});
	});
});
