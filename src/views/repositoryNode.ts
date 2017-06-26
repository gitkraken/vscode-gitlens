'use strict';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchesNode } from './branchesNode';
import { GlyphChars } from '../constants';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitService, GitUri } from '../gitService';
// import { StatusNode } from './statusNode';

export class RepositoryNode extends ExplorerNode {

    static readonly rootType: ResourceType = 'repository';
    readonly resourceType: ResourceType = 'repository';

    constructor(uri: GitUri, context: ExtensionContext, git: GitService) {
        super(uri, context, git);
     }

    async getChildren(): Promise<ExplorerNode[]> {
        return [
            // new StatusNode(this.uri, this.context, this.git),
            new BranchesNode(this.uri, this.context, this.git)
        ];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`Repository ${GlyphChars.Dash} ${this.uri.repoPath}`, TreeItemCollapsibleState.Expanded);
        item.contextValue = this.resourceType;
        return item;
    }
}