import { commands, Disposable, ExtensionContext, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitService, GitStatus, GitUri } from '../gitService';
import { StatusFilesNode } from './statusFilesNode';
import { StatusUpstreamNode } from './statusUpstreamNode';

let _eventDisposable: Disposable | undefined;

export class StatusNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:status';

    constructor(
        uri: GitUri,
        protected readonly context: ExtensionContext,
        protected readonly git: GitService
    ) {
        super(uri);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const status = await this.git.getStatusForRepo(this.uri.repoPath!);
        if (status === undefined) return [];

        const children: ExplorerNode[] = [];

        if (status.state.behind) {
            children.push(new StatusUpstreamNode(status, 'behind', this.context, this.git));
        }

        if (status.state.ahead) {
            children.push(new StatusUpstreamNode(status, 'ahead', this.context, this.git));
        }

        if (status.state.ahead || (status.files.length !== 0 && this.includeWorkingTree)) {
            const range = status.upstream
                ? `${status.upstream}..${status.branch}`
                : undefined;
            children.push(new StatusFilesNode(status, range, this.context, this.git));
        }

        return children;
    }

    private _status: GitStatus | undefined;

    async getTreeItem(): Promise < TreeItem > {
        const status = await this.git.getStatusForRepo(this.uri.repoPath!);
        if (status === undefined) return new TreeItem('No repo status');

        if (_eventDisposable !== undefined) {
            _eventDisposable.dispose();
            _eventDisposable = undefined;
        }

        if (this.includeWorkingTree) {
            this._status = status;

            _eventDisposable = this.git.onDidChangeFileSystem(this.onFileSystemChanged, this);
            this.git.startWatchingFileSystem();
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

        const item = new TreeItem(label, (hasChildren || hasWorkingChanges) ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.None);
        item.contextValue = this.resourceType;

        item.iconPath = {
            dark: this.context.asAbsolutePath(`images/dark/icon-repo${iconSuffix}.svg`),
            light: this.context.asAbsolutePath(`images/light/icon-repo${iconSuffix}.svg`)
        };

        return item;
    }

    private get includeWorkingTree(): boolean {
        return this.git.config.gitExplorer.includeWorkingTree;
    }

    private async onFileSystemChanged(uri: Uri) {
        const status = await this.git.getStatusForRepo(this.uri.repoPath!);

        // If we haven't changed from having some working changes to none or vice versa then just refresh the node
        // This is because of https://github.com/Microsoft/vscode/issues/34789
        if (this._status !== undefined && status !== undefined &&
            ((this._status.files.length === status.files.length) || (this._status.files.length > 0 && status.files.length > 0))) {
            commands.executeCommand('gitlens.gitExplorer.refreshNode', this);
        }

        commands.executeCommand('gitlens.gitExplorer.refresh');
    }
}