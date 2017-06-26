import { Strings } from '../system';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../constants';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitService, GitUri } from '../gitService';

export class StatusNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'status';

    constructor(uri: GitUri, context: ExtensionContext, git: GitService) {
        super(uri, context, git);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        return [];
        // const status = await this.git.getStatusForRepo(this.uri.repoPath!);
        // if (status === undefined) return [];

        // return [...Iterables.map(status.files, b => new CommitFile(b, this.uri, this.context, this.git))];
    }

    async getTreeItem(): Promise<TreeItem> {
        const status = await this.git.getStatusForRepo(this.uri.repoPath!);
        let suffix = '';
        if (status !== undefined) {
            suffix = ` ${GlyphChars.Dash} ${GlyphChars.ArrowUp} ${status.state.ahead} ${GlyphChars.ArrowDown} ${status.state.behind} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${status.branch} ${GlyphChars.ArrowLeftRight} ${status.upstream}`;
        }

        const item = new TreeItem(`Status${suffix}`, TreeItemCollapsibleState.Collapsed);
        item.contextValue = this.resourceType;
        return item;
    }
}