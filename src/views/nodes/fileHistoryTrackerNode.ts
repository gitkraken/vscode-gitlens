'use strict';
import * as paths from 'path';
import { Disposable, TextEditor, TreeItem, TreeItemCollapsibleState, Uri, window } from 'vscode';
import { UriComparer } from '../../comparers';
import { Container } from '../../container';
import { GitUri } from '../../git/gitService';
import { debug, Functions, gate, log } from '../../system';
import { FileHistoryView } from '../fileHistoryView';
import { MessageNode } from './common';
import { FileHistoryNode } from './fileHistoryNode';
import { ResourceType, SubscribeableViewNode, unknownGitUri, ViewNode } from './viewNode';

export class FileHistoryTrackerNode extends SubscribeableViewNode<FileHistoryView> {
    private _child: FileHistoryNode | undefined;

    constructor(view: FileHistoryView) {
        super(unknownGitUri, undefined, view);
    }

    dispose() {
        super.dispose();

        this.resetChild();
    }

    @debug()
    resetChild() {
        if (this._child !== undefined) {
            this._child.dispose();
            this._child = undefined;
        }
    }

    async getChildren(): Promise<ViewNode[]> {
        if (this._child === undefined) {
            if (this.uri === unknownGitUri) {
                return [new MessageNode(this, 'There are no editors open that can provide file history')];
            }

            this._child = new FileHistoryNode(this.uri, this, this.view);
        }

        return [this._child];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem('File History', TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.ActiveFileHistory;

        void this.ensureSubscription();

        return item;
    }

    @gate()
    @debug()
    async refresh() {
        const editor = window.activeTextEditor;
        if (editor == null || !Container.git.isTrackable(editor.document.uri)) {
            if (
                this.uri === unknownGitUri ||
                (Container.git.isTrackable(this.uri) &&
                    window.visibleTextEditors.some(e => e.document && UriComparer.equals(e.document.uri, this.uri)))
            ) {
                return true;
            }

            this._uri = unknownGitUri;
            this.resetChild();

            return false;
        }

        if (UriComparer.equals(editor!.document.uri, this.uri)) {
            return true;
        }

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
                uri = Uri.file(repoPath !== undefined ? paths.join(repoPath, fileName) : fileName);
            }
        }

        if (this.uri !== unknownGitUri && UriComparer.equals(uri || gitUri, this.uri)) {
            return true;
        }

        if (uri !== undefined) {
            gitUri = await GitUri.fromUri(uri);
        }

        this._uri = gitUri;
        this.resetChild();

        return false;
    }

    @log()
    setEditorFollowing(enabled: boolean) {
        this.canSubscribe = enabled;
    }

    @debug()
    protected async subscribe() {
        return Disposable.from(
            window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveEditorChanged, 500), this)
        );
    }

    @debug({ args: false })
    private onActiveEditorChanged(editor: TextEditor | undefined) {
        void this.triggerChange();
    }
}
