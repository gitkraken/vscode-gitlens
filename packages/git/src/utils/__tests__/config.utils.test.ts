import * as assert from 'assert';
import { parseGitBoolean } from '../config.utils.js';

suite('parseGitBoolean Test Suite', () => {
	test('returns undefined for unset values', () => {
		assert.strictEqual(parseGitBoolean(undefined), undefined);
		assert.strictEqual(parseGitBoolean(null), undefined);
	});

	test('returns false for git falsy spellings, case- and whitespace-insensitive', () => {
		for (const value of ['', 'false', 'no', 'off', '0', ' FALSE ', 'No', 'OFF', '  0  ']) {
			assert.strictEqual(parseGitBoolean(value), false, `expected ${JSON.stringify(value)} to be false`);
		}
	});

	test('returns true for git truthy spellings and any other non-empty value', () => {
		for (const value of ['true', 'yes', '1', 'anything']) {
			assert.strictEqual(parseGitBoolean(value), true, `expected ${JSON.stringify(value)} to be true`);
		}
	});
});
