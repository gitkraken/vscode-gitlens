'use strict';
import { Arrays } from '../../system';
import { GitTag } from './../git';

export class GitTagParser {
    static parse(data: string, repoPath: string): GitTag[] | undefined {
        if (!data) return undefined;

        const tags = Arrays.filterMap(data.split('\n'), t => (!!t ? new GitTag(repoPath, t) : undefined));
        if (!tags.length) return undefined;

        return tags;
    }
}
