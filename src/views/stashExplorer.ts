'use strict';
// import { Functions } from '../system';
import { commands, Event, EventEmitter, ExtensionContext, TreeDataProvider, TreeItem, Uri } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs, openEditor, OpenFileInRemoteCommandArgs } from '../commands';
import { ExplorerNode, StashCommitNode, StashNode } from './explorerNodes';
import { GitService, GitUri } from '../gitService';

export * from './explorerNodes';

export class StashExplorer implements TreeDataProvider<ExplorerNode>  {

    private _node: ExplorerNode;

    private _onDidChangeTreeData = new EventEmitter<ExplorerNode>();
    public get onDidChangeTreeData(): Event<ExplorerNode> {
        return this._onDidChangeTreeData.event;
    }

    constructor(private context: ExtensionContext, private git: GitService) {
        commands.registerCommand('gitlens.stashExplorer.refresh', this.refresh, this);
        commands.registerCommand('gitlens.stashExplorer.openChanges', this.openChanges, this);
        commands.registerCommand('gitlens.stashExplorer.openFile', this.openFile, this);
        commands.registerCommand('gitlens.stashExplorer.openStashedFile', this.openStashedFile, this);
        commands.registerCommand('gitlens.stashExplorer.openFileInRemote', this.openFileInRemote, this);

        context.subscriptions.push(this.git.onDidChangeRepo(this.onRepoChanged, this));

        this._node = this.getRootNode();
    }

    async getTreeItem(node: ExplorerNode): Promise<TreeItem> {
        return node.getTreeItem();
    }

    async getChildren(node?: ExplorerNode): Promise<ExplorerNode[]> {
        if (node === undefined) return this._node.getChildren();
        return node.getChildren();
    }

    private getRootNode(): ExplorerNode {
        const uri = new GitUri(Uri.file(this.git.repoPath), { repoPath: this.git.repoPath, fileName: this.git.repoPath });
        return new StashNode(uri, this.context, this.git);
    }

    private onRepoChanged(reasons: ('stash' | 'unknown')[]) {
        if (!reasons.includes('stash')) return;

        this.refresh();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    private openChanges(node: StashCommitNode) {
        const command = node.getCommand();
        if (command === undefined || command.arguments === undefined) return;

        const [uri, args] = command.arguments as [Uri, DiffWithPreviousCommandArgs];
        args.showOptions!.preview = false;
        return commands.executeCommand(command.command, uri, args);
    }

    private openFile(node: StashCommitNode) {
        return openEditor(node.uri, { preserveFocus: true, preview: false });
    }

    private openStashedFile(node: StashCommitNode) {
        return openEditor(GitService.toGitContentUri(node.uri), { preserveFocus: true, preview: false });
    }

    private openFileInRemote(node: StashCommitNode) {
        return commands.executeCommand(Commands.OpenFileInRemote, node.commit.uri, { range: false } as OpenFileInRemoteCommandArgs);
    }
}