'use strict';
import { StarredBranches, WorkspaceState } from '../../constants';
import { Container } from '../../container';
import { Git } from '../git';
import { GitStatus } from './status';

export interface GitTrackingState {
    ahead: number;
    behind: number;
}

export class GitBranch {
    readonly detached: boolean;
    readonly id: string;
    readonly name: string;
    readonly remote: boolean;
    readonly tracking?: string;
    readonly state: GitTrackingState;

    constructor(
        public readonly repoPath: string,
        name: string,
        public readonly current: boolean = false,
        public readonly sha?: string,
        tracking?: string,
        ahead: number = 0,
        behind: number = 0,
        detached: boolean = false
    ) {
        this.id = `${repoPath}|${name}`;

        if (name.startsWith('remotes/')) {
            name = name.substring(8);
            this.remote = true;
        }
        else {
            this.remote = false;
        }

        this.detached = detached || (this.current ? GitBranch.isDetached(name) : false);
        if (this.detached) {
            this.name = GitBranch.formatDetached(this.sha!);
        }
        else {
            this.name = name;
        }

        this.tracking = tracking == null || tracking.length === 0 ? undefined : tracking;
        this.state = {
            ahead: ahead,
            behind: behind
        };
    }

    get ref() {
        return this.detached ? this.sha! : this.name;
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

    getTrackingStatus(options?: {
        empty?: string;
        expand?: boolean;
        prefix?: string;
        separator?: string;
        suffix?: string;
    }): string {
        return GitStatus.getUpstreamStatus(this.tracking, this.state, options);
    }

    get starred() {
        const starred = Container.context.workspaceState.get<StarredBranches>(WorkspaceState.StarredBranches);
        return starred !== undefined && starred[this.id] === true;
    }

    star() {
        return this.updateStarred(true);
    }

    unstar() {
        return this.updateStarred(false);
    }

    private async updateStarred(star: boolean) {
        let starred = Container.context.workspaceState.get<StarredBranches>(WorkspaceState.StarredBranches);
        if (starred === undefined) {
            starred = Object.create(null);
        }

        if (star) {
            starred![this.id] = true;
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [this.id]: _, ...rest } = starred!;
            starred = rest;
        }
        await Container.context.workspaceState.update(WorkspaceState.StarredBranches, starred);
    }

    static getRemote(branch: string): string {
        return branch.substring(0, branch.indexOf('/'));
    }

    static formatDetached(sha: string): string {
        return `(${Git.shortenSha(sha)}...)`;
    }

    static isDetached(name: string): boolean {
        // If there is whitespace in the name assume this is not a valid branch name
        // Deals with detached HEAD states
        return name.match(/\s/) !== null || name.match(/\(detached\)/) !== null;
    }
}
