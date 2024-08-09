import * as assert from 'assert';
import { suite, test } from 'mocha';
import { join } from '../iterable';

suite('Iterable Test Suite', () => {
	test('join', () => {
		assert.strictEqual(join([1, 2, 3], ','), '1,2,3');
		assert.strictEqual(join([1, 2, 3], ''), '123');
		assert.strictEqual(join([], ''), '');
		assert.strictEqual(join([1], ''), '1');
		assert.strictEqual(join([1], ','), '1');
		assert.strictEqual(join([], ','), '');
	});
});
