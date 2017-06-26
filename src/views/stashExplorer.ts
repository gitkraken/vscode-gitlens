'use strict';
import { commands, Event, EventEmitter, ExtensionContext, TreeDataProvider, TreeItem, Uri } from 'vscode';
import { ExplorerNode, StashNode } from './explorerNodes';
import { GitService, GitUri } from '../gitService';
import { StashCommitNode } from './stashCommitNode';

export * from './explorerNodes';

export class StashExplorer implements TreeDataProvider<ExplorerNode>  {

    private _node: ExplorerNode;
    private _onDidChangeTreeData = new EventEmitter<ExplorerNode>();
    public get onDidChangeTreeData(): Event<StashCommitNode> {
        return this._onDidChangeTreeData.event;
    }

    constructor(private context: ExtensionContext, private git: GitService) {
        commands.registerCommand('gitlens.stashExplorer.refresh', () => this.refresh());

        // const editor = window.activeTextEditor;

        // const uri = (editor !== undefined && editor.document !== undefined)
        //     ? new GitUri(editor.document.uri, { repoPath: git.repoPath, fileName: editor.document.uri.fsPath })
        //     : new GitUri(Uri.file(git.repoPath), { repoPath: git.repoPath, fileName: git.repoPath });

        const uri = new GitUri(Uri.file(git.repoPath), { repoPath: git.repoPath, fileName: git.repoPath });
        this._node = new StashNode(uri, this.context, this.git);
    }

    async getTreeItem(node: ExplorerNode): Promise<TreeItem> {
        return node.getTreeItem();
    }

    async getChildren(node?: ExplorerNode): Promise<ExplorerNode[]> {
        if (node === undefined) return this._node.getChildren();
        return node.getChildren();
    }

    update(uri: GitUri) {
        this._node = new StashNode(uri, this.context, this.git);
        this.refresh();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }
}