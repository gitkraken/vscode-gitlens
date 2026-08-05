import * as assert from 'assert';
import { settingsPageAnchorCommands } from '../../../../settings/settingsPageAnchors.js';
import { anchorToCategory, droppedAnchorQueries, settingsCategories } from '../index.js';

/**
 * Drift guard for the settings taxonomy v2 curation (#5392 Doc A): every
 * `gitlens.showSettingsPage!<anchor>` command must resolve to either a kept
 * category (via `anchorToCategory`) or a `droppedAnchorQueries` redirect —
 * so a future category drop can't silently orphan its command/menu entry point.
 */
suite('settings taxonomy — anchor coverage', () => {
	test('every showSettingsPage!<anchor> command resolves to a kept category or a native redirect', () => {
		for (const command of settingsPageAnchorCommands) {
			const match = /!(.*)/.exec(command);
			assert.ok(match, `${command} is missing its anchor suffix`);
			const anchor = match[1];

			const resolvesToKeptCategory = anchorToCategory(anchor) != null;
			const redirectsToNative = anchor in droppedAnchorQueries;
			assert.ok(
				resolvesToKeptCategory || redirectsToNative,
				`${command} neither resolves to a kept category nor redirects to native settings`,
			);
		}
	});

	test('the legacy "views" alias redirects to native now that the sorting section is dropped', () => {
		assert.ok('views' in droppedAnchorQueries, 'the "views" legacy alias must have a redirect');
		assert.strictEqual(anchorToCategory('views'), undefined);
	});

	test('every dropped category id has a redirect and no longer exists as a category', () => {
		const droppedIds = [
			'file-annotations',
			'repositories-view',
			'branches-view',
			'remotes-view',
			'tags-view',
			'worktrees-view',
			'commit-details-view',
			'contributors-view',
			'file-history-view',
			'line-history-view',
			'search-compare-view',
			'sorting',
			'shortcuts',
			'modes',
			'terminal-links',
			'rebase-editor',
		];
		for (const id of droppedIds) {
			assert.ok(id in droppedAnchorQueries, `${id} is missing a droppedAnchorQueries redirect`);
			assert.ok(!settingsCategories.some(c => c.id === id), `${id} should no longer be a registered category`);
		}
	});

	test('the relocated advanced.blame keys resolve to the kept blame category', () => {
		assert.deepStrictEqual(anchorToCategory('advanced.blame.delayAfterEdit'), {
			id: 'blame',
			key: 'advanced.blame.delayAfterEdit',
		});
		assert.deepStrictEqual(anchorToCategory('advanced.blame.sizeThresholdAfterEdit'), {
			id: 'blame',
			key: 'advanced.blame.sizeThresholdAfterEdit',
		});
	});

	test('every category renders in one of the taxonomy v2 groups, Setup first', () => {
		const groups = settingsCategories.map(c => c.group);
		assert.ok(
			groups.every(
				g => g === 'Setup' || g === 'Integrations' || g === 'Editor' || g === 'Views' || g === 'General',
			),
			'every category must use a taxonomy v2 group',
		);
		assert.strictEqual(groups[0], 'Setup', 'the Setup launchpad must be the first-rendered group');
	});

	test('the Account section is the first category and default landing, with Setup leading its group', () => {
		assert.strictEqual(settingsCategories[0].id, 'account', 'Account must be the first category');
		assert.strictEqual(settingsCategories[0].group, 'Setup');
		// The Get Started launchpad stays within the Setup group, right after Account
		assert.strictEqual(settingsCategories[1].id, 'setup', 'Get Started must follow Account');
		assert.strictEqual(settingsCategories[1].group, 'Setup');
	});

	test('every kept category id is unique', () => {
		const ids = settingsCategories.map(c => c.id);
		assert.strictEqual(new Set(ids).size, ids.length);
	});

	test('the new Launchpad category is present in the Integrations group', () => {
		const launchpad = settingsCategories.find(c => c.id === 'launchpad');
		assert.ok(launchpad, 'a "launchpad" category must exist');
		assert.strictEqual(launchpad.group, 'Integrations');
	});
});
