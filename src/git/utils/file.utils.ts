import type { GitFile } from '../models/file';

export function isGitFile(file: any | undefined): file is GitFile {
	return (
		file != null &&
		'fileName' in file &&
		typeof file.fileName === 'string' &&
		'status' in file &&
		typeof file.status === 'string' &&
		file.status.length === 1
	);
}
