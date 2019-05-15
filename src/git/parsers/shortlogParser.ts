'use strict';
import { GitContributor, GitShortLog } from '../git';
import { debug } from '../../system';

const shortlogRegex = /^(.*?)\t(.*?) <(.*?)>$/gm;

export class GitShortLogParser {
    @debug({ args: false, singleLine: true })
    static parse(data: string, repoPath: string): GitShortLog | undefined {
        if (!data) return undefined;

        const contributors: GitContributor[] = [];

        let count;
        let name;
        let email;

        let match: RegExpExecArray | null;
        do {
            match = shortlogRegex.exec(data);
            if (match == null) break;

            [, count, name, email] = match;

            contributors.push(
                new GitContributor(
                    repoPath,
                    // Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
                    ` ${name}`.substr(1),
                    // Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
                    ` ${email}`.substr(1),
                    Number(count) || 0
                )
            );
        } while (match != null);

        return { repoPath: repoPath, contributors: contributors };
    }
}
