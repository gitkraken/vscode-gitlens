import { createHash, randomBytes, randomUUID } from 'crypto';

export function getNonce(): string {
	return randomBytes(16).toString('base64');
}

export function md5(data: string | Uint8Array, encoding: 'base64' | 'hex' = 'base64'): string {
	return createHash('md5').update(data).digest(encoding);
}

export function uuid(): string {
	return randomUUID();
}
