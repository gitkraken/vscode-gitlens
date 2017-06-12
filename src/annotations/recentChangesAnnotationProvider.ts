'use strict';
import { DecorationOptions, ExtensionContext, Position, Range, TextEditor, TextEditorDecorationType } from 'vscode';
import { endOfLineIndex } from './annotations';
import { FileAnnotationType } from './annotationController';
import { AnnotationProviderBase } from './annotationProvider';
import { CommitFormatter, GitService, GitUri } from '../gitService';

export class RecentChangesAnnotationProvider extends AnnotationProviderBase {

    constructor(context: ExtensionContext, editor: TextEditor, decoration: TextEditorDecorationType | undefined, highlightDecoration: TextEditorDecorationType | undefined, private git: GitService, private uri: GitUri) {
        super(context, editor, decoration, highlightDecoration, undefined);
    }

    async provideAnnotation(shaOrLine?: string | number): Promise<boolean> {
        this.annotationType = FileAnnotationType.RecentChanges;

        const commit = await this.git.getLogCommit(this.uri.repoPath, this.uri.fsPath, { previous: true });
        if (commit === undefined) return false;

        const diff = await this.git.getDiffForFile(this.uri, commit.previousSha);
        if (diff === undefined) return false;

        const cfg = this._config.annotations.file.recentChanges;
        const dateFormat = this._config.defaultDateFormat;

        const decorators: DecorationOptions[] = [];

        for (const chunk of diff.chunks) {
            let count = chunk.currentPosition.start - 2;
            for (const change of chunk.current) {
                if (change === undefined) continue;

                count++;

                if (change.state === 'unchanged') continue;

                let endingIndex = 0;
                if (cfg.hover.details || cfg.hover.changes) {
                    endingIndex = cfg.hover.wholeLine ? endOfLineIndex : this.editor.document.lineAt(count).firstNonWhitespaceCharacterIndex;
                }

                const range = this.editor.document.validateRange(new Range(new Position(count, 0), new Position(count, endingIndex)));

                if (cfg.hover.details) {
                    decorators.push({
                        hoverMessage: CommitFormatter.toHoverAnnotation(commit, dateFormat),
                        range: range
                    } as DecorationOptions);
                }

                let message: string | undefined = undefined;
                if (cfg.hover.changes) {
                    message = CommitFormatter.toHoverDiff(commit, chunk.previous[count], change);
                }

                decorators.push({
                    hoverMessage: message,
                    range: range
                } as DecorationOptions);
            }
        }

        this.editor.setDecorations(this.highlightDecoration!, decorators);

        return true;
    }

    async selection(shaOrLine?: string | number): Promise<void> {
    }

    async validate(): Promise<boolean> {
        return true;
    }
}