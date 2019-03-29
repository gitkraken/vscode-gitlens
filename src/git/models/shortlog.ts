'use strict';
import { GitContributor } from './contributor';

export interface GitShortLog {
    readonly repoPath: string;
    readonly contributors: GitContributor[];
}
