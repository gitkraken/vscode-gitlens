'use strict';
import * as path from 'path';
import { Disposable, TextEditor, TreeItem, TreeItemCollapsibleState, Uri, window } from 'vscode';
import { UriComparer } from '../../comparers';
import { Container } from '../../container';
import { GitUri } from '../../git/gitService';
import { Functions } from '../../system';
import { FileHistoryExplorer } from '../fileHistoryExplorer';
import { MessageNode } from './common';
import { ExplorerNode, ResourceType, SubscribeableExplorerNode, unknownGitUri } from './explorerNode';
import { FileHistoryNode } from './fileHistoryNode';

export class ActiveFileHistoryNode extends SubscribeableExplorerNode<FileHistoryExplorer> {
    private _child: FileHistoryNode | undefined;

    constructor(explorer: FileHistoryExplorer) {
        super(unknownGitUri, explorer);
    }

    dispose() {
        super.dispose();

        this.resetChild();
    }

    resetChild() {
        if (this._child !== undefined) {
            this._child.dispose();
            this._child = undefined;
        }
    }

    async getChildren(): Promise<ExplorerNode[]> {
        if (this._child === undefined) {
            if (this.uri === unknownGitUri) {
                return [new MessageNode('There are no editors open that can provide file history')];
            }

            this._child = new FileHistoryNode(this.uri, this.explorer);
        }

        return [this._child];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem('File History', TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.ActiveFileHistory;

        void this.ensureSubscription();

        return item;
    }

    async refresh() {
        const editor = window.activeTextEditor;
        if (editor == null || !Container.git.isTrackable(editor.document.uri)) {
            if (
                this.uri === unknownGitUri ||
                (Container.git.isTrackable(this.uri) &&
                    window.visibleTextEditors.some(e => e.document && UriComparer.equals(e.document.uri, this.uri)))
            ) {
                return;
            }

            this._uri = unknownGitUri;
            this.resetChild();

            return;
        }

        if (UriComparer.equals(editor!.document.uri, this.uri)) return;

        let gitUri = await GitUri.fromUri(editor!.document.uri);

        let uri;
        if (gitUri.sha !== undefined) {
            // If we have a sha, normalize the history to the working file (so we get a full history all the time)
            const [fileName, repoPath] = await Container.git.findWorkingFileName(
                gitUri.fsPath,
                gitUri.repoPath,
                gitUri.sha
            );

            if (fileName !== undefined) {
                uri = Uri.file(repoPath !== undefined ? path.join(repoPath, fileName) : fileName);
            }
        }

        if (this.uri !== unknownGitUri && UriComparer.equals(uri || gitUri, this.uri)) return;

        if (uri !== undefined) {
            gitUri = await GitUri.fromUri(uri);
        }

        this._uri = gitUri;
        this.resetChild();
    }

    protected async subscribe() {
        return Disposable.from(
            window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveEditorChanged, 500), this)
        );
    }

    private onActiveEditorChanged(editor: TextEditor | undefined) {
        void this.explorer.refreshNode(this);
    }
}
