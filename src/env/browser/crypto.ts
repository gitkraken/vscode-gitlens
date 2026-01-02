import { base64 } from './base64.js';
import { convertToHex } from './hex.js';
import { md5 as _md5 } from './md5.js';

export function getNonce(): string {
	return base64(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

export function md5(data: string, encoding: 'base64' | 'hex' = 'hex'): string {
	return _md5(data, encoding);
}

export async function sha256(data: string, encoding: 'base64' | 'hex' = 'hex'): Promise<string> {
	const buffer = new TextEncoder().encode(data);
	const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', buffer));
	return encoding === 'base64' ? base64(bytes) : convertToHex(bytes);
}

export function uuid(): string {
	return globalThis.crypto.randomUUID();
}
