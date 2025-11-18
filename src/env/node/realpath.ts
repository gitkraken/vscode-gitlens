import { realpath as fs_realpath } from 'fs';
import { promisify } from 'util';

export function realpath(path: string): Promise<string> {
	return promisify(fs_realpath)(path);
}
