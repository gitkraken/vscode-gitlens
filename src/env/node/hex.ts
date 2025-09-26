export function convertToHex(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('hex');
}

export function encodeUtf8Hex(s: string): string {
	return Buffer.from(s, 'utf8').toString('hex');
}

export function decodeUtf8Hex(hex: string): string {
	return Buffer.from(hex, 'hex').toString('utf8');
}
