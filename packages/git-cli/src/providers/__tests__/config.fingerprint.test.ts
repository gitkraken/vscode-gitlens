import * as assert from 'assert';
import { isGkConfigStatRacy } from '../config.js';

const s = 1_000_000_000n;
const ms = 1_000_000n;

suite('isGkConfigStatRacy', () => {
	test('a file with whole-second times must have been stat’d 2s past its change', () => {
		const changed = 1_700_000_000n * s;
		const changedMs = Number(changed / ms);

		assert.strictEqual(isGkConfigStatRacy(changed, changed, changedMs + 1_999), true);
		assert.strictEqual(isGkConfigStatRacy(changed, changed, changedMs + 2_000), false);
	});

	test('a file with finer times must have been stat’d 50ms past its change', () => {
		const changed = 1_700_000_000n * s + 123_456_789n;
		const changedMs = Number(changed / ms);

		assert.strictEqual(
			isGkConfigStatRacy(changed, changed, changedMs + 50),
			true,
			'the change is part way into that ms',
		);
		assert.strictEqual(isGkConfigStatRacy(changed, changed, changedMs + 51), false);
	});

	test('measures from the later of mtime and ctime', () => {
		const mtime = 1_700_000_000n * s + 1n;
		const ctime = mtime + 5n * s;
		const ctimeMs = Number(ctime / ms);

		assert.strictEqual(isGkConfigStatRacy(mtime, ctime, ctimeMs + 10), true);
		assert.strictEqual(isGkConfigStatRacy(ctime, mtime, ctimeMs + 10), true);
		assert.strictEqual(isGkConfigStatRacy(mtime, ctime, ctimeMs + 51), false);
	});

	test('a change stamped after the stat (a clock ahead of ours) is racy', () => {
		const changed = 1_700_000_000n * s + 1n;

		assert.strictEqual(isGkConfigStatRacy(changed, changed, Number(changed / ms) - 10_000), true);
	});
});
