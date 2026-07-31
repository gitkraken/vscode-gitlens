import * as assert from 'assert';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import type { TreeItemBase, TreeModel } from '../base.js';
import { buildFileTooltip, buildFileTree, trimTrailingSlash } from '../file-tree-utils.js';

function file(path: string, status: GitFileStatus = '?'): GitFileChangeShape {
	return { path: path, status: status, repoPath: '/repo' };
}

function stubModel(f: GitFileChangeShape, options: Partial<TreeItemBase>, flat: boolean): TreeModel {
	const model: TreeModel = {
		branch: false,
		expanded: true,
		path: f.path,
		level: 1,
		checkable: false,
		checked: false,
		label: f.path,
		context: [f, flat],
	};
	return { ...model, ...options };
}

// Git reports an untracked directory that is itself a repository as a single entry with a trailing
// slash, since it can't recurse past the embedded repository boundary.
const nestedRepo = 'nested-repo/';

suite('tree/file-tree-utils', () => {
	suite('trimTrailingSlash', () => {
		test('trims one trailing slash', () => {
			assert.strictEqual(trimTrailingSlash(nestedRepo), 'nested-repo');
			assert.strictEqual(trimTrailingSlash('a/b/nested-repo/'), 'a/b/nested-repo');
		});

		test('leaves an ordinary path and a backslash-bearing filename alone', () => {
			assert.strictEqual(trimTrailingSlash('src/foo.ts'), 'src/foo.ts');
			assert.strictEqual(trimTrailingSlash('weird\\name.ts'), 'weird\\name.ts');
		});
	});

	suite('buildFileTree', () => {
		test('tree layout renders a trailing-slash entry as one leaf, not a folder with an empty child', () => {
			const children = buildFileTree([file(nestedRepo)], true, true, 'off', null, stubModel);

			assert.strictEqual(children.length, 1);
			assert.strictEqual(children[0].branch, false, 'should not be a folder node');
			assert.strictEqual(children[0].children, undefined, 'should not contain an empty-named leaf');
			assert.strictEqual(children[0].path, nestedRepo, 'leaf keeps the real (unnormalized) path');
		});

		test('tree layout still nests an ordinary path under its folders', () => {
			const children = buildFileTree([file('src/foo.ts', 'M')], true, true, 'off', null, stubModel);

			assert.strictEqual(children.length, 1);
			assert.strictEqual(children[0].branch, true);
			assert.strictEqual(children[0].label, 'src');
			assert.strictEqual(children[0].children?.length, 1);
			assert.strictEqual(children[0].children?.[0].path, 'src/foo.ts');
		});

		test('tree layout treats a backslash as part of the filename, not a separator', () => {
			// Git paths always use `/`, so a backslash is a literal character in a (POSIX-legal)
			// filename — normalizing it away would split the name across folders.
			const children = buildFileTree([file('weird\\name.ts', 'M')], true, true, 'off', null, stubModel);

			assert.strictEqual(children.length, 1);
			assert.strictEqual(children[0].branch, false);
			assert.strictEqual(children[0].path, 'weird\\name.ts');
		});

		test('list layout passes the file through untouched', () => {
			const children = buildFileTree([file(nestedRepo)], false, true, 'off', null, stubModel);

			assert.strictEqual(children.length, 1);
			assert.strictEqual(children[0].path, nestedRepo);
		});
	});

	suite('buildFileTooltip', () => {
		test('names a trailing-slash entry as a nested repository and drops the slash', () => {
			const tooltip = buildFileTooltip(file(nestedRepo));

			assert.ok(tooltip.includes('(nested repository)'), tooltip);
			assert.ok(!tooltip.includes('nested-repo/'), tooltip);
			assert.ok(tooltip.includes('Untracked'), tooltip);
		});

		test('leaves an ordinary untracked file unmarked', () => {
			const tooltip = buildFileTooltip(file('new-untracked.txt'));

			assert.ok(!tooltip.includes('nested repository'), tooltip);
			assert.ok(tooltip.includes('Untracked'), tooltip);
		});

		test('keeps the submodule marker taking precedence', () => {
			const f: GitFileChangeShape = { ...file('sub/'), submodule: { oid: 'abc1234' } };

			assert.ok(buildFileTooltip(f).includes('(submodule)'));
		});
	});
});
