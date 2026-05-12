import * as assert from 'assert';
import {
	base64 as base64Browser,
	fromBase64 as fromBase64Browser,
	fromBase64ToString as fromBase64ToStringBrowser,
} from '../env/browser/base64.js';
import { base64 as base64Node, fromBase64ToString as fromBase64ToStringNode } from '../env/node/base64.js';

const deepLink = 'vscode://eamodio.gitlens/link/r/abc123/b/main?url=https%3A%2F%2Fgithub.com%2Ffoo%2Fbar';

// The `#env` import map always resolves `../base64.js` to the Node implementation under mocha, so the browser
// implementation is imported directly by path here. This runs the browser code on Node's spec-compliant web
// globals (btoa/atob/TextEncoder/TextDecoder), not in a real browser.
suite('Base64 (browser implementation) Test Suite', () => {
	suite('base64 (string input)', () => {
		test('encodes empty string', () => {
			assert.strictEqual(base64Browser(''), '');
		});

		test('encodes single ASCII character', () => {
			assert.strictEqual(base64Browser('a'), 'YQ==');
		});

		test('encodes simple ASCII string', () => {
			assert.strictEqual(base64Browser('foobar'), 'Zm9vYmFy');
		});

		test('encodes string requiring two padding chars', () => {
			assert.strictEqual(base64Browser('Ma'), 'TWE=');
		});

		test('encodes string requiring no padding', () => {
			assert.strictEqual(base64Browser('Man'), 'TWFu');
		});

		test('encodes multi-byte UTF-8 string', () => {
			assert.strictEqual(base64Browser('héllo'), 'aMOpbGxv');
		});
	});

	suite('base64 (Uint8Array input)', () => {
		test('encodes empty bytes', () => {
			assert.strictEqual(base64Browser(new Uint8Array()), '');
		});

		test('encodes high bytes', () => {
			assert.strictEqual(base64Browser(new Uint8Array([0xff, 0x00, 0x80])), '/wCA');
		});

		test('encodes ASCII bytes equivalently to string input', () => {
			const bytes = new Uint8Array([0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72]);
			assert.strictEqual(base64Browser(bytes), base64Browser('foobar'));
		});
	});

	suite('fromBase64 / fromBase64ToString', () => {
		test('decodes to bytes', () => {
			assert.deepStrictEqual([...fromBase64Browser('Zm9vYmFy')], [0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72]);
		});

		test('decodes multi-byte UTF-8 string', () => {
			assert.strictEqual(fromBase64ToStringBrowser('aMOpbGxv'), 'héllo');
		});

		test('round-trips a deep-link URL', () => {
			assert.strictEqual(fromBase64ToStringBrowser(base64Browser(deepLink)), deepLink);
		});
	});

	suite('parity with the Node implementation', () => {
		for (const v of ['', 'a', 'Man', 'foobar', 'héllo', deepLink]) {
			test(`matches Node for ${JSON.stringify(v)}`, () => {
				assert.strictEqual(base64Browser(v), base64Node(v));
				assert.strictEqual(fromBase64ToStringBrowser(base64Node(v)), v);
				assert.strictEqual(fromBase64ToStringNode(base64Browser(v)), v);
			});
		}
	});
});
