'use strict';
import { Range } from 'vscode';
import { IGitAuthor } from './commit';
import { GitLogCommit } from './logCommit';

export interface IGitLog {
    repoPath: string;
    authors: Map<string, IGitAuthor>;
    commits: Map<string, GitLogCommit>;

    sha: string | undefined;
    maxCount: number | undefined;
    range: Range;
    truncated: boolean;
}