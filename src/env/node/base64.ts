export function base64(s: string): string;
export function base64(bytes: Uint8Array): string;
export function base64(data: string | Uint8Array): string {
	return Buffer.from(data).toString('base64');
}

export function fromBase64(s: string): Uint8Array {
	return Buffer.from(s, 'base64') as unknown as Uint8Array;
}
