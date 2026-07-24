/**
 * Minimal BOM/UTF-16 detection + round-trip for the conflict-tools working-tree read/write port.
 *
 * `@gitkraken/conflict-tools` parses conflict markers from a JS string. Reading a UTF-16 (or
 * BOM-prefixed) file as UTF-8 yields mojibake with no parseable `<<<<<<<` markers, so the file
 * is silently skipped. Decoding by the detected encoding lets genuinely-textual UTF-16 files
 * resolve; the encode counterpart writes the AI result back in the same encoding so the file
 * doesn't silently flip to UTF-8. Pure (Buffer in/out) so it's unit-testable in isolation.
 */

export type DetectedEncoding = { encoding: 'utf8' | 'utf16le' | 'utf16be'; hasBom: boolean };

const utf8Bom = [0xef, 0xbb, 0xbf];
const utf16leBom = [0xff, 0xfe];
const utf16beBom = [0xfe, 0xff];

export function detectEncoding(buffer: Buffer): DetectedEncoding {
	if (buffer.length >= 2) {
		if (buffer[0] === 0xff && buffer[1] === 0xfe) return { encoding: 'utf16le', hasBom: true };
		if (buffer[0] === 0xfe && buffer[1] === 0xff) return { encoding: 'utf16be', hasBom: true };
	}
	if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
		return { encoding: 'utf8', hasBom: true };
	}
	return { encoding: 'utf8', hasBom: false };
}

export function decodeBuffer(buffer: Buffer, encoding?: DetectedEncoding): string {
	const enc = encoding ?? detectEncoding(buffer);
	let buf = buffer;
	if (enc.hasBom) {
		buf = buf.subarray(enc.encoding === 'utf8' ? utf8Bom.length : utf16leBom.length);
	}
	if (enc.encoding === 'utf16be') {
		// Node has no native utf16be decoder — swap each byte pair to little-endian first. Skip on an
		// odd length (malformed) and fall back to utf8 rather than throwing.
		if (buf.length % 2 === 0) return Buffer.from(buf).swap16().toString('utf16le');
		return buf.toString('utf8');
	}
	if (enc.encoding === 'utf16le') return buf.toString('utf16le');
	return buf.toString('utf8');
}

export function encodeContent(content: string, encoding: DetectedEncoding): Buffer {
	if (encoding.encoding === 'utf16le') {
		const body = Buffer.from(content, 'utf16le');
		return encoding.hasBom ? Buffer.concat([Buffer.from(utf16leBom), body]) : body;
	}
	if (encoding.encoding === 'utf16be') {
		const body = Buffer.from(content, 'utf16le').swap16();
		return encoding.hasBom ? Buffer.concat([Buffer.from(utf16beBom), body]) : body;
	}

	const body = Buffer.from(content, 'utf8');
	return encoding.hasBom ? Buffer.concat([Buffer.from(utf8Bom), body]) : body;
}
