'use strict';
import { GitStashCommit } from './stashCommit';

export interface GitStash {
    repoPath: string;
    commits: Map<string, GitStashCommit>;
}