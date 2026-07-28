import * as assert from 'assert';
import { getFileDiffPathspecs } from '../fileStatus.utils.js';

suite('getFileDiffPathspecs Test Suite', () => {
	test('returns just the path when there is no original path', () => {
		assert.deepStrictEqual(getFileDiffPathspecs({ path: 'src/foo.ts' }), ['src/foo.ts']);
		assert.deepStrictEqual(getFileDiffPathspecs({ path: 'src/foo.ts', originalPath: undefined }), ['src/foo.ts']);
	});

	test('returns both sides of a rename so the delete half survives pathspec limiting', () => {
		assert.deepStrictEqual(getFileDiffPathspecs({ path: 'src/new.ts', originalPath: 'src/old.ts' }), [
			'src/new.ts',
			'src/old.ts',
		]);
	});

	test('ignores an empty original path', () => {
		assert.deepStrictEqual(getFileDiffPathspecs({ path: 'src/foo.ts', originalPath: '' }), ['src/foo.ts']);
	});
});
