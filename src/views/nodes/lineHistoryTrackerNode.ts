'use strict';
import { Disposable, Selection, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { UriComparer } from '../../comparers';
import { Container } from '../../container';
import { GitUri } from '../../git/gitService';
import { debug, Functions, log } from '../../system';
import { LinesChangeEvent } from '../../trackers/gitLineTracker';
import { LineHistoryView } from '../lineHistoryView';
import { MessageNode } from './common';
import { LineHistoryNode } from './lineHistoryNode';
import { ResourceType, SubscribeableViewNode, unknownGitUri, ViewNode } from './viewNode';

export class LineHistoryTrackerNode extends SubscribeableViewNode<LineHistoryView> {
    private _child: LineHistoryNode | undefined;
    private _selection: Selection | undefined;

    constructor(view: LineHistoryView) {
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
                return [new MessageNode(this, 'There are no editors open that can provide line history')];
            }

            this._child = new LineHistoryNode(this.uri, this._selection!, this, this.view);
        }

        return [this._child];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem('Line History', TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.ActiveLineHistory;

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
                return true;
            }

            this._uri = unknownGitUri;
            this._selection = undefined;
            this.resetChild();

            return false;
        }

        if (
            UriComparer.equals(editor!.document.uri, this.uri) &&
            (this._selection !== undefined && editor.selection.isEqual(this._selection))
        ) {
            return true;
        }

        const gitUri = await GitUri.fromUri(editor!.document.uri);

        if (
            this.uri !== unknownGitUri &&
            UriComparer.equals(gitUri, this.uri) &&
            (this._selection !== undefined && editor.selection.isEqual(this._selection))
        ) {
            return true;
        }

        this._uri = gitUri;
        this._selection = editor.selection;
        this.resetChild();

        return false;
    }

    @log()
    setEditorFollowing(enabled: boolean) {
        this.canSubscribe = enabled;
    }

    @debug()
    protected async subscribe() {
        if (Container.lineTracker.isSubscribed(this)) return undefined;

        const onActiveLinesChanged = Functions.debounce(this.onActiveLinesChanged.bind(this), 250);

        return Container.lineTracker.start(
            this,
            Disposable.from(
                Container.lineTracker.onDidChangeActiveLines((e: LinesChangeEvent) => {
                    if (e.pending) return;

                    onActiveLinesChanged(e);
                })
            )
        );
    }

    @debug({ args: false })
    private onActiveLinesChanged(e: LinesChangeEvent) {
        void this.triggerChange();
    }
}
