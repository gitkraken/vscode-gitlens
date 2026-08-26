import * as assert from 'node:assert';
import { formatResourceUsage } from '../resourceUsage.js';

suite('resourceUsage', () => {
	test('formats an empty report', () => {
		assert.strictEqual(formatResourceUsage({}), '');
	});

	test('formats byte metrics as memory sizes', () => {
		assert.strictEqual(
			formatResourceUsage({ 'extensionHost.memory.heapUsed.bytes': 2 * 1024 * 1024 }),
			'  extensionHost.memory.heapUsed.bytes = 2.0MB (2097152)',
		);
	});

	test('formats unavailable metrics explicitly', () => {
		assert.strictEqual(
			formatResourceUsage({ 'extensionHost.memory.heapUsed.bytes': undefined }),
			'  extensionHost.memory.heapUsed.bytes = unavailable',
		);
	});

	test('does not format large counts as memory sizes', () => {
		assert.strictEqual(
			formatResourceUsage({ 'cache.entries.total.count': 2_000_000 }),
			'  cache.entries.total.count = 2000000',
		);
	});

	test('sorts and aligns metrics', () => {
		assert.strictEqual(
			formatResourceUsage({ 'z.count': 2, 'longer.count': 1 }),
			'  longer.count = 1\n  z.count      = 2',
		);
	});
});
