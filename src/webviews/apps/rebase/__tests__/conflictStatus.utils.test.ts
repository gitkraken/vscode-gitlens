import * as assert from 'assert';
import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import {
	conflictColors,
	getConflictFileActions,
	getConflictFileContextData,
	getConflictStatusInfo,
} from '../conflictStatus.utils.js';

const allStatuses: GitFileConflictStatus[] = ['UU', 'AA', 'DD', 'AU', 'UA', 'UD', 'DU'];

suite('rebase/conflictStatus.utils', () => {
	suite('getConflictStatusInfo', () => {
		test('returns an entry for every GitFileConflictStatus value', () => {
			for (const status of allStatuses) {
				const info = getConflictStatusInfo(status);
				assert.ok(info.label.length > 0, `label should be non-empty for ${status}`);
				assert.ok(info.description.length > 0, `description should be non-empty for ${status}`);
				assert.ok(info.color.length > 0, `color should be non-empty for ${status}`);
			}
		});

		test('uses modified color for UU', () => {
			assert.strictEqual(getConflictStatusInfo('UU').color, conflictColors.modified);
		});

		test('uses added color for AA/AU/UA', () => {
			assert.strictEqual(getConflictStatusInfo('AA').color, conflictColors.added);
			assert.strictEqual(getConflictStatusInfo('AU').color, conflictColors.added);
			assert.strictEqual(getConflictStatusInfo('UA').color, conflictColors.added);
		});

		test('uses deleted color for DD/UD/DU', () => {
			assert.strictEqual(getConflictStatusInfo('DD').color, conflictColors.deleted);
			assert.strictEqual(getConflictStatusInfo('UD').color, conflictColors.deleted);
			assert.strictEqual(getConflictStatusInfo('DU').color, conflictColors.deleted);
		});

		test('distinguishes UA from AU labels', () => {
			assert.notStrictEqual(getConflictStatusInfo('UA').label, getConflictStatusInfo('AU').label);
		});

		test('distinguishes UD from DU labels', () => {
			assert.notStrictEqual(getConflictStatusInfo('UD').label, getConflictStatusInfo('DU').label);
		});

		test('includes branch name in description when provided', () => {
			const info = getConflictStatusInfo('UU', 'feature/foo');
			assert.ok(info.description.includes('feature/foo'));
		});

		test('falls back to "incoming" when no branch name', () => {
			const info = getConflictStatusInfo('UU');
			assert.ok(info.description.includes('incoming'));
		});
	});

	suite('getConflictFileActions', () => {
		function actionNames(status: GitFileConflictStatus): string[] {
			return getConflictFileActions(status).map(a => a.action);
		}

		test('returns current-changes, incoming-changes, and stage for every status', () => {
			for (const status of allStatuses) {
				assert.deepStrictEqual(
					actionNames(status),
					['current-changes', 'incoming-changes', 'stage'],
					`inline actions wrong for ${status}`,
				);
			}
		});
	});

	suite('getConflictFileContextData', () => {
		function parseContext(status: GitFileConflictStatus) {
			return JSON.parse(getConflictFileContextData('path/to/file.ts', status)) as {
				webviewItem: string;
				webviewItemValue: { type: string; path: string; conflictStatus: GitFileConflictStatus };
			};
		}

		test('emits webviewItem and item value for every status', () => {
			for (const status of allStatuses) {
				const ctx = parseContext(status);
				assert.strictEqual(ctx.webviewItemValue.type, 'rebaseConflict');
				assert.strictEqual(ctx.webviewItemValue.path, 'path/to/file.ts');
				assert.strictEqual(ctx.webviewItemValue.conflictStatus, status);
				assert.ok(
					ctx.webviewItem.startsWith('gitlens:rebase:conflict+file'),
					`webviewItem prefix wrong for ${status}`,
				);
			}
		});

		test('+canStageCurrent is excluded for UA and DD only', () => {
			for (const status of allStatuses) {
				const has = parseContext(status).webviewItem.includes('+canStageCurrent');
				const expected = status !== 'UA' && status !== 'DD';
				assert.strictEqual(has, expected, `+canStageCurrent presence wrong for ${status}`);
			}
		});

		test('+canStageIncoming is excluded for AU and DD only', () => {
			for (const status of allStatuses) {
				const has = parseContext(status).webviewItem.includes('+canStageIncoming');
				const expected = status !== 'AU' && status !== 'DD';
				assert.strictEqual(has, expected, `+canStageIncoming presence wrong for ${status}`);
			}
		});

		test('DD has no stage modifiers', () => {
			assert.strictEqual(parseContext('DD').webviewItem, 'gitlens:rebase:conflict+file');
		});
	});
});
