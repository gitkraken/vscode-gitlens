'use strict';
import * as paths from 'path';
import { normalizePath } from './string';

const slash = '/';

export function splitPath(fileName: string, repoPath: string | undefined, extract: boolean = true): [string, string] {
	if (repoPath) {
		fileName = normalizePath(fileName);
		repoPath = normalizePath(repoPath);

		const normalizedRepoPath = (repoPath.endsWith(slash) ? repoPath : `${repoPath}/`).toLowerCase();
		if (fileName.toLowerCase().startsWith(normalizedRepoPath)) {
			fileName = fileName.substring(normalizedRepoPath.length);
		}
	} else {
		repoPath = normalizePath(extract ? paths.dirname(fileName) : repoPath!);
		fileName = normalizePath(extract ? paths.basename(fileName) : fileName);
	}

	return [fileName, repoPath];
}
