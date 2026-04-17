import * as assert from 'assert';
import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import { getConflictStatusInfo } from '../conflictRendering.js';

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
	});
});
