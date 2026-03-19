import * as assert from 'assert';
import type { GitFile } from '../../models/file.js';
import { resolveConflictFilePaths } from '../pausedOperationStatus.utils.js';

function file(path: string, status: string, originalPath?: string): GitFile {
	return { path: path, status: status as GitFile['status'], originalPath: originalPath };
}

suite('resolveConflictFilePaths Test Suite', () => {
	suite('no renames', () => {
		test('returns same path when file exists directly in both sides', () => {
			const currentFiles = [file('src/app.ts', 'M')];
			const incomingFiles = [file('src/app.ts', 'M')];

			const result = resolveConflictFilePaths(currentFiles, incomingFiles, 'src/app.ts');

			assert.deepStrictEqual(result, { lhsPath: 'src/app.ts', rhsPath: 'src/app.ts' });
		});

		test('returns same path when file lists are empty', () => {
			const result = resolveConflictFilePaths([], [], 'src/app.ts');

			assert.deepStrictEqual(result, { lhsPath: 'src/app.ts', rhsPath: 'src/app.ts' });
		});

		test('returns same path when file lists are undefined', () => {
			const result = resolveConflictFilePaths(undefined, undefined, 'src/app.ts');

			assert.deepStrictEqual(result, { lhsPath: 'src/app.ts', rhsPath: 'src/app.ts' });
		});
	});

	suite('git-recognized rename (R status)', () => {
		test('detects rename on current side', () => {
			const currentFiles = [file('new.ts', 'R', 'old.ts')];
			const incomingFiles = [file('old.ts', 'M')];

			const result = resolveConflictFilePaths(currentFiles, incomingFiles, 'new.ts');

			assert.deepStrictEqual(result, { lhsPath: 'old.ts', rhsPath: 'new.ts' });
		});

		test('detects rename on incoming side', () => {
			const currentFiles = [file('src/app.ts', 'M')];
			const incomingFiles = [file('new.ts', 'R', 'old.ts')];

			const result = resolveConflictFilePaths(currentFiles, incomingFiles, 'new.ts');

			assert.deepStrictEqual(result, { lhsPath: 'old.ts', rhsPath: 'old.ts' });
		});

		test('prioritizes current-side rename over incoming-side rename', () => {
			const currentFiles = [file('new.ts', 'R', 'current-old.ts')];
			const incomingFiles = [file('new.ts', 'R', 'incoming-old.ts')];

			const result = resolveConflictFilePaths(currentFiles, incomingFiles, 'new.ts');

			// Current side is checked first, so its originalPath wins
			assert.deepStrictEqual(result, { lhsPath: 'current-old.ts', rhsPath: 'new.ts' });
		});
	});

	suite('git-recognized copy (C status)', () => {
		test('detects copy on current side', () => {
			const currentFiles = [file('copy.ts', 'C', 'original.ts')];
			const incomingFiles = [file('original.ts', 'M')];

			const result = resolveConflictFilePaths(currentFiles, incomingFiles, 'copy.ts');

			assert.deepStrictEqual(result, { lhsPath: 'original.ts', rhsPath: 'copy.ts' });
		});

		test('detects copy on incoming side', () => {
			const currentFiles = [file('original.ts', 'M')];
			const incomingFiles = [file('copy.ts', 'C', 'original.ts')];

			const result = resolveConflictFilePaths(currentFiles, incomingFiles, 'copy.ts');

			assert.deepStrictEqual(result, { lhsPath: 'original.ts', rhsPath: 'original.ts' });
		});
	});

	suite('undetected rename via suffix matching', () => {
		test('detects undetected rename on current side via suffix match', () => {
			// filePath was added on current side, old path was deleted on current side,
			// and the old path also exists in incoming side
			const currentFiles = [file('packages/utils/src/helpers.ts', 'A'), file('src/helpers.ts', 'D')];
			const incomingFiles = [file('src/helpers.ts', 'M')];

			const result = resolveConflictFilePaths(currentFiles, incomingFiles, 'packages/utils/src/helpers.ts');

			assert.deepStrictEqual(result, {
				lhsPath: 'src/helpers.ts',
				rhsPath: 'packages/utils/src/helpers.ts',
			});
		});

		test('detects undetected rename on incoming side via suffix match', () => {
			const currentFiles = [file('src/helpers.ts', 'M')];
			const incomingFiles = [file('packages/utils/src/helpers.ts', 'A'), file('src/helpers.ts', 'D')];

			const result = resolveConflictFilePaths(currentFiles, incomingFiles, 'packages/utils/src/helpers.ts');

			// Incoming-side rename: both lhs and rhs resolve to the original path
			assert.deepStrictEqual(result, {
				lhsPath: 'src/helpers.ts',
				rhsPath: 'src/helpers.ts',
			});
		});

		test('suffix matching respects directory boundaries', () => {
			// 'bold.ts' should NOT match 'old.ts' even though 'old.ts' is a suffix of 'bold.ts'
			// The suffix check requires a '/' boundary: filePath.endsWith(`/${deleted.path}`)
			const currentFiles = [file('bold.ts', 'A'), file('old.ts', 'D')];
			const incomingFiles = [file('old.ts', 'M')];

			const result = resolveConflictFilePaths(currentFiles, incomingFiles, 'bold.ts');

			// No suffix match (bold.ts does not end with /old.ts), and no fallback match
			// because basenames differ (bold.ts != old.ts), so no rename is detected
			assert.deepStrictEqual(result, { lhsPath: 'bold.ts', rhsPath: 'bold.ts' });
		});

		test('prefers suffix match over fallback match', () => {
			// Two deleted files: one has a suffix match, the other is just a fallback
			const currentFiles = [
				file('packages/lib/src/utils.ts', 'A'),
				file('unrelated.ts', 'D'),
				file('src/utils.ts', 'D'),
			];
			const incomingFiles = [file('unrelated.ts', 'M'), file('src/utils.ts', 'M')];

			const result = resolveConflictFilePaths(currentFiles, incomingFiles, 'packages/lib/src/utils.ts');

			// src/utils.ts is a suffix match (preferred), unrelated.ts would be a fallback
			assert.deepStrictEqual(result, {
				lhsPath: 'src/utils.ts',
				rhsPath: 'packages/lib/src/utils.ts',
			});
		});
	});

	suite('no match found', () => {
		test('returns filePath for both sides when no rename is detected', () => {
			const currentFiles = [file('other.ts', 'M')];
			const incomingFiles = [file('another.ts', 'M')];

			const result = resolveConflictFilePaths(currentFiles, incomingFiles, 'src/app.ts');

			assert.deepStrictEqual(result, { lhsPath: 'src/app.ts', rhsPath: 'src/app.ts' });
		});
	});

	suite('R/C status without originalPath is ignored', () => {
		test('ignores R status entry when originalPath is missing', () => {
			const currentFiles = [file('new.ts', 'R')];
			const incomingFiles = [file('new.ts', 'M')];

			const result = resolveConflictFilePaths(currentFiles, incomingFiles, 'new.ts');

			assert.deepStrictEqual(result, { lhsPath: 'new.ts', rhsPath: 'new.ts' });
		});
	});
});
