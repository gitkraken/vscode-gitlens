'use strict';

export class GitTag {

    constructor(
        public readonly repoPath: string,
        public readonly name: string
    ) { }
}