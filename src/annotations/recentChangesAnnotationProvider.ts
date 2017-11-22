'use strict';
import { DecorationOptions, ExtensionContext, MarkdownString, Position, Range, TextEditor, TextEditorDecorationType } from 'vscode';
import { Annotations, endOfLineIndex } from './annotations';
import { FileAnnotationType } from './annotationController';
import { AnnotationProviderBase } from './annotationProvider';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';

export class RecentChangesAnnotationProvider extends AnnotationProviderBase {

    constructor(
        context: ExtensionContext,
        editor: TextEditor,
        decoration: TextEditorDecorationType | undefined,
        highlightDecoration: TextEditorDecorationType | undefined,
        private readonly git: GitService,
        private readonly uri: GitUri
    ) {
        super(context, editor, decoration, highlightDecoration);
    }

    async provideAnnotation(shaOrLine?: string | number): Promise<boolean> {
        this.annotationType = FileAnnotationType.RecentChanges;

        const commit = await this.git.getLogCommit(this.uri.repoPath, this.uri.fsPath, { previous: true });
        if (commit === undefined) return false;

        const diff = await this.git.getDiffForFile(this.uri, commit.previousSha);
        if (diff === undefined) return false;

        const start = process.hrtime();

        const cfg = this._config.annotations.file.recentChanges;
        const dateFormat = this._config.defaultDateFormat;

        this._decorations = [];

        for (const chunk of diff.chunks) {
            let count = chunk.currentPosition.start - 2;
            for (const line of chunk.lines) {
                if (line.line === undefined) continue;

                count++;

                if (line.state === 'unchanged') continue;

                const range = this.editor.document.validateRange(new Range(new Position(count, 0), new Position(count, endOfLineIndex)));

                if (cfg.hover.details) {
                    this._decorations.push({
                        hoverMessage: Annotations.getHoverMessage(commit, dateFormat, await this.git.hasRemote(commit.repoPath), this._config.blame.file.annotationType),
                        range: range
                    } as DecorationOptions);
                }

                let message: MarkdownString | undefined = undefined;
                if (cfg.hover.changes) {
                    message = Annotations.getHoverDiffMessage(commit, this.uri, line);
                }

                this._decorations.push({
                    hoverMessage: message,
                    range: range
                } as DecorationOptions);
            }
        }

        this.editor.setDecorations(this.highlightDecoration!, this._decorations);

        const duration = process.hrtime(start);
        Logger.log(`${(duration[0] * 1000) + Math.floor(duration[1] / 1000000)} ms to compute recent changes annotations`);

        return true;
    }

    async selection(shaOrLine?: string | number): Promise<void> {
    }

    async validate(): Promise<boolean> {
        return true;
    }
}