'use strict';
import { GitBranch } from './../git';
const branchWithTrackingRegex = /^(\*?)\s+(.+?)\s+([0-9,a-f]+)\s+(?:\[(.*?\/.*?)(?:\:|\]))?/gm;

export class GitBranchParser {

    static parse(data: string, repoPath: string): GitBranch[] | undefined {
        if (!data) return undefined;

        const branches: GitBranch[] = [];

        let match: RegExpExecArray | null = null;
        do {
            match = branchWithTrackingRegex.exec(data);
            if (match == null) break;

            branches.push(new GitBranch(repoPath, match[2], match[1] === '*', match[4]));
        } while (match != null);

        if (!branches.length) return undefined;

        return branches;
    }
}