'use strict';
import { memoize } from '../../system';

export class GitTag {
    constructor(
        public readonly repoPath: string,
        public readonly name: string,
        public readonly sha?: string,
        public readonly annotation?: string
    ) {}

    get ref() {
        return this.name;
    }

    @memoize()
    getBasename(): string {
        const index = this.name.lastIndexOf('/');
        return index !== -1 ? this.name.substring(index + 1) : this.name;
    }
}
