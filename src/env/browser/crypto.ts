import { base64 } from './base64';
import { md5 as _md5 } from './md5';

export function getNonce(): string {
	return base64(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

export function md5(data: string, encoding: 'base64' | 'hex' = 'hex'): string {
	return _md5(data, encoding);
}

export function uuid(): string {
	return globalThis.crypto.randomUUID();
}
