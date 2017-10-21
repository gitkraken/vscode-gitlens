'use strict';
import { Strings } from '../system';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchesNode } from './branchesNode';
import { GlyphChars } from '../constants';
import { ExplorerNode, ResourceType } from './explorerNode';
import { GitService, GitUri, Repository } from '../gitService';
import { RemotesNode } from './remotesNode';
import { StatusNode } from './statusNode';
import { StashesNode } from './stashesNode';

export class RepositoryNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:repository';

    constructor(
        uri: GitUri,
        private repo: Repository,
        protected readonly context: ExtensionContext,
        protected readonly git: GitService
    ) {
        super(uri);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        return [
            new StatusNode(this.uri, this.context, this.git),
            new BranchesNode(this.uri, this.context, this.git),
            new RemotesNode(this.uri, this.context, this.git),
            new StashesNode(this.uri, this.context, this.git)
        ];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`Repository ${Strings.pad(GlyphChars.Dash, 1, 1)} ${this.repo.name || this.uri.repoPath}`, TreeItemCollapsibleState.Expanded);
        item.contextValue = this.resourceType;
        return item;
    }
}