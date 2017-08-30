import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitService, GitUri } from '../gitService';
import { StatusUpstreamNode } from './statusUpstreamNode';

export class StatusNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:status';

    constructor(uri: GitUri, protected readonly context: ExtensionContext, protected readonly git: GitService) {
        super(uri);
     }

    async getChildren(): Promise<ExplorerNode[]> {
        const status = await this.git.getStatusForRepo(this.uri.repoPath!);
        if (status === undefined) return [];

        const children = [];

        if (status.state.behind) {
            children.push(new StatusUpstreamNode(status, 'behind', this.git.config.gitExplorer.commitFormat, this.context, this.git));
        }

        if (status.state.ahead) {
            children.push(new StatusUpstreamNode(status, 'ahead', this.git.config.gitExplorer.commitFormat, this.context, this.git));
        }

        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const status = await this.git.getStatusForRepo(this.uri.repoPath!);
        if (status === undefined) return new TreeItem('No repo status');

        let hasChildren = false;
        let label = '';
        if (status.upstream) {
            if (!status.state.ahead && !status.state.behind) {
                label = `${status.branch} is up-to-date with ${status.upstream}`;
            }
            else {
                label = `${status.branch} is not up-to-date with ${status.upstream}`;
                hasChildren = true;
            }
        }
        else {
            label = `${status.branch} is up-to-date`;
        }

        const item = new TreeItem(label, hasChildren ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.None);
        item.contextValue = this.resourceType;

        item.iconPath = {
            dark: this.context.asAbsolutePath('images/dark/icon-repo.svg'),
            light: this.context.asAbsolutePath('images/light/icon-repo.svg')
        };

        return item;
    }
}