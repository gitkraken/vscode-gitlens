import * as assert from 'assert';
import { fnv1aHash, fnv1aHash64 } from '../hash.js';

/**
 * Test vectors from RFC 9923 (FNV Non-Cryptographic Hash Algorithm), Section 8.3.
 * The RFC defines 4 test strings: "", "a", "foobar", "Hello!\x01\xFF\xED".
 * The 4th string contains raw bytes 0xFF/0xED which map to different charCodeAt
 * values than the byte values, so it is excluded from these tests.
 *
 * The 32-bit implementation uses `(hash * prime) | 0` which loses precision
 * when the product exceeds 2^53 (JS safe integer limit). The "" and "a" vectors
 * match the RFC; "foobar" diverges. The 64-bit implementation avoids this by
 * splitting into hi/lo 32-bit halves and matches the RFC vectors exactly.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9923.html — Section 8.3 (FNV Test Code)
 */

suite('Hash Test Suite', () => {
	// FNV-1a 32-bit test vectors: [input, expected hash, source]
	// RFC 9923 §8.3: FNV32svalues = { 0x811c9dc5, 0xe40c292c, 0xbf9cf968, 0xfd9d3881 }
	const fnv1a32Vectors: [string, number][] = [
		['', 0x811c9dc5], // RFC 9923 §8.3 — https://www.rfc-editor.org/rfc/rfc9923.html
		['a', 0xe40c292c], // RFC 9923 §8.3 — https://www.rfc-editor.org/rfc/rfc9923.html
		['foobar', 0xbf9cf968], // RFC 9923 §8.3 — https://www.rfc-editor.org/rfc/rfc9923.html
	];

	// FNV-1a 64-bit test vectors: [input, expected hash]
	// RFC 9923 §8.3: FNV64svalues = { 0xcbf29ce484222325, 0xaf63dc4c8601ec8c, 0x85944171f73967e8, 0xbd51ea7094ee6fa1 }
	const fnv1a64Vectors: [string, string][] = [
		['', 'cbf29ce484222325'], // RFC 9923 §8.3 — https://www.rfc-editor.org/rfc/rfc9923.html
		['a', 'af63dc4c8601ec8c'], // RFC 9923 §8.3 — https://www.rfc-editor.org/rfc/rfc9923.html
		['foobar', '85944171f73967e8'], // RFC 9923 §8.3 — https://www.rfc-editor.org/rfc/rfc9923.html
	];

	suite('fnv1aHash (32-bit)', () => {
		for (const [input, expected] of fnv1a32Vectors) {
			test(`hash of ${JSON.stringify(input)} should be 0x${(expected >>> 0).toString(16)}`, () => {
				// Compare as unsigned 32-bit: the function returns signed (| 0) for
				// non-empty strings but unsigned for empty string (no loop iteration)
				assert.strictEqual(fnv1aHash(input) >>> 0, expected >>> 0);
			});
		}

		test('returns a 32-bit integer', () => {
			const hash = fnv1aHash('test');
			assert.ok(hash >= -2147483648 && hash <= 2147483647, 'hash should be a 32-bit signed integer');
		});

		test('different inputs produce different hashes', () => {
			const hashes = new Set(['hello', 'world', 'foo', 'bar', 'baz'].map(s => fnv1aHash(s)));
			assert.strictEqual(hashes.size, 5, 'all hashes should be unique');
		});
	});

	suite('fnv1aHash64 (64-bit)', () => {
		for (const [input, expected] of fnv1a64Vectors) {
			test(`hash of ${JSON.stringify(input)} should be ${expected}`, () => {
				assert.strictEqual(fnv1aHash64(input), expected);
			});
		}

		test('returns a 16-character hex string', () => {
			const hash = fnv1aHash64('test');
			assert.match(hash, /^[0-9a-f]{16}$/, 'hash should be a 16-char lowercase hex string');
		});

		test('different inputs produce different hashes', () => {
			const hashes = new Set(['hello', 'world', 'foo', 'bar', 'baz'].map(s => fnv1aHash64(s)));
			assert.strictEqual(hashes.size, 5, 'all hashes should be unique');
		});
	});
});
