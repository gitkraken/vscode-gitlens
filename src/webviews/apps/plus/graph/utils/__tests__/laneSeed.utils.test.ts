import * as assert from 'assert';
import { laneSeedKey, pickLaneSeed } from '../laneSeed.utils.js';

suite('pickLaneSeed', () => {
	test('nothing available → undefined', () => {
		assert.strictEqual(pickLaneSeed({}), undefined);
	});

	test('the focused row wins', () => {
		assert.deepStrictEqual(pickLaneSeed({ focusedSha: 'fff', headSha: 'hhh' }), {
			sha: 'fff',
			origin: 'keyboard',
		});
	});

	test('HEAD is the fallback when no row is focused', () => {
		assert.deepStrictEqual(pickLaneSeed({ headSha: 'hhh' }), { sha: 'hhh', origin: 'head' });
	});
});

suite('laneSeedKey', () => {
	test('the key is `row:<sha>`, regardless of origin', () => {
		const key = laneSeedKey({ sha: 'aaa', origin: 'keyboard' });
		assert.strictEqual(key, 'row:aaa');
		assert.strictEqual(laneSeedKey({ sha: 'aaa', origin: 'head' }), key);
	});
});
