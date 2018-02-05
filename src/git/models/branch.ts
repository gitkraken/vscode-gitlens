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
        this.tracking = tracking === '' || tracking == null ? undefined : tracking;
        this.state = {
            ahead: ahead,
            behind: behind
        };
    }

    private _basename: string | undefined;
    getBasename(): string {
        if (this._basename === undefined) {
            const name = this.getName();
            const index = name.lastIndexOf('/');
            this._basename = index !== -1
                ? name.substring(index + 1)
                : name;
        }

        return this._basename;
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

    getRemote(): string | undefined {
        if (this.remote) return GitBranch.getRemote(this.name);
        if (this.tracking !== undefined) return GitBranch.getRemote(this.tracking);

        return undefined;
    }

    isValid(): boolean {
        return GitBranch.isValid(this.name);
    }

    static getRemote(branch: string): string {
        return branch.substring(0, branch.indexOf('/'));
    }

    static isValid(name: string): boolean {
        // If there is whitespace in the name assume this is not a valid branch name
        // Deals with detached HEAD states
        return name.match(/\s/) === null;
    }
}