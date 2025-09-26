const { fromCharCode } = String;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function base64(s: string): string;
export function base64(bytes: Uint8Array): string;
export function base64(data: string | Uint8Array): string {
	const bytes = typeof data === 'string' ? textEncoder.encode(data) : data;

	let output = '';
	for (let i = 0, { length } = bytes; i < length; i++) {
		output += fromCharCode(bytes[i]);
	}
	return globalThis.btoa(output);
}

export function fromBase64(s: string): Uint8Array {
	const decoded = globalThis.atob(s);

	const len = decoded.length;
	const bytes = new Uint8Array(len);

	// Unrolled loop for better performance on larger strings
	let i = 0;
	const end = len - (len % 8);
	for (; i < end; i += 8) {
		bytes[i] = decoded.charCodeAt(i);
		bytes[i + 1] = decoded.charCodeAt(i + 1);
		bytes[i + 2] = decoded.charCodeAt(i + 2);
		bytes[i + 3] = decoded.charCodeAt(i + 3);
		bytes[i + 4] = decoded.charCodeAt(i + 4);
		bytes[i + 5] = decoded.charCodeAt(i + 5);
		bytes[i + 6] = decoded.charCodeAt(i + 6);
		bytes[i + 7] = decoded.charCodeAt(i + 7);
	}
	// Handle remaining bytes
	for (; i < len; i++) {
		bytes[i] = decoded.charCodeAt(i);
	}

	return bytes;
}

/**
 * Decodes a base64-encoded string directly to a UTF-8 string.
 * More efficient than fromBase64().toString() for string conversion.
 */
export function fromBase64ToString(s: string): string {
	return textDecoder.decode(fromBase64(s));
}
