'use strict';
import { Disposable, TextEditor } from 'vscode';
import { Container } from '../container';
import { GitBlameCommit, GitLogCommit } from '../git/gitService';
import {
    DocumentBlameStateChangeEvent,
    DocumentDirtyIdleTriggerEvent,
    DocumentDirtyStateChangeEvent,
    GitDocumentState
} from './gitDocumentTracker';
import { LinesChangeEvent, LineTracker } from './lineTracker';

export * from './lineTracker';

export class GitLineState {
    constructor(public readonly commit: GitBlameCommit | undefined, public logCommit?: GitLogCommit) {}
}

export class GitLineTracker extends LineTracker<GitLineState> {
    private _count = 0;
    private _subscriptions: Map<any, Disposable> = new Map();

    protected async fireLinesChanged(e: LinesChangeEvent) {
        this.reset();

        let updated = false;
        if (!this._suspended && !e.pending && e.lines !== undefined && e.editor !== undefined) {
            updated = await this.updateState(e.lines, e.editor);
        }

        return super.fireLinesChanged(updated ? e : { ...e, lines: undefined });
    }

    private onBlameStateChanged(e: DocumentBlameStateChangeEvent<GitDocumentState>) {
        this.trigger('editor');
    }

    private onDirtyIdleTriggered(e: DocumentDirtyIdleTriggerEvent<GitDocumentState>) {
        const maxLines = Container.config.advanced.blame.sizeThresholdAfterEdit;
        if (maxLines > 0 && e.document.lineCount > maxLines) return;

        this.resume();
    }

    private onDirtyStateChanged(e: DocumentDirtyStateChangeEvent<GitDocumentState>) {
        if (e.dirty) {
            this.suspend();
        }
        else {
            this.resume({ force: true });
        }
    }

    private _suspended = false;

    private resume(options: { force?: boolean } = {}) {
        if (!options.force && !this._suspended) return;

        this._suspended = false;
        this.trigger('editor');
    }

    private suspend(options: { force?: boolean } = {}) {
        if (!options.force && this._suspended) return;

        this._suspended = true;
        this.trigger('editor');
    }

    isSubscribed(subscriber: any) {
        return this._subscriptions.has(subscriber);
    }

    start(subscriber: any, subscription: Disposable): Disposable {
        const disposable = {
            dispose: () => this.stop(subscriber)
        };

        if (this.isSubscribed(subscriber)) return disposable;

        this._subscriptions.set(subscriber, subscription);

        this._count++;
        if (this._count === 1) {
            super.start();

            this._disposable = Disposable.from(
                this._disposable!,
                Container.tracker.onDidChangeBlameState(this.onBlameStateChanged, this),
                Container.tracker.onDidChangeDirtyState(this.onDirtyStateChanged, this),
                Container.tracker.onDidTriggerDirtyIdle(this.onDirtyIdleTriggered, this)
            );
        }

        return disposable;
    }

    stop(subscriber: any) {
        const subscription = this._subscriptions.get(subscriber);
        if (subscription === undefined) return;

        this._subscriptions.delete(subscriber);
        subscription.dispose();

        if (this._disposable === undefined) {
            this._count = 0;
            return;
        }

        this._count--;
        if (this._count === 0) {
            super.stop();
        }
    }

    private async updateState(lines: number[], editor: TextEditor): Promise<boolean> {
        const trackedDocument = await Container.tracker.getOrAdd(editor.document);
        if (!trackedDocument.isBlameable || !this.includesAll(lines)) return false;

        if (lines.length === 1) {
            const blameLine = editor.document.isDirty
                ? await Container.git.getBlameForLineContents(trackedDocument.uri, lines[0], editor.document.getText())
                : await Container.git.getBlameForLine(trackedDocument.uri, lines[0]);
            if (blameLine === undefined) return false;

            this.setState(blameLine.line.line - 1, new GitLineState(blameLine.commit));
        }
        else {
            const blame = editor.document.isDirty
                ? await Container.git.getBlameForFileContents(trackedDocument.uri, editor.document.getText())
                : await Container.git.getBlameForFile(trackedDocument.uri);
            if (blame === undefined) return false;

            for (const line of lines) {
                const commitLine = blame.lines[line];
                this.setState(line, new GitLineState(blame.commits.get(commitLine.sha)));
            }
        }

        if (!trackedDocument.isBlameable || !this.includesAll(lines)) return false;

        if (editor.document.isDirty) {
            trackedDocument.setForceDirtyStateChangeOnNextDocumentChange();
        }

        return true;
    }
}
