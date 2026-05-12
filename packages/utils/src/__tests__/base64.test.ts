import * as assert from 'assert';
import { base64, fromBase64ToString } from '../base64.js';

suite('Base64 Test Suite', () => {
	suite('base64 (string input)', () => {
		test('encodes empty string', () => {
			assert.strictEqual(base64(''), '');
		});

		test('encodes single ASCII character', () => {
			assert.strictEqual(base64('a'), 'YQ==');
		});

		test('encodes simple ASCII string', () => {
			assert.strictEqual(base64('foobar'), 'Zm9vYmFy');
		});

		test('encodes string requiring two padding chars', () => {
			assert.strictEqual(base64('Ma'), 'TWE=');
		});

		test('encodes string requiring no padding', () => {
			assert.strictEqual(base64('Man'), 'TWFu');
		});
	});

	suite('base64 (Uint8Array input)', () => {
		test('encodes empty bytes', () => {
			assert.strictEqual(base64(new Uint8Array()), '');
		});

		test('encodes single byte', () => {
			assert.strictEqual(base64(new Uint8Array([0x61])), 'YQ==');
		});

		test('encodes ASCII bytes equivalently to string input', () => {
			const text = 'foobar';
			const bytes = new Uint8Array([0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72]);
			assert.strictEqual(base64(bytes), base64(text));
		});
	});

	suite('Deep-link round-trip with fromBase64ToString', () => {
		test('encodes and decodes a deep-link URL identically', () => {
			const input = 'vscode://eamodio.gitlens/link/r/abc123/b/main?url=https%3A%2F%2Fgithub.com%2Ffoo%2Fbar';
			const encoded = base64(input);
			const decoded = fromBase64ToString(encoded);
			assert.strictEqual(decoded, input);
		});

		test('round-trips an empty string', () => {
			assert.strictEqual(fromBase64ToString(base64('')), '');
		});
	});
});
