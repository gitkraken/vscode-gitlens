'use strict';
import { Iterables } from '../system';
import { ExtensionContext, Range, TextEditor, TextEditorDecorationType } from 'vscode';
import { AnnotationProviderBase } from './annotationProvider';
import { GitBlame, GitService, GitUri } from '../gitService';
import { WhitespaceController } from './whitespaceController';

export abstract class BlameAnnotationProviderBase extends AnnotationProviderBase {

    protected _blame: Promise<GitBlame>;

    constructor(context: ExtensionContext, editor: TextEditor, decoration: TextEditorDecorationType, highlightDecoration: TextEditorDecorationType | undefined, whitespaceController: WhitespaceController | undefined, protected git: GitService, protected uri: GitUri) {
        super(context, editor, decoration, highlightDecoration, whitespaceController);

        this._blame = this.git.getBlameForFile(this.uri);
    }

    async selection(shaOrLine?: string | number, blame?: GitBlame) {
        if (!this.highlightDecoration) return;

        if (blame === undefined) {
            blame = await this._blame;
            if (!blame || !blame.lines.length) return;
        }

        const offset = this.uri.offset;

        let sha: string | undefined = undefined;
        if (typeof shaOrLine === 'string') {
            sha = shaOrLine;
        }
        else if (typeof shaOrLine === 'number') {
            const line = shaOrLine - offset;
            if (line >= 0) {
                const commitLine = blame.lines[line];
                sha = commitLine && commitLine.sha;
            }
        }
        else {
            sha = Iterables.first(blame.commits.values()).sha;
        }

        if (!sha) {
            this.editor.setDecorations(this.highlightDecoration, []);
            return;
        }

        const highlightDecorationRanges = blame.lines
            .filter(l => l.sha === sha)
            .map(l => this.editor.document.validateRange(new Range(l.line + offset, 0, l.line + offset, 1000000)));

        this.editor.setDecorations(this.highlightDecoration, highlightDecorationRanges);
    }

    async validate(): Promise<boolean> {
        const blame = await this._blame;
        return blame !== undefined && blame.lines.length !== 0;
    }

    protected async getBlame(requiresWhitespaceHack: boolean): Promise<GitBlame | undefined> {
        let whitespacePromise: Promise<void> | undefined;
        // HACK: Until https://github.com/Microsoft/vscode/issues/11485 is fixed -- override whitespace (turn off)
        if (requiresWhitespaceHack) {
            whitespacePromise = this.whitespaceController && this.whitespaceController.override();
        }

        let blame: GitBlame;
        if (whitespacePromise) {
            [blame] = await Promise.all([this._blame, whitespacePromise]);
        }
        else {
            blame = await this._blame;
        }

        if (!blame || !blame.lines.length) {
            this.whitespaceController && await this.whitespaceController.restore();
            return undefined;
        }

        return blame;
    }
}