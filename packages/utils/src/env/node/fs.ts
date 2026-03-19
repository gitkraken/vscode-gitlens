import { realpath as _realpath } from 'fs/promises';

export function realpath(path: string): Promise<string> {
	return _realpath(path);
}
