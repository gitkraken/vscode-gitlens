import * as assert from 'assert';
import { settingsPageAnchorCommands } from '../../../../settings/settingsPageAnchors.js';
import { anchorToCategory, defaultSettingsCategoryId, droppedAnchorQueries, settingsCategories } from '../index.js';

/**
 * Drift guard for the settings taxonomy v2 curation (#5392 Doc A):
 *  - every `gitlens.showSettingsPage!<anchor>` command resolves to a kept
 *    category (via `anchorToCategory`) or a `droppedAnchorQueries` redirect,
 *    so a category drop can't silently orphan its command;
 *  - every `droppedAnchorQueries` redirect is backed by such a command for a
 *    dropped category, so a redirect never lingers for an entry point that can
 *    never fire it (and never points at a still-kept category — the check that
 *    caught the terminal-links regression).
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

	test('every droppedAnchorQueries redirect is backed by a live showSettingsPage! command for a dropped category', () => {
		const commandAnchors = new Set(settingsPageAnchorCommands.map(c => /!(.*)/.exec(c)?.[1]));
		for (const anchor of Object.keys(droppedAnchorQueries)) {
			assert.ok(
				commandAnchors.has(anchor),
				`${anchor} has a redirect but no gitlens.showSettingsPage!${anchor} command uses it`,
			);
			assert.strictEqual(
				anchorToCategory(anchor),
				undefined,
				`${anchor} redirects to native settings but still resolves to a kept category`,
			);
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

	test('the default landing resolves to a real category', () => {
		assert.ok(
			settingsCategories.some(c => c.id === defaultSettingsCategoryId),
			'defaultSettingsCategoryId must resolve to a registered category',
		);
	});

	test('every kept category id is unique', () => {
		const ids = settingsCategories.map(c => c.id);
		assert.strictEqual(new Set(ids).size, ids.length);
	});
});
