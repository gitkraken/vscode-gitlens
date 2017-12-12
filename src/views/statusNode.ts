import { Disposable, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitExplorer } from './gitExplorer';
import { GitStatus, GitUri, Repository, RepositoryFileSystemChangeEvent } from '../gitService';
import { Logger } from '../logger';
import { StatusFilesNode } from './statusFilesNode';
import { StatusUpstreamNode } from './statusUpstreamNode';

export class StatusNode extends ExplorerNode {

    constructor(
        uri: GitUri,
        private readonly repo: Repository,
        private readonly parent: ExplorerNode,
        private readonly explorer: GitExplorer,
        private readonly active: boolean = false
    ) {
        super(uri);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        this.resetChildren();

        this.children = [];

        const status = await this.repo.getStatus();
        if (status === undefined) return this.children;

        if (status.state.behind) {
            this.children.push(new StatusUpstreamNode(status, 'behind', this.explorer));
        }

        if (status.state.ahead) {
            this.children.push(new StatusUpstreamNode(status, 'ahead', this.explorer));
        }

        if (status.state.ahead || (status.files.length !== 0 && this.includeWorkingTree)) {
            const range = status.upstream
                ? `${status.upstream}..${status.branch}`
                : undefined;
            this.children.push(new StatusFilesNode(status, range, this.explorer));
        }

        return this.children;
    }

    private _status: GitStatus | undefined;

    async getTreeItem(): Promise < TreeItem > {
        if (this.disposable !== undefined) {
            this.disposable.dispose();
            this.disposable = undefined;
        }

        const status = await this.repo.getStatus();
        if (status === undefined) return new TreeItem('No repo status');

        if (this.explorer.autoRefresh && this.includeWorkingTree) {
            this._status = status;

            this.disposable = Disposable.from(
                this.explorer.onDidChangeAutoRefresh(this.onAutoRefreshChanged, this),
                this.repo.onDidChangeFileSystem(this.onFileSystemChanged, this),
                { dispose: () => this.repo.stopWatchingFileSystem() }
            );

            this.repo.startWatchingFileSystem();
        }

        let hasChildren = false;
        const hasWorkingChanges = status.files.length !== 0 && this.includeWorkingTree;
        let label = '';
        let iconSuffix = '';
        if (status.upstream) {
            if (!status.state.ahead && !status.state.behind) {
                label = `${status.branch}${hasWorkingChanges ? ' has uncommitted changes and' : ''} is up-to-date with ${status.upstream}`;
            }
            else {
                label = `${status.branch}${hasWorkingChanges ? ' has uncommitted changes and' : ''} is not up-to-date with ${status.upstream}`;

                hasChildren = true;
                if (status.state.ahead && status.state.behind) {
                    iconSuffix = '-yellow';
                }
                else if (status.state.ahead) {
                    iconSuffix = '-green';
                }
                else if (status.state.behind) {
                    iconSuffix = '-red';
                }
            }
        }
        else {
            label = `${status.branch} ${hasWorkingChanges ? 'has uncommitted changes' : this.includeWorkingTree ? 'has no changes' : 'has nothing to commit'}`;
        }

        let state: TreeItemCollapsibleState;
        if (hasChildren || hasWorkingChanges) {
            // HACK: Until https://github.com/Microsoft/vscode/issues/30918 is fixed
            state = this.active ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed;
        }
        else {
            state = TreeItemCollapsibleState.None;
        }

        const item = new TreeItem(label, state);
        item.contextValue = ResourceType.Status;

        item.iconPath = {
            dark: this.explorer.context.asAbsolutePath(`images/dark/icon-repo${iconSuffix}.svg`),
            light: this.explorer.context.asAbsolutePath(`images/light/icon-repo${iconSuffix}.svg`)
        };

        return item;
    }

    private get includeWorkingTree(): boolean {
        return this.explorer.config.includeWorkingTree;
    }

    private onAutoRefreshChanged() {
        if (this.disposable === undefined) return;

        // If auto-refresh changes, just kill the subscriptions
        // (if it was enabled -- we will get refreshed so we don't have to worry about re-hooking it up here)
        this.disposable.dispose();
        this.disposable = undefined;
    }

    private async onFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
        const status = await this.repo.getStatus();

        // If we haven't changed from having some working changes to none or vice versa then just refresh the node
        // This is because of https://github.com/Microsoft/vscode/issues/34789
        if (this._status !== undefined && status !== undefined &&
            ((this._status.files.length === status.files.length) || (this._status.files.length > 0 && status.files.length > 0))) {

            Logger.log(`StatusNode.onFileSystemChanged; triggering node refresh`);
            this.explorer.refreshNode(this);

            return;
        }

        Logger.log(`StatusNode.onFileSystemChanged; triggering parent node refresh`);
        this.explorer.refreshNode(this.parent);
    }
}