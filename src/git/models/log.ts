'use strict';
import { Range } from 'vscode';
import { GitAuthor } from './commit';
import { GitLogCommit } from './logCommit';

export interface GitLog {
    readonly repoPath: string;
    readonly authors: Map<string, GitAuthor>;
    readonly commits: Map<string, GitLogCommit>;

    readonly sha: string | undefined;
    readonly count: number;
    readonly maxCount: number | undefined;
    readonly range: Range | undefined;
    readonly truncated: boolean;

    query?(maxCount: number | undefined): Promise<GitLog | undefined>;
}
