'use strict';
import { GitTag } from './../git';

const tagWithAnnotationRegex = /^(.+?)(?:$|(?:\s+)(.*)$)/gm;

export class GitTagParser {
    static parse(data: string, repoPath: string): GitTag[] | undefined {
        if (!data) return undefined;

        const tags: GitTag[] = [];

        let match: RegExpExecArray | null = null;
        do {
            match = tagWithAnnotationRegex.exec(data);
            if (match == null) break;

            tags.push(
                new GitTag(
                    repoPath,
                    // Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
                    (' ' + match[1]).substr(1),
                    // Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
                    match[2] === undefined ? undefined : (' ' + match[2]).substr(1)
                )
            );
        } while (match != null);

        if (!tags.length) return undefined;

        return tags;
    }
}
