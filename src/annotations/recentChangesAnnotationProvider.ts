'use strict';
import { MarkdownString, Position, Range, TextEditor, TextEditorDecorationType } from 'vscode';
import { FileAnnotationType } from '../configuration';
import { Container } from '../container';
import { GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { log, Strings } from '../system';
import { GitDocumentState, TrackedDocument } from '../trackers/gitDocumentTracker';
import { AnnotationProviderBase } from './annotationProvider';
import { Annotations } from './annotations';

export class RecentChangesAnnotationProvider extends AnnotationProviderBase {
    private readonly _uri: GitUri;

    constructor(
        editor: TextEditor,
        trackedDocument: TrackedDocument<GitDocumentState>,
        decoration: TextEditorDecorationType,
        highlightDecoration: TextEditorDecorationType | undefined
    ) {
        super(editor, trackedDocument, decoration, highlightDecoration);

        this._uri = trackedDocument.uri;
    }

    @log()
    async onProvideAnnotation(shaOrLine?: string | number): Promise<boolean> {
        const cc = Logger.getCorrelationContext();

        this.annotationType = FileAnnotationType.RecentChanges;

        const commit = await Container.git.getRecentLogCommitForFile(this._uri.repoPath, this._uri.fsPath);
        if (commit === undefined) return false;

        const diff = await Container.git.getDiffForFile(this._uri, commit.sha);
        if (diff === undefined) return false;

        let start = process.hrtime();

        const cfg = Container.config;
        const dateFormat = cfg.defaultDateFormat;

        this.decorations = [];

        for (const hunk of diff.hunks) {
            // Subtract 2 because editor lines are 0-based and we will be adding 1 in the first iteration of the loop
            let count = hunk.currentPosition.start - 2;
            for (const hunkLine of hunk.lines) {
                if (hunkLine.current === undefined) continue;

                count++;

                if (hunkLine.current.state === 'unchanged') continue;

                const range = this.editor.document.validateRange(
                    new Range(new Position(count, 0), new Position(count, Number.MAX_SAFE_INTEGER))
                );

                let message: MarkdownString | undefined = undefined;

                if (cfg.hovers.enabled && cfg.hovers.annotations.enabled) {
                    if (cfg.hovers.annotations.details) {
                        this.decorations.push({
                            hoverMessage: Annotations.getHoverMessage(
                                commit,
                                dateFormat,
                                await Container.vsls.getContactPresence(commit.email),
                                await Container.git.getRemotes(commit.repoPath),
                                this.annotationType,
                                count
                            ),
                            range: range
                        });
                    }

                    if (cfg.hovers.annotations.changes) {
                        message = Annotations.getHoverDiffMessage(commit, this._uri, hunkLine, count);
                        if (message === undefined) continue;
                    }
                }

                this.decorations.push({
                    hoverMessage: message,
                    range: range
                });
            }
        }

        Logger.log(cc, `${Strings.getDurationMilliseconds(start)} ms to compute recent changes annotations`);

        if (this.decorations.length) {
            start = process.hrtime();

            this.editor.setDecorations(this.decoration, this.decorations);

            Logger.log(cc, `${Strings.getDurationMilliseconds(start)} ms to apply recent changes annotations`);
        }

        return true;
    }

    selection(shaOrLine?: string | number): Promise<void> {
        return Promise.resolve(undefined);
    }

    validate(): Promise<boolean> {
        return Promise.resolve(true);
    }
}
