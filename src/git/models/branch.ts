'use strict';

export class GitBranch {

    current: boolean;
    name: string;
    remote: boolean;
    tracking?: string;
    state: {
        ahead: number;
        behind: number;
    };

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

        this.current = current;
        this.name = branch;
        this.tracking = tracking;
        this.state = {
            ahead: ahead,
            behind: behind
        };
    }

    getName(): string {
        return this.remote
            ? this.name.substring(this.name.indexOf('/') + 1)
            : this.name;
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