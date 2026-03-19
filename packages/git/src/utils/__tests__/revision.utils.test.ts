import * as assert from 'assert';
import { deletedOrMissing, uncommitted, uncommittedStaged } from '../../models/revision.js';
import {
	createRevisionRange,
	getRevisionRangeParts,
	isRevisionRange,
	isRevisionWithSuffix,
	isSha,
	isShaWithOptionalRevisionSuffix,
	isShaWithParentSuffix,
	isUncommitted,
	isUncommittedStaged,
	resetAbbreviatedShaLength,
	setAbbreviatedShaLength,
	shortenRevision,
	stripOrigin,
} from '../revision.utils.js';

const fullSha = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const zeroSha = '0000000000000000000000000000000000000000';

suite('Revision Utils Test Suite', () => {
	suite('isSha', () => {
		test('accepts a valid 40-char hex SHA', () => {
			assert.strictEqual(isSha(fullSha), true);
		});

		test('rejects a short SHA when allowShort is false (default)', () => {
			assert.strictEqual(isSha('a1b2c3d'), false);
		});

		test('accepts a 7-char short SHA when allowShort is true', () => {
			assert.strictEqual(isSha('a1b2c3d', true), true);
		});

		test('rejects a 6-char SHA even with allowShort true', () => {
			assert.strictEqual(isSha('a1b2c3', true), false);
		});

		test('rejects non-hex characters', () => {
			assert.strictEqual(isSha('g1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'), false);
			assert.strictEqual(isSha('ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'), false);
		});

		test('accepts zero-sha with colon suffix', () => {
			assert.strictEqual(isSha(`${zeroSha}:`), true);
		});

		test('accepts zero-sha with dash suffix', () => {
			assert.strictEqual(isSha(`${zeroSha}-`), true);
		});

		test('rejects empty string', () => {
			assert.strictEqual(isSha(''), false);
		});

		test('rejects a 41-char string', () => {
			assert.strictEqual(isSha(`${fullSha}a`), false);
		});
	});

	suite('isShaWithOptionalRevisionSuffix', () => {
		test('accepts a plain 40-char SHA', () => {
			assert.strictEqual(isShaWithOptionalRevisionSuffix(fullSha), true);
		});

		test('accepts a SHA with ^ suffix', () => {
			assert.strictEqual(isShaWithOptionalRevisionSuffix(`${fullSha}^`), true);
		});

		test('accepts a SHA with @ suffix', () => {
			assert.strictEqual(isShaWithOptionalRevisionSuffix(`${fullSha}@{1}`), true);
		});

		test('accepts a SHA with ~ suffix', () => {
			assert.strictEqual(isShaWithOptionalRevisionSuffix(`${fullSha}~2`), true);
		});

		test('accepts a SHA with : suffix', () => {
			assert.strictEqual(isShaWithOptionalRevisionSuffix(`${fullSha}:path/file`), true);
		});

		test('rejects a non-SHA string', () => {
			assert.strictEqual(isShaWithOptionalRevisionSuffix('main'), false);
		});

		test('accepts zero-sha with colon suffix', () => {
			assert.strictEqual(isShaWithOptionalRevisionSuffix(`${zeroSha}:`), true);
		});
	});

	suite('isShaWithParentSuffix', () => {
		test('accepts SHA with ^', () => {
			assert.strictEqual(isShaWithParentSuffix(`${fullSha}^`), true);
		});

		test('accepts SHA with ^0', () => {
			assert.strictEqual(isShaWithParentSuffix(`${fullSha}^0`), true);
		});

		test('accepts SHA with ^1 through ^3', () => {
			assert.strictEqual(isShaWithParentSuffix(`${fullSha}^1`), true);
			assert.strictEqual(isShaWithParentSuffix(`${fullSha}^2`), true);
			assert.strictEqual(isShaWithParentSuffix(`${fullSha}^3`), true);
		});

		test('rejects SHA with ^4 (only 0-3 allowed)', () => {
			assert.strictEqual(isShaWithParentSuffix(`${fullSha}^4`), false);
		});

		test('rejects plain SHA without suffix', () => {
			assert.strictEqual(isShaWithParentSuffix(fullSha), false);
		});
	});

	suite('isRevisionWithSuffix', () => {
		test('accepts a string > 40 chars with ^ suffix', () => {
			assert.strictEqual(isRevisionWithSuffix(`${fullSha}^2`), true);
		});

		test('accepts a string > 40 chars with ~ suffix', () => {
			assert.strictEqual(isRevisionWithSuffix(`${fullSha}~1`), true);
		});

		test('accepts a string > 40 chars with : suffix', () => {
			assert.strictEqual(isRevisionWithSuffix(`${fullSha}:path`), true);
		});

		test('rejects a string <= 40 chars even with suffix', () => {
			// 'main^2' is only 6 chars, well under 40
			assert.strictEqual(isRevisionWithSuffix('main^2'), false);
		});

		test('rejects a plain 40-char SHA (no suffix)', () => {
			assert.strictEqual(isRevisionWithSuffix(fullSha), false);
		});
	});

	suite('isUncommitted', () => {
		test('returns true for exact uncommitted constant', () => {
			assert.strictEqual(isUncommitted(uncommitted), true);
		});

		test('returns true for exact uncommittedStaged constant', () => {
			assert.strictEqual(isUncommitted(uncommittedStaged), true);
		});

		test('returns true for zero-sha with suffix when not exact', () => {
			assert.strictEqual(isUncommitted(`${zeroSha}^`), true);
		});

		test('returns false for zero-sha with suffix when exact is true', () => {
			assert.strictEqual(isUncommitted(`${zeroSha}^`, true), false);
		});

		test('returns true for exact uncommittedStaged when exact is true', () => {
			assert.strictEqual(isUncommitted(uncommittedStaged, true), true);
		});

		test('returns false for undefined', () => {
			assert.strictEqual(isUncommitted(undefined), false);
		});

		test('returns false for a regular SHA', () => {
			assert.strictEqual(isUncommitted(fullSha), false);
		});
	});

	suite('isUncommittedStaged', () => {
		test('returns true for exact uncommittedStaged constant', () => {
			assert.strictEqual(isUncommittedStaged(uncommittedStaged), true);
		});

		test('returns false for uncommitted (no colon)', () => {
			assert.strictEqual(isUncommittedStaged(uncommitted), false);
		});

		test('returns true for zero-sha with ^ and trailing colon when not exact', () => {
			assert.strictEqual(isUncommittedStaged(`${zeroSha}^:`), true);
		});

		test('returns false for zero-sha with ^ and trailing colon when exact is true', () => {
			assert.strictEqual(isUncommittedStaged(`${zeroSha}^:`, true), false);
		});

		test('returns false for undefined', () => {
			assert.strictEqual(isUncommittedStaged(undefined), false);
		});
	});

	suite('shortenRevision', () => {
		teardown(() => {
			resetAbbreviatedShaLength();
		});

		test('returns "(deleted)" for deletedOrMissing', () => {
			assert.strictEqual(shortenRevision(deletedOrMissing), '(deleted)');
		});

		test('returns empty string for undefined', () => {
			assert.strictEqual(shortenRevision(undefined), '');
		});

		test('returns custom working string for undefined when provided', () => {
			assert.strictEqual(shortenRevision(undefined, { strings: { working: 'Workspace' } }), 'Workspace');
		});

		test('returns "Working Tree" for uncommitted', () => {
			assert.strictEqual(shortenRevision(uncommitted), 'Working Tree');
		});

		test('returns custom uncommitted string when provided', () => {
			assert.strictEqual(shortenRevision(uncommitted, { strings: { uncommitted: 'Unsaved' } }), 'Unsaved');
		});

		test('returns "Index" for uncommittedStaged', () => {
			assert.strictEqual(shortenRevision(uncommittedStaged), 'Index');
		});

		test('returns custom uncommittedStaged string when provided', () => {
			assert.strictEqual(
				shortenRevision(uncommittedStaged, { strings: { uncommittedStaged: 'Staged' } }),
				'Staged',
			);
		});

		test('passes revision range through unchanged', () => {
			assert.strictEqual(shortenRevision('main..develop'), 'main..develop');
		});

		test('truncates a regular SHA to 7 characters by default', () => {
			assert.strictEqual(shortenRevision(fullSha), fullSha.substring(0, 7));
		});

		test('truncates a SHA with suffix, preserving the suffix', () => {
			assert.strictEqual(shortenRevision(`${fullSha}^2`), `${fullSha.substring(0, 7)}^2`);
		});

		test('respects custom abbreviated length via setAbbreviatedShaLength', () => {
			setAbbreviatedShaLength(10);
			assert.strictEqual(shortenRevision(fullSha), fullSha.substring(0, 10));
		});

		test('enforces minimum length of 5 even if abbreviatedShaLength is smaller', () => {
			setAbbreviatedShaLength(3);
			assert.strictEqual(shortenRevision(fullSha), fullSha.substring(0, 5));
		});

		test('returns non-SHA string unchanged', () => {
			assert.strictEqual(shortenRevision('refs/heads/main'), 'refs/heads/main');
		});
	});

	suite('isRevisionRange', () => {
		test('detects double-dot range', () => {
			assert.strictEqual(isRevisionRange('main..develop'), true);
		});

		test('detects triple-dot range', () => {
			assert.strictEqual(isRevisionRange('main...develop'), true);
		});

		test('detects partial range with left side only', () => {
			assert.strictEqual(isRevisionRange('main..'), true);
		});

		test('detects partial range with right side only', () => {
			assert.strictEqual(isRevisionRange('..develop'), true);
		});

		test('rejects non-range string', () => {
			assert.strictEqual(isRevisionRange('main'), false);
		});

		test('returns false for null/undefined', () => {
			assert.strictEqual(isRevisionRange(undefined), false);
			assert.strictEqual(isRevisionRange(null as unknown as string), false);
		});

		test('qualified requires both sides', () => {
			assert.strictEqual(isRevisionRange('main..develop', 'qualified'), true);
			assert.strictEqual(isRevisionRange('main..', 'qualified'), false);
			assert.strictEqual(isRevisionRange('..develop', 'qualified'), false);
		});

		test('qualified-double-dot only matches ..', () => {
			assert.strictEqual(isRevisionRange('main..develop', 'qualified-double-dot'), true);
			assert.strictEqual(isRevisionRange('main...develop', 'qualified-double-dot'), false);
		});

		test('qualified-triple-dot only matches ...', () => {
			assert.strictEqual(isRevisionRange('main...develop', 'qualified-triple-dot'), true);
			assert.strictEqual(isRevisionRange('main..develop', 'qualified-triple-dot'), false);
		});
	});

	suite('getRevisionRangeParts', () => {
		test('parses double-dot range', () => {
			const result = getRevisionRangeParts('main..develop');
			assert.deepStrictEqual(result, { left: 'main', right: 'develop', notation: '..' });
		});

		test('parses triple-dot range', () => {
			const result = getRevisionRangeParts('main...develop');
			assert.deepStrictEqual(result, { left: 'main', right: 'develop', notation: '...' });
		});

		test('returns undefined for missing left side', () => {
			const result = getRevisionRangeParts('..develop');
			assert.strictEqual(result?.left, undefined);
			assert.strictEqual(result?.right, 'develop');
			assert.strictEqual(result?.notation, '..');
		});

		test('returns undefined for missing right side', () => {
			const result = getRevisionRangeParts('main..');
			assert.strictEqual(result?.left, 'main');
			assert.strictEqual(result?.right, undefined);
			assert.strictEqual(result?.notation, '..');
		});

		test('returns undefined for non-range input', () => {
			assert.strictEqual(getRevisionRangeParts('main' as any), undefined);
		});

		test('round-trips with createRevisionRange', () => {
			const range = createRevisionRange('feature', 'main', '...');
			const parts = getRevisionRangeParts(range);
			assert.deepStrictEqual(parts, { left: 'feature', right: 'main', notation: '...' });
		});
	});

	suite('stripOrigin', () => {
		test('strips origin/ prefix from a ref', () => {
			assert.strictEqual(stripOrigin('origin/main'), 'main');
		});

		test('strips first origin/ in range (non-global regex)', () => {
			// Non-global regex only replaces the first match
			assert.strictEqual(stripOrigin('origin/main..origin/develop'), 'main..origin/develop');
			assert.strictEqual(stripOrigin('origin/feat...origin/main'), 'feat...origin/main');
		});

		test('strips origin/ after range notation via lookbehind', () => {
			// Lookbehind (?<=..) matches any 2 chars before origin/
			assert.strictEqual(stripOrigin('main..origin/develop'), 'main..develop');
			assert.strictEqual(stripOrigin('main...origin/develop'), 'main...develop');
		});

		test('does not strip "origin" when not followed by /', () => {
			assert.strictEqual(stripOrigin('original'), 'original');
		});

		test('returns undefined when given undefined', () => {
			// eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
			assert.strictEqual(stripOrigin(undefined), undefined);
		});
	});
});
