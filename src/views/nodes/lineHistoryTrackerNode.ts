'use strict';
import { Disposable, Selection, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { UriComparer } from '../../comparers';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitCommitish, GitUri } from '../../git/gitService';
import { Logger } from '../../logger';
import { CommandQuickPickItem, ReferencesQuickPick } from '../../quickpicks';
import { debug, Functions, gate, log } from '../../system';
import { LinesChangeEvent } from '../../trackers/gitLineTracker';
import { LineHistoryView } from '../lineHistoryView';
import { MessageNode } from './common';
import { LineHistoryNode } from './lineHistoryNode';
import { ResourceType, SubscribeableViewNode, unknownGitUri, ViewNode } from './viewNode';

export class LineHistoryTrackerNode extends SubscribeableViewNode<LineHistoryView> {
    private _base: string | undefined;
    private _child: LineHistoryNode | undefined;
    private _selection: Selection | undefined;

    constructor(view: LineHistoryView) {
        super(unknownGitUri, view);
    }

    dispose() {
        super.dispose();

        this.resetChild();
    }

    @debug()
    private resetChild() {
        if (this._child === undefined) return;

        this._child.dispose();
        this._child = undefined;
    }

    getChildren(): ViewNode[] {
        if (this._child === undefined) {
            if (this.uri === unknownGitUri) {
                return [
                    new MessageNode(
                        this.view,
                        this,
                        'There are no editors open that can provide line history information.'
                    )
                ];
            }

            const commitish: GitCommitish = {
                ...this.uri,
                repoPath: this.uri.repoPath!,
                sha: this.uri.sha || this._base
            };
            const fileUri = new GitUri(this.uri, commitish);
            this._child = new LineHistoryNode(fileUri, this.view, this, this._selection!);
        }

        return [this._child];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem('Line History', TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.ActiveLineHistory;

        void this.ensureSubscription();

        return item;
    }

    @gate()
    @log()
    async changeBase() {
        const pick = await new ReferencesQuickPick(this.uri.repoPath!).show(
            `Change the line history base to${GlyphChars.Ellipsis}`,
            {
                allowEnteringRefs: true,
                checked: this._base
            }
        );
        if (pick === undefined || pick instanceof CommandQuickPickItem) return;

        this._base = pick.current ? undefined : pick.ref;
        if (this._child === undefined) return;

        this._uri = unknownGitUri;
        await this.triggerChange();
    }

    @gate()
    @debug()
    async refresh(reset: boolean = false) {
        const cc = Logger.getCorrelationContext();

        if (reset) {
            this._uri = unknownGitUri;
            this._selection = undefined;
            this.resetChild();
        }

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

            if (cc !== undefined) {
                cc.exitDetails = `, uri=${Logger.toLoggable(this._uri)}`;
            }
            return false;
        }

        if (
            UriComparer.equals(editor!.document.uri, this.uri) &&
            (this._selection !== undefined && editor.selection.isEqual(this._selection))
        ) {
            if (cc !== undefined) {
                cc.exitDetails = `, uri=${Logger.toLoggable(this._uri)}`;
            }
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

        if (cc !== undefined) {
            cc.exitDetails = `, uri=${Logger.toLoggable(this._uri)}`;
        }
        return false;
    }

    @log()
    setEditorFollowing(enabled: boolean) {
        this.canSubscribe = enabled;
    }

    @debug()
    protected subscribe() {
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
