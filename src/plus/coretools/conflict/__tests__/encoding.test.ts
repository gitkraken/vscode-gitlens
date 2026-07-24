import * as assert from 'assert';
import type { DetectedEncoding } from '../encoding.js';
import { decodeBuffer, detectEncoding, encodeContent } from '../encoding.js';

suite('coretools/conflict/encoding', () => {
	suite('detectEncoding', () => {
		test('plain UTF-8 (no BOM)', () => {
			const enc = detectEncoding(Buffer.from('hello', 'utf8'));
			assert.deepStrictEqual(enc, { encoding: 'utf8', hasBom: false });
		});

		test('UTF-8 with BOM', () => {
			const enc = detectEncoding(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hi', 'utf8')]));
			assert.deepStrictEqual(enc, { encoding: 'utf8', hasBom: true });
		});

		test('UTF-16 LE BOM', () => {
			const enc = detectEncoding(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hi', 'utf16le')]));
			assert.deepStrictEqual(enc, { encoding: 'utf16le', hasBom: true });
		});

		test('UTF-16 BE BOM', () => {
			const enc = detectEncoding(Buffer.from([0xfe, 0xff, 0x00, 0x68]));
			assert.deepStrictEqual(enc, { encoding: 'utf16be', hasBom: true });
		});

		test('empty buffer defaults to UTF-8', () => {
			assert.deepStrictEqual(detectEncoding(Buffer.alloc(0)), { encoding: 'utf8', hasBom: false });
		});
	});

	suite('decodeBuffer', () => {
		test('decodes UTF-16 LE with markers so they are parseable', () => {
			const content = '<<<<<<< ours\na\n=======\nb\n>>>>>>> theirs\n';
			const buf = encodeContent(content, { encoding: 'utf16le', hasBom: true });
			assert.strictEqual(decodeBuffer(buf), content);
		});

		test('decodes UTF-16 BE round-trip', () => {
			const content = 'héllo wörld';
			const buf = encodeContent(content, { encoding: 'utf16be', hasBom: true });
			assert.strictEqual(decodeBuffer(buf), content);
		});

		test('strips a UTF-8 BOM', () => {
			const buf = encodeContent('plain', { encoding: 'utf8', hasBom: true });
			assert.strictEqual(decodeBuffer(buf), 'plain');
		});
	});

	suite('encodeContent round-trips through detect+decode', () => {
		const cases: DetectedEncoding[] = [
			{ encoding: 'utf8', hasBom: false },
			{ encoding: 'utf8', hasBom: true },
			{ encoding: 'utf16le', hasBom: true },
			{ encoding: 'utf16be', hasBom: true },
		];
		const content = 'line1\nline2 ünïcode\nline3';
		for (const enc of cases) {
			test(`${enc.encoding}${enc.hasBom ? '+BOM' : ''}`, () => {
				const buf = encodeContent(content, enc);
				assert.deepStrictEqual(detectEncoding(buf), enc);
				assert.strictEqual(decodeBuffer(buf), content);
			});
		}
	});
});
