'use strict';
// import { Arrays } from '../system';
import { commands, Event, EventEmitter, ExtensionContext, TextEditor, TreeDataProvider, TreeItem, Uri, window } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs, openEditor, OpenFileInRemoteCommandArgs } from '../commands';
import { UriComparer } from '../comparers';
import { CommitNode, ExplorerNode, FileHistoryNode, TextExplorerNode } from './explorerNodes';
import { GitService, GitUri } from '../gitService';

export * from './explorerNodes';

export class FileHistoryExplorer implements TreeDataProvider<ExplorerNode>  {

    private _node?: ExplorerNode;

    private _onDidChangeTreeData = new EventEmitter<ExplorerNode>();
    public get onDidChangeTreeData(): Event<ExplorerNode> {
        return this._onDidChangeTreeData.event;
    }

    constructor(private context: ExtensionContext, private git: GitService) {
        commands.registerCommand('gitlens.fileHistoryExplorer.refresh', this.refresh, this);
        commands.registerCommand('gitlens.fileHistoryExplorer.openChanges', this.openChanges, this);
        commands.registerCommand('gitlens.fileHistoryExplorer.openFile', this.openFile, this);
        commands.registerCommand('gitlens.fileHistoryExplorer.openFileRevision', this.openFileRevision, this);
        commands.registerCommand('gitlens.fileHistoryExplorer.openFileInRemote', this.openFileInRemote, this);
        commands.registerCommand('gitlens.fileHistoryExplorer.openFileRevisionInRemote', this.openFileRevisionInRemote, this);

        context.subscriptions.push(window.onDidChangeActiveTextEditor(this.onActiveEditorChanged, this));

        this._node = this.getRootNode(window.activeTextEditor);
    }

    async getTreeItem(node: ExplorerNode): Promise<TreeItem> {
        return node.getTreeItem();
    }

    async getChildren(node?: ExplorerNode): Promise<ExplorerNode[]> {
        if (this._node === undefined) return [new TextExplorerNode('No active file')];
        if (node === undefined) return this._node.getChildren();
        return node.getChildren();
    }

    private getRootNode(editor: TextEditor | undefined): ExplorerNode | undefined {
        if (window.visibleTextEditors.length === 0) return undefined;
        if (editor === undefined) return this._node;

        const uri = this.git.getGitUriForFile(editor.document.uri) || new GitUri(editor.document.uri, { repoPath: this.git.repoPath, fileName: editor.document.uri.fsPath });
        if (UriComparer.equals(uri, this._node && this._node.uri)) return this._node;

        return new FileHistoryNode(uri, this.context, this.git);
    }

    private onActiveEditorChanged(editor: TextEditor | undefined) {
        const node = this.getRootNode(editor);
        if (node === this._node) return;

        this.refresh();
    }

    refresh(node?: ExplorerNode) {
        this._node = node || this.getRootNode(window.activeTextEditor);
        this._onDidChangeTreeData.fire();
    }

    private openChanges(node: CommitNode) {
        const command = node.getCommand();
        if (command === undefined || command.arguments === undefined) return;

        const [uri, args] = command.arguments as [Uri, DiffWithPreviousCommandArgs];
        args.showOptions!.preview = false;
        return commands.executeCommand(command.command, uri, args);
    }

    private openFile(node: CommitNode) {
        return openEditor(node.uri, { preserveFocus: true, preview: false });
    }

    private openFileRevision(node: CommitNode) {
        return openEditor(GitService.toGitContentUri(node.uri), { preserveFocus: true, preview: false });
    }

    private async openFileInRemote(node: CommitNode) {
        return commands.executeCommand(Commands.OpenFileInRemote, node.commit.uri, { range: false } as OpenFileInRemoteCommandArgs);
    }

    private async openFileRevisionInRemote(node: CommitNode) {
        return commands.executeCommand(Commands.OpenFileInRemote, new GitUri(node.commit.uri, node.commit), { range: false } as OpenFileInRemoteCommandArgs);
    }
}