'use strict';

export class GitTag {
    constructor(
        public readonly repoPath: string,
        public readonly name: string
    ) {}

    private _basename: string | undefined;
    getBasename(): string {
        if (this._basename === undefined) {
            const index = this.name.lastIndexOf('/');
            this._basename = index !== -1 ? this.name.substring(index + 1) : this.name;
        }

        return this._basename;
    }
}
