import * as assert from 'assert';
import { laneSeedKey, pickLaneSeed } from '../laneSeed.utils.js';

const pill = { key: 'head:main', sha: 'aaa' };

suite('pickLaneSeed', () => {
	test('nothing available → undefined', () => {
		assert.strictEqual(pickLaneSeed({ source: 'pointer' }), undefined);
		assert.strictEqual(pickLaneSeed({ source: 'keyboard' }), undefined);
	});

	test('pointer wins when it moved last', () => {
		assert.deepStrictEqual(
			pickLaneSeed({ source: 'pointer', pointerSha: 'ppp', focusedSha: 'fff', headSha: 'hhh' }),
			{ kind: 'row', sha: 'ppp', origin: 'pointer' },
		);
	});

	test('keyboard wins when it moved last', () => {
		assert.deepStrictEqual(
			pickLaneSeed({ source: 'keyboard', pointerSha: 'ppp', focusedSha: 'fff', headSha: 'hhh' }),
			{ kind: 'row', sha: 'fff', origin: 'keyboard' },
		);
	});

	test('a hovered pill beats the hovered row within the pointer group', () => {
		assert.deepStrictEqual(pickLaneSeed({ source: 'pointer', pillRef: pill, pointerSha: 'ppp' }), {
			kind: 'pill',
			key: pill.key,
			sha: pill.sha,
		});
	});

	test('the keyboard row beats a hovered pill when the keyboard moved last', () => {
		assert.deepStrictEqual(pickLaneSeed({ source: 'keyboard', pillRef: pill, focusedSha: 'fff' }), {
			kind: 'row',
			sha: 'fff',
			origin: 'keyboard',
		});
	});

	test('pointer falls through to the focused row', () => {
		assert.deepStrictEqual(pickLaneSeed({ source: 'pointer', focusedSha: 'fff', headSha: 'hhh' }), {
			kind: 'row',
			sha: 'fff',
			origin: 'keyboard',
		});
	});

	test('keyboard falls through to the pointer', () => {
		assert.deepStrictEqual(pickLaneSeed({ source: 'keyboard', pillRef: pill, headSha: 'hhh' }), {
			kind: 'pill',
			key: pill.key,
			sha: pill.sha,
		});
		assert.deepStrictEqual(pickLaneSeed({ source: 'keyboard', pointerSha: 'ppp', headSha: 'hhh' }), {
			kind: 'row',
			sha: 'ppp',
			origin: 'pointer',
		});
	});

	test('HEAD is the last resort from either source', () => {
		assert.deepStrictEqual(pickLaneSeed({ source: 'pointer', headSha: 'hhh' }), {
			kind: 'row',
			sha: 'hhh',
			origin: 'head',
		});
		assert.deepStrictEqual(pickLaneSeed({ source: 'keyboard', headSha: 'hhh' }), {
			kind: 'row',
			sha: 'hhh',
			origin: 'head',
		});
	});
});

suite('laneSeedKey', () => {
	test('pill keys carry both the ref key and the sha', () => {
		assert.strictEqual(laneSeedKey({ kind: 'pill', key: 'head:main', sha: 'aaa' }), 'pill:head:main:aaa');
	});

	test('the same row from either origin dedups to one key', () => {
		const key = laneSeedKey({ kind: 'row', sha: 'aaa', origin: 'pointer' });
		assert.strictEqual(key, 'row:aaa');
		assert.strictEqual(laneSeedKey({ kind: 'row', sha: 'aaa', origin: 'keyboard' }), key);
		assert.strictEqual(laneSeedKey({ kind: 'row', sha: 'aaa', origin: 'head' }), key);
	});
});
