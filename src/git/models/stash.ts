'use strict';
import { GitStashCommit } from './stashCommit';

export interface GitStash {
    readonly repoPath: string;
    readonly commits: Map<string, GitStashCommit>;
}