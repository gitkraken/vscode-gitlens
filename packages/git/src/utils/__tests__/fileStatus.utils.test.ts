import * as assert from 'assert';
import { getFileDiffPathspecs, toLiteralPathspecMatcher } from '../fileStatus.utils.js';

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

suite('toLiteralPathspecMatcher Test Suite', () => {
	test('matches an exact file and not its sibling', () => {
		const matches = toLiteralPathspecMatcher(['src/a.ts']);
		assert.strictEqual(matches('src/a.ts'), true);
		assert.strictEqual(matches('src/b.ts'), false);
	});

	test('matches a folder at any depth but not a name that merely starts with it', () => {
		const matches = toLiteralPathspecMatcher(['src']);
		assert.strictEqual(matches('src/a.ts'), true);
		assert.strictEqual(matches('src/deep/er/a.ts'), true);
		assert.strictEqual(matches('src2/a.ts'), false);
		assert.strictEqual(matches('srcfoo'), false);
	});

	test('treats a trailing slash as the same folder', () => {
		const matches = toLiteralPathspecMatcher(['new/']);
		assert.strictEqual(matches('new/n.txt'), true);
		assert.strictEqual(matches('newer/n.txt'), false);
	});

	test('matches everything for `.` and for an empty spec', () => {
		for (const spec of ['.', '']) {
			const matches = toLiteralPathspecMatcher(['src/a.ts', spec]);
			assert.strictEqual(matches('anything/at/all.ts'), true);
			assert.strictEqual(matches('top.ts'), true);
		}
	});

	test('treats glob characters literally', () => {
		const matches = toLiteralPathspecMatcher(['[id]']);
		assert.strictEqual(matches('[id]/page.txt'), true);
		assert.strictEqual(matches('i/page.txt'), false);
	});
});
