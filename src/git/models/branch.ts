import { GlyphChars } from '../../constants';

'use strict';

export class GitBranch {
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
        public readonly current: boolean = false,
        public readonly sha?: string,
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
            this._basename = index !== -1 ? name.substring(index + 1) : name;
        }

        return this._basename;
    }

    private _name: string | undefined;
    getName(): string {
        if (this._name === undefined) {
            this._name = this.remote ? this.name.substring(this.name.indexOf('/') + 1) : this.name;
        }

        return this._name;
    }

    getRemote(): string | undefined {
        if (this.remote) return GitBranch.getRemote(this.name);
        if (this.tracking !== undefined) return GitBranch.getRemote(this.tracking);

        return undefined;
    }

    getTrackingStatus(options: { empty?: string; expand?: boolean; prefix?: string; separator?: string } = {}): string {
        options = { empty: '', prefix: '', separator: ' ', ...options };
        if (this.tracking === undefined || (this.state.behind === 0 && this.state.ahead === 0)) return options.empty!;

        if (options.expand) {
            let status = '';
            if (this.state.behind) {
                status += `${this.state.behind} ${this.state.behind === 1 ? 'commit' : 'commits'} behind`;
            }
            if (this.state.ahead) {
                status += `${status === '' ? '' : options.separator}${this.state.ahead} ${
                    this.state.ahead === 1 ? 'commit' : 'commits'
                } ahead`;
            }
            return `${options.prefix}${status}`;
        }

        return `${options.prefix}${this.state.behind}${GlyphChars.ArrowDown}${options.separator}${this.state.ahead}${
            GlyphChars.ArrowUp
        }`;
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
