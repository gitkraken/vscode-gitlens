'use strict';
import { GitStashCommit } from './stashCommit';

export interface IGitStash {
    repoPath: string;
    commits: Map<string, GitStashCommit>;
}