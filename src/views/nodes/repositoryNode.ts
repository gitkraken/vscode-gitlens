'use strict';
import { Disposable, TreeItem, TreeItemCollapsibleState } from 'vscode';
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
import { Dates, debug, Functions, gate, log, Strings } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { BranchesNode } from './branchesNode';
import { BranchNode } from './branchNode';
import { MessageNode } from './common';
import { RemotesNode } from './remotesNode';
import { StashesNode } from './stashesNode';
import { StatusFilesNode } from './statusFilesNode';
import { StatusUpstreamNode } from './statusUpstreamNode';
import { TagsNode } from './tagsNode';
import { ResourceType, SubscribeableViewNode, ViewNode } from './viewNode';

export class RepositoryNode extends SubscribeableViewNode<RepositoriesView> {
    private _children: ViewNode[] | undefined;
    private _lastFetched: number = 0;
    private _status: Promise<GitStatus | undefined>;

    constructor(
        uri: GitUri,
        public readonly repo: Repository,
        parent: ViewNode,
        view: RepositoriesView
    ) {
        super(uri, parent, view);

        this._status = this.repo.getStatus();
    }

    get id(): string {
        return `gitlens:repository(${this.repo.path})`;
    }

    async getChildren(): Promise<ViewNode[]> {
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
                children.push(new BranchNode(branch, this.uri, this, this.view, false));

                if (status.state.behind) {
                    children.push(new StatusUpstreamNode(status, 'behind', this, this.view));
                }

                if (status.state.ahead) {
                    children.push(new StatusUpstreamNode(status, 'ahead', this, this.view));
                }

                if (status.state.ahead || (status.files.length !== 0 && this.includeWorkingTree)) {
                    const range = status.upstream ? `${status.upstream}..${branch.ref}` : undefined;
                    children.push(new StatusFilesNode(status, range, this, this.view));
                }

                children.push(new MessageNode(this, GlyphChars.Dash.repeat(2), ''));
            }

            children.push(
                new BranchesNode(this.uri, this.repo, this, this.view),
                new RemotesNode(this.uri, this.repo, this, this.view),
                new StashesNode(this.uri, this.repo, this, this.view),
                new TagsNode(this.uri, this.repo, this, this.view)
            );
            this._children = children;
        }
        return this._children;
    }

    async getTreeItem(): Promise<TreeItem> {
        let label = this.repo.formattedName || this.uri.repoPath || '';

        this._lastFetched = await this.repo.getLastFetched();

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

    @log()
    fetch(options: { progress?: boolean; remote?: string } = {}) {
        return this.repo.fetch(options);
    }

    @log()
    pull(options: { progress?: boolean } = {}) {
        return this.repo.pull(options);
    }

    @log()
    push(options: { force?: boolean; progress?: boolean } = {}) {
        return this.repo.push(options);
    }

    @gate()
    @debug()
    async refresh() {
        this._status = this.repo.getStatus();

        this._children = undefined;
        await this.ensureSubscription();
    }

    @debug()
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
        return this.view.config.includeWorkingTree;
    }

    @debug({
        args: {
            0: (e: RepositoryFileSystemChangeEvent) =>
                `{ repository: ${e.repository ? e.repository.name : ''}, uris: [${e.uris
                    .map(u => u.fsPath)
                    .join(', ')}] }`
        }
    })
    private onFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
        void this.triggerChange();
    }

    @debug({
        args: {
            0: (e: RepositoryChangeEvent) =>
                `{ repository: ${e.repository ? e.repository.name : ''}, changes: ${e.changes.join()} }`
        }
    })
    private onRepoChanged(e: RepositoryChangeEvent) {
        if (e.changed(RepositoryChange.Closed)) {
            this.dispose();

            return;
        }

        if (
            this._children === undefined ||
            e.changed(RepositoryChange.Repository) ||
            e.changed(RepositoryChange.Config)
        ) {
            void this.triggerChange();

            return;
        }

        if (e.changed(RepositoryChange.Stashes)) {
            const node = this._children.find(c => c instanceof StashesNode);
            if (node !== undefined) {
                void this.view.triggerNodeChange(node);
            }
        }

        if (e.changed(RepositoryChange.Remotes)) {
            const node = this._children.find(c => c instanceof RemotesNode);
            if (node !== undefined) {
                void this.view.triggerNodeChange(node);
            }
        }

        if (e.changed(RepositoryChange.Tags)) {
            const node = this._children.find(c => c instanceof TagsNode);
            if (node !== undefined) {
                void this.view.triggerNodeChange(node);
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

    @debug()
    private async updateLastFetched() {
        const prevLastFetched = this._lastFetched;
        this._lastFetched = await this.repo.getLastFetched();

        // If the fetched date hasn't changed and it was over a day ago, kick out
        if (this._lastFetched === prevLastFetched && Date.now() - this._lastFetched >= Dates.MillisecondsPerDay) return;

        this.view.triggerNodeChange(this);
    }
}
