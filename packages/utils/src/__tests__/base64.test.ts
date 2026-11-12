import * as assert from 'assert';
import { base64, fromBase64ToString } from '../base64.js';
import * as browser from '../env/browser/base64.js';
import * as node from '../env/node/base64.js';

const deepLink = 'vscode://eamodio.gitlens/link/r/abc123/b/main?url=https%3A%2F%2Fgithub.com%2Ffoo%2Fbar';

const stringVectors: [input: string, encoded: string][] = [
	['', ''],
	['a', 'YQ=='],
	['Ma', 'TWE='],
	['Man', 'TWFu'],
	['foobar', 'Zm9vYmFy'],
	['héllo', 'aMOpbGxv'],
];

const byteVectors: [bytes: number[], encoded: string][] = [
	[[], ''],
	[[0x61], 'YQ=='],
	[[0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72], 'Zm9vYmFy'],
	[[0xff, 0x00, 0x80], '/wCA'],
];

// The `#env` import map always resolves `../base64.js` to the Node implementation under mocha, so both
// implementations are imported directly by path. The browser one runs on Node's spec-compliant web globals
// (btoa/atob/TextEncoder/TextDecoder), not in a real browser.
const implementations: [name: string, impl: typeof node][] = [
	['Node', node],
	['browser', browser],
];

suite('Base64 Test Suite', () => {
	for (const [name, impl] of implementations) {
		suite(`${name} implementation`, () => {
			for (const [input, encoded] of stringVectors) {
				test(`encodes and decodes ${JSON.stringify(input)}`, () => {
					assert.strictEqual(impl.base64(input), encoded);
					assert.strictEqual(impl.fromBase64ToString(encoded), input);
				});
			}

			for (const [bytes, encoded] of byteVectors) {
				test(`encodes and decodes bytes [${bytes.join(', ')}]`, () => {
					assert.strictEqual(impl.base64(new Uint8Array(bytes)), encoded);
					assert.deepStrictEqual([...impl.fromBase64(encoded)], bytes);
				});
			}

			test('round-trips a deep-link URL', () => {
				assert.strictEqual(impl.fromBase64ToString(impl.base64(deepLink)), deepLink);
			});
		});
	}

	test('decodes a deep-link URL encoded by the other implementation', () => {
		assert.strictEqual(browser.base64(deepLink), node.base64(deepLink));
		assert.strictEqual(browser.fromBase64ToString(node.base64(deepLink)), deepLink);
		assert.strictEqual(node.fromBase64ToString(browser.base64(deepLink)), deepLink);
	});

	test('round-trips through the environment-resolved entry point', () => {
		assert.strictEqual(fromBase64ToString(base64(deepLink)), deepLink);
	});
});
