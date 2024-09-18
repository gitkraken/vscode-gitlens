const { fromCharCode } = String;
const textEncoder = new TextEncoder();

export function base64(s: string): string;
export function base64(bytes: Uint8Array): string;
export function base64(data: string | Uint8Array): string {
	const bytes = typeof data === 'string' ? textEncoder.encode(data) : data;

	let output = '';
	for (let i = 0, { length } = bytes; i < length; i++) {
		output += fromCharCode(bytes[i]);
	}
	// eslint-disable-next-line @typescript-eslint/no-deprecated
	return globalThis.btoa(output);
}

export function fromBase64(s: string): Uint8Array {
	// eslint-disable-next-line @typescript-eslint/no-deprecated
	const decoded = globalThis.atob(s);

	const len = decoded.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = decoded.charCodeAt(i);
	}
	return bytes;
}
