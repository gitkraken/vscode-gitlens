import { normalizePath } from '@gitlens/utils/path.js';
import type { Uri } from '@gitlens/utils/uri.js';

export function getRepositoryOrWorktreePath(uri: Uri): string {
	return uri.scheme === 'file' ? normalizePath(uri.fsPath) : uri.toString();
}

export function getCommonRepositoryPath(commonUri: Uri): string {
	const uri = getCommonRepositoryUri(commonUri);
	return getRepositoryOrWorktreePath(uri);
}

export function getCommonRepositoryUri(commonUri: Uri): Uri {
	if (commonUri?.path.endsWith('/.git')) {
		return commonUri.with({ path: commonUri.path.substring(0, commonUri.path.length - 5) });
	}
	return commonUri;
}
