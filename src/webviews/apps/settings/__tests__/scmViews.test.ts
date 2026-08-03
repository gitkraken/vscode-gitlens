import * as assert from 'assert';
import { groupableViewTypeLabels, groupableViewTypes } from '../../../../constants.views.js';
import { viewsCategories } from '../categories/views.js';
import { descriptorKeys } from '../model.js';

/**
 * Drift guard for the GitLens SCM grouped-views editor (#5392 Doc B): the
 * component's iteration order is a hand-authored array typed against
 * `GroupableTreeViewTypes`, which guards typos but not omissions (challenge
 * finding #2) — this pins the expected member set so a future addition to the
 * union can't silently drop out of the Settings editor without a test failure.
 */
suite('settings — GitLens SCM grouped-views editor', () => {
	test('groupableViewTypes covers exactly the known groupable views', () => {
		const expected = [
			'commits',
			'branches',
			'remotes',
			'stashes',
			'tags',
			'worktrees',
			'contributors',
			'repositories',
			'searchAndCompare',
			'launchpad',
			'fileHistory',
		].sort();
		assert.deepStrictEqual([...groupableViewTypes].sort(), expected);
	});

	test('every groupableViewTypes entry has a label', () => {
		for (const id of groupableViewTypes) {
			assert.ok(groupableViewTypeLabels[id], `missing a label for ${id}`);
		}
	});

	test('the "scm-views" category exists in the Views group with a scm-views control', () => {
		const category = viewsCategories.find(c => c.id === 'scm-views');
		assert.ok(category, 'a "scm-views" category must exist');
		assert.strictEqual(category.group, 'Views');
		assert.strictEqual(category.settingsSearch, 'gitlens.views.scm.grouped');
		assert.ok(
			category.controls.some(c => c.kind === 'scm-views'),
			'the category must render the scm-views control',
		);
	});

	test('the scm-views descriptor keys cover all 3 round-tripped config keys', () => {
		assert.deepStrictEqual(descriptorKeys({ kind: 'scm-views', label: 'GitLens SCM views' }), [
			'views.scm.grouped.views',
			'views.scm.grouped.hiddenViews',
			'views.scm.grouped.default',
		]);
	});
});
