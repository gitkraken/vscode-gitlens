/* oxlint-disable no-template-curly-in-string -- Tests exercise literal GitLens format tokens */
import * as assert from 'assert';
import { createBranchNameFromIssue } from '../startWork.utils.js';

suite('Start Work branch name format', () => {
	const issue = { id: 'ABC-123', title: 'Update login flow!' };

	test('default and blank formats preserve existing issue slugging', () => {
		assert.strictEqual(createBranchNameFromIssue(issue), 'ABC-123-update-login-flow');
		assert.strictEqual(createBranchNameFromIssue(issue, '  '), 'ABC-123-update-login-flow');
	});

	test('formats tokens and preserves literal branch hierarchy and capitalization', () => {
		assert.strictEqual(
			createBranchNameFromIssue(issue, 'Feature/${id}/${title}'),
			'Feature/ABC-123/update-login-flow',
		);
		assert.strictEqual(createBranchNameFromIssue(issue, 'fix/${id}'), 'fix/ABC-123');
	});

	test('supports GitLens token prefix, suffix and width modifiers', () => {
		assert.strictEqual(createBranchNameFromIssue(issue, "${'fix/'id'/work'}"), 'fix/ABC-123/work');
		assert.strictEqual(createBranchNameFromIssue(issue, '${title|8}'), 'update-l');
		assert.strictEqual(createBranchNameFromIssue(issue, '${id|10-}'), 'ABC-123');
		assert.strictEqual(createBranchNameFromIssue(issue, '${title|7}'), 'update');
		assert.strictEqual(createBranchNameFromIssue(issue, '${id|10}-${title}'), 'ABC-123-update-login-flow');
	});

	test('renders each token with its own options', () => {
		assert.strictEqual(createBranchNameFromIssue(issue, '${id|3}/${id}'), 'ABC/ABC-123');
		assert.strictEqual(createBranchNameFromIssue(issue, "${'x-'id}/${id}"), 'x-ABC-123/ABC-123');
	});

	test('normalizes invalid Git ref patterns and reserved branch names', () => {
		for (const [format, expected] of [
			['/.foo//bar.lock.lock/', 'foo/bar'],
			['--HEAD', 'HEAD-branch'],
			['HEAD', 'HEAD-branch'],
			['foo..bar@{baz}.[x] :?*~^\\', 'foo-bar-baz-.-x'],
			['foo/.bar./baz.lock.', 'foo/bar/baz'],
			['--.foo/foo.lock-/.-.bar.lock.-', 'foo/foo/bar'],
		] as const) {
			assert.strictEqual(createBranchNameFromIssue(issue, format), expected);
		}
	});

	test('slugifies issue Unicode and punctuation without exposing token data as paths', () => {
		assert.strictEqual(createBranchNameFromIssue({ id: '#42', title: 'Crème / brûlée' }), '42-creme-brulee');
	});

	test('rejects unknown, malformed and empty-result formats', () => {
		for (const format of ['${unknown}', '${id', '${id|abc}', '${id|1x}', '${id}${', '${}', '/', '...']) {
			assert.throws(() => createBranchNameFromIssue(issue, format), Error, format);
		}
	});
});
