'use strict';
import { GitTree } from '../git';
import { debug } from '../../system';

const emptyStr = '';
const treeRegex = /(?:.+?)\s+(.+?)\s+(.+?)\s+(.+?)\s+(.+)/gm;

export class GitTreeParser {
	@debug({ args: false, singleLine: true })
	static parse(data: string | undefined): GitTree[] | undefined {
		if (!data) return undefined;

		const trees: GitTree[] = [];

		let type;
		let sha;
		let size;
		let filePath;

		let match;
		do {
			match = treeRegex.exec(data);
			if (match == null) break;

			[, type, sha, size, filePath] = match;

			trees.push({
				// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
				commitSha: sha == null || sha.length === 0 ? emptyStr : ` ${sha}`.substr(1),
				// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
				path: filePath == null || filePath.length === 0 ? emptyStr : ` ${filePath}`.substr(1),
				size: Number(size) || 0,
				// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
				type: (type == null || type.length === 0 ? emptyStr : ` ${type}`.substr(1)) as 'blob' | 'tree',
			});
		} while (true);

		return trees;
	}
}
