'use strict';

export class GitBranch {

    readonly current: boolean;
    readonly name: string;
    readonly remote: boolean;
    readonly tracking?: string;
    readonly state: {
        ahead: number;
        behind: number;
    };
    basename: string;

    constructor(
        public readonly repoPath: string,
        branch: string,
        current: boolean = false,
        tracking?: string,
        ahead: number = 0,
        behind: number = 0
    ) {
        if (branch.startsWith('remotes/')) {
            branch = branch.substring(8);
            this.remote = true;
        }
        else {
            this.remote = false;
        }

        this.current = current;
        this.name = branch;
        this.basename = this.name.split('/').pop() || this.name;
        this.tracking = tracking === '' || tracking == null ? undefined : tracking;
        this.state = {
            ahead: ahead,
            behind: behind
        };
    }

    private _name: string | undefined;
    getName(): string {
        if (this._name === undefined) {
            this._name = this.remote
                ? this.name.substring(this.name.indexOf('/') + 1)
                : this.name;
        }

        return this._name;
    }

    getBasename(): string {
        return this.basename;
    }

    getRemote(): string | undefined {
        if (this.remote) return GitBranch.getRemote(this.name);
        if (this.tracking !== undefined) return GitBranch.getRemote(this.tracking);

        return undefined;
    }

    static getRemote(branch: string): string {
        return branch.substring(0, branch.indexOf('/'));
    }
}