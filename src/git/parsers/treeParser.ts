'use strict';
import { GitTree } from '../git';

const emptyStr = '';
const treeRegex = /(?:.+?)\s+(.+?)\s+(.+?)\s+(.+?)\s+(.+)/gm;

export class GitTreeParser {
    static parse(data: string | undefined): GitTree[] | undefined {
        if (!data) return undefined;

        const trees: GitTree[] = [];

        let match: RegExpExecArray | null = null;
        do {
            match = treeRegex.exec(data);
            if (match == null) break;

            const [, type, commitSha, size, filePath] = match;
            trees.push({
                // Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
                commitSha: commitSha === undefined ? emptyStr : ` ${commitSha}`.substr(1),
                path: filePath === undefined ? emptyStr : filePath,
                size: size === '-' ? 0 : Number(size || 0),
                // Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
                type: (type === undefined ? emptyStr : ` ${type}`.substr(1)) as 'blob' | 'tree'
            });
        } while (match != null);

        if (!trees.length) return undefined;

        return trees;
    }
}
