'use strict';
import { GitBranch } from '../git';

const branchWithTrackingRegex = /^(\*?)\s+(.+?)\s+([0-9,a-f]+)\s+(?:\[(.*?\/.*?)(?::\s(.*)\]|\]))?/gm;
const branchWithTrackingStateRegex = /^(?:ahead\s([0-9]+))?[,\s]*(?:behind\s([0-9]+))?/;

export class GitBranchParser {
    static parse(data: string, repoPath: string): GitBranch[] | undefined {
        if (!data) return undefined;

        const branches: GitBranch[] = [];

        let match: RegExpExecArray | null;
        let ahead;
        let behind;
        let current;
        let name;
        let sha;
        let state;
        let tracking;
        do {
            match = branchWithTrackingRegex.exec(data);
            if (match == null) break;

            [, current, name, sha, tracking, state] = match;
            [ahead, behind] = this.parseState(state);
            branches.push(
                new GitBranch(
                    repoPath,
                    // Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
                    ` ${name}`.substr(1),
                    current === '*',
                    // Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
                    sha === undefined ? undefined : ` ${sha}`.substr(1),
                    // Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
                    tracking === undefined ? undefined : ` ${tracking}`.substr(1),
                    ahead,
                    behind
                )
            );
        } while (match != null);

        if (!branches.length) return undefined;

        return branches;
    }

    static parseState(state: string): [number, number] {
        if (state == null) return [0, 0];

        const match = branchWithTrackingStateRegex.exec(state);
        if (match == null) return [0, 0];

        const ahead = parseInt(match[1], 10);
        const behind = parseInt(match[2], 10);
        return [isNaN(ahead) ? 0 : ahead, isNaN(behind) ? 0 : behind];
    }
}
