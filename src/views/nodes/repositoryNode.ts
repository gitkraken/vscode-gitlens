'use strict';
import * as fs from 'fs';
import * as path from 'path';
import { commands, Disposable, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import {
    GitBranch,
    GitStatus,
    GitUri,
    Repository,
    RepositoryChange,
    RepositoryChangeEvent,
    RepositoryFileSystemChangeEvent
} from '../../git/gitService';
import { Logger } from '../../logger';
import { Dates, Functions, Strings } from '../../system';
import { GitExplorer } from '../gitExplorer';
import { BranchesNode } from './branchesNode';
import { BranchNode } from './branchNode';
import { MessageNode } from './common';
import { ExplorerNode, ResourceType, SubscribeableExplorerNode } from './explorerNode';
import { RemotesNode } from './remotesNode';
import { StashesNode } from './stashesNode';
import { StatusFilesNode } from './statusFilesNode';
import { StatusUpstreamNode } from './statusUpstreamNode';
import { TagsNode } from './tagsNode';

export class RepositoryNode extends SubscribeableExplorerNode<GitExplorer> {
    private _children: ExplorerNode[] | undefined;
    private _lastFetched: number = 0;
    private _status: Promise<GitStatus | undefined>;

    constructor(
        uri: GitUri,
        public readonly repo: Repository,
        explorer: GitExplorer
    ) {
        super(uri, explorer);

        this._status = this.repo.getStatus();
    }

    get id(): string {
        return `gitlens:repository(${this.repo.path})`;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        if (this._children === undefined) {
            const children = [];

            const status = await this._status;
            if (status !== undefined) {
                const branch = new GitBranch(
                    status.repoPath,
                    status.branch,
                    true,
                    status.sha,
                    status.upstream,
                    status.state.ahead,
                    status.state.behind,
                    status.detached
                );
                children.push(new BranchNode(branch, this.uri, this.explorer, false));

                if (status.state.behind) {
                    children.push(new StatusUpstreamNode(status, 'behind', this.explorer));
                }

                if (status.state.ahead) {
                    children.push(new StatusUpstreamNode(status, 'ahead', this.explorer));
                }

                if (status.state.ahead || (status.files.length !== 0 && this.includeWorkingTree)) {
                    const range = status.upstream ? `${status.upstream}..${branch.ref}` : undefined;
                    children.push(new StatusFilesNode(status, range, this.explorer));
                }

                children.push(new MessageNode(GlyphChars.Dash.repeat(2), ''));
            }

            children.push(
                new BranchesNode(this.uri, this.repo, this.explorer),
                new RemotesNode(this.uri, this.repo, this.explorer),
                new StashesNode(this.uri, this.repo, this.explorer),
                new TagsNode(this.uri, this.repo, this.explorer)
            );
            this._children = children;
        }
        return this._children;
    }

    async getTreeItem(): Promise<TreeItem> {
        let label = this.repo.formattedName || this.uri.repoPath || '';

        this._lastFetched = await this.getLastFetched();

        const lastFetchedTooltip = this.formatLastFetched({
            prefix: `${Strings.pad(GlyphChars.Dash, 2, 2)}Last fetched on `,
            format: 'dddd MMMM Do, YYYY h:mm a'
        });

        let tooltip = this.repo.formattedName
            ? `${this.repo.formattedName}${lastFetchedTooltip}\n${this.uri.repoPath}`
            : `${this.uri.repoPath}${lastFetchedTooltip}`;
        let iconSuffix = '';
        let workingStatus = '';

        const status = await this._status;
        if (status !== undefined) {
            tooltip += `\n\n${status.branch}`;

            if (status.files.length !== 0 && this.includeWorkingTree) {
                workingStatus = status.getFormattedDiffStatus({
                    compact: true,
                    prefix: Strings.pad(GlyphChars.Dot, 2, 2)
                });
            }

            const upstreamStatus = status.getUpstreamStatus({
                prefix: `${GlyphChars.Space} `
            });

            label += `${Strings.pad(GlyphChars.Dash, 3, 3)}${status.branch}${upstreamStatus}${workingStatus}`;

            iconSuffix = workingStatus ? '-blue' : '';
            if (status.upstream !== undefined) {
                tooltip += ` is tracking ${status.upstream}\n${status.getUpstreamStatus({
                    empty: 'up-to-date',
                    expand: true,
                    separator: '\n',
                    suffix: '\n'
                })}`;

                if (status.state.behind) {
                    iconSuffix = '-red';
                }
                if (status.state.ahead) {
                    iconSuffix = status.state.behind ? '-yellow' : '-green';
                }
            }

            if (workingStatus) {
                tooltip += `\nWorking tree has uncommitted changes${status.getFormattedDiffStatus({
                    expand: true,
                    prefix: `\n`,
                    separator: '\n'
                })}`;
            }
        }

        const item = new TreeItem(
            `${label}${this.formatLastFetched({
                prefix: `${Strings.pad(GlyphChars.Dash, 4, 4)}Last fetched `
            })}`,
            TreeItemCollapsibleState.Expanded
        );
        item.id = this.id;
        item.contextValue = ResourceType.Repository;
        item.tooltip = tooltip;
        item.iconPath = {
            dark: Container.context.asAbsolutePath(`images/dark/icon-repo${iconSuffix}.svg`),
            light: Container.context.asAbsolutePath(`images/light/icon-repo${iconSuffix}.svg`)
        };

        void this.ensureSubscription();

        return item;
    }

    async fetch() {
        await commands.executeCommand('git.fetch', this.repo.path);

        await this.updateLastFetched();
        this.explorer.triggerNodeUpdate(this);
    }

    async pull() {
        await commands.executeCommand('git.pull', this.repo.path);

        await this.updateLastFetched();
        this.explorer.triggerNodeUpdate(this);
    }

    async push() {
        await commands.executeCommand('git.push', this.repo.path);

        this.explorer.triggerNodeUpdate(this);
    }

    refresh() {
        this._status = this.repo.getStatus();

        this._children = undefined;
        void this.ensureSubscription();
    }

    protected async subscribe() {
        const disposables = [this.repo.onDidChange(this.onRepoChanged, this)];

        if (this.includeWorkingTree) {
            disposables.push(
                this.repo.onDidChangeFileSystem(this.onFileSystemChanged, this),
                {
                    dispose: () => this.repo.stopWatchingFileSystem()
                },
                Functions.interval(() => void this.updateLastFetched(), 60000)
            );

            this.repo.startWatchingFileSystem();
        }

        return Disposable.from(...disposables);
    }

    private get includeWorkingTree(): boolean {
        return this.explorer.config.includeWorkingTree;
    }

    private onFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
        void this.explorer.refreshNode(this);
    }

    private onRepoChanged(e: RepositoryChangeEvent) {
        Logger.log(`RepositoryNode.onRepoChanged(${e.changes.join()}); triggering node refresh`);

        if (e.changed(RepositoryChange.Closed)) {
            this.dispose();

            return;
        }

        if (
            this._children === undefined ||
            e.changed(RepositoryChange.Repository) ||
            e.changed(RepositoryChange.Config)
        ) {
            void this.explorer.refreshNode(this);

            return;
        }

        if (e.changed(RepositoryChange.Stashes)) {
            const node = this._children.find(c => c instanceof StashesNode);
            if (node !== undefined) {
                void this.explorer.refreshNode(node);
            }
        }

        if (e.changed(RepositoryChange.Remotes)) {
            const node = this._children.find(c => c instanceof RemotesNode);
            if (node !== undefined) {
                void this.explorer.refreshNode(node);
            }
        }

        if (e.changed(RepositoryChange.Tags)) {
            const node = this._children.find(c => c instanceof TagsNode);
            if (node !== undefined) {
                void this.explorer.refreshNode(node);
            }
        }
    }

    private formatLastFetched(options: { prefix?: string; format?: string } = {}) {
        if (this._lastFetched === 0) return '';

        if (options.format === undefined && Date.now() - this._lastFetched < Dates.MillisecondsPerDay) {
            return `${options.prefix || ''}${Dates.toFormatter(new Date(this._lastFetched)).fromNow()}`;
        }

        return `${options.prefix || ''}${Dates.toFormatter(new Date(this._lastFetched)).format(
            options.format || 'MMM DD, YYYY'
        )}`;
    }

    private async getLastFetched(): Promise<number> {
        const hasRemotes = await this.repo.hasRemotes();
        if (!hasRemotes) return 0;

        return new Promise<number>((resolve, reject) =>
            fs.stat(path.join(this.repo.path, '.git/FETCH_HEAD'), (err, stat) =>
                resolve(err ? 0 : stat.mtime.getTime())
            )
        );
    }

    private async updateLastFetched() {
        const prevLastFetched = this._lastFetched;
        this._lastFetched = await this.getLastFetched();

        // If the fetched date hasn't changed and it was over a day ago, kick out
        if (this._lastFetched === prevLastFetched && Date.now() - this._lastFetched >= Dates.MillisecondsPerDay) return;

        this.explorer.triggerNodeUpdate(this);
    }
}
