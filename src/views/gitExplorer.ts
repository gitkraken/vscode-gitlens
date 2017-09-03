'use strict';
import { Functions } from '../system';
import { commands, Event, EventEmitter, ExtensionContext, TextDocumentShowOptions, TextEditor, TreeDataProvider, TreeItem, Uri, window } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs, DiffWithWorkingCommandArgs, openEditor, OpenFileInRemoteCommandArgs } from '../commands';
import { UriComparer } from '../comparers';
import { CommandContext, setCommandContext } from '../constants';
import { CommitFileNode, CommitNode, ExplorerNode, HistoryNode, MessageNode, RepositoryNode, StashNode } from './explorerNodes';
import { GitService, GitUri } from '../gitService';

export * from './explorerNodes';

export type GitExplorerView =
    'history' |
    'repository';
export const GitExplorerView = {
    History: 'history' as GitExplorerView,
    Repository: 'repository' as GitExplorerView
};

export interface OpenFileRevisionCommandArgs {
    uri?: Uri;
    showOptions?: TextDocumentShowOptions;
}

export class GitExplorer implements TreeDataProvider<ExplorerNode> {

    private _root?: ExplorerNode;
    private _view: GitExplorerView = GitExplorerView.Repository;

    private _onDidChangeTreeData = new EventEmitter<ExplorerNode>();
    public get onDidChangeTreeData(): Event<ExplorerNode> {
        return this._onDidChangeTreeData.event;
    }

    constructor(private readonly context: ExtensionContext, private readonly git: GitService) {
        commands.registerCommand('gitlens.gitExplorer.switchToHistoryView', () => this.switchTo(GitExplorerView.History), this);
        commands.registerCommand('gitlens.gitExplorer.switchToRepositoryView', () => this.switchTo(GitExplorerView.Repository), this);
        commands.registerCommand('gitlens.gitExplorer.refresh', this.refresh, this);
        commands.registerCommand('gitlens.gitExplorer.openChanges', this.openChanges, this);
        commands.registerCommand('gitlens.gitExplorer.openChangesWithWorking', this.openChangesWithWorking, this);
        commands.registerCommand('gitlens.gitExplorer.openFile', this.openFile, this);
        commands.registerCommand('gitlens.gitExplorer.openFileRevision', this.openFileRevision, this);
        commands.registerCommand('gitlens.gitExplorer.openFileRevisionInRemote', this.openFileRevisionInRemote, this);
        commands.registerCommand('gitlens.gitExplorer.openChangedFiles', this.openChangedFiles, this);
        commands.registerCommand('gitlens.gitExplorer.openChangedFileRevisions', this.openChangedFileRevisions, this);
        commands.registerCommand('gitlens.gitExplorer.applyChanges', this.applyChanges, this);

        const fn = Functions.debounce(this.onActiveEditorChanged, 500);
        context.subscriptions.push(window.onDidChangeActiveTextEditor(fn, this));

        this._view = this.git.config.gitExplorer.view;
        setCommandContext(CommandContext.GitExplorerView, this._view);
        this._root = this.getRootNode();
    }

    async getTreeItem(node: ExplorerNode): Promise<TreeItem> {
        return node.getTreeItem();
    }

    async getChildren(node?: ExplorerNode): Promise<ExplorerNode[]> {
        if (this._root === undefined) {
            if (this._view === GitExplorerView.History) return [new MessageNode('No active file; no history to show')];
            return [];
        }

        if (node === undefined) return this._root.getChildren();
        return node.getChildren();
    }

    private getRootNode(editor?: TextEditor): ExplorerNode | undefined {
        const uri = new GitUri(Uri.file(this.git.repoPath), { repoPath: this.git.repoPath, fileName: this.git.repoPath });

        switch (this._view) {
            case GitExplorerView.History: return this.getHistoryNode(editor || window.activeTextEditor);
            case GitExplorerView.Repository: return new RepositoryNode(uri, this.context, this.git);
        }

        return undefined;
    }

    private getHistoryNode(editor: TextEditor | undefined): ExplorerNode | undefined {
        if (window.visibleTextEditors.length === 0) return undefined;
        if (editor === undefined) return this._root;

        const uri = this.git.getGitUriForFile(editor.document.uri) || new GitUri(editor.document.uri, { repoPath: this.git.repoPath, fileName: editor.document.uri.fsPath });
        if (UriComparer.equals(uri, this._root && this._root.uri)) return this._root;

        return new HistoryNode(uri, this.context, this.git);
    }

    private onActiveEditorChanged(editor: TextEditor | undefined) {
        if (this._view !== GitExplorerView.History) return;
        const root = this.getRootNode(editor);
        if (root === this._root) return;

        this.refresh(root);
    }

    refresh(root?: ExplorerNode) {
        this._root = root || this.getRootNode();
        this._onDidChangeTreeData.fire();
    }

    switchTo(view: GitExplorerView) {
        if (this._view === view) return;

        this._view = view;
        setCommandContext(CommandContext.GitExplorerView, this._view);

        this._root = undefined;
        this.refresh();
    }

    private async applyChanges(node: CommitNode | StashNode) {
        await this.git.checkoutFile(node.uri);
        return this.openFile(node);
    }

    private openChanges(node: CommitNode | StashNode) {
        const command = node.getCommand();
        if (command === undefined || command.arguments === undefined) return;

        const [uri, args] = command.arguments as [Uri, DiffWithPreviousCommandArgs];
        args.showOptions!.preview = false;
        return commands.executeCommand(command.command, uri, args);
    }

    private openChangesWithWorking(node: CommitNode | StashNode) {
        const args: DiffWithWorkingCommandArgs = {
            commit: node.commit,
            showOptions: {
                preserveFocus: true,
                preview: false

            }
        };
        return commands.executeCommand(Commands.DiffWithWorking, new GitUri(node.commit.uri, node.commit), args);
    }

    private openFile(node: CommitNode | StashNode) {
        return openEditor(node.uri, { preserveFocus: true, preview: false });
    }

    private openFileRevision(node: CommitNode | StashNode | CommitFileNode, options: OpenFileRevisionCommandArgs = { showOptions: { preserveFocus: true, preview: false } }) {
        return openEditor(options.uri || GitService.toGitContentUri(node.uri), options.showOptions || { preserveFocus: true, preview: false });
    }

    private async openChangedFiles(node: CommitNode | StashNode, options: TextDocumentShowOptions = { preserveFocus: false, preview: false }) {
        const repoPath = node.commit.repoPath;
        const uris = node.commit.fileStatuses.filter(s => s.status !== 'D').map(s => GitUri.fromFileStatus(s, repoPath));
        for (const uri of uris) {
            await openEditor(uri, options);
        }
    }

    private async openChangedFileRevisions(node: CommitNode | StashNode, options: TextDocumentShowOptions = { preserveFocus: false, preview: false }) {
        const uris = node.commit.fileStatuses
            .filter(s => s.status !== 'D')
            .map(s => GitService.toGitContentUri(node.commit.sha, node.commit.shortSha, s.fileName, node.commit.repoPath, s.originalFileName));
        for (const uri of uris) {
            await openEditor(uri, options);
        }
    }

    private async openFileRevisionInRemote(node: CommitNode | StashNode) {
        return commands.executeCommand(Commands.OpenFileInRemote, new GitUri(node.commit.uri, node.commit), { range: false } as OpenFileInRemoteCommandArgs);
    }
}