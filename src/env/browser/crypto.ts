import MD5 from 'md5.js';
import { base64 } from './base64';

export function getNonce(): string {
	return base64(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

export function md5(data: string | Uint8Array, encoding: 'base64' | 'hex' = 'base64'): string {
	return new MD5().update(data).digest(encoding);
}

export function uuid(): string {
	return globalThis.crypto.randomUUID();
}
