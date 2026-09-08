import * as assert from 'assert';
import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import { getNumericFormat } from '@gitlens/utils/date.js';
import { getConflictDecorations, getConflictStatusInfo, getConflictTooltip } from '../conflictRendering.js';

const allStatuses: GitFileConflictStatus[] = ['UU', 'AA', 'DD', 'AU', 'UA', 'UD', 'DU'];

suite('tree/conflictRendering', () => {
	suite('getConflictStatusInfo', () => {
		test('returns an entry for every GitFileConflictStatus value', () => {
			for (const status of allStatuses) {
				const info = getConflictStatusInfo(status);
				assert.ok(info != null, `expected info for ${status}`);
				assert.ok(info.label.length > 0, `label should be non-empty for ${status}`);
				assert.ok(info.description.length > 0, `description should be non-empty for ${status}`);
				assert.ok(info.kind.length > 0, `kind should be non-empty for ${status}`);
			}
		});

		test('uses modified kind for UU', () => {
			assert.strictEqual(getConflictStatusInfo('UU')?.kind, 'modified');
		});

		test('uses added kind for AA/AU/UA', () => {
			assert.strictEqual(getConflictStatusInfo('AA')?.kind, 'added');
			assert.strictEqual(getConflictStatusInfo('AU')?.kind, 'added');
			assert.strictEqual(getConflictStatusInfo('UA')?.kind, 'added');
		});

		test('uses deleted kind for DD/UD/DU', () => {
			assert.strictEqual(getConflictStatusInfo('DD')?.kind, 'deleted');
			assert.strictEqual(getConflictStatusInfo('UD')?.kind, 'deleted');
			assert.strictEqual(getConflictStatusInfo('DU')?.kind, 'deleted');
		});

		test('distinguishes UA from AU labels', () => {
			assert.notStrictEqual(getConflictStatusInfo('UA')?.label, getConflictStatusInfo('AU')?.label);
		});

		test('distinguishes UD from DU labels', () => {
			assert.notStrictEqual(getConflictStatusInfo('UD')?.label, getConflictStatusInfo('DU')?.label);
		});

		test('includes branch name in description when provided', () => {
			const info = getConflictStatusInfo('UU', 'feature/foo');
			assert.ok(info?.description.includes('feature/foo'));
		});

		test('falls back to "incoming" when no branch name', () => {
			const info = getConflictStatusInfo('UU');
			assert.ok(info?.description.includes('incoming'));
		});

		test('preserves exact descriptions for every status with and without a branch', () => {
			const branch = '$(git-branch) feature/foo';
			const expected = {
				UU: [`Modified on both ${branch} and the target`, 'Modified on both incoming and the target'],
				AA: [`Added on both ${branch} and the target`, 'Added on both incoming and the target'],
				DD: [`Deleted on both ${branch} and the target`, 'Deleted on both incoming and the target'],
				AU: [
					`Added on the target (conflict with ${branch} — possible rename or directory/file clash)`,
					'Added on the target (conflict with incoming — possible rename or directory/file clash)',
				],
				UA: [
					`Added on ${branch} (conflict with the target — possible rename or directory/file clash)`,
					'Added on incoming (conflict with the target — possible rename or directory/file clash)',
				],
				UD: [`Deleted on ${branch}\nModified on the target`, 'Deleted on incoming\nModified on the target'],
				DU: [`Modified on ${branch}\nDeleted on the target`, 'Modified on incoming\nDeleted on the target'],
			} satisfies Record<GitFileConflictStatus, [string, string]>;

			for (const status of allStatuses) {
				assert.strictEqual(getConflictStatusInfo(status, 'feature/foo')?.description, expected[status][0]);
				assert.strictEqual(getConflictStatusInfo(status)?.description, expected[status][1]);
				assert.strictEqual(getConflictStatusInfo(status, '')?.description, expected[status][1]);
			}
		});
	});

	suite('conflict counts', () => {
		for (const conflictCount of [1, 2, 1234]) {
			test(`formats ${conflictCount} with exact singular/plural numeric parity`, () => {
				const count = getNumericFormat()(conflictCount);
				const expected = conflictCount === 1 ? `${count} conflict` : `${count} conflicts`;
				const decoration = getConflictDecorations('UU', conflictCount)?.find(d => d.type === 'conflict');

				assert.strictEqual(decoration?.label, expected);
				assert.strictEqual(decoration?.tooltip, expected);
				assert.ok(getConflictTooltip('UU', conflictCount).endsWith(`\n\n${expected}`));
			});
		}
	});

	test('escapes branch Markdown only for the Markdown tooltip consumer', () => {
		const branch = 'feature/`code`';
		assert.ok(getConflictStatusInfo('UU', branch)?.description.includes(branch));

		const tooltip = getConflictTooltip('UU', undefined, branch);
		assert.ok(tooltip.includes('$(git-branch) feature/\\`code\\`'));
		assert.ok(!tooltip.includes('$(git-branch) feature/`code`'));
	});
});
