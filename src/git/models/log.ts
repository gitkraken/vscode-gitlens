'use strict';
import { Range } from 'vscode';
import { GitAuthor } from './commit';
import { GitLogCommit } from './logCommit';

export interface GitLog {
    repoPath: string;
    authors: Map<string, GitAuthor>;
    commits: Map<string, GitLogCommit>;

    sha: string | undefined;
    maxCount: number | undefined;
    range: Range;
    truncated: boolean;
}