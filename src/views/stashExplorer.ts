'use strict';
// import { Functions } from '../system';
import { commands, Event, EventEmitter, ExtensionContext, TreeDataProvider, TreeItem, Uri } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs, openEditor } from '../commands';
import { ExplorerNode, StashCommitNode, StashNode } from './explorerNodes';
import { GitService, GitUri } from '../gitService';

export * from './explorerNodes';

export class StashExplorer implements TreeDataProvider<ExplorerNode>  {

    private _node: ExplorerNode;
    // private _refreshDebounced: () => void;

    private _onDidChangeTreeData = new EventEmitter<ExplorerNode>();
    public get onDidChangeTreeData(): Event<ExplorerNode> {
        return this._onDidChangeTreeData.event;
    }

    constructor(private context: ExtensionContext, private git: GitService) {
        commands.registerCommand('gitlens.stashExplorer.refresh', () => this.refresh());
        commands.registerCommand('gitlens.stashExplorer.openChanges', (node: StashCommitNode) => {
            const command = node.getCommand();
            if (command === undefined || command.arguments === undefined) return;

            const [uri, args] = command.arguments as [Uri, DiffWithPreviousCommandArgs];
            args.showOptions!.preview = false;
            commands.executeCommand(command.command, uri, args);
        });
        commands.registerCommand('gitlens.stashExplorer.openFile', (node: StashCommitNode) => openEditor(node.uri, { preserveFocus: true, preview: false }));
        commands.registerCommand('gitlens.stashExplorer.openStashedFile', (node: StashCommitNode) => openEditor(GitService.toGitContentUri(node.uri), { preserveFocus: true, preview: false }));
        commands.registerCommand('gitlens.stashExplorer.openFileInRemote', (node: StashCommitNode) => commands.executeCommand(Commands.OpenFileInRemote, node.commit.previousUri));

        context.subscriptions.push(this.git.onDidChangeRepo(reasons => {
            if (!reasons.includes('stash')) return;

            this.refresh();
        }, this));

        // this._refreshDebounced = Functions.debounce(this.refresh.bind(this), 250);

        // const editor = window.activeTextEditor;

        // const uri = (editor !== undefined && editor.document !== undefined)
        //     ? new GitUri(editor.document.uri, { repoPath: git.repoPath, fileName: editor.document.uri.fsPath })
        //     : new GitUri(Uri.file(git.repoPath), { repoPath: git.repoPath, fileName: git.repoPath });

        const uri = new GitUri(Uri.file(git.repoPath), { repoPath: git.repoPath, fileName: git.repoPath });
        this._node = new StashNode(uri, this.context, this.git);
    }

    async getTreeItem(node: ExplorerNode): Promise<TreeItem> {
        // if (node.onDidChangeTreeData !== undefined) {
        //     node.onDidChangeTreeData(() => setTimeout(this._refreshDebounced, 1));
        // }
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