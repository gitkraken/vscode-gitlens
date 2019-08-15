'use strict';
import { StarredBranches, WorkspaceState } from '../../constants';
import { Container } from '../../container';
import { Git, GitRemote } from '../git';
import { GitStatus } from './status';
import { memoize } from '../../system';

const whitespaceRegex = /\s/;

export interface GitTrackingState {
    ahead: number;
    behind: number;
}

export class GitBranch {
    static is(branch: any): branch is GitBranch {
        return branch instanceof GitBranch;
    }

    static sort(branches: GitBranch[]) {
        return branches.sort(
            (a, b) =>
                (a.current ? -1 : 1) - (b.current ? -1 : 1) ||
                (a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
                (b.remote ? -1 : 1) - (a.remote ? -1 : 1) ||
                a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        );
    }

    readonly detached: boolean;
    readonly id: string;
    readonly tracking?: string;
    readonly state: GitTrackingState;

    constructor(
        public readonly repoPath: string,
        public readonly name: string,
        public readonly remote: boolean,
        public readonly current: boolean,
        public readonly sha?: string,
        tracking?: string,
        ahead: number = 0,
        behind: number = 0,
        detached: boolean = false
    ) {
        this.id = `${repoPath}|${remote ? 'remotes/' : 'heads/'}${name}`;

        this.detached = detached || (this.current ? GitBranch.isDetached(name) : false);
        if (this.detached) {
            this.name = GitBranch.formatDetached(this.sha!);
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

    @memoize()
    getBasename(): string {
        const name = this.getName();
        const index = name.lastIndexOf('/');
        return index !== -1 ? name.substring(index + 1) : name;
    }

    @memoize()
    getName(): string {
        return this.remote ? this.name.substring(this.name.indexOf('/') + 1) : this.name;
    }

    @memoize()
    async getRemote(): Promise<GitRemote | undefined> {
        const remoteName = this.getRemoteName();
        if (remoteName === undefined) return undefined;

        const remotes = await Container.git.getRemotes(this.repoPath);
        if (remotes.length === 0) return undefined;

        return remotes.find(r => r.name === remoteName);
    }

    @memoize()
    getRemoteName(): string | undefined {
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

    static formatDetached(sha: string): string {
        return `(${Git.shortenSha(sha)}...)`;
    }

    static getRemote(branch: string): string {
        return branch.substring(0, branch.indexOf('/'));
    }

    static isDetached(name: string): boolean {
        // If there is whitespace in the name assume this is not a valid branch name
        // Deals with detached HEAD states
        return whitespaceRegex.test(name) || name.includes('(detached)');
    }
}
